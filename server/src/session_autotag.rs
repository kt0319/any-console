//! セッションへのワークスペース / ジョブの自動タグ付け（ADR 32 —
//! `agent_watch.rs` のポーリングから呼ばれるメタデータ書き込み側を分離）。

use serde_json::{Map, Value};

use crate::foreground::ForegroundInspector;
use crate::job_match::JobPattern;
use crate::state::AppState;

/// セッションの (workspace, job_name) を返す。キャッシュ優先・tmux env で補完。
pub(crate) async fn session_meta(
    state: &AppState,
    session_id: &str,
) -> (Option<String>, Option<String>) {
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
pub(crate) async fn resolve_workspace(
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
pub(crate) async fn maybe_autotag_job(
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
