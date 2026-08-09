//! ターミナル HTTP + WebSocket ルートの統合テスト。
//!
//! これらのルートはまだ `build_router` に配線されていない（Phase 5 の設計判断 —
//! `/run`・`/dispatch` と同時に配線する）ため、ここではテスト専用の Router を
//! 直接組み立てて `terminal::` ハンドラを検証する。

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::routing::{delete, get, put};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message as TgMsg;

use any_console_server::auth::Auth;
use any_console_server::config::ConfigStore;
use any_console_server::git_lock::WorkspaceLocks;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::terminal;
use any_console_server::terminal_session::TerminalRegistry;

const TOKEN: &str = "term-test-token";

struct TestFront {
    addr: SocketAddr,
    state: Arc<AppState>,
    _dir: tempfile::TempDir,
}

fn terminal_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/terminal/sessions", get(terminal::list_terminal_sessions))
        .route(
            "/terminal/sessions/{session_id}/history",
            get(terminal::get_terminal_history),
        )
        .route(
            "/terminal/sessions/{session_id}",
            delete(terminal::delete_terminal_session),
        )
        .route(
            "/terminal/sessions/{session_id}/cwd",
            get(terminal::get_terminal_session_cwd),
        )
        .route(
            "/terminal/sessions/{session_id}/workspace",
            put(terminal::set_terminal_session_workspace),
        )
        .route(
            "/terminal/sessions/{session_id}/detached",
            put(terminal::set_terminal_detached),
        )
        .route(
            "/terminal/order",
            get(terminal::get_tab_order).put(terminal::put_tab_order),
        )
        .route("/terminal/ws/{session_id}", get(terminal::terminal_ws))
        .with_state(state)
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let tmux_prefix = format!("ac-test-{}-", any_console_server::util::token_hex(3));

    let state = Arc::new(AppState {
        paths: Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: dir.path().join("config.json"),
            frontend_dir: dir.path().join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix,
        },
        config: ConfigStore::new(dir.path().join("config.json")),
        git_locks: WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
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
            terminal_router(router_state).into_make_service_with_connect_info::<SocketAddr>(),
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

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

fn skip_if_no_tmux() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
}

#[tokio::test]
async fn list_sessions_empty_when_none_created() {
    let front = spawn_front().await;
    let resp = client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body, json!([]));
}

#[tokio::test]
async fn list_and_delete_require_auth() {
    let front = spawn_front().await;
    let resp = client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid token");
}

#[tokio::test]
async fn terminal_order_roundtrip() {
    let front = spawn_front().await;
    let get_order = |front: &TestFront| {
        let addr = front.addr;
        async move {
            client()
                .get(format!("http://{addr}/terminal/order"))
                .bearer_auth(TOKEN)
                .send()
                .await
                .unwrap()
        }
    };
    let resp = get_order(&front).await;
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.json::<Value>().await.unwrap(), json!({"order": []}));

    let resp = client()
        .put(format!("http://{}/terminal/order", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"order": ["b", "a"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = get_order(&front).await;
    assert_eq!(
        resp.json::<Value>().await.unwrap(),
        json!({"order": ["b", "a"]})
    );
}

#[tokio::test]
async fn ws_connect_attach_write_read_and_lifecycle() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;

    // 事前にセッションを作成しておく（/run 相当。まだルート未配線のため直接呼ぶ）。
    let (session_id, _session_arc) = front
        .state
        .terminal_registry
        .create_registered_session(
            &front.state.paths.data_dir,
            &front.state.config,
            &front.state.paths.tmux_prefix,
            None,
            None,
            None,
            None,
            None,
            None,
            true,
        )
        .await
        .expect("session should be created");

    // WS 未認証は拒否される
    let bad_url = format!(
        "ws://{}/terminal/ws/{session_id}?cols=80&rows=24",
        front.addr
    );
    assert!(tokio_tungstenite::connect_async(&bad_url).await.is_err());

    let url = format!(
        "ws://{}/terminal/ws/{session_id}?token={TOKEN}&cols=80&rows=24",
        front.addr
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect should succeed");

    ws.send(TgMsg::Text("echo hello-ws-terminal\r".into()))
        .await
        .unwrap();

    let mut collected = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline && !collected.contains("hello-ws-terminal") {
        match tokio::time::timeout(Duration::from_millis(500), ws.next()).await {
            Ok(Some(Ok(TgMsg::Binary(b)))) => collected.push_str(&String::from_utf8_lossy(&b)),
            Ok(Some(Ok(TgMsg::Text(t)))) => collected.push_str(&t),
            _ => continue,
        }
    }
    assert!(
        collected.contains("hello-ws-terminal"),
        "collected output: {collected:?}"
    );

    // 一覧に反映されている
    let resp = client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    let sessions: Value = resp.json().await.unwrap();
    let arr = sessions.as_array().unwrap();
    assert!(arr.iter().any(|s| s["session_id"] == session_id));

    // detached フラグの更新
    let resp = client()
        .put(format!(
            "http://{}/terminal/sessions/{session_id}/detached",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"detached": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.json::<Value>().await.unwrap(),
        json!({"status": "ok", "detached": true})
    );

    // history capture が過去の出力を含む
    let resp = client()
        .get(format!(
            "http://{}/terminal/sessions/{session_id}/history",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert!(body["content"]
        .as_str()
        .unwrap()
        .contains("hello-ws-terminal"));

    ws.close(None).await.unwrap();
    drop(ws);

    // セッション削除（tmux も消える）
    let resp = client()
        .delete(format!(
            "http://{}/terminal/sessions/{session_id}",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    assert!(!any_console_server::subprocess::tmux_session_exists(&full_name).await);

    // 削除済みの再削除は 404
    let resp = client()
        .delete(format!(
            "http://{}/terminal/sessions/{session_id}",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn ws_missing_session_closes_with_1008() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let url = format!(
        "ws://{}/terminal/ws/no-such-session?token={TOKEN}",
        front.addr
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("upgrade succeeds even though session is then closed");
    match tokio::time::timeout(Duration::from_secs(3), ws.next()).await {
        Ok(Some(Ok(TgMsg::Close(Some(frame))))) => {
            assert_eq!(u16::from(frame.code), 1008);
        }
        other => panic!("expected close frame with code 1008, got {other:?}"),
    }
}
