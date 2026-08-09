//! `/auth/pairing/*` の統合テスト。
//!
//! これらのルートはまだ `build_router` に配線されていない（`/devices/*`・
//! `/auth/check`・`/auth/logout` と同時に配線する — devices.json への書き込みが
//! Python/Rust 両方から起きる split-brain を避けるための atomic cutover 設計判断。
//! `server/src/pairing.rs` の module doc 参照）ため、テスト専用の Router を直接
//! 組み立てる。サンドボックスに `tailscale` バイナリは無い前提のため、MagicDNS
//! による URL 組み立て分岐は必ずスキップされ、netloc フォールバックへ落ちる。

use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};

use any_console_server::auth::{Auth, COOKIE_DEVICE_ID, COOKIE_DEVICE_SECRET};
use any_console_server::config::ConfigStore;
use any_console_server::json_store::save_json_file;
use any_console_server::pairing;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;

const TOKEN: &str = "pairing-test-token";
/// テストサーバ自身は 127.0.0.1 で listen するが、発行元が非 loopback の Host で
/// 開いている体で叩くために明示的な Host ヘッダを送る（HTTP は Host ヘッダと
/// 実際の接続先アドレスが一致している必要はない）。
const FAKE_ORIGIN_HOST: &str = "100.64.1.2:8888";

struct TestFront {
    addr: SocketAddr,
    _dir: tempfile::TempDir,
}

fn pairing_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/auth/pairing/start", post(pairing::start_pairing))
        .route(
            "/auth/pairing/{pairing_id}/status",
            get(pairing::pairing_status),
        )
        .route(
            "/auth/pairing/{pairing_id}/claim",
            post(pairing::claim_pairing),
        )
        .with_state(state)
}

async fn spawn_front_with_token(token: &str) -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": token})).unwrap();
    let state = Arc::new(AppState {
        paths: Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: dir.path().join("config.json"),
            frontend_dir: dir.path().join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix: "ac-".to_string(),
        },
        config: ConfigStore::new(dir.path().join("config.json")),
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
        pairing: pairing::PairingState::new(),
        push: any_console_server::push::PushState::new(),
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
            pairing_router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    TestFront { addr, _dir: dir }
}

async fn spawn_front() -> TestFront {
    spawn_front_with_token(TOKEN).await
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

async fn start_pairing(front: &TestFront) -> Value {
    let resp = client()
        .post(format!("http://{}/auth/pairing/start", front.addr))
        .bearer_auth(TOKEN)
        .header("host", FAKE_ORIGIN_HOST)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json().await.unwrap()
}

#[tokio::test]
async fn start_requires_auth() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/auth/pairing/start", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn start_rejects_when_auth_disabled() {
    let front = spawn_front_with_token("").await;
    let resp = client()
        .post(format!("http://{}/auth/pairing/start", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Authentication is disabled");
}

#[tokio::test]
async fn start_rejects_when_only_reachable_via_localhost() {
    let front = spawn_front().await;
    // Host ヘッダを明示しない素のリクエストは、テストサーバの実アドレス
    // （127.0.0.1）を Host として受け取る。tailscale バイナリも無いため
    // MagicDNS URL は組み立てられず、loopback フォールバック拒否に落ちる。
    let resp = client()
        .post(format!("http://{}/auth/pairing/start", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert!(body["detail"]
        .as_str()
        .unwrap()
        .contains("Cannot build a link"));
}

#[tokio::test]
async fn start_returns_id_url_and_expiry() {
    let front = spawn_front().await;
    let body = start_pairing(&front).await;
    assert_eq!(body["expires_in_sec"], 90);
    let pairing_id = body["id"].as_str().unwrap();
    assert!(pairing_id.starts_with("pr_"));
    let url = body["url"].as_str().unwrap();
    assert!(url.starts_with(&format!("http://{FAKE_ORIGIN_HOST}/pair/{pairing_id}?t=")));
}

#[tokio::test]
async fn status_not_found_for_unknown_id() {
    let front = spawn_front().await;
    let resp = client()
        .get(format!(
            "http://{}/auth/pairing/pr_doesnotexist/status",
            front.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "not_found");
}

#[tokio::test]
async fn status_pending_after_start_no_auth_required() {
    let front = spawn_front().await;
    let started = start_pairing(&front).await;
    let pairing_id = started["id"].as_str().unwrap();
    // status ポーリングは未認証（新デバイス自身がまだ cookie を持たない）。
    let resp = client()
        .get(format!(
            "http://{}/auth/pairing/{pairing_id}/status",
            front.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "pending");
    assert!(body["expires_in_sec"].as_i64().unwrap() <= 90);
}

fn extract_pairing_token(url: &str) -> String {
    url.rsplit_once("?t=").unwrap().1.to_string()
}

#[tokio::test]
async fn claim_with_wrong_token_is_rejected() {
    let front = spawn_front().await;
    let started = start_pairing(&front).await;
    let pairing_id = started["id"].as_str().unwrap();
    let resp = client()
        .post(format!(
            "http://{}/auth/pairing/{pairing_id}/claim",
            front.addr
        ))
        .json(&json!({"token": "wrong-token"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid pairing token");
}

#[tokio::test]
async fn claim_unknown_id_is_gone() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!(
            "http://{}/auth/pairing/pr_doesnotexist/claim",
            front.addr
        ))
        .json(&json!({"token": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 410);
}

#[tokio::test]
async fn claim_succeeds_registers_device_sets_cookies_and_reports_claimed() {
    let front = spawn_front().await;
    let started = start_pairing(&front).await;
    let pairing_id = started["id"].as_str().unwrap();
    let pairing_token = extract_pairing_token(started["url"].as_str().unwrap());

    let resp = client()
        .post(format!(
            "http://{}/auth/pairing/{pairing_id}/claim",
            front.addr
        ))
        .header(
            "user-agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36",
        )
        .json(&json!({"token": pairing_token}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let cookies: Vec<_> = resp
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .collect();
    assert_eq!(cookies.len(), 2);
    let joined = cookies
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect::<Vec<_>>()
        .join(" | ");
    assert!(joined.contains(COOKIE_DEVICE_ID));
    assert!(joined.contains(COOKIE_DEVICE_SECRET));

    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["ok"], true);
    assert_eq!(body["auth_required"], true);
    assert_eq!(body["name"], "Chrome on macOS");
    assert!(body["device_id"].as_str().unwrap().starts_with("dev_"));

    // claim 後は status が claimed を返す。
    let resp = client()
        .get(format!(
            "http://{}/auth/pairing/{pairing_id}/status",
            front.addr
        ))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "claimed");

    // 使い切ったトークンでの再 claim は拒否される。
    let resp = client()
        .post(format!(
            "http://{}/auth/pairing/{pairing_id}/claim",
            front.addr
        ))
        .json(&json!({"token": pairing_token}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 410);
}

#[tokio::test]
async fn rate_limit_blocks_after_threshold() {
    let front = spawn_front().await;
    let c = client();
    let mut last_status = reqwest::StatusCode::OK;
    for _ in 0..121 {
        let resp = c
            .get(format!(
                "http://{}/auth/pairing/pr_doesnotexist/status",
                front.addr
            ))
            .send()
            .await
            .unwrap();
        last_status = resp.status();
    }
    assert_eq!(last_status, 429);
}
