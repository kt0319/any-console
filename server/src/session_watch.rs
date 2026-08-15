//! ターミナルセッション作成・削除のリアルタイム配信（Python 側
//! `api/session_watch.py` の移植）。
//!
//! Python 版が持っていた「同期ハンドラのスレッドから安全にイベントループへ
//! スケジュールする」ための `call_threadsafe` パターンは、`AppState` が保持する
//! `tokio::sync::broadcast::Sender`（`status_stream.rs`）へ直接 `send()` するだけで
//! 不要になる（マルチスレッドから安全に呼べる）。
//!
//! 呼び出し元はセッション作成（`job_runner.rs`・`dispatch.rs`）・削除
//! （`terminal.rs`）・エージェント自動紐付け（`agent_watch.rs`）で、
//! `/workspaces/statuses/ws`（`status_stream.rs`）の購読者へ配信される。

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
/// 相当）を購読中の全クライアントへ即時配信する。icon/icon_color は
/// 未解決なら空文字（クライアント側は空文字を未設定として扱い上書きしない）。
pub fn notify_session_job_bound(
    state: &AppState,
    session_id: &str,
    job_name: &str,
    job_label: &str,
    icon: &str,
    icon_color: &str,
) {
    state.status_stream.broadcast(json!({
        "type": "session_job_bound",
        "session_id": session_id,
        "job_name": job_name,
        "job_label": job_label,
        "icon": icon,
        "icon_color": icon_color,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::state::test_app_state(dir.path(), "ac-", 1000);
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
        notify_session_job_bound(&state, "s1", "dev", "Dev Server", "mdi-server", "#f00");
        assert_eq!(
            rx.recv().await.unwrap(),
            json!({
                "type": "session_job_bound",
                "session_id": "s1",
                "job_name": "dev",
                "job_label": "Dev Server",
                "icon": "mdi-server",
                "icon_color": "#f00",
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
