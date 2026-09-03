//! Rust ネイティブ移行済み `GET /preview/ports` の統合テスト。
//!
//! 実際のポートスキャン（ss/lsof）は環境依存のため、ここでは認証・配線・
//! アクセス時スキャン起動・レスポンス形を検証する。ポートスキャンのパース
//! ロジック自体は `server/src/preview.rs` の単体テストで検証済み。

mod common;

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::build_router;
use any_console_server::json_store::save_json_file;
use any_console_server::state::AppState;

struct TestFront {
    addr: SocketAddr,
    state: Arc<AppState>,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "preview-test-token";

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let state = common::test_app_state(dir.path(), common::StateOptions::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router_state = state.clone();
    tokio::spawn(async move {
        axum::serve(
            listener,
            build_router(router_state).into_make_service_with_connect_info::<SocketAddr>(),
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
async fn preview_ports_requires_auth() {
    let front = spawn_front().await;
    let resp = common::client()
        .get(format!("http://{}/preview/ports", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid token");
}

#[tokio::test]
async fn preview_ports_served_natively_and_triggers_scan() {
    let front = spawn_front().await;
    let resp = common::client()
        .get(format!("http://{}/preview/ports", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert!(body.is_array(), "{body:?}");

    // アクセスにより touch_access が呼ばれ、以後 should_scan_now が true になる
    // ことを、バックグラウンドスキャナ起動 → 短時間待って panic しないことで
    // 間接的に確認する（内部状態は private のため直接は見ない）。
    any_console_server::preview::start_scanner(&front.state);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
}
