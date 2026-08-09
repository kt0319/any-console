//! ターミナルセッション作成・削除のリアルタイム配信（Python 側
//! `api/session_watch.py` の移植）。
//!
//! Python 版が持っていた「同期ハンドラのスレッドから安全にイベントループへ
//! スケジュールする」ための `call_threadsafe` パターンは、`AppState` が保持する
//! `tokio::sync::broadcast::Sender`（`status_stream.rs`）へ直接 `send()` するだけで
//! 不要になる（マルチスレッドから安全に呼べる）。
//!
//! まだ実際の呼び出し元（`terminal_session.rs` のセッション作成・`terminal.rs` の
//! 削除ハンドラ・`agent_watch.rs` の自動紐付け）へは配線していない —
//! status stream の実体（`/workspaces/statuses/ws`）が Rust に無い間は、送信しても
//! 購読者が存在しないため（Python 側の同エンドポイントが引き続き実際の購読者を
//! 抱えている）。配線は状態ストリーム一括切替のタイミングで行う。

use serde_json::json;

use crate::state::AppState;

pub fn notify_session_created(state: &AppState, session_id: &str) {
    state
        .status_stream
        .broadcast(json!({"type": "session_created", "session_id": session_id}));
}

pub fn notify_session_removed(state: &AppState, session_id: &str) {
    state
        .status_stream
        .broadcast(json!({"type": "session_removed", "session_id": session_id}));
}

/// cwd 照合による自動ワークスペース紐付け（`agent_watch::apply_workspace_tag`
/// 相当）を購読中の全クライアントへ即時配信する。
pub fn notify_session_workspace_bound(state: &AppState, session_id: &str, workspace: &str) {
    state.status_stream.broadcast(json!({
        "type": "session_workspace_bound",
        "session_id": session_id,
        "workspace": workspace,
    }));
}

/// 前面ジョブの argv 照合による自動ジョブタグ付け（`agent_watch::apply_job_tag`
/// 相当）を購読中の全クライアントへ即時配信する。
pub fn notify_session_job_bound(
    state: &AppState,
    session_id: &str,
    job_name: &str,
    job_label: &str,
) {
    state.status_stream.broadcast(json!({
        "type": "session_job_bound",
        "session_id": session_id,
        "job_name": job_name,
        "job_label": job_label,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            paths: crate::paths::Paths {
                project_root: dir.path().to_path_buf(),
                data_dir: dir.path().join("data"),
                config_file: dir.path().join("config.json"),
                frontend_dir: dir.path().join("dist"),
                icons_dir: dir.path().join("icons"),
                tmux_prefix: "ac-".to_string(),
            },
            config: crate::config::ConfigStore::new(dir.path().join("config.json")),
            git_locks: crate::git_lock::WorkspaceLocks::new(),
            gh_cache: crate::github::GhCache::new(),
            git_info_cache: crate::git_info::GitInfoCache::new(),
            git_watch: crate::git_watch::GitWatchState::new(),
            jobs_cache: crate::jobs_common::JobsCache::new(),
            terminal_registry: crate::terminal_session::TerminalRegistry::new(),
            dispatch: crate::dispatch::DispatchState::new(),
            agent_hooks: crate::agent_hooks::AgentHookState::new(),
            agent_watch: crate::agent_watch::AgentWatchState::new(),
            status_stream: crate::status_stream::StatusStreamState::new(),
            manifest_store: crate::screen_manifest::ManifestStore::new(
                dir.path().join("agent_manifests"),
                dir.path(),
            ),
            preview: crate::preview::PreviewState::new(),
            pairing: crate::pairing::PairingState::new(),
            push: crate::push::PushState::new(),
            proxy: crate::proxy::Proxy::new("http://127.0.0.1:1".to_string()),
            static_ctx: None,
            auth: crate::auth::Auth::load(dir.path().join("data"), false),
            rate_counter: crate::rate_limit::FixedWindowCounter::new(),
            rate_limit: 1000,
        };
        (state, dir)
    }

    #[tokio::test]
    async fn session_created_and_removed_payload_shapes() {
        let (state, _dir) = test_state();
        let mut rx = state.status_stream.tx.subscribe();

        notify_session_created(&state, "s1");
        assert_eq!(
            rx.recv().await.unwrap(),
            json!({"type": "session_created", "session_id": "s1"})
        );

        notify_session_removed(&state, "s1");
        assert_eq!(
            rx.recv().await.unwrap(),
            json!({"type": "session_removed", "session_id": "s1"})
        );
    }

    #[tokio::test]
    async fn workspace_bound_payload_shape() {
        let (state, _dir) = test_state();
        let mut rx = state.status_stream.tx.subscribe();
        notify_session_workspace_bound(&state, "s1", "proj");
        assert_eq!(
            rx.recv().await.unwrap(),
            json!({"type": "session_workspace_bound", "session_id": "s1", "workspace": "proj"})
        );
    }

    #[tokio::test]
    async fn job_bound_payload_shape() {
        let (state, _dir) = test_state();
        let mut rx = state.status_stream.tx.subscribe();
        notify_session_job_bound(&state, "s1", "dev", "Dev Server");
        assert_eq!(
            rx.recv().await.unwrap(),
            json!({
                "type": "session_job_bound",
                "session_id": "s1",
                "job_name": "dev",
                "job_label": "Dev Server",
            })
        );
    }

    #[test]
    fn no_subscriber_does_not_panic() {
        let (state, _dir) = test_state();
        notify_session_created(&state, "s1");
        notify_session_removed(&state, "s1");
    }
}
