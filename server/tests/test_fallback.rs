//! フォールバックハンドラ（`fallback::handle`）の統合テスト。
//!
//! 全ルートが Rust ネイティブ実装のため、ここでは upstream を一切起動せずに
//! 検証する（静的ファイル配信・未知パスのネイティブ 404・セキュリティヘッダ・
//! レート制限がいずれも upstream 無しで正しく動くことの確認）。

mod common;

use std::net::SocketAddr;

use serde_json::Value;

use any_console_server::build_router;
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
    let state = common::test_app_state(
        dir.path(),
        common::StateOptions {
            rate_limit,
            static_ctx: StaticCtx::detect(dist.clone(), dir.path().join("icons")),
            frontend_dir: Some(dist),
            icons_dir: Some(dir.path().join("icons")),
            ..Default::default()
        },
    );
    let addr = spawn(build_router(state)).await;
    TestFront { addr, _dir: dir }
}

#[tokio::test]
async fn unknown_path_returns_native_404_with_detail() {
    let front = spawn_front(1000).await;
    let resp = common::client()
        .get(format!("http://{}/no-such-route", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Not Found");
}

/// `/internal/*` はもう存在しない内部ブリッジ用パスだが、他の未知パスと
/// 同様にネイティブ 404 になることを確認する（外部から到達しても何の内部
/// 操作も起動しない）。
#[tokio::test]
async fn internal_prefixed_paths_are_not_special_cased_and_404() {
    let front = spawn_front(1000).await;
    let resp = common::client()
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
    let resp = common::client()
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
    let resp = common::client()
        .get(format!("http://{}/", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.headers()["cache-control"], "no-cache");
    assert_eq!(resp.text().await.unwrap(), "<html>rust-served</html>");
    // SPA シェル: dist に無いパスも index にフォールバックする
    let resp = common::client()
        .get(format!("http://{}/pair/abc123", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.text().await.unwrap(), "<html>rust-served</html>");
    let resp = common::client()
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
    assert_eq!(
        common::client().get(&url).send().await.unwrap().status(),
        200
    );
    assert_eq!(
        common::client().get(&url).send().await.unwrap().status(),
        200
    );
    let resp = common::client().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 429);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Too many requests");
    // 除外パス（静的 suffix）は上限超過後も通る
    let resp = common::client()
        .get(format!("http://{}/assets/app-hash.js", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}
