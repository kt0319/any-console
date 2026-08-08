//! Rust ネイティブ移行済み system ルートの統合テスト。
//!
//! proxy を介さず Rust ハンドラが直接応答すること・認証が効いていることを検証する。
//! upstream は不要（未移行ルートに触れないため、繋がらないダミーを指す）。

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;

struct TestFront {
    addr: SocketAddr,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "system-test-token";

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
            tmux_prefix: "ac-".to_string(),
        },
        // 未移行ルートへ触れたら失敗するよう、繋がらない upstream を指す
        proxy: Proxy::new("http://127.0.0.1:1".to_string()),
        static_ctx: None,
        auth: Auth::load(data_dir, false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit: 10_000,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            build_router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    TestFront { addr, _dir: dir }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn system_routes_require_auth() {
    let front = spawn_front().await;
    for path in ["/system/info", "/system/processes", "/system/tmux-info"] {
        let resp = client()
            .get(format!("http://{}{}", front.addr, path))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401, "{path}");
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["detail"], "Invalid token", "{path}");
    }
}

#[tokio::test]
async fn system_info_served_natively() {
    let front = spawn_front().await;
    let resp = client()
        .get(format!("http://{}/system/info", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    // 必須キー（Python 実装と同じ）
    assert!(body["hostname"].is_string());
    assert!(body["user"].is_string());
    assert!(body["install_dir"].is_string());
    // Linux では disk / memory も取れるはず
    assert!(body["disk"].as_str().unwrap_or("").contains("GB"));
    assert!(body["memory"].as_str().unwrap_or("").contains("GB"));
}

#[tokio::test]
async fn system_processes_shape() {
    let front = spawn_front().await;
    let resp = client()
        .get(format!("http://{}/system/processes", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let list = body.as_array().expect("array");
    assert!(!list.is_empty() && list.len() <= 10);
    for p in list {
        assert!(p["pid"].is_i64() || p["pid"].is_u64());
        assert!(p["cpu"].is_number());
        assert!(p["mem"].is_number());
        assert!(p["name"].is_string());
        assert!(p["command"].is_string());
    }
}

#[tokio::test]
async fn process_kill_maps_errno_to_status() {
    let front = spawn_front().await;
    // ほぼ確実に存在しない PID → ESRCH → 404
    let resp = client()
        .post(format!("http://{}/system/process/kill", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"pid": 9_999_999}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Process not found");
    // ボディ不正は 422 + detail
    let resp = client()
        .post(format!("http://{}/system/process/kill", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"pid": "not-a-number"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
    let body: Value = resp.json().await.unwrap();
    assert!(body["detail"].is_string());
}

#[tokio::test]
async fn tmux_kill_validates_name() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/system/tmux/kill", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"name": "  "}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Empty session name");

    let resp = client()
        .post(format!("http://{}/system/tmux/adopt", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"name": "ac-already-managed"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Already managed by any-console");
}

#[tokio::test]
async fn client_errors_accepts_and_validates() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/client-errors", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"type": "error", "message": "boom", "url": "/x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    // max_length 超過は 422
    let resp = client()
        .post(format!("http://{}/client-errors", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"type": "x".repeat(41)}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn tmux_info_shape() {
    let front = spawn_front().await;
    let resp = client()
        .get(format!("http://{}/system/tmux-info", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["prefix"], "ac-");
    assert!(body["available"].is_boolean());
    assert!(body["sessions"].is_array());
}
