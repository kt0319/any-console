//! Rust ネイティブ移行済み `POST /upload-image` の統合テスト。
//!
//! クリップボード書き込み（osascript/xclip 呼び出し）はサンドボックスに無いため
//! 実行されない・例外にもならないことを、`clipboard: false` の応答で確認する。
//! ファイルは実運用と同じパス（`/tmp/any-console-uploads`）に書かれるため、
//! テストは自分が作ったファイルを後始末する。

mod common;

use std::net::SocketAddr;

use serde_json::{json, Value};

use any_console_server::build_router;
use any_console_server::json_store::save_json_file;

struct TestFront {
    addr: SocketAddr,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "upload-image-test-token";

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
    TestFront { addr, _dir: dir }
}

/// テスト自身が作ったアップロード先ファイルを後始末する（実運用の `/tmp` を
/// テストで汚さないため、パスは応答の "path" フィールドから正確に取り出す）。
fn cleanup(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn upload_image_requires_auth() {
    let front = spawn_front().await;
    let part = reqwest::multipart::Part::bytes(vec![1, 2, 3])
        .file_name("x.png")
        .mime_str("image/png")
        .unwrap();
    let form = reqwest::multipart::Form::new().part("file", part);
    let resp = common::client()
        .post(format!("http://{}/upload-image", front.addr))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn upload_image_rejects_unsupported_type() {
    let front = spawn_front().await;
    let part = reqwest::multipart::Part::bytes(vec![1, 2, 3])
        .file_name("x.txt")
        .mime_str("text/plain")
        .unwrap();
    let form = reqwest::multipart::Form::new().part("file", part);
    let resp = common::client()
        .post(format!("http://{}/upload-image", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert!(body["detail"]
        .as_str()
        .unwrap()
        .starts_with("Unsupported type"));
}

#[tokio::test]
async fn upload_image_rejects_oversized_file() {
    let front = spawn_front().await;
    let oversized = vec![0u8; 10 * 1024 * 1024 + 1];
    let part = reqwest::multipart::Part::bytes(oversized)
        .file_name("big.png")
        .mime_str("image/png")
        .unwrap();
    let form = reqwest::multipart::Form::new().part("file", part);
    let resp = common::client()
        .post(format!("http://{}/upload-image", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 413);
}

#[tokio::test]
async fn upload_image_saves_file_and_reports_shape() {
    let front = spawn_front().await;
    let part = reqwest::multipart::Part::bytes(b"fake-png-bytes".to_vec())
        .file_name("x.png")
        .mime_str("image/png")
        .unwrap();
    let form = reqwest::multipart::Form::new().part("file", part);
    let resp = common::client()
        .post(format!("http://{}/upload-image", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    let path = body["path"].as_str().unwrap().to_string();
    // 保存先は data_dir 配下（paths.rs の uploads_dir — ANY_CONSOLE_DATA_DIR 隔離が効く）
    assert!(path.contains("uploads"));
    assert!(path.ends_with(".png"));
    assert_eq!(
        std::fs::read(&path).unwrap(),
        b"fake-png-bytes",
        "uploaded bytes should be persisted verbatim"
    );
    // サンドボックスに osascript/xclip は無いため false になるはず。
    assert_eq!(body["clipboard"], false);
    cleanup(&path);
}

#[tokio::test]
async fn upload_image_missing_file_field_is_bad_request() {
    let front = spawn_front().await;
    let form = reqwest::multipart::Form::new().text("not_file", "x");
    let resp = common::client()
        .post(format!("http://{}/upload-image", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    // 422（git_files 側の必須ファイルフィールド未指定と同じ扱い）。
    assert_eq!(resp.status(), 422);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "file field required");
}
