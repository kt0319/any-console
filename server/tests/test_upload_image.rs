//! Rust ネイティブ移行済み `POST /upload-image` の統合テスト。
//!
//! クリップボード書き込み（osascript/xclip 呼び出し）はサンドボックスに無いため
//! 実行されない・例外にもならないことを、`clipboard: false` の応答で確認する。
//! ファイル自体は Python 版と同じ実パス（`/tmp/any-console-uploads`）に書かれる
//! ため、テストは自分が作ったファイルを後始末する。

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;

struct TestFront {
    addr: SocketAddr,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "upload-image-test-token";

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
        config: any_console_server::config::ConfigStore::new(dir.path().join("config.json")),
        git_locks: any_console_server::git_lock::WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        git_watch: any_console_server::git_watch::GitWatchState::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: any_console_server::terminal_session::TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        agent_watch: any_console_server::agent_watch::AgentWatchState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            dir.path().join("agent_manifests"),
            dir.path(),
        ),
        preview: any_console_server::preview::PreviewState::new(),
        pairing: any_console_server::pairing::PairingState::new(),
        push: any_console_server::push::PushState::new(),
        // 未移行ルートへ触れたら失敗するよう、繋がらない upstream を指す
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
    let resp = client()
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
    let resp = client()
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
    let resp = client()
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
    let resp = client()
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
    assert!(path.contains("any-console-uploads"));
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
    let resp = client()
        .post(format!("http://{}/upload-image", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "file field required");
}
