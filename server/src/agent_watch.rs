//! ターミナルセッションのエージェント状態判定（Python 側 `api/agent_watch.py` の移植）。
//!
//! 状態は3値（working / idle / blocked）。判定は3系統（優先度の高い順に
//! hooks > screen manifest > 画面差分）: hooks 由来の状態（`agent_hooks::hook_state`）
//! が新鮮な間はそれを最優先し、無ければ screen manifest（既知エージェントのみ）→
//! 画面差分の順にフォールバックする（`resolve_session_state`。hooks との合成は
//! `collect_agent_states` 側で行う）。
//!
//! `collect_agent_states` はポーリング1周期分の全セッション状態判定を行う
//! （tmux 問い合わせ→状態判定→ワークスペース/ジョブの自動紐付け→フレーズ通知判定
//! までを1関数にまとめた、Python 版 `collect_agent_states` の直接対応）。
//!
//! `AgentWatchState` / `ensure_tasks` / `maybe_stop_tasks` / `initial_snapshot` /
//! `poll_loop` がポーリングループ本体（Python `_poll_loop`/`subscribe`/
//! `unsubscribe`/`ensure_phrase_task` 相当）と push 通知連携
//! （`crate::push::send_push_notification` へネイティブに委譲、`tokio::spawn`
//! で fire-and-forget）を担う。status stream WS ハンドラの接続/切断
//! （`status_stream.rs`）から呼ぶ。

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;

use crate::foreground::ForegroundInspector;
use crate::job_match::JobPattern;
use crate::screen_manifest::{
    Manifest, ManifestStore, ADOPTED_STATES, STATE_BLOCKED, STATE_IDLE, STATE_WORKING,
};
use crate::state::AppState;
use crate::util::task_running;

/// Python `common.py` の同名定数と同じ値。
const AGENT_WATCH_POLL_INTERVAL_SEC: u64 = 2;

/// 可視ペインの内容からセッション状態を判定する純関数。
///
/// - 前回ポーリングから出力が変化していれば working（スピナー等の動きも拾う）
/// - 画面が静止していれば idle
pub fn classify_agent_state(capture: &str, prev_capture: Option<&str>) -> &'static str {
    match prev_capture {
        Some(prev) if prev != capture => STATE_WORKING,
        _ => STATE_IDLE,
    }
}

/// 画面差分と screen manifest を統合してセッション状態を決める。
///
/// 既知エージェント（manifest が特定済み）は manifest 判定
/// （blocked / working / idle）を優先し、確定しない場合
/// （ルール不一致・unknown・skip_state_update）は画面差分の結果を使う。
pub fn resolve_session_state(
    capture: &str,
    prev_capture: Option<&str>,
    manifest: Option<&Manifest>,
    pane_title: &str,
) -> String {
    let diff_state = classify_agent_state(capture, prev_capture).to_string();
    if let Some(manifest) = manifest {
        if let Some(manifest_state) =
            crate::screen_manifest::evaluate_state(manifest, capture, pane_title, "")
        {
            if ADOPTED_STATES.contains(&manifest_state.as_str()) {
                return manifest_state;
            }
        }
    }
    diff_state
}

/// blocked（許可待ち）への遷移かどうかを判定する純関数。直前が既に blocked
/// だった場合は false（画面差分等で同じ blocked が続けて評価されても、
/// 実際に許可待ちへ入った瞬間の1回だけ通知したいため）。
pub fn entered_blocked(new_state: &str, prev_state: Option<&str>) -> bool {
    new_state == STATE_BLOCKED && prev_state != Some(STATE_BLOCKED)
}

/// 前回配信から状態が変わったセッションだけを取り出す純関数。
pub fn diff_states(
    previous: &HashMap<String, String>,
    current: &HashMap<String, String>,
) -> HashMap<String, String> {
    current
        .iter()
        .filter(|(id, state)| previous.get(id.as_str()).map(|s| s.as_str()) != Some(state.as_str()))
        .map(|(id, state)| (id.clone(), state.clone()))
        .collect()
}

pub fn states_payload(states: &HashMap<String, String>) -> Value {
    let entries: Vec<Value> = states
        .iter()
        .map(|(session_id, state)| json!({"session_id": session_id, "state": state}))
        .collect();
    json!({"type": "agent_states", "states": entries})
}

pub fn phrase_notify_payload(session_id: &str, phrase: &str, workspace: Option<&str>) -> Value {
    json!({
        "type": "phrase_notify",
        "session_id": session_id,
        "phrase": phrase,
        "workspace": workspace,
    })
}

pub fn phrase_notify_clear_payload(session_id: &str) -> Value {
    json!({"type": "phrase_notify_clear", "session_id": session_id})
}

/// フレーズ通知の検出→猶予判定の状態を保持する（Python 側の
/// `_phrase_detected_at` / `_phrase_notified` / `_phrase_ws_notified` 相当。
/// モジュールグローバルの代わりにポーリングループが専有するインスタンスとして
/// 持つ設計にした）。
#[derive(Default)]
pub struct PhraseNotifyTracker {
    detected_at: HashMap<String, f64>,
    notified: HashSet<String>,
    ws_notified: HashSet<String>,
}

impl PhraseNotifyTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// `(should_push, should_clear_ws)` を返す。
    ///
    /// should_push: notify_phrase 検出から grace_sec 秒アクティビティが無ければ
    /// true。should_clear_ws: 検出後にアクティビティがあり push を見送った瞬間に
    /// true（タブ通知マークを取り消すタイミングとしてそのまま使う）。
    pub fn should_notify_phrase(
        &mut self,
        session_id: &str,
        notify_phrase: &str,
        capture: &str,
        changed: bool,
        now: f64,
        grace_sec: f64,
    ) -> (bool, bool) {
        if notify_phrase.is_empty() || !capture.contains(notify_phrase) {
            self.detected_at.remove(session_id);
            self.notified.remove(session_id);
            return (false, false);
        }
        if self.notified.contains(session_id) {
            return (false, false);
        }
        if !self.detected_at.contains_key(session_id) {
            // 初検出。フレーズ出現自体による変化は無視し、これ以降の変化だけを見る。
            self.detected_at.insert(session_id.to_string(), now);
            return (false, false);
        }
        if changed {
            // 検出後に画面が動いた = 見ていた とみなし、このフレーズ出現では通知しない。
            self.detected_at.remove(session_id);
            self.notified.insert(session_id.to_string());
            return (false, true);
        }
        if now - self.detected_at[session_id] >= grace_sec {
            self.notified.insert(session_id.to_string());
            self.detected_at.remove(session_id);
            return (true, false);
        }
        (false, false)
    }

    /// タブの通知マーク用の判定。push と違い「見ていたか」の推測猶予を待たず、
    /// 検出したポーリング周期で即座に true を返す（見れば消える表示のため
    /// 誤検知コストが低い）。フレーズが画面から消えたら次の出現でまた通知できる
    /// ようリセットする。
    pub fn should_ws_notify_phrase(
        &mut self,
        session_id: &str,
        notify_phrase: &str,
        capture: &str,
    ) -> bool {
        if notify_phrase.is_empty() || !capture.contains(notify_phrase) {
            self.ws_notified.remove(session_id);
            return false;
        }
        if self.ws_notified.contains(session_id) {
            return false;
        }
        self.ws_notified.insert(session_id.to_string());
        true
    }

    /// ポーリング1周期の終わりに、消えたセッションの残留状態を掃除する。
    pub fn prune(&mut self, live_session_ids: &HashSet<String>) {
        self.detected_at.retain(|k, _| live_session_ids.contains(k));
        self.notified.retain(|k| live_session_ids.contains(k));
        self.ws_notified.retain(|k| live_session_ids.contains(k));
    }
}

// ─── ポーリング1周期分の状態収集（tmux 問い合わせ + 自動紐付け）───────────────

/// `collect_agent_states` の戻り値（Python 版の4要素タプルに対応）。
pub struct CollectedStates {
    /// session_id → state。tmux コマンド自体が失敗した場合は None
    /// （呼び出し元は直前のスナップショットを保持し、空で上書きしない）。
    pub states: Option<HashMap<String, String>>,
    /// プッシュ通知すべき (session_id, phrase, workspace) のリスト（猶予あり）。
    pub notifications: Vec<(String, String, Option<String>)>,
    /// タブの通知マーク配信用の同形式のリスト（猶予なし・即時）。
    pub ws_notifications: Vec<(String, String, Option<String>)>,
    /// push を『見ていた』とみなして見送った session_id のリスト
    /// （タブ通知マークを出していれば同じ理由で取り消す）。
    pub ws_clear_session_ids: Vec<String>,
    /// 今回のポーリングで blocked に遷移した (session_id, workspace) のリスト。
    /// phrase 通知と異なり猶予は設けない（許可待ちは検知即時に知らせたいため）。
    pub blocked_notifications: Vec<(String, Option<String>)>,
}

/// セッションの (workspace, job_name) を返す。キャッシュ優先・tmux env で補完。
async fn session_meta(state: &AppState, session_id: &str) -> (Option<String>, Option<String>) {
    if let Some(cached) = state.terminal_registry.get(session_id).await {
        let session = cached.lock().await;
        return (session.workspace.clone(), session.job_name.clone());
    }
    let tmux_name = state.paths.tmux_session_name(session_id);
    let meta = crate::tmux::load_tmux_metadata(&tmux_name).await;
    (
        meta.get("TMUX_WORKSPACE").cloned(),
        meta.get("TMUX_JOB_NAME").cloned(),
    )
}

/// cwd 照合で判明したワークスペースをセッションへ刻印する。
///
/// 復元時の自動判定（`tmux::detect_workspace_from_tmux`）と同じ紐付けをライブの
/// セッションにも適用する。刻印されれば Git ピル・activity 帰属・ワークスペース
/// ジョブの照合対象化が有効になる。
async fn apply_workspace_tag(state: &AppState, session_id: &str, workspace: &str) {
    if let Some(cached) = state.terminal_registry.get(session_id).await {
        let mut session = cached.lock().await;
        session.set_workspace(Some(workspace.to_string()));
        session.save_workspace().await;
    } else {
        let tmux_name = state.paths.tmux_session_name(session_id);
        crate::tmux::set_environment(&tmux_name, &[("TMUX_WORKSPACE", workspace)]).await;
    }
    tracing::info!("auto-bound workspace session={session_id} workspace={workspace}");
    crate::session_watch::notify_session_workspace_bound(state, session_id, workspace);
}

/// 未紐付けセッションを cwd の最長前方一致で自動紐付けする（ADR 32）。
///
/// 既に紐付いているセッションはそのまま返す（上書きしない）。
async fn resolve_workspace(
    state: &AppState,
    session_id: &str,
    workspace: Option<String>,
    pane_path: &str,
) -> Option<String> {
    if workspace.is_some() || pane_path.is_empty() {
        return workspace;
    }
    let matched = crate::git_utils::match_workspace_with_worktree(&state.config, pane_path).await;
    if let Some(ws) = &matched {
        apply_workspace_tag(state, session_id, ws).await;
    }
    matched
}

/// 一致したジョブのメタデータをセッションへ刻印する。
///
/// 刻印されれば notify_phrase・アイコン表示など既存のジョブ機構が次のポーリング
/// 以降そのまま有効になる。`jobs` は照合に使った候補ジョブ（label/icon 引き当て用）。
async fn apply_job_tag(
    state: &AppState,
    session_id: &str,
    pattern: &JobPattern,
    jobs: &Map<String, Value>,
) {
    let entry = jobs.get(&pattern.name);
    let label = entry
        .and_then(|e| e.get("label"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(&pattern.name)
        .to_string();
    let icon = entry
        .and_then(|e| e.get("icon"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let icon_color = entry
        .and_then(|e| e.get("icon_color"))
        .and_then(Value::as_str)
        .unwrap_or("");

    // 素のターミナル起動時にクライアントが送る仮アイコン（ui/composables/
    // useTerminalLifecycle.ts の `jobName ? ... : "mdi-console"` と同じ値）。
    // 「未設定」と区別が付かないため、この値の時もジョブのアイコンで
    // 上書きしてよい（そうしないと素のターミナルが常にこの仮アイコンのまま
    // 固定され、動的検出されたジョブのアイコンが一切反映されなかった）。
    const BARE_TERMINAL_ICON: &str = "mdi-console";

    if let Some(cached) = state.terminal_registry.get(session_id).await {
        let mut session = cached.lock().await;
        session.job_name = Some(pattern.name.clone());
        session.job_label = Some(label.clone());
        let has_custom_icon = !matches!(
            session.icon.as_deref(),
            None | Some("") | Some(BARE_TERMINAL_ICON)
        );
        if !has_custom_icon && !icon.is_empty() {
            session.icon = Some(icon.to_string());
            session.icon_color = Some(icon_color.to_string());
        }
        session.save_metadata().await;
    } else {
        let tmux_name = state.paths.tmux_session_name(session_id);
        crate::tmux::set_environment(
            &tmux_name,
            &[
                ("TMUX_JOB_NAME", pattern.name.as_str()),
                ("TMUX_JOB_LABEL", label.as_str()),
            ],
        )
        .await;
    }
    tracing::info!("auto-tagged job session={session_id} job={}", pattern.name);
    crate::session_watch::notify_session_job_bound(
        state,
        session_id,
        &pattern.name,
        &label,
        icon,
        icon_color,
    );
}

/// 未タグのセッションで前面ジョブがジョブ定義と一致したらタグ付けする。
///
/// 既にジョブタグのあるセッション（明示起動・過去の自動タグとも）は上書きしない。
/// 照合は完全一致のみ（`job_match.rs`）。
async fn maybe_autotag_job(
    state: &AppState,
    session_id: &str,
    workspace: Option<&str>,
    job_name: Option<&str>,
    pane_pid: i64,
    argvs: Option<Vec<Vec<String>>>,
    inspector: &mut ForegroundInspector,
) {
    if job_name.is_some() || pane_pid <= 0 {
        return;
    }
    let argvs = match argvs {
        Some(a) => a,
        None => inspector.argvs(pane_pid as i32).await,
    };
    if argvs.is_empty() {
        return;
    }
    let jobs = crate::job_match::candidate_jobs(state, workspace);
    let patterns = crate::job_match::build_job_patterns(&jobs);
    if let Some(pattern) = crate::job_match::match_job(&argvs, &patterns) {
        apply_job_tag(state, session_id, pattern, &jobs).await;
    }
}

/// エージェント特定。プロセス名で当たらなければ前面ジョブの argv で再照合する。
///
/// 戻り値の argvs はラッパー照合のために取得した場合のみ非 None
/// （ジョブ照合で再利用し、前面ジョブ取得の二重実行を避ける）。
async fn detect_manifest(
    store: &ManifestStore,
    pane_command: &str,
    pane_pid: i64,
    inspector: &mut ForegroundInspector,
) -> (Option<Arc<Manifest>>, Option<Vec<Vec<String>>>) {
    if let Some(manifest) = store.identify_agent(Some(pane_command)) {
        return (Some(manifest), None);
    }
    if pane_pid <= 0 {
        return (None, None);
    }
    let argvs = inspector.argvs(pane_pid as i32).await;
    let manifest = store.identify_agent_from_argvs(&argvs);
    (manifest, Some(argvs))
}

/// セッションを起動したジョブ定義から notify_phrase を引く（ジョブ無しは空文字）。
fn job_notify_phrase(state: &AppState, workspace: Option<&str>, job_name: Option<&str>) -> String {
    let Some(job_name) = job_name else {
        return String::new();
    };
    let entry = match workspace {
        Some(ws) if !ws.is_empty() => crate::jobs_common::serialize_workspace_jobs(state, ws)
            .get(job_name)
            .cloned(),
        _ => crate::jobs_common::load_common_jobs_data(state)
            .get(job_name)
            .cloned(),
    };
    entry
        .and_then(|e| {
            e.get("notify_phrase")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

/// 全ターミナルセッションの状態を判定して返す（ポーリング1周期分）。
///
/// `last_capture` / `tracker` はポーリングループが自身のローカル変数として
/// 周期をまたいで保持する（Python 版のモジュールグローバル `_last_capture` /
/// `_phrase_detected_at` 等に対応 — ここでは呼び出し元が所有するだけの違い）。
pub async fn collect_agent_states(
    state: &AppState,
    manifest_store: &ManifestStore,
    last_capture: &mut HashMap<String, String>,
    last_pane_size: &mut HashMap<String, (i64, i64)>,
    tracker: &mut PhraseNotifyTracker,
    prev_states: &HashMap<String, String>,
    now: f64,
) -> CollectedStates {
    let Some(session_ids) = crate::tmux::list_session_ids(&state.paths.tmux_prefix).await else {
        return CollectedStates {
            states: None,
            notifications: Vec::new(),
            ws_notifications: Vec::new(),
            ws_clear_session_ids: Vec::new(),
            blocked_notifications: Vec::new(),
        };
    };

    let mut states = HashMap::new();
    let mut notifications = Vec::new();
    let mut ws_notifications = Vec::new();
    let mut ws_clear_session_ids = Vec::new();
    let mut blocked_notifications = Vec::new();
    let grace_sec = crate::settings::notification_grace_sec(&state.config) as f64;
    // manifest 判定・ジョブ照合用の (前面プロセス名, タイトル, シェル PID, cwd)。
    // 周期あたり tmux 1 回で全取得。前面ジョブの argv は必要になったときだけ
    // inspector 経由で取得する。
    let pane_meta = crate::tmux::list_pane_meta().await;
    let mut inspector = ForegroundInspector::new();

    for session_id in &session_ids {
        let tmux_name = state.paths.tmux_session_name(session_id);
        let Some(capture) = crate::tmux::capture_visible_pane(&tmux_name).await else {
            continue;
        };
        let (workspace, job_name) = session_meta(state, session_id).await;
        let (pane_command, pane_title, pane_pid, pane_path, pane_size) = pane_meta
            .get(&tmux_name)
            .cloned()
            .unwrap_or_else(|| (String::new(), String::new(), 0, String::new(), (0, 0)));
        let workspace = resolve_workspace(state, session_id, workspace, &pane_path).await;
        let notify_phrase = job_notify_phrase(state, workspace.as_deref(), job_name.as_deref());
        let prev_capture = last_capture.get(session_id).cloned();

        // tmux はアタッチ中クライアントの端末幅に合わせてペイン内容を再フロー
        // （折り返し直し）するため、実際の出力に変化が無くてもリサイズだけで
        // capture-pane の全文が変わってしまう（phone/PC間の行き来やブラウザの
        // ウィンドウ幅変更で頻発）。リサイズを検知した周期は画面差分による
        // working判定を1周期分だけ抑制する（比較対象なし＝idle扱いにする。
        // 次周期はリサイズ後の内容同士を比較するので通常通り機能する）。
        let resized = last_pane_size
            .get(session_id)
            .is_some_and(|prev| *prev != pane_size);
        let diff_prev_capture = if resized {
            None
        } else {
            prev_capture.as_deref()
        };

        // hooks 由来の状態が新鮮ならそれを最優先し、manifest 評価は省略する
        // （エージェント特定・argv 取得はジョブ照合が必要になれば遅延実行される）。
        let mut argvs: Option<Vec<Vec<String>>> = None;
        let new_state = match crate::agent_hooks::hook_state(state, session_id) {
            Some(hooked) => hooked,
            None => {
                let (manifest, a) =
                    detect_manifest(manifest_store, &pane_command, pane_pid, &mut inspector).await;
                argvs = a;
                resolve_session_state(
                    &capture,
                    diff_prev_capture,
                    manifest.as_deref(),
                    &pane_title,
                )
            }
        };
        if entered_blocked(&new_state, prev_states.get(session_id).map(String::as_str)) {
            blocked_notifications.push((session_id.clone(), workspace.clone()));
        }
        states.insert(session_id.clone(), new_state);

        maybe_autotag_job(
            state,
            session_id,
            workspace.as_deref(),
            job_name.as_deref(),
            pane_pid,
            argvs,
            &mut inspector,
        )
        .await;

        let changed = prev_capture.as_deref().is_some_and(|p| p != capture);
        let (should_push, should_clear_ws) = tracker.should_notify_phrase(
            session_id,
            &notify_phrase,
            &capture,
            changed,
            now,
            grace_sec,
        );
        if should_push {
            notifications.push((session_id.clone(), notify_phrase.clone(), workspace.clone()));
        }
        if should_clear_ws {
            ws_clear_session_ids.push(session_id.clone());
        }
        if tracker.should_ws_notify_phrase(session_id, &notify_phrase, &capture) {
            ws_notifications.push((session_id.clone(), notify_phrase, workspace));
        }
        last_capture.insert(session_id.clone(), capture);
        last_pane_size.insert(session_id.clone(), pane_size);
    }

    let live: HashSet<String> = states.keys().cloned().collect();
    last_capture.retain(|k, _| live.contains(k));
    last_pane_size.retain(|k, _| live.contains(k));
    tracker.prune(&live);

    CollectedStates {
        states: Some(states),
        notifications,
        ws_notifications,
        ws_clear_session_ids,
        blocked_notifications,
    }
}

// ─── 購読者連動ポーリングループ（Python 版 `subscribe`/`unsubscribe`/
// `ensure_phrase_task`/`_poll_loop` 相当）────────────────────────────────────

/// agent_watch の常駐ポーリングタスクとポーリング間で持ち越す状態を保持する。
pub struct AgentWatchState {
    poll_task: std::sync::Mutex<Option<JoinHandle<()>>>,
    last_capture: AsyncMutex<HashMap<String, String>>,
    /// リサイズ検知用の前回ペインサイズ（`collect_agent_states` 参照）。
    last_pane_size: AsyncMutex<HashMap<String, (i64, i64)>>,
    tracker: AsyncMutex<PhraseNotifyTracker>,
    /// 前回配信した状態一式（`states_payload` の差分計算・新規接続への
    /// 即時スナップショット送信に使う — Python `_last_states` 相当）。
    last_states: AsyncMutex<HashMap<String, String>>,
}

impl AgentWatchState {
    pub fn new() -> Self {
        Self {
            poll_task: std::sync::Mutex::new(None),
            last_capture: AsyncMutex::new(HashMap::new()),
            last_pane_size: AsyncMutex::new(HashMap::new()),
            tracker: AsyncMutex::new(PhraseNotifyTracker::new()),
            last_states: AsyncMutex::new(HashMap::new()),
        }
    }
}

impl Default for AgentWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// push subscription が1件以上登録されているか（Python `push.has_subscriptions`
/// 相当）。
fn has_push_subscriptions(state: &AppState) -> bool {
    crate::push::has_subscriptions(&state.paths.data_dir)
}

/// 購読開始時に呼ぶ（status stream WS ハンドラから）。ポーリングタスクが
/// 動いていなければ起動する（Python `ensure_phrase_task` 相当）。
pub fn ensure_tasks(state: &Arc<AppState>) {
    let mut task = state
        .agent_watch
        .poll_task
        .lock()
        .expect("agent_watch state poisoned");
    if !task_running(&task) {
        *task = Some(tokio::spawn(poll_loop(state.clone())));
    }
}

/// 購読解除時に呼ぶ。全体の購読者（`StatusStreamState`）・push subscription が
/// どちらも無ければタスクを停止する（Python `unsubscribe`/`_stop_task` 相当）。
pub fn maybe_stop_tasks(state: &Arc<AppState>) {
    if state.status_stream.subscriber_count() > 0 || has_push_subscriptions(state) {
        return;
    }
    if let Some(h) = state
        .agent_watch
        .poll_task
        .lock()
        .expect("agent_watch state poisoned")
        .take()
    {
        h.abort();
    }
    // Python `_stop_task` と同じく、タスク停止時にポーリング間の持ち越し状態も
    // 破棄する（次回起動時はまっさらな状態から再構築する）。
    let state = state.clone();
    tokio::spawn(async move {
        *state.agent_watch.last_capture.lock().await = HashMap::new();
        *state.agent_watch.last_pane_size.lock().await = HashMap::new();
        *state.agent_watch.tracker.lock().await = PhraseNotifyTracker::new();
        *state.agent_watch.last_states.lock().await = HashMap::new();
    });
}

/// 新規接続への即時スナップショット（Python `subscribe` が
/// `websocket.send_json(states_payload(_last_states))` を直送する処理に対応）。
/// 既知の状態が無ければ None（何も送らない）。
pub async fn initial_snapshot(state: &Arc<AppState>) -> Option<Value> {
    let last_states = state.agent_watch.last_states.lock().await;
    if last_states.is_empty() {
        None
    } else {
        Some(states_payload(&last_states))
    }
}

async fn poll_loop(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(Duration::from_secs(AGENT_WATCH_POLL_INTERVAL_SEC)).await;
        if state.status_stream.subscriber_count() == 0 && !has_push_subscriptions(&state) {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let mut last_states = state.agent_watch.last_states.lock().await;
        let collected = {
            let mut last_capture = state.agent_watch.last_capture.lock().await;
            let mut last_pane_size = state.agent_watch.last_pane_size.lock().await;
            let mut tracker = state.agent_watch.tracker.lock().await;
            collect_agent_states(
                &state,
                &state.manifest_store,
                &mut last_capture,
                &mut last_pane_size,
                &mut tracker,
                &last_states,
                now,
            )
            .await
        };
        let Some(states) = collected.states else {
            // tmux コマンド自体が一時的に失敗。直前のスナップショットを保持して
            // 次の周期に委ね、状態を空で上書きしない。
            continue;
        };
        let changed = diff_states(&last_states, &states);
        *last_states = states;
        drop(last_states);
        if !changed.is_empty() {
            state.status_stream.broadcast(states_payload(&changed));
        }
        // タブの通知マークは見れば消える表示なので、push の猶予を待たず検出即時に配信する。
        for (session_id, phrase, workspace) in &collected.ws_notifications {
            state.status_stream.broadcast(phrase_notify_payload(
                session_id,
                phrase,
                workspace.as_deref(),
            ));
        }
        // push を『見ていた』とみなして見送った session は、出していたタブ通知マークも取り消す。
        for session_id in &collected.ws_clear_session_ids {
            state
                .status_stream
                .broadcast(phrase_notify_clear_payload(session_id));
        }
        for (session_id, phrase, workspace) in &collected.notifications {
            let body = match workspace {
                Some(w) => format!("{w}: {phrase}"),
                None => phrase.clone(),
            };
            crate::push::spawn_push_notification(
                &state,
                "Phrase detected",
                body,
                format!("/?session={session_id}"),
                "phrase",
                Some(session_id.clone()),
            );
        }
        // blocked（許可待ち）遷移は phrase と異なり猶予を設けず即時 push する
        // （入力待ちは早く気づけるほど良いため）。
        for (session_id, workspace) in &collected.blocked_notifications {
            let body = match workspace {
                Some(w) => format!("{w}: waiting for your input"),
                None => "waiting for your input".to_string(),
            };
            crate::push::spawn_push_notification(
                &state,
                "Agent blocked",
                body,
                format!("/?session={session_id}"),
                "blocked",
                Some(session_id.clone()),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // ─── classify_agent_state ────────────────────────────────────────────

    #[test]
    fn output_change_is_working() {
        assert_eq!(
            classify_agent_state("spinner /", Some("spinner -")),
            STATE_WORKING
        );
    }

    #[test]
    fn static_screen_is_idle() {
        let text = "$ ls\nREADME.md\n$ ";
        assert_eq!(classify_agent_state(text, Some(text)), STATE_IDLE);
    }

    #[test]
    fn first_poll_is_idle() {
        assert_eq!(classify_agent_state("anything", None), STATE_IDLE);
    }

    // ─── diff_states ─────────────────────────────────────────────────────

    #[test]
    fn only_changed_entries_are_returned() {
        let prev = map(&[("a", "working"), ("b", "idle")]);
        let cur = map(&[("a", "working"), ("b", "working"), ("c", "idle")]);
        assert_eq!(
            diff_states(&prev, &cur),
            map(&[("b", "working"), ("c", "idle")])
        );
    }

    #[test]
    fn removed_sessions_are_not_reported() {
        let prev = map(&[("a", "working")]);
        let cur = HashMap::new();
        assert!(diff_states(&prev, &cur).is_empty());
    }

    // ─── entered_blocked ─────────────────────────────────────────────────

    #[test]
    fn working_to_blocked_is_entered_blocked() {
        assert!(entered_blocked("blocked", Some("working")));
    }

    #[test]
    fn idle_to_blocked_is_entered_blocked() {
        assert!(entered_blocked("blocked", Some("idle")));
    }

    #[test]
    fn first_seen_blocked_is_entered_blocked() {
        assert!(entered_blocked("blocked", None));
    }

    #[test]
    fn staying_blocked_is_not_entered_blocked() {
        assert!(!entered_blocked("blocked", Some("blocked")));
    }

    #[test]
    fn non_blocked_state_is_not_entered_blocked() {
        assert!(!entered_blocked("working", Some("idle")));
        assert!(!entered_blocked("idle", Some("blocked")));
    }

    // ─── payload shapes ──────────────────────────────────────────────────

    #[test]
    fn states_payload_shape() {
        let payload = states_payload(&map(&[("s1", "idle")]));
        assert_eq!(
            payload,
            json!({"type": "agent_states", "states": [{"session_id": "s1", "state": "idle"}]})
        );
    }

    #[test]
    fn phrase_notify_payload_shape() {
        let payload = phrase_notify_payload("s1", "done!", Some("my-ws"));
        assert_eq!(
            payload,
            json!({"type": "phrase_notify", "session_id": "s1", "phrase": "done!", "workspace": "my-ws"})
        );
    }

    #[test]
    fn phrase_notify_payload_workspace_none_is_preserved() {
        let payload = phrase_notify_payload("s1", "done!", None);
        assert_eq!(payload["workspace"], Value::Null);
    }

    #[test]
    fn phrase_notify_clear_payload_shape() {
        assert_eq!(
            phrase_notify_clear_payload("s1"),
            json!({"type": "phrase_notify_clear", "session_id": "s1"})
        );
    }

    // ─── resolve_session_state（screen manifest 統合）─────────────────────

    fn bundled_store() -> (ManifestStore, tempfile::TempDir) {
        let manifest_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../agent_manifests");
        let dir = tempfile::tempdir().unwrap();
        (ManifestStore::new(manifest_dir, dir.path()), dir)
    }

    #[test]
    fn claude_permission_prompt_marks_blocked() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen = "Running command...\n\
             ──────────────────────────────\n\
             Do you want to proceed?\n\
             ❯ 1. Yes\n  2. No\nesc to cancel\n";
        assert_eq!(
            resolve_session_state(screen, None, Some(&claude), ""),
            "blocked"
        );
    }

    #[test]
    fn blocked_overrides_working_screen_diff() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let base = "──────────────────────────────\nDo you want to proceed?\n❯ 1. Yes\n  2. No\nesc to cancel\n";
        let next = format!("{base}tick\n");
        assert_eq!(
            resolve_session_state(&next, Some(base), Some(&claude), ""),
            "blocked"
        );
    }

    #[test]
    fn unknown_agent_keeps_diff_based_state() {
        let screen = "Do you want to proceed?\n❯ 1. Yes\n  2. No\nesc to cancel\n";
        assert_eq!(resolve_session_state(screen, None, None, ""), "idle");
    }

    #[test]
    fn manifest_idle_overrides_screen_diff() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let box_ = "──────────\n❯ \n──────────\n";
        let prev = format!("output tick 1\n{box_}");
        let cur = format!("output tick 2\n{box_}");
        assert_eq!(
            resolve_session_state(&cur, Some(&prev), Some(&claude), ""),
            "idle"
        );
    }

    #[test]
    fn osc_title_spinner_marks_working_on_static_screen() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen = "static output";
        assert_eq!(
            resolve_session_state(screen, Some(screen), Some(&claude), "⠋ Thinking…"),
            "working"
        );
    }

    // ─── PhraseNotifyTracker ─────────────────────────────────────────────

    #[test]
    fn no_phrase_present_never_notifies() {
        let mut tracker = PhraseNotifyTracker::new();
        let (push, clear) =
            tracker.should_notify_phrase("s1", "done", "still running", false, 0.0, 20.0);
        assert_eq!((push, clear), (false, false));
        assert!(!tracker.should_ws_notify_phrase("s1", "done", "still running"));
    }

    #[test]
    fn first_detection_does_not_push_immediately() {
        let mut tracker = PhraseNotifyTracker::new();
        let (push, clear) = tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        assert_eq!((push, clear), (false, false));
    }

    #[test]
    fn grace_period_elapsed_without_activity_pushes() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        let (push, clear) = tracker.should_notify_phrase("s1", "done", "done!", false, 121.0, 20.0);
        assert_eq!((push, clear), (true, false));
        // 通知済みなので、以後は同じフレーズが出続けても再通知しない
        let (push2, _) = tracker.should_notify_phrase("s1", "done", "done!", false, 200.0, 20.0);
        assert!(!push2);
    }

    #[test]
    fn activity_after_detection_suppresses_and_clears() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        let (push, clear) =
            tracker.should_notify_phrase("s1", "done", "done! tick", true, 105.0, 20.0);
        assert_eq!((push, clear), (false, true));
        // 見送った後、フレーズが再検出されればまた新規検出として扱う
        let (push2, _) =
            tracker.should_notify_phrase("s1", "done", "done! tick2", true, 106.0, 20.0);
        assert!(!push2);
    }

    #[test]
    fn phrase_disappearing_resets_detection() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        tracker.should_notify_phrase("s1", "done", "no phrase here", false, 105.0, 20.0);
        // 消えた後に再出現すれば、また初検出扱いになる（即座には通知しない）
        let (push, _) = tracker.should_notify_phrase("s1", "done", "done!", false, 106.0, 20.0);
        assert!(!push);
    }

    #[test]
    fn ws_notify_fires_immediately_and_only_once_per_appearance() {
        let mut tracker = PhraseNotifyTracker::new();
        assert!(tracker.should_ws_notify_phrase("s1", "done", "done!"));
        assert!(!tracker.should_ws_notify_phrase("s1", "done", "done! still here"));
        assert!(!tracker.should_ws_notify_phrase("s1", "done", "gone now"));
        assert!(tracker.should_ws_notify_phrase("s1", "done", "done! again"));
    }

    #[test]
    fn prune_removes_stale_sessions() {
        let mut tracker = PhraseNotifyTracker::new();
        tracker.should_notify_phrase("s1", "done", "done!", false, 100.0, 20.0);
        tracker.should_ws_notify_phrase("s2", "done", "done!");
        tracker.prune(&HashSet::from(["s2".to_string()]));
        // s1 の検出時刻は消えているので、再検出扱いになり即座には通知しない
        let (push, _) = tracker.should_notify_phrase("s1", "done", "done!", false, 100.5, 20.0);
        assert!(!push);
    }
}

/// `collect_agent_states` の実 tmux 統合テスト。純粋ロジック側（`PhraseNotifyTracker`
/// 等）は上の `tests` モジュールで検証済みのため、ここでは配線（tmux 問い合わせ →
/// 状態判定 → 自動紐付け → 通知判定）が実際の tmux・TerminalRegistry・config と
/// 噛み合っていることを確認する。
#[cfg(test)]
mod collect_agent_states_tests {
    use super::*;
    use serde_json::json;

    /// テストが作った実tmuxセッションを、途中の `assert!` がpanicして
    /// アーリーリターンした場合でも確実にkillするためのRAIIガード
    /// （Codexレビュー指摘: 従来は末尾に `kill_tmux_by_name(...).await` を
    /// 書くだけだったため、その手前のassertが失敗するとkillされずに
    /// セッションが残り続けていた。tempdir（ワークスペースのcwd）は
    /// TempDirのDropで削除されるため、残ったtmuxセッションのシェルだけが
    /// 存在しないディレクトリを指す不整合な状態になる）。
    /// `kill_tmux_by_name` は非同期だが `Drop` は同期しか呼べないため、
    /// ここでは同じ `tmux kill-session` をブロッキングで直接叩く
    /// （テスト専用・ベストエフォート、失敗しても無視する）。
    struct TmuxSessionGuard(String);

    impl Drop for TmuxSessionGuard {
        fn drop(&mut self) {
            let _ = std::process::Command::new("tmux")
                .args(["kill-session", "-t", &self.0])
                .output();
        }
    }

    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        // 並行テストで tmux セッション名が衝突しないようランごとにランダム化する。
        let prefix = format!("ac-awtest-{}-", crate::util::token_hex(4));
        let state = crate::state::test_app_state(dir.path(), &prefix, 1000);
        (state, dir)
    }

    async fn create_session(
        state: &AppState,
        workspace_path: Option<&str>,
        workspace: Option<&str>,
        job_name: Option<&str>,
    ) -> String {
        let (session_id, _) = state
            .terminal_registry
            .create_registered_session(
                &state.paths.data_dir,
                &state.config,
                &state.paths.project_root,
                &state.paths.tmux_prefix,
                workspace_path,
                workspace.map(str::to_string),
                None,
                None,
                job_name.map(str::to_string),
                None,
                false,
            )
            .await
            .expect("session should be created");
        let tmux_name = state.paths.tmux_session_name(&session_id);
        assert!(
            crate::tmux::wait_pane_ready(&tmux_name, crate::tmux::TMUX_PANE_READY_TIMEOUT_SEC)
                .await
        );
        session_id
    }

    #[tokio::test]
    async fn zero_sessions_returns_empty_states() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let (state, dir) = test_state();
        let store = ManifestStore::new(dir.path().join("agent_manifests"), dir.path());
        let mut last_capture = HashMap::new();
        let mut last_pane_size = HashMap::new();
        let mut tracker = PhraseNotifyTracker::new();
        let result = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            0.0,
        )
        .await;
        assert_eq!(result.states, Some(HashMap::new()));
        assert!(result.notifications.is_empty());
    }

    #[tokio::test]
    async fn activity_between_polls_toggles_working_and_idle() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let (state, dir) = test_state();
        let store = ManifestStore::new(dir.path().join("agent_manifests"), dir.path());
        let session_id = create_session(&state, None, None, None).await;
        let tmux_name = state.paths.tmux_session_name(&session_id);
        let _guard = TmuxSessionGuard(tmux_name.clone());

        let mut last_capture = HashMap::new();
        let mut last_pane_size = HashMap::new();
        let mut tracker = PhraseNotifyTracker::new();

        // 初回ポーリング: 比較対象が無いので idle。
        let r1 = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            0.0,
        )
        .await;
        assert_eq!(
            r1.states
                .as_ref()
                .unwrap()
                .get(&session_id)
                .map(String::as_str),
            Some(STATE_IDLE)
        );

        // 画面を変化させる。
        // 固定sleep + 単発assertは、CI等の低速環境ではtmuxの実際の再描画
        // タイミングに間に合わず稀に落ちていた（flaky）。実際に期待状態へ
        // 収束するまでポーリングする（最大2秒、100msごと）。
        assert!(crate::tmux::send_keys_to_tmux(&tmux_name, "echo activity-marker", true).await);
        let mut now = 1.0;
        let got = poll_state(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &session_id,
            STATE_WORKING,
            &mut now,
        )
        .await;
        assert_eq!(got.as_deref(), Some(STATE_WORKING));

        // 画面が静止すれば idle に戻る。
        let got = poll_state(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &session_id,
            STATE_IDLE,
            &mut now,
        )
        .await;
        assert_eq!(got.as_deref(), Some(STATE_IDLE));
    }

    /// 最新の状態を返すまで最大2秒（100msごと）ポーリングする（実tmuxの
    /// タイミング依存によるテストのflakinessを避けるためのテスト専用ヘルパー）。
    #[allow(clippy::too_many_arguments)]
    async fn poll_state(
        state: &AppState,
        store: &ManifestStore,
        last_capture: &mut HashMap<String, String>,
        last_pane_size: &mut HashMap<String, (i64, i64)>,
        tracker: &mut PhraseNotifyTracker,
        session_id: &str,
        expected: &str,
        now: &mut f64,
    ) -> Option<String> {
        let mut last = None;
        for _ in 0..20 {
            let result = collect_agent_states(
                state,
                store,
                last_capture,
                last_pane_size,
                tracker,
                &HashMap::new(),
                *now,
            )
            .await;
            *now += 1.0;
            last = result.states.and_then(|s| s.get(session_id).cloned());
            if last.as_deref() == Some(expected) {
                return last;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        last
    }

    /// resize（capture-pane の再フローで全文が変わるが、実際の出力は何も
    /// 変わっていない）だけでは working に化けないことを確認する
    /// （リサイズ検知して1周期だけ画面差分を抑制する仕組みの回帰ガード）。
    #[tokio::test]
    async fn resize_between_polls_does_not_flip_to_working() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let (state, dir) = test_state();
        let store = ManifestStore::new(dir.path().join("agent_manifests"), dir.path());
        let session_id = create_session(&state, None, None, None).await;
        let tmux_name = state.paths.tmux_session_name(&session_id);
        let _guard = TmuxSessionGuard(tmux_name.clone());

        let mut last_capture = HashMap::new();
        let mut last_pane_size = HashMap::new();
        let mut tracker = PhraseNotifyTracker::new();

        // 初回ポーリング: 比較対象が無いので idle。
        let r1 = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            0.0,
        )
        .await;
        assert_eq!(
            r1.states
                .as_ref()
                .unwrap()
                .get(&session_id)
                .map(String::as_str),
            Some(STATE_IDLE)
        );

        // 実際の出力は変えず、ペイン幅だけ変える（80 → 40。tmux が内容を
        // 再フローするため capture-pane -p の全文は変わる）。
        assert!(crate::subprocess::run_tmux_cmd(&[
            "resize-window",
            "-t",
            &tmux_name,
            "-x",
            "40",
            "-y",
            "24",
        ])
        .await
        .is_some_and(|r| r.success()));
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let r2 = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            1.0,
        )
        .await;
        assert_eq!(
            r2.states
                .as_ref()
                .unwrap()
                .get(&session_id)
                .map(String::as_str),
            Some(STATE_IDLE),
            "resize alone must not be reported as working"
        );
    }

    #[tokio::test]
    async fn notify_phrase_via_cached_session_waits_for_grace_period() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let (state, dir) = test_state();
        let store = ManifestStore::new(dir.path().join("agent_manifests"), dir.path());

        let mut jobs = serde_json::Map::new();
        jobs.insert(
            "agent".to_string(),
            json!({"label": "agent", "command": "claude", "notify_phrase": "FINISHED"}),
        );
        crate::jobs_common::save_common_jobs_data(&state, jobs).unwrap();
        state
            .config
            .save_global_section("notifications", json!({"phrase_notify_grace_sec": 0}))
            .unwrap();

        let session_id = create_session(&state, None, None, Some("agent")).await;
        let tmux_name = state.paths.tmux_session_name(&session_id);
        let _guard = TmuxSessionGuard(tmux_name.clone());
        assert!(crate::tmux::send_keys_to_tmux(&tmux_name, "echo FINISHED", true).await);
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let mut last_capture = HashMap::new();
        let mut last_pane_size = HashMap::new();
        let mut tracker = PhraseNotifyTracker::new();

        // 初検出のポーリングでは通知しない。
        let r1 = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            100.0,
        )
        .await;
        assert!(r1.notifications.is_empty());
        assert!(r1
            .ws_notifications
            .iter()
            .any(|(id, phrase, _)| id == &session_id && phrase == "FINISHED"));

        // 画面が変わらないまま次のポーリング → 猶予(0)経過で通知される。
        let r2 = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            100.5,
        )
        .await;
        assert!(r2
            .notifications
            .iter()
            .any(|(id, phrase, _)| id == &session_id && phrase == "FINISHED"));
    }

    #[tokio::test]
    async fn workspace_auto_bind_via_cwd() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let (state, dir) = test_state();
        let store = ManifestStore::new(dir.path().join("agent_manifests"), dir.path());

        let ws_dir = dir.path().join("proj");
        std::fs::create_dir_all(&ws_dir).unwrap();
        // macOSでは /tmp・/var がシンボリックリンク（実体は /private/tmp・
        // /private/var）で、tmuxが報告する pane_current_path はOSレベルで
        // realpath解決済みの値になる。tempfile::tempdir() が返す非正規化パス
        // （/var/folders/...）をそのまま設定してしまうと、実際のcwd
        // （/private/var/folders/...）と文字列として一致せず
        // match_workspace_by_path が常に不一致になる（タイミングの問題では
        // なく恒久的な不一致 — 以前はこれを「まれに失敗するflaky」と誤認して
        // いた）。実環境のtmuxと同じ土俵で比較するため、テスト側でも
        // canonicalize してから設定する。
        let ws_dir_canonical = std::fs::canonicalize(&ws_dir).unwrap();
        let mut cfg = state.config.load_all();
        cfg.insert(
            "proj".to_string(),
            json!({"name": "proj", "path": ws_dir_canonical.to_string_lossy()}),
        );
        state.config.save_all(&cfg).unwrap();

        let session_id = create_session(&state, Some(ws_dir.to_str().unwrap()), None, None).await;
        let tmux_name = state.paths.tmux_session_name(&session_id);
        let _guard = TmuxSessionGuard(tmux_name.clone());

        let mut rx = state.status_stream.tx.subscribe();
        let mut last_capture = HashMap::new();
        let mut last_pane_size = HashMap::new();
        let mut tracker = PhraseNotifyTracker::new();
        let result = collect_agent_states(
            &state,
            &store,
            &mut last_capture,
            &mut last_pane_size,
            &mut tracker,
            &HashMap::new(),
            0.0,
        )
        .await;
        assert!(result.states.unwrap().contains_key(&session_id));

        let cached = state.terminal_registry.get(&session_id).await.unwrap();
        assert_eq!(cached.lock().await.workspace.as_deref(), Some("proj"));

        let broadcast = rx.recv().await.unwrap();
        assert_eq!(broadcast["type"], "session_workspace_bound");
        assert_eq!(broadcast["session_id"], session_id);
        assert_eq!(broadcast["workspace"], "proj");
    }

    #[tokio::test]
    async fn job_auto_tag_via_foreground_argv() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let (state, dir) = test_state();
        let store = ManifestStore::new(dir.path().join("agent_manifests"), dir.path());

        let mut jobs = serde_json::Map::new();
        jobs.insert(
            "long-sleep".to_string(),
            json!({"label": "Long Sleep", "command": "sleep 987654321"}),
        );
        crate::jobs_common::save_common_jobs_data(&state, jobs).unwrap();

        let session_id = create_session(&state, None, None, None).await;
        let tmux_name = state.paths.tmux_session_name(&session_id);
        // sleepプロセスはセッションと一緒にこのガードのkillで後始末される。
        let _guard = TmuxSessionGuard(tmux_name.clone());
        assert!(crate::tmux::send_keys_to_tmux(&tmux_name, "sleep 987654321", true).await);

        let mut rx = state.status_stream.tx.subscribe();
        let mut last_capture = HashMap::new();
        let mut last_pane_size = HashMap::new();
        let mut tracker = PhraseNotifyTracker::new();
        let cached = state.terminal_registry.get(&session_id).await.unwrap();
        // 固定sleep + 単発pollは、CI等の低速環境ではtmuxのpane_current_command
        // がまだ旧シェルのままのタイミングに引っかかり稀に落ちていた（flaky）。
        // foregroundがsleepへ実際に切り替わるまでポーリングする。新規シェルの
        // プロンプト初期化（同期的な外部コマンド呼び出しを含むテーマ等）が
        // 遅い環境では切り替わりに数秒かかることがあるため、20回=2秒では
        // 足りず稀に落ちていた。150回=15秒まで許容する。
        let mut tagged = false;
        for i in 0..150 {
            collect_agent_states(
                &state,
                &store,
                &mut last_capture,
                &mut last_pane_size,
                &mut tracker,
                &HashMap::new(),
                i as f64,
            )
            .await;
            if cached.lock().await.job_name.as_deref() == Some("long-sleep") {
                tagged = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(tagged, "job was not auto-tagged within the timeout");

        let broadcast = rx.recv().await.unwrap();
        assert_eq!(broadcast["type"], "session_job_bound");
        assert_eq!(broadcast["job_name"], "long-sleep");
    }
}
