//! ターミナル HTTP + WebSocket ルートの統合テスト。
//!
//! これらのルートはまだ `build_router` に配線されていない（Phase 5 の設計判断 —
//! `/run`・`/dispatch` と同時に配線する）ため、ここではテスト専用の Router を
//! 直接組み立てて `terminal::` ハンドラを検証する。

mod common;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::routing::{delete, get, put};
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message as TgMsg;

use any_console_server::json_store::save_json_file;
use any_console_server::state::AppState;
use any_console_server::terminal;

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
    let tmux_prefix = common::unique_tmux_prefix();

    let state = common::test_app_state(
        dir.path(),
        common::StateOptions {
            tmux_prefix,
            ..Default::default()
        },
    );
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

#[tokio::test]
async fn list_sessions_empty_when_none_created() {
    let front = spawn_front().await;
    let resp = common::client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body, json!([]));
}

/// 複数セッションが未登録（レジストリ空、Rust再起動直後を模した状況）の
/// まま並行問い合わせされても、全件返り created_at 昇順でソートされること
/// （list_terminal_sessionsをper-session逐次awaitからjoin_allへ並列化した
/// リグレッションガード）。
#[tokio::test]
async fn list_sessions_with_multiple_unregistered_returns_all_sorted() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let session_ids = ["multi-a", "multi-b", "multi-c"];
    for session_id in session_ids {
        let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
        any_console_server::subprocess::run_subprocess_safe(
            &["tmux", "new-session", "-d", "-s", &full_name],
            5.0,
            None,
        )
        .await;
        tokio::time::sleep(Duration::from_millis(1100)).await;
    }
    assert_eq!(front.state.terminal_registry.len().await, 0);

    let resp = common::client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let sessions = body.as_array().unwrap();
    assert_eq!(sessions.len(), 3);
    let returned_ids: Vec<&str> = sessions
        .iter()
        .map(|s| s["session_id"].as_str().unwrap())
        .collect();
    assert_eq!(returned_ids, session_ids);
    let created_ats: Vec<i64> = sessions
        .iter()
        .map(|s| s["created_at"].as_i64().unwrap())
        .collect();
    assert!(created_ats.windows(2).all(|w| w[0] <= w[1]));

    for session_id in session_ids {
        let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
        any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
    }
}

#[tokio::test]
async fn list_and_delete_require_auth() {
    let front = spawn_front().await;
    let resp = common::client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid token");
}

/// Rust 再起動直後を模した状況（レジストリが空だが tmux には実在する
/// セッション）を DELETE すると、404 にならずレジストリへハイドレートしてから
/// 実際に tmux セッションが kill されること（Codex レビュー指摘: 以前は
/// registry-only の `remove` が None を返して 404 になり、tmux プロセスは
/// キルされずに残り続けていた）。
#[tokio::test]
async fn delete_hydrates_unregistered_but_live_tmux_session() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let session_id = "cold-delete";
    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    any_console_server::subprocess::run_subprocess_safe(
        &["tmux", "new-session", "-d", "-s", &full_name],
        5.0,
        None,
    )
    .await;
    assert_eq!(front.state.terminal_registry.len().await, 0);

    let resp = common::client()
        .delete(format!(
            "http://{}/terminal/sessions/{session_id}",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(!any_console_server::subprocess::tmux_session_exists(&full_name).await);
}

#[tokio::test]
async fn terminal_order_roundtrip() {
    let front = spawn_front().await;
    let get_order = |front: &TestFront| {
        let addr = front.addr;
        async move {
            common::client()
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

    let resp = common::client()
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
    if common::skip_if_no_tmux() {
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
            &front.state.paths.project_root,
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
    let resp = common::client()
        .get(format!("http://{}/terminal/sessions", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    let sessions: Value = resp.json().await.unwrap();
    let arr = sessions.as_array().unwrap();
    assert!(arr.iter().any(|s| s["session_id"] == session_id));

    // detached フラグの更新
    let resp = common::client()
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
    let resp = common::client()
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

    // agent hook 由来の状態も削除時に一緒に消えること
    any_console_server::agent_hooks::record_event(
        &front.state,
        &session_id,
        "Notification",
        "needs your permission",
    );
    assert_eq!(
        any_console_server::agent_hooks::hook_state(&front.state, &session_id).as_deref(),
        Some("blocked")
    );

    // セッション削除（tmux も消える）
    let resp = common::client()
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
    assert!(
        any_console_server::agent_hooks::hook_state(&front.state, &session_id).is_none(),
        "agent hook state should be cleared on session delete"
    );

    // 削除済みの再削除は 404
    let resp = common::client()
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

/// 手動でのワークスペース紐付け（Add/Open。`WorkspaceAddView.vue`が叩く
/// `PUT /terminal/sessions/{id}/workspace`）が status stream WS へ
/// `session_workspace_bound` をブロードキャストすること。発火元クライアントは
/// APIレスポンス直後にローカルで楽観更新するため気付かないが、これが無いと
/// 同じセッションを見ている別クライアントには紐付けが一切反映されない
/// （agent_watchのcwd自動紐付け経由の`apply_workspace_tag`だけが配線されており、
/// 手動紐付け経路に配線が漏れていたリグレッション）。
#[tokio::test]
async fn set_workspace_broadcasts_session_workspace_bound() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let (session_id, _session_arc) = front
        .state
        .terminal_registry
        .create_registered_session(
            &front.state.paths.data_dir,
            &front.state.config,
            &front.state.paths.project_root,
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

    let mut rx = front.state.status_stream.tx.subscribe();

    let resp = common::client()
        .put(format!(
            "http://{}/terminal/sessions/{session_id}/workspace",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "my-ws"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let msg = tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .expect("broadcast should arrive")
        .unwrap();
    assert_eq!(
        msg,
        json!({
            "type": "session_workspace_bound",
            "session_id": session_id,
            "workspace": "my-ws",
        })
    );
}

#[tokio::test]
async fn ws_missing_session_closes_with_1008() {
    if common::skip_if_no_tmux() {
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
