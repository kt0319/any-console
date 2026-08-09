//! Rust ネイティブ移行済み `POST /agent-hooks/events` の統合テスト。
//!
//! proxy を介さず Rust ハンドラが直接応答すること・hook 専用トークンでの
//! 認証が効いていること・agent_watch が読む `AgentHookState` へ実際に
//! 反映されることを検証する。upstream は不要（未移行ルートに触れないため、
//! 繋がらないダミーを指す）。

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::agent_hooks::hook_state;
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

const HOOK_TOKEN: &str = "hook-test-token-0123456789abcdef";

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": "main-token"})).unwrap();
    // get_hook_token は既存ファイルがあればそれを使う（無ければ新規発行する）ため、
    // テストからトークンを直接読めるよう事前に書いておく。
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::write(data_dir.join("hook_token"), format!("{HOOK_TOKEN}\n")).unwrap();
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
        // 未移行ルートへ触れたら失敗するよう、繋がらない upstream を指す
        preview: any_console_server::preview::PreviewState::new(),
        pairing: any_console_server::pairing::PairingState::new(),
        push: any_console_server::push::PushState::new(),
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
async fn missing_or_wrong_hook_token_is_rejected() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);

    let resp = client()
        .post(&url)
        .json(&json!({"session": "s1", "event": "Notification"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid hook token");

    let resp = client()
        .post(&url)
        .header("x-hook-token", "wrong-token")
        .json(&json!({"session": "s1", "event": "Notification"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    assert!(hook_state(&front.state, "s1").is_none());
}

#[tokio::test]
async fn valid_hook_event_updates_agent_hook_state() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);

    let resp = client()
        .post(&url)
        .header("x-hook-token", HOOK_TOKEN)
        .json(&json!({"session": "ac-s1", "event": "PreToolUse"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["recognized"], true);
    // tmux セッション名（プレフィックス付き）で送っても素の session_id で引ける
    assert_eq!(hook_state(&front.state, "s1").as_deref(), Some("working"));
}

#[tokio::test]
async fn unrecognized_event_is_not_an_error_but_not_recognized() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);

    let resp = client()
        .post(&url)
        .header("x-hook-token", HOOK_TOKEN)
        .json(&json!({"session": "s1", "event": "SomeFutureEvent"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["recognized"], false);
    assert!(hook_state(&front.state, "s1").is_none());
}

#[tokio::test]
async fn out_of_range_fields_are_rejected() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);

    let resp = client()
        .post(&url)
        .header("x-hook-token", HOOK_TOKEN)
        .json(&json!({"session": "", "event": "Stop"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}
