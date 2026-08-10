//! Rust ネイティブ移行済み `/push/*` の統合テスト。
//!
//! 暗号（VAPID JWT・RFC 8291 `aes128gcm`）自体の正しさは `server/src/push.rs` の
//! ユニットテストで検証済み（RFC 8291 Appendix A の中間値との一致を含む）。
//! ここでは配線・認証・購読の CRUD・Origin からの vapid sub 自動検出を検証する。

mod common;

use std::net::SocketAddr;

use serde_json::{json, Value};

use any_console_server::build_router;
use any_console_server::json_store::save_json_file;

struct TestFront {
    addr: SocketAddr,
    data_dir: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "push-test-token";

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let state = common::test_app_state(dir.path(), common::StateOptions::default());
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
    TestFront {
        addr,
        data_dir,
        _dir: dir,
    }
}

#[tokio::test]
async fn vapid_public_key_requires_auth_and_returns_stable_key() {
    let front = spawn_front().await;
    let resp = common::client()
        .get(format!("http://{}/push/vapid-public-key", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    let resp = common::client()
        .get(format!("http://{}/push/vapid-public-key", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let key1 = body["publicKey"].as_str().unwrap().to_string();
    assert!(!key1.is_empty());

    // 2回目の呼び出しでも同じ鍵（プロセス内キャッシュ + ファイル永続化）。
    let resp = common::client()
        .get(format!("http://{}/push/vapid-public-key", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["publicKey"], key1);
}

#[tokio::test]
async fn subscribe_requires_auth_persists_and_detects_vapid_sub() {
    let front = spawn_front().await;
    let sub_body = json!({
        "endpoint": "https://push.example/abc",
        "keys": {"p256dh": "fake-key", "auth": "fake-auth"},
    });

    let resp = common::client()
        .post(format!("http://{}/push/subscribe", front.addr))
        .json(&sub_body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    let resp = common::client()
        .post(format!("http://{}/push/subscribe", front.addr))
        .bearer_auth(TOKEN)
        .header("origin", "https://my-any-console.example:8888")
        .json(&sub_body)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");

    let subs: Value = serde_json::from_str(
        &std::fs::read_to_string(front.data_dir.join("push_subscriptions.json")).unwrap(),
    )
    .unwrap();
    let subs = subs.as_array().unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0]["endpoint"], "https://push.example/abc");
    // メイントークン認証（デバイスペアリング未経由）にはdevice_idが無いため、
    // 「その端末で見ているセッションには送らない」抑制の対象にはならない
    // （購読・push送信自体は従来通り成立する）。
    assert_eq!(subs[0]["device_id"], Value::Null);

    // Origin ヘッダからポート抜きで vapid sub が検出・永続化される。
    let vapid_sub = std::fs::read_to_string(front.data_dir.join("vapid_sub.txt")).unwrap();
    assert_eq!(vapid_sub.trim(), "https://my-any-console.example");
}

#[tokio::test]
async fn subscribe_same_endpoint_twice_does_not_duplicate() {
    let front = spawn_front().await;
    let sub_body = json!({
        "endpoint": "https://push.example/dup",
        "keys": {"p256dh": "k1", "auth": "a1"},
    });
    for _ in 0..2 {
        let resp = common::client()
            .post(format!("http://{}/push/subscribe", front.addr))
            .bearer_auth(TOKEN)
            .json(&sub_body)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
    }
    let subs: Value = serde_json::from_str(
        &std::fs::read_to_string(front.data_dir.join("push_subscriptions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(subs.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn unsubscribe_requires_auth_and_removes_subscription() {
    let front = spawn_front().await;
    let sub_body = json!({
        "endpoint": "https://push.example/xyz",
        "keys": {"p256dh": "k", "auth": "a"},
    });
    common::client()
        .post(format!("http://{}/push/subscribe", front.addr))
        .bearer_auth(TOKEN)
        .json(&sub_body)
        .send()
        .await
        .unwrap();

    let resp = common::client()
        .delete(format!("http://{}/push/subscribe", front.addr))
        .json(&json!({"endpoint": "https://push.example/xyz"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    let resp = common::client()
        .delete(format!("http://{}/push/subscribe", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"endpoint": "https://push.example/xyz"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let subs: Value = serde_json::from_str(
        &std::fs::read_to_string(front.data_dir.join("push_subscriptions.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(subs.as_array().unwrap().len(), 0);
}
