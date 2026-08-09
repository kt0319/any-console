//! デバイス cookie 認証成功時に、Python 側 devices.json の last_seen_at を
//! 更新するブリッジ（POST /internal/touch-device）がスロットリング付きで
//! 呼ばれることの統合テスト（Codex レビュー指摘）。

use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::routing::post;
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

use any_console_server::auth::{COOKIE_DEVICE_ID, COOKIE_DEVICE_SECRET};
use any_console_server::build_router;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;

type HmacSha256 = Hmac<Sha256>;

#[derive(Default, Clone)]
struct TouchCalls(Arc<StdMutex<Vec<Value>>>);

async fn touch_device_handler(
    AxumState(calls): AxumState<TouchCalls>,
    Json(body): Json<Value>,
) -> Json<Value> {
    calls.0.lock().unwrap().push(body);
    Json(json!({"status": "ok"}))
}

async fn spawn_upstream() -> (SocketAddr, TouchCalls) {
    let calls = TouchCalls::default();
    let router = Router::new()
        .route("/internal/touch-device", post(touch_device_handler))
        .with_state(calls.clone());
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
    (addr, calls)
}

struct TestFront {
    addr: SocketAddr,
    calls: TouchCalls,
    raw_secret: String,
    _dir: tempfile::TempDir,
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": "main-token"})).unwrap();

    let key: Vec<u8> = (0u8..32).collect();
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::write(data_dir.join("server_key"), &key).unwrap();
    let raw_secret = "device-raw-secret".to_string();
    let mut mac = HmacSha256::new_from_slice(&key).unwrap();
    mac.update(raw_secret.as_bytes());
    let hash: String = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    save_json_file(
        &data_dir.join("devices.json"),
        &json!({"devices": [{"id": "dev_1", "secret_hash": hash, "last_seen_at": 0}]}),
    )
    .unwrap();

    let (upstream_addr, calls) = spawn_upstream().await;

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
        proxy: Proxy::new(format!("http://{upstream_addr}")),
        static_ctx: None,
        auth: any_console_server::auth::Auth::load(data_dir, false),
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
    TestFront {
        addr,
        calls,
        raw_secret,
        _dir: dir,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn device_auth_touches_last_seen_once_per_throttle_window() {
    let front = spawn_front().await;
    let cookie = format!(
        "{}=dev_1; {}={}",
        COOKIE_DEVICE_ID, COOKIE_DEVICE_SECRET, front.raw_secret
    );

    // 1回目: デバイス cookie 認証で system/info に到達できる（= 認証成功）。
    let resp = client()
        .get(format!("http://{}/system/info", front.addr))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // fire-and-forget なので、ブリッジ呼び出しが届くまで短時間ポーリングする。
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while tokio::time::Instant::now() < deadline && front.calls.0.lock().unwrap().is_empty() {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let calls = front.calls.0.lock().unwrap().clone();
    assert_eq!(calls.len(), 1, "1回目の認証で1回だけタッチされるはず");
    assert_eq!(calls[0]["device_id"], "dev_1");
    assert_eq!(calls[0]["raw_secret"], front.raw_secret);

    // 2回目（直後）: スロットリングされ、追加のブリッジ呼び出しは発生しない。
    let resp = client()
        .get(format!("http://{}/system/info", front.addr))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        front.calls.0.lock().unwrap().len(),
        1,
        "直後の再認証はスロットリングされ、ブリッジは再度叩かれないはず"
    );
}
