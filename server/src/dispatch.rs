//! `POST /dispatch` エンドポイント一式。
//!
//! 外部から「workspace + job + テキスト」を1回のリクエストで投げて、既存セッション
//! 再利用 or 新規作成、ブランチ確認/作成、起動コマンド実行、text の tmux 送信までを
//! 行う。`POST /dispatch` はpendingキューへ積んで即座に 202 を返し、実行は
//! `/dispatch/{id}/decision`（`executed: true`=実行 / `false`=破棄の二択）だけが
//! 担う。同じエンドポイントは決定済み（pendingから外れた）itemに対しても働き、
//! recent履歴から元のリクエストを復元して再送する。
//! `direct: true` の即時実行はセキュリティモデルを単純にするため拒否する。
//!
//! 新規作成セッションに予約するテキスト（`pending_text`）は tmux 環境変数
//! （`TMUX_PENDING_TEXT`/`TMUX_PENDING_ENTER`）へ永続化する。ターミナル WS の
//! attach 処理（`terminal.rs`）がこれを読んで flush する。プロセスをまたいでも
//! 安全に受け渡せる（`create_registered_session` を呼ぶプロセスと WS が繋がる
//! プロセスが一致している保証が要らなくなる）。
//!
//! `image_paths`（サーバーローカルのファイルパス。`POST /upload-image`で事前に
//! アップロードして得る）はバイナリとして送るのではなく、`compose_text_with_images`
//! が `text` の末尾へ `Image: <path>` 行として展開してから tmux へ送る。セッション内の
//! CLIエージェント（Claude Code等）がそのパス言及を見て自分のファイルツールで画像を
//! 読みに行く前提。

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::auth::{parse_cookies, AuthKind, RequireAuth};
use crate::errors::{bad_request, not_found, server_error, ApiError};
use crate::git_helpers::{invalidate_and_publish_git_info, validate_branch_name};
use crate::git_utils::{
    git_branch, git_branches, resolve_workspace_path, run_git_raw, worktree_display_name,
    GIT_QUICK_TIMEOUT_SEC,
};
use crate::jobs_common::{serialize_workspace_jobs, TERMINAL_JOB_KEY};
use crate::paths::Paths;
use crate::state::AppState;
use crate::terminal_session::TerminalSession;
use crate::tmux;
use crate::util::{default_true, now_epoch, JsonBody};

const RECENT_LIMIT: usize = 10;
const PUSH_TEXT_PREVIEW_LEN: usize = 120;
const API_TOKEN_SCOPE_LABEL_PREFIX: &str = "token:";
/// 決定（実行/破棄）済みdispatchの添付画像を保持する期間。超過分は
/// `sweep_expired_dispatch_images` が削除し、Recent側の `image_paths` を
/// 空にした上で `images_expired: true` を立てる。
const DISPATCH_IMAGE_TTL_SEC: i64 = 24 * 60 * 60;

// ─── 永続化状態 ──────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct DispatchState {
    /// dispatch_id -> リクエスト payload（挿入順を保持 — `serde_json::Map` は
    /// `preserve_order` 機能により IndexMap ベース）。
    pub pending: Mutex<Map<String, Value>>,
    /// run/discardが決定された直近の項目（新しい順、最大 `RECENT_LIMIT` 件）。
    pub recent: Mutex<Vec<Value>>,
}

impl DispatchState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn dispatch_state_file(paths: &Paths, filename: &str) -> PathBuf {
    paths.data_dir.join(filename)
}

fn queue_file(paths: &Paths) -> PathBuf {
    dispatch_state_file(paths, "dispatch_queue.json")
}

fn recent_file(paths: &Paths) -> PathBuf {
    dispatch_state_file(paths, "dispatch_recent.json")
}

/// 起動時に永続化済みのキュー/履歴を読み込み、status stream 購読者へ初期
/// スナップショットを送る（`main.rs` から一度だけ呼ぶ）。
pub async fn load_persisted_and_seed_bridge(state: &Arc<AppState>) {
    let queue_raw = crate::json_store::load_json_file(&queue_file(&state.paths), json!({}), None);
    if let Some(items) = queue_raw.get("items").and_then(Value::as_object) {
        *state.dispatch.pending.lock().await = items.clone();
    }
    let recent_raw = crate::json_store::load_json_file(&recent_file(&state.paths), json!({}), None);
    if let Some(items) = recent_raw.get("items").and_then(Value::as_array) {
        let valid: Vec<Value> = items
            .iter()
            .filter(|item| {
                item.get("id").and_then(Value::as_str).is_some() && item.get("request").is_some()
            })
            .take(RECENT_LIMIT)
            .cloned()
            .collect();
        *state.dispatch.recent.lock().await = valid;
    }
    sweep_expired_dispatch_images(state).await;
    broadcast_queue(state).await;
}

async fn persist_pending(state: &Arc<AppState>) {
    let pending = state.dispatch.pending.lock().await.clone();
    crate::json_store::save_or_warn(
        &queue_file(&state.paths),
        &json!({"items": pending}),
        "dispatch queue",
    );
}

async fn persist_recent(state: &Arc<AppState>) {
    let recent = state.dispatch.recent.lock().await.clone();
    crate::json_store::save_or_warn(
        &recent_file(&state.paths),
        &json!({"items": recent}),
        "dispatch recent",
    );
}

async fn queue_payload(state: &Arc<AppState>) -> Value {
    let pending = state.dispatch.pending.lock().await;
    let items: Vec<Value> = pending
        .iter()
        .map(|(id, req)| json!({"id": id, "request": req}))
        .collect();
    let recent = state.dispatch.recent.lock().await.clone();
    json!({"type": "dispatch_queue", "items": items, "recent": recent})
}

/// キューの現在の全量を status stream 購読者へ配信する。
async fn broadcast_queue(state: &Arc<AppState>) {
    let payload = queue_payload(state).await;
    state.status_stream.broadcast(payload);
}

/// status stream WS への新規接続時に呼ぶ（全量スナップショットは冪等なので、
/// 既存購読者への再送は無害）。
pub async fn broadcast_current_queue(state: &Arc<AppState>) {
    broadcast_queue(state).await;
}

/// pending の永続化と status stream への全量配信の定型ペア（決定・失敗・
/// 受付のたびに必ずセットで呼ぶ）。
async fn persist_and_broadcast(state: &Arc<AppState>) {
    persist_pending(state).await;
    broadcast_queue(state).await;
}

/// dispatch 起動失敗時の activity 記録（pending 実行・履歴からの再送で共用）。
fn log_dispatch_failed(state: &AppState, workspace: &str, detail: &str) {
    crate::activity::log_activity(
        &state.paths.data_dir,
        Some(workspace),
        "dispatch_failed",
        crate::git_helpers::activity_fields(&[("detail", json!(detail))]),
    );
}

async fn record_recent(
    state: &Arc<AppState>,
    dispatch_id: &str,
    mut request: Value,
    outcome: &str,
) {
    // DispatchRequest のフィールドへ正規化してから格納する（実行時は model_dump 済み、
    // 破棄時は _PENDING の生 payload — branch_status 等の実行時メタが混ざるため）。
    if let Value::Object(map) = &mut request {
        map.retain(|k, _| DISPATCH_REQUEST_FIELDS.contains(&k.as_str()));
    }
    // 正規化後に effective_workspace を再計算して積む（上の retain で一旦落ちる
    // ため、呼び出し元が事前に積んでいても消えてしまい、worktree dispatch の
    // 履歴フィルタ（DispatchWorkspacePane.vue）が誤判定・取りこぼしてしまう）。
    if let Ok(body) = serde_json::from_value::<DispatchRequest>(request.clone()) {
        if let Value::Object(map) = &mut request {
            map.insert(
                "effective_workspace".to_string(),
                json!(body.effective_workspace()),
            );
        }
    }
    // 決定（実行/破棄）が確定した時刻。受付時刻（received_at）と合わせて、
    // フロントのDispatch履歴で「受付からどれだけ待たされたか」を計算できる
    // ようにする。
    if let Value::Object(map) = &mut request {
        map.insert("decided_at".to_string(), json!(now_epoch()));
    }
    let mut recent = state.dispatch.recent.lock().await;
    recent.insert(
        0,
        json!({"id": dispatch_id, "request": request, "outcome": outcome}),
    );
    recent.truncate(RECENT_LIMIT);
    drop(recent);
    persist_recent(state).await;
}

const DISPATCH_REQUEST_FIELDS: &[&str] = &[
    "workspace",
    "worktree",
    "job",
    "text",
    "enter",
    "match",
    "session_id",
    "branch",
    "create_branch",
    "base_branch",
    "direct",
    "dedup_key",
    "received_at",
    "image_paths",
];

// ─── リクエストモデル ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DispatchRequest {
    pub workspace: String,
    #[serde(default)]
    pub worktree: Option<String>,
    #[serde(default = "default_job")]
    pub job: String,
    #[serde(default)]
    pub text: String,
    #[serde(default = "default_true")]
    pub enter: bool,
    #[serde(default = "default_match", rename = "match")]
    pub match_mode: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub create_branch: bool,
    #[serde(default)]
    pub base_branch: Option<String>,
    #[serde(default)]
    pub direct: bool,
    #[serde(default)]
    pub dedup_key: Option<String>,
    #[serde(default)]
    pub image_paths: Vec<String>,
}

fn default_job() -> String {
    TERMINAL_JOB_KEY.to_string()
}
fn default_match() -> String {
    "any".to_string()
}

impl DispatchRequest {
    /// フィールドが String/bool/Vec/Option のみのため、JSON 化は失敗しない。
    fn to_json_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self).expect("DispatchRequest is always serializable") {
            Value::Object(map) => map,
            _ => unreachable!("DispatchRequest serializes to a JSON object"),
        }
    }

    fn effective_workspace(&self) -> String {
        match self.worktree.as_deref().filter(|w| !w.is_empty()) {
            Some(wt) => worktree_display_name(&self.workspace, wt),
            None => self.workspace.clone(),
        }
    }

    fn apply_overrides(&mut self, overrides: &DispatchOverrides) {
        if let Some(ws) = overrides.workspace.as_deref().filter(|s| !s.is_empty()) {
            self.workspace = ws.to_string();
            self.worktree = None;
        }
        if let Some(b) = &overrides.branch {
            self.branch = if b.is_empty() { None } else { Some(b.clone()) };
        }
        if let Some(b) = &overrides.base_branch {
            self.base_branch = if b.is_empty() { None } else { Some(b.clone()) };
        }
        if let Some(t) = &overrides.text {
            self.text = t.clone();
        }
        if let Some(j) = &overrides.job {
            self.job = j.clone();
        }
        if let Some(m) = &overrides.match_mode {
            self.match_mode = m.clone();
        }
        if let Some(c) = overrides.create_branch {
            self.create_branch = c;
        }
        if let Some(sid) = &overrides.session_id {
            self.session_id = Some(sid.clone());
        }
        if let Some(paths) = &overrides.image_paths {
            self.image_paths = paths.clone();
        }
    }
}

/// `DispatchExecute` の上書きフィールド集合（`#[serde(flatten)]` でそのまま
/// 埋め込む）。
#[derive(Default, Deserialize)]
struct DispatchOverrides {
    #[serde(default)]
    workspace: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    base_branch: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    job: Option<String>,
    #[serde(default, rename = "match")]
    match_mode: Option<String>,
    #[serde(default)]
    create_branch: Option<bool>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    image_paths: Option<Vec<String>>,
}

/// `POST /dispatch/{id}/decision` のリクエストボディ。`executed: true` で実行、
/// `false` で破棄（pendingのitemのみ。決定済みのitemに対してfalseは無効）。
#[derive(Deserialize)]
pub struct DispatchExecute {
    executed: bool,
    #[serde(flatten)]
    overrides: DispatchOverrides,
}

// ─── ジョブ定義解決 ──────────────────────────────────────────────────────────

struct JobDef {
    command: String,
    label: String,
    icon: String,
    icon_color: String,
}

fn resolve_job_def(state: &AppState, workspace: &str, job: &str) -> Result<JobDef, ApiError> {
    if job == TERMINAL_JOB_KEY {
        return Ok(JobDef {
            command: String::new(),
            label: "Terminal".to_string(),
            icon: String::new(),
            icon_color: String::new(),
        });
    }
    let jobs = serialize_workspace_jobs(state, workspace);
    let entry = jobs
        .get(job)
        .ok_or_else(|| bad_request(format!("Unknown job: {job}")))?;
    Ok(JobDef {
        command: entry
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        label: entry
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(job)
            .to_string(),
        icon: entry
            .get("icon")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        icon_color: entry
            .get("icon_color")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

// ─── ブランチ確認/作成 ───────────────────────────────────────────────────────

async fn has_uncommitted_changes(ws_path: &FsPath) -> Result<bool, ApiError> {
    match run_git_raw(
        &["status", "--porcelain"],
        ws_path,
        GIT_QUICK_TIMEOUT_SEC,
        &[],
    )
    .await
    {
        Ok(out) => Ok(out.code == 0 && !out.stdout.trim().is_empty()),
        Err(e) => Err(crate::git_utils::map_git_error(e, "Workspace status check")),
    }
}

async fn ensure_branch(
    state: &Arc<AppState>,
    workspace_name: &str,
    ws_path: &FsPath,
    branch: &str,
    create: bool,
    base: Option<&str>,
) -> Result<(), ApiError> {
    let branch = validate_branch_name(branch)?;
    let current = git_branch(ws_path).await;
    if current.as_deref() == Some(branch.as_str()) {
        return Ok(());
    }
    if has_uncommitted_changes(ws_path).await? {
        return Err(bad_request(format!(
            "Workspace has uncommitted changes. Commit or stash them before switching to \"{branch}\"."
        )));
    }
    let branches = git_branches(ws_path).await;
    let mut args: Vec<String> = if branches.contains(&branch) {
        vec!["checkout".to_string(), branch.clone()]
    } else if create {
        let mut a = vec!["checkout".to_string(), "-b".to_string(), branch.clone()];
        if let Some(b) = base {
            a.push(validate_branch_name(b)?);
        }
        a
    } else {
        return Err(bad_request(format!("Branch does not exist: {branch}")));
    };
    let args_ref: Vec<&str> = args.iter_mut().map(|s| s.as_str()).collect();
    let result = run_git_raw(&args_ref, ws_path, GIT_QUICK_TIMEOUT_SEC, &[])
        .await
        .map_err(|e| crate::git_utils::map_git_error(e, "Branch operation"))?;
    if result.code != 0 {
        let stderr = result.stderr.trim().to_string();
        return Err(bad_request(if stderr.is_empty() {
            "Branch operation failed".to_string()
        } else {
            stderr
        }));
    }
    invalidate_and_publish_git_info(state, workspace_name, ws_path);
    Ok(())
}

// ─── セッション解決/起動 ─────────────────────────────────────────────────────

async fn find_existing_session(
    state: &Arc<AppState>,
    workspace: &str,
    job: &str,
    match_mode: &str,
) -> Option<(String, Arc<Mutex<TerminalSession>>)> {
    if match_mode == "none" {
        return None;
    }
    let target_job = (job != TERMINAL_JOB_KEY).then_some(job);
    for (sid, sess) in state.terminal_registry.snapshot().await {
        let (matches, tmux_name) = {
            let s = sess.lock().await;
            let ws_match = s.workspace.as_deref() == Some(workspace);
            let job_match = match_mode != "job" || s.job_name.as_deref() == target_job;
            (
                ws_match && !s.detached && job_match,
                s.tmux_session_name.clone(),
            )
        };
        if matches && crate::subprocess::tmux_session_exists(&tmux_name).await {
            return Some((sid, sess));
        }
    }
    None
}

async fn create_session(
    state: &Arc<AppState>,
    workspace: &str,
    ws_path: Option<&FsPath>,
    job: &str,
    job_def: &JobDef,
) -> Result<(String, Arc<Mutex<TerminalSession>>), ApiError> {
    let (session_id, session_arc) = state
        .create_terminal_session(crate::terminal_session::NewSessionSpec {
            workspace_path: ws_path.map(|p| p.to_string_lossy().into_owned()),
            workspace: Some(workspace.to_string()),
            icon: Some(job_def.icon.clone()),
            icon_color: Some(job_def.icon_color.clone()),
            job_name: (job != TERMINAL_JOB_KEY).then(|| job.to_string()),
            job_label: Some(job_def.label.clone()),
            interactive: true,
        })
        .await?;
    crate::session_watch::notify_session_created(state, &session_id);
    tracing::info!("dispatch session created session={session_id} workspace={workspace} job={job}");
    Ok((session_id, session_arc))
}

async fn resolve_session(
    state: &Arc<AppState>,
    body: &DispatchRequest,
    effective_ws: &str,
) -> Option<(String, Arc<Mutex<TerminalSession>>)> {
    if let Some(sid) = body.session_id.as_deref().filter(|s| !s.is_empty()) {
        // レジストリ未登録でも tmux 上には実在しうる（Rust 再起動直後・別プロセスが
        // 作成した等）ため、registry-only の `get` ではなく `terminal_session`
        // （get_or_register）で on-demand ハイドレートしてから解決する
        // （Codex レビュー指摘: `get` だけだと
        // 明示的に選択されたセッションが無視され、別のセッションへ誤って送信/新規
        // セッションを二重作成してしまう）。
        if let Ok(sess) = state.terminal_session(sid).await {
            return Some((sid.to_string(), sess));
        }
    }
    find_existing_session(state, effective_ws, &body.job, &body.match_mode).await
}

// ─── 添付画像のライフサイクル ────────────────────────────────────────────────

/// `image_paths` はクライアントが指定した生のファイルパス（将来的には生パスでは
/// なく `POST /upload-image` が発行する不透明なアップロードIDへ置き換えたい）。
/// それまでの間、`sync_dispatch_image_dir` へ渡す前に「`uploads_dir()` 直下の
/// 通常ファイルか」を実体パス（symlink解決込み）で検証する。ここを通さずに
/// リネーム対象・`compose_text_with_images` 埋め込み対象に使うと、任意ファイルの
/// 移動やCLIエージェントへの読み取り誘導（`Image: <path>` 経由）につながる。
enum DispatchImageSrc {
    /// `uploads_dir()` 直下の通常ファイル。移動対象。
    InUploads(PathBuf),
    /// 既に対象 dispatch の画像ディレクトリ直下にある通常ファイル。移動不要。
    AlreadyPlaced(PathBuf),
}

/// `src` を検証し、移動対象 / 移動不要のいずれかに分類する。範囲外・symlink・
/// 走査パス・非通常ファイルは `None` で拒否する。
async fn validate_dispatch_image_src(
    uploads_dir: &FsPath,
    dispatch_dir: &FsPath,
    src: &str,
) -> Option<DispatchImageSrc> {
    let canonical_src = tokio::fs::canonicalize(src).await.ok()?;
    let metadata = tokio::fs::metadata(&canonical_src).await.ok()?;
    if !metadata.is_file() {
        return None;
    }
    if let Ok(canonical_dispatch_dir) = tokio::fs::canonicalize(dispatch_dir).await {
        if canonical_src.parent() == Some(canonical_dispatch_dir.as_path()) {
            return Some(DispatchImageSrc::AlreadyPlaced(canonical_src));
        }
    }
    let canonical_uploads_dir = tokio::fs::canonicalize(uploads_dir).await.ok()?;
    if canonical_src.parent() == Some(canonical_uploads_dir.as_path()) {
        return Some(DispatchImageSrc::InUploads(canonical_src));
    }
    None
}

/// dispatch 1件の添付画像を、`uploads_dir()` などの一時領域から
/// `dispatch_images_dir(dispatch_id)` へ集約する（idempotent）。既にそこに
/// あるファイルは移動せず、現在の `image_paths` に含まれなくなったフォルダ内の
/// 孤立ファイル（Run前の差し替え・削除分）は削除する。戻り値は移動後のパス。
/// `uploads_dir()` 直下の通常ファイルでない `src`（範囲外パス・symlink・
/// 走査パス等）は `validate_dispatch_image_src` で拒否し、結果から丸ごと除外する
/// （移動失敗時と違い元パスのまま残さない — テキストへの埋め込みに使われるため）。
async fn sync_dispatch_image_dir(
    paths: &Paths,
    dispatch_id: &str,
    image_paths: &[String],
) -> Vec<String> {
    if image_paths.is_empty() {
        return Vec::new();
    }
    let dir = paths.dispatch_images_dir(dispatch_id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        tracing::warn!("dispatch image dir create failed ({}): {e}", dir.display());
        return Vec::new();
    }
    let uploads_dir = paths.uploads_dir();
    let mut result = Vec::with_capacity(image_paths.len());
    let mut keep_names: HashSet<OsString> = HashSet::new();
    for src in image_paths {
        let Some(validated) = validate_dispatch_image_src(&uploads_dir, &dir, src).await else {
            tracing::warn!("dispatch image path rejected (outside uploads dir): {src}");
            continue;
        };
        match validated {
            DispatchImageSrc::AlreadyPlaced(path) => {
                if let Some(name) = path.file_name() {
                    keep_names.insert(name.to_os_string());
                }
                // 実体は移動していないため、`src` の表記ゆれ（canonicalize による
                // シンボリックリンク解決等）を持ち込まず元の文字列をそのまま返す。
                result.push(src.clone());
            }
            DispatchImageSrc::InUploads(src_path) => {
                let Some(name) = src_path.file_name() else {
                    continue;
                };
                let dest = dir.join(name);
                match tokio::fs::rename(&src_path, &dest).await {
                    Ok(()) => {
                        keep_names.insert(name.to_os_string());
                        result.push(dest.to_string_lossy().into_owned());
                    }
                    Err(e) => {
                        tracing::warn!("dispatch image move failed ({}): {e}", src_path.display());
                    }
                }
            }
        }
    }
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if !keep_names.contains(&entry.file_name()) {
                if let Err(e) = tokio::fs::remove_file(entry.path()).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(
                            "dispatch image cleanup failed ({}): {e}",
                            entry.path().display()
                        );
                    }
                }
            }
        }
    }
    result
}

/// 決定済み（実行/破棄）dispatchの添付画像を、TTL（`DISPATCH_IMAGE_TTL_SEC`）
/// 超過分だけ削除する。`upload_image.rs::prune_old_uploads` と同じく能動的な
/// バックグラウンドタイマーは持たず、起動時・新規dispatch受付の都度呼び出す
/// アクセス時lazy sweep方式。
async fn sweep_expired_dispatch_images(state: &Arc<AppState>) {
    let now = now_epoch();
    let mut expired_ids: Vec<String> = Vec::new();
    {
        let mut recent = state.dispatch.recent.lock().await;
        for item in recent.iter_mut() {
            let has_images = item["request"]["image_paths"]
                .as_array()
                .map(|a| !a.is_empty())
                .unwrap_or(false);
            if !has_images {
                continue;
            }
            let decided_at = item["request"]["decided_at"].as_i64().unwrap_or(0);
            if now - decided_at < DISPATCH_IMAGE_TTL_SEC {
                continue;
            }
            let Some(id) = item.get("id").and_then(Value::as_str).map(str::to_string) else {
                continue;
            };
            if let Some(req_obj) = item.get_mut("request").and_then(Value::as_object_mut) {
                req_obj.insert("image_paths".to_string(), json!([]));
                req_obj.insert("images_expired".to_string(), json!(true));
            }
            expired_ids.push(id);
        }
    }
    for id in &expired_ids {
        let dir = state.paths.dispatch_images_dir(id);
        if let Err(e) = tokio::fs::remove_dir_all(&dir).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!("dispatch image dir cleanup failed ({}): {e}", dir.display());
            }
        }
    }
    if !expired_ids.is_empty() {
        persist_recent(state).await;
    }
}

/// 貼り付けられた画像パスを送信テキストへ埋め込む。CLIエージェント（Claude Code等）は
/// テキスト中のファイルパス言及から Read ツールで画像を読みに行くため、tmux 環境変数
/// 経由ではなく本文に含める必要がある。
fn compose_text_with_images(text: &str, image_paths: &[String]) -> String {
    if image_paths.is_empty() {
        return text.to_string();
    }
    let mut composed = text.to_string();
    if !composed.is_empty() {
        composed.push_str("\n\n");
    }
    for path in image_paths {
        composed.push_str("Image: ");
        composed.push_str(path);
        composed.push('\n');
    }
    composed.trim_end().to_string()
}

/// 新規作成セッションへ pending text を予約する（tmux 環境変数経由 — モジュール
/// 冒頭の設計判断コメント参照）。
async fn set_pending_text(tmux_name: &str, text: &str, enter: bool) {
    // 改行を含む複数行 text も1行の tmux 環境変数値として安全に運べるよう
    // hex エンコードする（`tmux::encode_pending_text` のドキュメント参照）。
    let encoded = tmux::encode_pending_text(text);
    tmux::set_environment(
        tmux_name,
        &[
            ("TMUX_PENDING_TEXT", &encoded),
            ("TMUX_PENDING_ENTER", if enter { "1" } else { "0" }),
        ],
    )
    .await;
}

async fn resolve_and_launch_session(
    state: &Arc<AppState>,
    body: &DispatchRequest,
    effective_ws: &str,
    ws_path: &FsPath,
    job_def: &JobDef,
) -> Result<(String, bool), ApiError> {
    let existing = resolve_session(state, body, effective_ws).await;

    if let Some(branch) = body.branch.as_deref().filter(|_| body.worktree.is_none()) {
        let existing_workspace = match &existing {
            Some((_, s)) => s.lock().await.workspace.clone(),
            None => None,
        };
        let branch_ws = existing_workspace
            .filter(|w| !w.is_empty())
            .unwrap_or_else(|| effective_ws.to_string());
        let branch_ws_path = resolve_workspace_path(&state.config, &branch_ws).await?;
        ensure_branch(
            state,
            &branch_ws,
            &branch_ws_path,
            branch,
            body.create_branch,
            body.base_branch.as_deref(),
        )
        .await?;
    }

    let has_input = !body.text.is_empty() || !body.image_paths.is_empty();
    let (session_id, created) = match existing {
        Some((sid, sess)) => {
            if has_input {
                let text = compose_text_with_images(&body.text, &body.image_paths);
                let tmux_name = { sess.lock().await.tmux_session_name.clone() };
                if !tmux::send_keys_to_tmux(&tmux_name, &text, body.enter).await {
                    tracing::warn!("dispatch text send-keys failed session={sid}");
                }
            }
            (sid, false)
        }
        None => {
            let (sid, sess) =
                create_session(state, effective_ws, Some(ws_path), &body.job, job_def).await?;
            let tmux_name = { sess.lock().await.tmux_session_name.clone() };
            tmux::wait_pane_ready(&tmux_name, tmux::TMUX_PANE_READY_TIMEOUT_SEC).await;
            if !job_def.command.is_empty() {
                // rc ファイル読み込み・direnv 等の起動処理中に送るとジョブ起動
                // コマンドが飲み込まれることがあるため、シェルが実際にキー入力を
                // 処理できる状態になったことをプローブで確認してから送る
                // （タイムアウトしてもベストエフォートでそのまま送信する）。
                tmux::wait_shell_ready(&tmux_name, tmux::SHELL_READY_TIMEOUT_SEC).await;
                if !tmux::send_keys_to_tmux(&tmux_name, &job_def.command, true).await {
                    tracing::warn!("dispatch job launch send-keys failed session={sid}");
                }
            }
            if has_input {
                let text = compose_text_with_images(&body.text, &body.image_paths);
                set_pending_text(&tmux_name, &text, body.enter).await;
            }
            (sid, true)
        }
    };
    Ok((session_id, created))
}

async fn launch(state: &Arc<AppState>, body: &DispatchRequest) -> Result<Value, ApiError> {
    let effective_ws = body.effective_workspace();
    let ws_path = resolve_workspace_path(&state.config, &effective_ws).await?;
    let job_def = resolve_job_def(state, &effective_ws, &body.job)?;
    let (session_id, created) =
        resolve_and_launch_session(state, body, &effective_ws, &ws_path, &job_def).await?;
    Ok(json!({
        "status": "ok",
        "session_id": session_id,
        "workspace": effective_ws,
        "job": body.job,
        "created": created,
        "url": format!("/?workspace={effective_ws}&session={session_id}"),
        "ws_url": format!("/terminal/ws/{session_id}"),
    }))
}

// ─── dedup / 通知本文 / branch_status ───────────────────────────────────────

fn find_pending_by_dedup_key(pending: &Map<String, Value>, key: &str) -> Option<(String, Value)> {
    pending
        .iter()
        .find(|(_, req)| req.get("dedup_key").and_then(Value::as_str) == Some(key))
        .map(|(id, req)| (id.clone(), req.clone()))
}

/// dedup キーでの既存項目検索から新規項目の挿入までを1回のロック区間で行う
/// （Codex レビュー指摘: 検索とロック解放を挟んで挿入が別ロックだと、同じ
/// dedup_key を持つ2件が並行到着したときに両方とも「初回」と誤判定し、
/// coalesce されず2件とも積まれてしまう）。
/// 戻り値: (実際に使われた dispatch_id, retry_count, 初回通知を鳴らすべきか)。
async fn resolve_dedup_and_insert(
    state: &Arc<AppState>,
    dispatch_id: String,
    dedup_key: Option<&str>,
    mut payload: Value,
) -> (String, u64, bool) {
    let mut pending = state.dispatch.pending.lock().await;
    let key = dedup_key.filter(|k| !k.is_empty());
    let (id, retry_count, should_notify) =
        match key.and_then(|k| find_pending_by_dedup_key(&pending, k)) {
            None => (dispatch_id, 1, true),
            Some((old_id, old_payload)) => {
                let retry_count = old_payload
                    .get("retry_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    + 1;
                pending.shift_remove(&old_id);
                (old_id, retry_count, retry_count == 1)
            }
        };
    if let Value::Object(map) = &mut payload {
        map.insert("retry_count".to_string(), json!(retry_count));
    }
    pending.insert(id.clone(), payload);
    (id, retry_count, should_notify)
}

fn dispatch_notification_body(
    effective_ws: &str,
    body: &DispatchRequest,
    job_def: &JobDef,
) -> String {
    let mut detail_parts: Vec<String> = Vec::new();
    if body.job != TERMINAL_JOB_KEY {
        detail_parts.push(job_def.label.clone());
    }
    if let Some(b) = body.branch.as_deref().filter(|b| !b.is_empty()) {
        detail_parts.push(b.to_string());
    }
    if !body.image_paths.is_empty() {
        let n = body.image_paths.len();
        detail_parts.push(format!("{n} image{}", if n == 1 { "" } else { "s" }));
    }
    let mut notif_body = effective_ws.to_string();
    if !detail_parts.is_empty() {
        notif_body.push('\n');
        notif_body.push_str(&detail_parts.join(" \u{b7} "));
    }
    if !body.text.is_empty() {
        notif_body.push('\n');
        notif_body.push_str(
            &body
                .text
                .chars()
                .take(PUSH_TEXT_PREVIEW_LEN)
                .collect::<String>(),
        );
    }
    notif_body
}

async fn branch_status(ws_path: &FsPath, branch: &str) -> &'static str {
    let current = git_branch(ws_path).await;
    if current.as_deref() == Some(branch) {
        return "current";
    }
    let branches = git_branches(ws_path).await;
    if branches.contains(&branch.to_string()) {
        "exists"
    } else {
        "missing"
    }
}

// ─── 認証（POST /dispatch 専用: メイン/デバイス + dispatch scope token）─

/// (auth_label, is_scoped_token)。
async fn verify_dispatch_auth(
    state: &Arc<AppState>,
    bearer: &str,
    headers: &http::HeaderMap,
) -> Result<(String, bool), ApiError> {
    let cookies = parse_cookies(headers);
    if let Some(result) = state.auth.authenticate(bearer, Some(&cookies)) {
        return Ok(match result.kind {
            AuthKind::Disabled => ("disabled".to_string(), false),
            AuthKind::Main => ("main".to_string(), false),
            AuthKind::Device => (result.label, false),
        });
    }
    if let Some(entry) = state.auth.verify_and_touch_api_token(bearer) {
        if entry.get("scope").and_then(Value::as_str) == Some(crate::auth::API_TOKEN_SCOPE_DISPATCH)
        {
            let token_id = entry.get("id").and_then(Value::as_str).unwrap_or_default();
            return Ok((format!("{API_TOKEN_SCOPE_LABEL_PREFIX}{token_id}"), true));
        }
    }
    Err(crate::errors::unauthorized("Invalid token"))
}

// ─── ルート ─────────────────────────────────────────────────────────────────

pub async fn dispatch(
    State(state): State<Arc<AppState>>,
    headers: http::HeaderMap,
    JsonBody(body): JsonBody<DispatchRequest>,
) -> Result<axum::response::Response, ApiError> {
    let bearer = crate::auth::bearer_from_headers(&headers);
    let (auth_label, is_scoped_token) = verify_dispatch_auth(&state, bearer, &headers).await?;
    dispatch_core(&state, body, &auth_label, is_scoped_token).await
}

/// dispatch 実行成功時の activity 記録（`dispatch_execute`のpending実行・履歴からの
/// 再送実行の両方で共用する定型）。
fn log_dispatch_executed(state: &AppState, result: &Value, auth_label: &str) {
    crate::activity::log_activity(
        &state.paths.data_dir,
        result["workspace"].as_str(),
        "dispatch_executed",
        crate::git_helpers::activity_fields(&[
            ("job", result["job"].clone()),
            ("session_id", result["session_id"].clone()),
            ("created", result["created"].clone()),
            ("auth", json!(auth_label)),
        ]),
    );
}

/// launch し、成否に応じて activity を記録する（pending 実行・履歴からの再実行で共用）。
async fn launch_logged(
    state: &Arc<AppState>,
    req: &DispatchRequest,
    auth_label: &str,
) -> Result<Value, ApiError> {
    match launch(state, req).await {
        Ok(result) => {
            log_dispatch_executed(state, &result, auth_label);
            Ok(result)
        }
        Err(e) => {
            log_dispatch_failed(state, &req.workspace, &e.detail);
            Err(e)
        }
    }
}

/// `POST /dispatch` の本体（認証確定後）。
async fn dispatch_core(
    state: &Arc<AppState>,
    mut body: DispatchRequest,
    auth_label: &str,
    is_scoped_token: bool,
) -> Result<axum::response::Response, ApiError> {
    use axum::response::IntoResponse;

    sweep_expired_dispatch_images(state).await;

    if body.direct {
        return Err(bad_request(
            "Direct dispatch execution is no longer supported; submit to the approval queue instead",
        ));
    }
    if is_scoped_token {
        // dispatch トークンは低信頼な外部連携用。session_id を無視し、通常の
        // workspace/job ベースの既存セッション探索だけに限定する（セキュリティ境界）。
        body.session_id = None;
    }

    let effective_ws = body.effective_workspace();
    let ws_path = resolve_workspace_path(&state.config, &effective_ws).await?;
    let job_def = resolve_job_def(state, &effective_ws, &body.job)?;

    let mut payload = body.to_json_map();
    payload.insert("effective_workspace".to_string(), json!(effective_ws));
    payload.insert("received_at".to_string(), json!(now_epoch()));
    if let Some(branch) = body.branch.as_deref().filter(|_| body.worktree.is_none()) {
        payload.insert(
            "branch_status".to_string(),
            json!(branch_status(&ws_path, branch).await),
        );
    }
    if let Some((pre_sid, pre_sess)) =
        find_existing_session(state, &effective_ws, &body.job, &body.match_mode).await
    {
        let job_name = { pre_sess.lock().await.job_name.clone() };
        payload.insert(
            "job".to_string(),
            json!(job_name.unwrap_or_else(|| TERMINAL_JOB_KEY.to_string())),
        );
        payload.insert("existing_session_id".to_string(), json!(pre_sid));
    }

    let dispatch_id = crate::util::token_urlsafe(8);
    let notify_push = |state: &Arc<AppState>| {
        crate::push::spawn_push_notification(
            state,
            "Dispatch",
            dispatch_notification_body(&effective_ws, &body, &job_def),
            format!("/?openDispatchQueue=1&dispatchId={dispatch_id}"),
            "dispatch",
            None,
        );
    };

    let (dispatch_id, retry_count, should_notify) = resolve_dedup_and_insert(
        state,
        dispatch_id.clone(),
        body.dedup_key.as_deref(),
        Value::Object(payload),
    )
    .await;
    if should_notify {
        notify_push(state);
    }
    crate::activity::log_activity(
        &state.paths.data_dir,
        Some(&effective_ws),
        if retry_count > 1 {
            "dispatch_superseded"
        } else {
            "dispatch_pending"
        },
        crate::git_helpers::activity_fields(&[
            ("job", json!(body.job)),
            ("text", json!(body.text)),
            ("auth", json!(auth_label)),
        ]),
    );

    // 最終的に採用された dispatch_id（dedup coalesce時は既存id）が確定してから
    // 添付画像を専用領域へ集約する。uploads_dir() の件数上限プルーニングの
    // 対象から外れ、pending中に消えなくなる。
    if !body.image_paths.is_empty() {
        let synced = sync_dispatch_image_dir(&state.paths, &dispatch_id, &body.image_paths).await;
        let mut pending = state.dispatch.pending.lock().await;
        if let Some(req_obj) = pending.get_mut(&dispatch_id).and_then(Value::as_object_mut) {
            req_obj.insert("image_paths".to_string(), json!(synced));
        }
    }

    persist_and_broadcast(state).await;

    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({"status": "pending", "id": dispatch_id})),
    )
        .into_response())
}

/// `POST /dispatch/{id}/decision`。まだpendingキューにあるitemはその場で実行/破棄、
/// 既にpendingから外れた（=決定済みの）itemはrecent履歴から元のリクエストを
/// 復元して再送する。「pendingか履歴か」でデータの取得元が違うだけで、
/// dispatch_idを渡して`executed: true/false`を決めるという操作自体は1つに
/// 統一している（旧 `dispatch_rerun` はこの関数へ統合済み）。
pub async fn dispatch_execute(
    State(state): State<Arc<AppState>>,
    Path(dispatch_id): Path<String>,
    auth: RequireAuth,
    JsonBody(body): JsonBody<DispatchExecute>,
) -> Result<axum::response::Response, ApiError> {
    use axum::response::IntoResponse;
    // 実際に認証された経路のラベルをそのまま activity ログ・再 dispatch へ渡す
    // （"main" 固定だと Tailscale/デバイス cookie 経由の認証で誤ったラベルになる）。
    let auth_label = auth.0.label.as_str();

    // 検索(get)と削除(shift_remove)を1回のロック区間で行う（Codex レビュー指摘:
    // 別ロックに分かれていると、同じ dispatch_id への decision が並行到着した
    // とき両方ともSomeを引き当て、executedなら launch を二重実行してしまう）。
    let pending_payload = state
        .dispatch
        .pending
        .lock()
        .await
        .shift_remove(&dispatch_id);

    if let Some(payload) = pending_payload {
        if !body.executed {
            crate::activity::log_activity(
                &state.paths.data_dir,
                payload.get("workspace").and_then(Value::as_str),
                "dispatch_discarded",
                Map::new(),
            );
            record_recent(&state, &dispatch_id, payload, "discarded").await;
            persist_and_broadcast(&state).await;
            return Ok(Json(json!({"status": "ok"})).into_response());
        }

        let request: DispatchRequest =
            serde_json::from_value(payload.clone()).map_err(|e| server_error(e.to_string()))?;
        // received_atはDispatchRequestのフィールドではないためpayloadから引き継ぐ。
        let received_at = payload.get("received_at").cloned();
        let result = execute_and_record(
            &state,
            &dispatch_id,
            request,
            received_at,
            &body.overrides,
            auth_label,
        )
        .await?;
        return Ok(Json(result).into_response());
    }

    // pendingに無ければ、決定済みの履歴（recent）から元のリクエストを復元して再送する。
    let item = {
        let recent = state.dispatch.recent.lock().await;
        recent.iter().find(|r| r["id"] == dispatch_id).cloned()
    };
    let Some(item) = item else {
        return Err(not_found(format!(
            "Dispatch item not found (only the most recent {RECENT_LIMIT} can be re-executed)"
        )));
    };

    if !body.executed {
        // 履歴のitemは既に決定済みで、pendingのように破棄できる対象が無い。
        return Err(bad_request(
            "Dispatch item already decided; nothing to discard",
        ));
    }

    let mut request: DispatchRequest =
        serde_json::from_value(item["request"].clone()).map_err(|e| server_error(e.to_string()))?;
    request.direct = false;
    request.dedup_key = None;
    request.session_id = None;
    // 履歴からの再実行は新規dispatchとして扱う（新しいID・受付時刻は再送された「今」）。
    let result = execute_and_record(
        &state,
        &crate::util::token_urlsafe(8),
        request,
        Some(json!(now_epoch())),
        &body.overrides,
        auth_label,
    )
    .await?;
    Ok(Json(result).into_response())
}

/// 上書きを適用して launch し、成否（executed / failed）を履歴に記録する。
/// 失敗した項目はキューに戻さず、履歴から値を直して再実行する。
async fn execute_and_record(
    state: &Arc<AppState>,
    dispatch_id: &str,
    mut request: DispatchRequest,
    received_at: Option<Value>,
    overrides: &DispatchOverrides,
    auth_label: &str,
) -> Result<Value, ApiError> {
    request.apply_overrides(overrides);
    // 添付画像は記録先 dispatch_id の専用領域へ集約してから launch する。
    if !request.image_paths.is_empty() {
        request.image_paths =
            sync_dispatch_image_dir(&state.paths, dispatch_id, &request.image_paths).await;
    }
    let result = launch_logged(state, &request, auth_label).await;
    let mut recorded = request.to_json_map();
    if let Some(received_at) = received_at {
        recorded.insert("received_at".to_string(), received_at);
    }
    let outcome = if result.is_ok() { "executed" } else { "failed" };
    record_recent(state, dispatch_id, Value::Object(recorded), outcome).await;
    persist_and_broadcast(state).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_request() -> DispatchRequest {
        DispatchRequest {
            workspace: "proj".to_string(),
            worktree: None,
            job: TERMINAL_JOB_KEY.to_string(),
            text: String::new(),
            enter: true,
            match_mode: "any".to_string(),
            session_id: None,
            branch: None,
            create_branch: false,
            base_branch: None,
            direct: false,
            dedup_key: None,
            image_paths: Vec::new(),
        }
    }

    #[test]
    fn effective_workspace_appends_worktree() {
        let mut req = base_request();
        assert_eq!(req.effective_workspace(), "proj");
        req.worktree = Some("feat/x".to_string());
        assert_eq!(req.effective_workspace(), "proj:feat/x");
        req.worktree = Some(String::new());
        assert_eq!(req.effective_workspace(), "proj");
    }

    #[test]
    fn apply_overrides_updates_only_provided_fields() {
        let mut req = base_request();
        req.branch = Some("main".to_string());
        req.worktree = Some("wt".to_string());
        let overrides = DispatchOverrides {
            workspace: Some("other".to_string()),
            branch: None,
            base_branch: None,
            text: Some("hello".to_string()),
            job: None,
            match_mode: None,
            create_branch: None,
            session_id: None,
            image_paths: None,
        };
        req.apply_overrides(&overrides);
        // workspace が変わると worktree は持ち越さない
        assert_eq!(req.workspace, "other");
        assert_eq!(req.worktree, None);
        assert_eq!(req.text, "hello");
        // 未指定（None）の branch はそのまま
        assert_eq!(req.branch.as_deref(), Some("main"));
    }

    #[test]
    fn apply_overrides_updates_image_paths_when_provided() {
        let mut req = base_request();
        req.image_paths = vec!["/tmp/old.png".to_string()];
        let overrides = DispatchOverrides {
            image_paths: Some(vec!["/tmp/new.png".to_string()]),
            ..Default::default()
        };
        req.apply_overrides(&overrides);
        assert_eq!(req.image_paths, vec!["/tmp/new.png".to_string()]);
    }

    #[test]
    fn apply_overrides_empty_string_clears_branch() {
        let mut req = base_request();
        req.branch = Some("main".to_string());
        req.base_branch = Some("develop".to_string());
        let overrides = DispatchOverrides {
            branch: Some(String::new()),
            base_branch: Some(String::new()),
            ..Default::default()
        };
        req.apply_overrides(&overrides);
        assert_eq!(req.branch, None);
        assert_eq!(req.base_branch, None);
    }

    #[test]
    fn compose_text_with_images_no_images_returns_text_unchanged() {
        assert_eq!(compose_text_with_images("hello", &[]), "hello");
        assert_eq!(compose_text_with_images("", &[]), "");
    }

    #[test]
    fn compose_text_with_images_appends_paths_after_text() {
        let paths = vec!["/tmp/a.png".to_string(), "/tmp/b.png".to_string()];
        assert_eq!(
            compose_text_with_images("look at this", &paths),
            "look at this\n\nImage: /tmp/a.png\nImage: /tmp/b.png"
        );
    }

    #[test]
    fn compose_text_with_images_with_empty_text_omits_leading_blank_line() {
        let paths = vec!["/tmp/a.png".to_string()];
        assert_eq!(compose_text_with_images("", &paths), "Image: /tmp/a.png");
    }

    #[test]
    fn dispatch_notification_body_includes_image_count() {
        let mut req = base_request();
        req.image_paths = vec!["/tmp/a.png".to_string(), "/tmp/b.png".to_string()];
        let job_def = JobDef {
            command: String::new(),
            label: "Terminal".to_string(),
            icon: String::new(),
            icon_color: String::new(),
        };
        let body = dispatch_notification_body("proj", &req, &job_def);
        assert_eq!(body, "proj\n2 images");
    }

    #[test]
    fn dispatch_notification_body_includes_job_branch_and_text_preview() {
        let mut req = base_request();
        req.job = "build".to_string();
        req.branch = Some("feat/x".to_string());
        req.text = "a".repeat(200);
        let job_def = JobDef {
            command: "npm run build".to_string(),
            label: "Build".to_string(),
            icon: String::new(),
            icon_color: String::new(),
        };
        let body = dispatch_notification_body("proj:feat/x", &req, &job_def);
        assert!(body.starts_with("proj:feat/x\nBuild \u{b7} feat/x\n"));
        // テキストは PUSH_TEXT_PREVIEW_LEN 文字までに切り詰められる
        let last_line = body.lines().last().unwrap();
        assert_eq!(last_line.chars().count(), PUSH_TEXT_PREVIEW_LEN);
    }

    #[test]
    fn dispatch_notification_body_terminal_job_omits_label() {
        let req = base_request(); // job == TERMINAL_JOB_KEY, no branch/text
        let job_def = JobDef {
            command: String::new(),
            label: "Terminal".to_string(),
            icon: String::new(),
            icon_color: String::new(),
        };
        assert_eq!(dispatch_notification_body("proj", &req, &job_def), "proj");
    }

    #[test]
    fn record_recent_strips_extra_fields_and_truncates() {
        let filtered = {
            let mut m = Map::new();
            m.insert("workspace".to_string(), json!("proj"));
            m.insert("branch_status".to_string(), json!("exists")); // 実行時メタ、除去対象
            m.insert("existing_session_id".to_string(), json!("abc")); // 同上
            let mut v = Value::Object(m);
            if let Value::Object(map) = &mut v {
                map.retain(|k, _| DISPATCH_REQUEST_FIELDS.contains(&k.as_str()));
            }
            v
        };
        assert_eq!(filtered, json!({"workspace": "proj"}));
    }

    /// retain で一旦落ちる effective_workspace が正規化後に再計算されて積まれ直す
    /// こと（worktree dispatch の履歴フィルタ（DispatchWorkspacePane.vue）が
    /// 依存しているフィールド）。
    #[tokio::test]
    async fn record_recent_recomputes_effective_workspace_for_worktree() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        // 却下時の生 payload 相当: branch_status 等の実行時メタ込み、
        // effective_workspace は事前には積んでいない。
        let payload = json!({
            "workspace": "proj",
            "worktree": "feat/x",
            "branch_status": "exists",
        });
        record_recent(&state, "d1", payload, "discarded").await;
        let recent = state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["request"]["effective_workspace"], "proj:feat/x");
        assert!(
            recent[0]["request"].get("branch_status").is_none(),
            "実行時メタは除去される"
        );
    }

    /// record_recentは決定時刻（decided_at）を必ず積む。受付時刻（received_at、
    /// pending時点で積まれる）はDISPATCH_REQUEST_FIELDSに含まれるためretainで
    /// 残る。
    #[tokio::test]
    async fn record_recent_stamps_decided_at_and_keeps_received_at() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let before = now_epoch();
        let payload = json!({"workspace": "proj", "received_at": before});
        record_recent(&state, "d1", payload, "executed").await;
        let recent = state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["request"]["received_at"], before);
        let decided_at = recent[0]["request"]["decided_at"].as_i64().unwrap();
        assert!(decided_at >= before);
    }

    #[tokio::test]
    async fn resolve_dedup_first_request_uses_own_id_and_notifies() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let (id, retry, notify) =
            resolve_dedup_and_insert(&state, "id1".to_string(), Some("key-a"), json!({})).await;
        assert_eq!(id, "id1");
        assert_eq!(retry, 1);
        assert!(notify);
        assert!(state.dispatch.pending.lock().await.contains_key("id1"));
    }

    #[tokio::test]
    async fn resolve_dedup_matching_key_supersedes_and_suppresses_notify() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        state.dispatch.pending.lock().await.insert(
            "old-id".to_string(),
            json!({"dedup_key": "key-a", "retry_count": 1}),
        );
        let (id, retry, notify) = resolve_dedup_and_insert(
            &state,
            "new-id".to_string(),
            Some("key-a"),
            json!({"dedup_key": "key-a"}),
        )
        .await;
        assert_eq!(id, "old-id");
        assert_eq!(retry, 2);
        assert!(!notify);
        let pending = state.dispatch.pending.lock().await;
        assert!(pending.contains_key("old-id"), "同じ id で置き換わる");
        assert!(!pending.contains_key("new-id"), "新規 id は残らない");
        assert_eq!(pending["old-id"]["retry_count"], json!(2));
    }

    #[tokio::test]
    async fn resolve_dedup_no_key_always_uses_own_id() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        state
            .dispatch
            .pending
            .lock()
            .await
            .insert("old-id".to_string(), json!({"dedup_key": null}));
        let (id, retry, notify) =
            resolve_dedup_and_insert(&state, "new-id".to_string(), None, json!({})).await;
        assert_eq!(id, "new-id");
        assert_eq!(retry, 1);
        assert!(notify);
        let pending = state.dispatch.pending.lock().await;
        assert!(pending.contains_key("old-id"), "無関係な既存項目は残る");
        assert!(pending.contains_key("new-id"));
    }

    #[tokio::test]
    async fn queue_persistence_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("ANY_CONSOLE_DATA_DIR", dir.path());
        let state = test_state(&dir).await;
        state
            .dispatch
            .pending
            .lock()
            .await
            .insert("d1".to_string(), json!({"workspace": "proj"}));
        persist_pending(&state).await;
        record_recent(&state, "d0", json!({"workspace": "proj"}), "executed").await;

        let state2 = test_state(&dir).await;
        load_persisted_and_seed_bridge(&state2).await;
        assert_eq!(
            state2.dispatch.pending.lock().await.get("d1"),
            Some(&json!({"workspace": "proj"}))
        );
        assert_eq!(state2.dispatch.recent.lock().await.len(), 1);
        std::env::remove_var("ANY_CONSOLE_DATA_DIR");
    }

    async fn test_state(dir: &tempfile::TempDir) -> Arc<AppState> {
        // rate_limit はテストの連続リクエストが制限に触れないよう引き上げる。
        Arc::new(crate::state::test_app_state(dir.path(), "test-", 10_000))
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_moves_new_files_into_dispatch_dir() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let uploads = state.paths.uploads_dir();
        std::fs::create_dir_all(&uploads).unwrap();
        let src = uploads.join("a.png");
        std::fs::write(&src, b"x").unwrap();

        let synced =
            sync_dispatch_image_dir(&state.paths, "disp1", &[src.to_string_lossy().into_owned()])
                .await;

        assert_eq!(synced.len(), 1);
        assert!(!src.exists(), "元ファイルは移動されて残らない");
        let expected = state.paths.dispatch_images_dir("disp1").join("a.png");
        assert_eq!(synced[0], expected.to_string_lossy());
        assert!(expected.exists());
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_is_noop_for_already_placed_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let path = img_dir.join("a.png");
        std::fs::write(&path, b"x").unwrap();
        let path_str = path.to_string_lossy().into_owned();

        let synced =
            sync_dispatch_image_dir(&state.paths, "disp1", std::slice::from_ref(&path_str)).await;

        assert_eq!(synced, vec![path_str]);
        assert!(path.exists());
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_removes_orphaned_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let kept = img_dir.join("keep.png");
        let stale = img_dir.join("stale.png");
        std::fs::write(&kept, b"x").unwrap();
        std::fs::write(&stale, b"x").unwrap();

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[kept.to_string_lossy().into_owned()],
        )
        .await;

        assert_eq!(synced, vec![kept.to_string_lossy().into_owned()]);
        assert!(kept.exists(), "現在参照されているファイルは残る");
        assert!(!stale.exists(), "参照が外れたファイルは削除される");
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_rejects_path_outside_uploads_dir() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        std::fs::create_dir_all(state.paths.uploads_dir()).unwrap();
        // uploads_dir の外（別ディレクトリ）に置かれたファイルを image_paths に
        // 直接指定するケース（例: /etc/passwd 等の任意ファイルを指す想定）。
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.txt");
        std::fs::write(&outside_file, b"secret").unwrap();

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[outside_file.to_string_lossy().into_owned()],
        )
        .await;

        assert!(synced.is_empty(), "範囲外パスは結果から除外される");
        assert!(outside_file.exists(), "範囲外ファイルは移動・削除されない");
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_rejects_traversal_path() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let uploads = state.paths.uploads_dir();
        std::fs::create_dir_all(&uploads).unwrap();
        // uploads_dir の親（data_dir直下）に置かれた、`../` 走査で参照できて
        // しまうファイル。
        let sibling_file = uploads.parent().unwrap().join("secret.txt");
        std::fs::write(&sibling_file, b"secret").unwrap();
        let traversal = uploads.join("..").join("secret.txt");

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[traversal.to_string_lossy().into_owned()],
        )
        .await;

        assert!(synced.is_empty(), "走査パスは結果から除外される");
        assert!(
            sibling_file.exists(),
            "走査パスの参照先は移動・削除されない"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sync_dispatch_image_dir_rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let uploads = state.paths.uploads_dir();
        std::fs::create_dir_all(&uploads).unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.txt");
        std::fs::write(&outside_file, b"secret").unwrap();
        let link = uploads.join("link.png");
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[link.to_string_lossy().into_owned()],
        )
        .await;

        assert!(
            synced.is_empty(),
            "uploads_dir外を指すsymlinkは結果から除外される"
        );
        assert!(
            outside_file.exists(),
            "symlink先の実ファイルは移動・削除されない"
        );
    }

    #[tokio::test]
    async fn sweep_expired_dispatch_images_keeps_items_within_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let img_path = img_dir.join("a.png").to_string_lossy().into_owned();
        state.dispatch.recent.lock().await.push(json!({
            "id": "disp1",
            "request": {"image_paths": [img_path], "decided_at": now_epoch()},
            "outcome": "executed",
        }));

        sweep_expired_dispatch_images(&state).await;

        let recent = state.dispatch.recent.lock().await;
        assert_eq!(
            recent[0]["request"]["image_paths"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(recent[0]["request"]["images_expired"].is_null());
        assert!(state.paths.dispatch_images_dir("disp1").exists());
    }

    #[tokio::test]
    async fn sweep_expired_dispatch_images_clears_paths_and_removes_dir_past_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let img_path = img_dir.join("a.png").to_string_lossy().into_owned();
        let old_decided_at = now_epoch() - DISPATCH_IMAGE_TTL_SEC - 1;
        state.dispatch.recent.lock().await.push(json!({
            "id": "disp1",
            "request": {"image_paths": [img_path], "decided_at": old_decided_at},
            "outcome": "executed",
        }));

        sweep_expired_dispatch_images(&state).await;

        let recent = state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["request"]["image_paths"], json!([]));
        assert_eq!(recent[0]["request"]["images_expired"], json!(true));
        assert!(!state.paths.dispatch_images_dir("disp1").exists());
    }
}
