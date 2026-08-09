//! フォールバックハンドラ（`proxy::fallback`）の統合テスト。
//!
//! ストラングラー移行は完了し、Python が提供していた全ルートが Rust ネイティブへ
//! 移行済みのため、ここでは Python upstream を一切起動せずに検証する
//! （静的ファイル配信・未知パスのネイティブ 404・セキュリティヘッダ・
//! レート制限がいずれも upstream 無しで正しく動くことの確認）。

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::Value;

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::static_files::StaticCtx;

async fn spawn(router: axum::Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

struct TestFront {
    addr: SocketAddr,
    // dist / data の一時ディレクトリは front サーバ稼働中は保持する
    _dir: tempfile::TempDir,
}

/// static ctx 有り・rate_limit 指定でフロントを起動する（upstream は無し）。
async fn spawn_front(rate_limit: u32) -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let dist = dir.path().join("dist");
    std::fs::create_dir_all(dist.join("assets")).unwrap();
    std::fs::write(dist.join("index.html"), "<html>rust-served</html>").unwrap();
    std::fs::write(dist.join("sw.js"), "// rust sw").unwrap();
    std::fs::write(dist.join("assets/app-hash.js"), "js!").unwrap();
    let state = Arc::new(AppState {
        paths: any_console_server::paths::Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: dir.path().join("data"),
            config_file: dir.path().join("config.json"),
            frontend_dir: dist.clone(),
            icons_dir: dir.path().join("icons"),
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
        static_ctx: StaticCtx::detect(dist, dir.path().join("icons")),
        auth: Auth::load(dir.path().join("data"), false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit,
    });
    let addr = spawn(build_router(state)).await;
    TestFront { addr, _dir: dir }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn unknown_path_returns_native_404_with_detail() {
    let front = spawn_front(1000).await;
    let resp = client()
        .get(format!("http://{}/no-such-route", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Not Found");
}

/// `/internal/*`（旧 migration_bridge.py 専用の内部ブリッジパス）は
/// もう存在しない routers を指すが、他の未知パスと同様にネイティブ 404 になる
/// ことを確認する（外部から到達しても何の内部操作も起動しない）。
#[tokio::test]
async fn internal_prefixed_paths_are_not_special_cased_and_404() {
    let front = spawn_front(1000).await;
    let resp = client()
        .post(format!("http://{}/internal/send-push", front.addr))
        .json(&serde_json::json!({"title": "t", "body": "b"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Not Found");
}

#[tokio::test]
async fn websocket_upgrade_to_unknown_path_fails_cleanly() {
    let front = spawn_front(1000).await;
    let result =
        tokio_tungstenite::connect_async(format!("ws://{}/no-such-ws-route", front.addr)).await;
    assert!(result.is_err(), "unknown path should not upgrade to a WS");
}

#[tokio::test]
async fn security_headers_are_added() {
    let front = spawn_front(1000).await;
    let resp = client()
        .get(format!("http://{}/", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.headers()["x-frame-options"], "DENY");
    assert_eq!(resp.headers()["x-content-type-options"], "nosniff");
    assert_eq!(resp.headers()["referrer-policy"], "no-referrer");
}

#[tokio::test]
async fn static_files_served_natively_without_any_upstream() {
    let front = spawn_front(1000).await;
    // index / sw.js / assets は Rust ネイティブに配信する
    let resp = client()
        .get(format!("http://{}/", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.headers()["cache-control"], "no-cache");
    assert_eq!(resp.text().await.unwrap(), "<html>rust-served</html>");
    // SPA シェル: dist に無いパスも index にフォールバックする
    let resp = client()
        .get(format!("http://{}/pair/abc123", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.text().await.unwrap(), "<html>rust-served</html>");
    let resp = client()
        .get(format!("http://{}/assets/app-hash.js", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );
}

#[tokio::test]
async fn rate_limit_returns_429_with_detail() {
    let front = spawn_front(2).await;
    let url = format!("http://{}/push/vapid-public-key", front.addr);
    assert_eq!(client().get(&url).send().await.unwrap().status(), 200);
    assert_eq!(client().get(&url).send().await.unwrap().status(), 200);
    let resp = client().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 429);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Too many requests");
    // 除外パス（静的 suffix）は上限超過後も通る
    let resp = client()
        .get(format!("http://{}/assets/app-hash.js", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}
