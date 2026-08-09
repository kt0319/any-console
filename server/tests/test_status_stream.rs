//! `/workspaces/statuses/ws`（status_stream）の統合テスト。
//!
//! このエンドポイントはまだ `build_router` に配線されていない（producer
//! 一式 — git_watch の FS 監視ループ・agent_watch のポーリングループ・dispatch の
//! 直接配信化 — が揃うまでは配信元が無いため）。ここではテスト専用の Router を
//! 直接組み立てて `status_stream::status_stream_ws` ハンドラを検証する。

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::routing::get;
use axum::Router;
use futures_util::StreamExt;
use serde_json::json;
use tokio_tungstenite::tungstenite::Message as TgMsg;

use any_console_server::auth::Auth;
use any_console_server::config::ConfigStore;
use any_console_server::git_lock::WorkspaceLocks;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::status_stream::{self, StatusStreamState};
use any_console_server::terminal_session::TerminalRegistry;

const TOKEN: &str = "status-stream-test-token";

struct TestFront {
    addr: SocketAddr,
    state: Arc<AppState>,
    _dir: tempfile::TempDir,
}

fn status_stream_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route(
            "/workspaces/statuses/ws",
            get(status_stream::status_stream_ws),
        )
        .with_state(state)
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();

    let state = Arc::new(AppState {
        paths: Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: dir.path().join("config.json"),
            frontend_dir: dir.path().join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix: "ac-test-".to_string(),
        },
        config: ConfigStore::new(dir.path().join("config.json")),
        git_locks: WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        status_stream: StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            dir.path().join("agent_manifests"),
            dir.path(),
        ),
        proxy: Proxy::new("http://127.0.0.1:1".to_string()),
        static_ctx: None,
        auth: Auth::load(data_dir, false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit: 10_000,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router_state = state.clone();
    tokio::spawn(async move {
        axum::serve(
            listener,
            status_stream_router(router_state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    TestFront {
        addr,
        state,
        _dir: dir,
    }
}

async fn wait_for(cond: impl Fn() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if cond() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

#[tokio::test]
async fn rejects_connection_without_valid_token() {
    let front = spawn_front().await;
    let url = format!("ws://{}/workspaces/statuses/ws", front.addr);
    let err = tokio_tungstenite::connect_async(&url)
        .await
        .expect_err("should be rejected");
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), 403);
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn subscriber_receives_broadcasts_and_disconnect_drops_count() {
    let front = spawn_front().await;
    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");

    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 1).await);

    front.state.status_stream.broadcast(json!({
        "type": "statuses",
        "statuses": [{"name": "proj", "branch": "main"}],
    }));

    let msg = ws.next().await.unwrap().unwrap();
    let TgMsg::Text(text) = msg else {
        panic!("expected text frame, got {msg:?}")
    };
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        parsed,
        json!({"type": "statuses", "statuses": [{"name": "proj", "branch": "main"}]})
    );

    ws.close(None).await.unwrap();
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 0).await);
}

#[tokio::test]
async fn multiple_subscribers_all_receive_the_same_broadcast() {
    let front = spawn_front().await;
    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws1, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut ws2, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 2).await);

    front
        .state
        .status_stream
        .broadcast(json!({"type": "session_created", "session_id": "s1"}));

    for ws in [&mut ws1, &mut ws2] {
        let msg = ws.next().await.unwrap().unwrap();
        let TgMsg::Text(text) = msg else {
            panic!("expected text frame, got {msg:?}")
        };
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            parsed,
            json!({"type": "session_created", "session_id": "s1"})
        );
    }
}
