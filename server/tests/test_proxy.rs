//! フロント（Rust）→ upstream（Python 相当のモック）の透過 proxy 統合テスト。
//!
//! upstream 役の axum サーバを別ポートに立て、フロントの Router を通した
//! リクエストが HTTP / WebSocket ともに正しく中継されることを検証する。

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::static_files::StaticCtx;

/// upstream 役（Python バックエンドのモック）。
fn upstream_router() -> Router {
    Router::new()
        .route(
            "/auth/check",
            get(|headers: HeaderMap| async move {
                Json(json!({
                    "workspaces": [],
                    "xff": headers
                        .get("x-forwarded-for")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or(""),
                    "auth": headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or(""),
                    "host": headers
                        .get("host")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or(""),
                }))
            }),
        )
        .route(
            "/echo",
            post(|body: String| async move { format!("echo:{body}") }),
        )
        .route(
            // 実際には migration_bridge.py 側のパスだが、フロントが本当に
            // upstream まで転送していないことを検証するためのマーカー役。
            "/internal/send-push",
            post(|| async { "reached-upstream" }),
        )
        .route(
            "/push/vapid-public-key",
            get(|| async { Json(json!({"key": "fake-vapid-key"})) }),
        )
        .route(
            "/missing",
            get(|| async {
                (
                    axum::http::StatusCode::NOT_FOUND,
                    Json(json!({"detail": "Not found"})),
                )
            }),
        )
        .route(
            // Rust に無いパスなら何でもよい（generic な WS proxy 経路の検証用。
            // /workspaces/statuses/ws は Rust ネイティブルートになったため使えない）。
            "/still-python-only/ws",
            any(|headers: HeaderMap, ws: WebSocketUpgrade| async move {
                let host = headers
                    .get("host")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                ws.on_upgrade(move |mut socket| async move {
                    if socket
                        .send(Message::Text(format!("host:{host}").into()))
                        .await
                        .is_err()
                    {
                        return;
                    }
                    while let Some(Ok(msg)) = socket.recv().await {
                        let reply = match msg {
                            Message::Text(t) => Message::Text(format!("pong:{t}").into()),
                            Message::Binary(b) => Message::Binary(b),
                            Message::Close(_) => break,
                            other => other,
                        };
                        if socket.send(reply).await.is_err() {
                            break;
                        }
                    }
                })
            }),
        )
        .route("/", get(|| async { "python index" }))
}

async fn spawn(router: Router) -> SocketAddr {
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
    // dist / data の一時ディレクトリを front サーバ稼働中は保持する
    _dir: tempfile::TempDir,
}

/// static ctx 有り・rate_limit 指定でフロントを起動する。
async fn spawn_front(upstream: SocketAddr, rate_limit: u32) -> TestFront {
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
        proxy: Proxy::new(format!("http://{upstream}")),
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
async fn http_get_is_proxied_with_forwarded_for() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let resp = client()
        .get(format!("http://{}/auth/check", front.addr))
        .header("authorization", "Bearer tkn")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["xff"], "127.0.0.1");
    assert_eq!(body["auth"], "Bearer tkn");
}

/// クライアントが実際にアクセスした Host が upstream にそのまま引き継がれること
/// （Codex レビュー指摘: Python 側の pairing URL 生成が Request.url = Host ヘッダ
/// に依存するため、常に upstream の 127.0.0.1:port に化けると壊れる）。
#[tokio::test]
async fn original_host_header_is_forwarded_not_upstream_addr() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let resp = client()
        .get(format!("http://{}/auth/check", front.addr))
        .header("host", "example.ts.net:8888")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["host"], "example.ts.net:8888");
}

#[tokio::test]
async fn spoofed_forwarded_for_is_appended_not_trusted() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let resp = client()
        .get(format!("http://{}/auth/check", front.addr))
        .header("x-forwarded-for", "6.6.6.6")
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    // 実接続元が右端に足される（uvicorn は右端を採用するため偽装が効かない）
    assert_eq!(body["xff"], "6.6.6.6, 127.0.0.1");
}

#[tokio::test]
async fn post_body_and_error_detail_pass_through() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let resp = client()
        .post(format!("http://{}/echo", front.addr))
        .body("hello")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.text().await.unwrap(), "echo:hello");

    let resp = client()
        .get(format!("http://{}/missing", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Not found");
}

#[tokio::test]
async fn security_headers_are_added() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let resp = client()
        .get(format!("http://{}/auth/check", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.headers()["x-frame-options"], "DENY");
    assert_eq!(resp.headers()["x-content-type-options"], "nosniff");
    assert_eq!(resp.headers()["referrer-policy"], "no-referrer");
}

#[tokio::test]
async fn static_files_served_by_rust_with_proxy_fallthrough() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    // index / sw.js / assets は Rust が配信
    let resp = client()
        .get(format!("http://{}/", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.headers()["cache-control"], "no-cache");
    assert_eq!(resp.text().await.unwrap(), "<html>rust-served</html>");
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
    // dist に無いパスは upstream へ
    let resp = client()
        .get(format!("http://{}/auth/check", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn rate_limit_returns_429_with_detail() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 2).await;
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

/// `/internal/*`（migration_bridge.py 専用の Rust→Python 内部ブリッジ）は
/// 公開ルートではないため、外部クライアントが公開の Rust front 経由で
/// 到達しても upstream へは転送されない（転送されると upstream からは
/// Rust 自身の loopback 接続と区別が付かず、migration_bridge.py の
/// loopback チェックをすり抜けてしまう）。
#[tokio::test]
async fn internal_bridge_paths_are_not_proxied_to_upstream() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let resp = client()
        .post(format!("http://{}/internal/send-push", front.addr))
        .json(&json!({"title": "t", "body": "b"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Not Found");
}

#[tokio::test]
async fn websocket_is_bridged_both_directions() {
    let upstream = spawn(upstream_router()).await;
    let front = spawn_front(upstream, 1000).await;
    let (mut ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{}/still-python-only/ws", front.addr))
            .await
            .expect("ws connect through proxy");

    use tokio_tungstenite::tungstenite::Message as TgMsg;
    // 元クライアントの Host（front.addr 宛て）が upstream にそのまま引き継がれる
    // こと（upstream 自身のアドレスに化けないこと）。
    let host_msg = ws.next().await.unwrap().unwrap();
    assert_eq!(host_msg, TgMsg::Text(format!("host:{}", front.addr).into()));

    ws.send(TgMsg::Text("hello".into())).await.unwrap();
    let reply = ws.next().await.unwrap().unwrap();
    assert_eq!(reply, TgMsg::Text("pong:hello".into()));

    ws.send(TgMsg::Binary(vec![0x00, 0x01, 0xff].into()))
        .await
        .unwrap();
    let reply = ws.next().await.unwrap().unwrap();
    assert_eq!(reply, TgMsg::Binary(vec![0x00, 0x01, 0xff].into()));

    ws.close(None).await.unwrap();
}
