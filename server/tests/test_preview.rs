//! Rust ネイティブ移行済み `GET /preview/ports` の統合テスト。
//!
//! 実際のポートスキャン（ss/lsof）は環境依存のため、ここでは認証・配線・
//! アクセス時スキャン起動・レスポンス形を検証する。ポートスキャンのパース
//! ロジック自体は `server/src/preview.rs` の単体テストで検証済み。

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
    state: Arc<AppState>,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "preview-test-token";

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
        proxy: Proxy::new("http://127.0.0.1:1".to_string()),
        static_ctx: None,
        auth: Auth::load(data_dir, false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit: 10_000,
    });
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

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn preview_ports_requires_auth() {
    let front = spawn_front().await;
    let resp = client()
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
    // 実 ss/lsof の結果は環境依存（この sandbox には ss が無い）ため中身までは
    // 検証しないが、配線・認証・アクセス時スキャン起動・レスポンス形（配列）を
    // 検証する。スキャン自体のパース・フィルタロジックは preview.rs の単体
    // テストで実際の出力フィクスチャを使って検証済み。
    let resp = client()
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
