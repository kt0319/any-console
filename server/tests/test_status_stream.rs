//! `/workspaces/statuses/ws`（status_stream）の統合テスト。
//!
//! このエンドポイントはまだ `build_router` に配線されていない（producer
//! 一式 — git_watch の FS 監視ループ・agent_watch のポーリングループ・dispatch の
//! 直接配信化 — が揃うまでは配信元が無いため）。ここではテスト専用の Router を
//! 直接組み立てて `status_stream::status_stream_ws` ハンドラを検証する。

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::routing::get;
use axum::Router;
use futures_util::StreamExt;
use serde_json::json;
use tokio_tungstenite::tungstenite::Message as TgMsg;

use any_console_server::auth::Auth;
use any_console_server::config::ConfigStore;
use any_console_server::git_lock::WorkspaceLocks;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::status_stream::{self, StatusStreamState};
use any_console_server::terminal_session::TerminalRegistry;

const TOKEN: &str = "status-stream-test-token";

struct TestFront {
    addr: SocketAddr,
    state: Arc<AppState>,
    _dir: tempfile::TempDir,
}

fn status_stream_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route(
            "/workspaces/statuses/ws",
            get(status_stream::status_stream_ws),
        )
        .with_state(state)
}

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
            tmux_prefix: format!("ac-test-{}-", any_console_server::util::token_hex(3)),
        },
        config: ConfigStore::new(dir.path().join("config.json")),
        git_locks: WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        git_watch: any_console_server::git_watch::GitWatchState::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        agent_watch: any_console_server::agent_watch::AgentWatchState::new(),
        status_stream: StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            dir.path().join("agent_manifests"),
            dir.path(),
        ),
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
            status_stream_router(router_state).into_make_service_with_connect_info::<SocketAddr>(),
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

async fn wait_for(cond: impl Fn() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if cond() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 接続直後は git_watch/agent_watch/dispatch の初期同期メッセージ（ping も）が
/// 混ざりうるため、単純に「次の1通」を見るのではなく `pred` に一致する最初の
/// メッセージが届くまで読み飛ばす。
async fn recv_json_until(
    ws: &mut WsStream,
    timeout: Duration,
    pred: impl Fn(&serde_json::Value) -> bool,
) -> serde_json::Value {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        let Ok(Some(Ok(msg))) = tokio::time::timeout(Duration::from_secs(1), ws.next()).await
        else {
            continue;
        };
        let TgMsg::Text(text) = msg else { continue };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if pred(&parsed) {
            return parsed;
        }
    }
    panic!("timed out waiting for a matching message");
}

#[tokio::test]
async fn rejects_connection_without_valid_token() {
    let front = spawn_front().await;
    let url = format!("ws://{}/workspaces/statuses/ws", front.addr);
    let err = tokio_tungstenite::connect_async(&url)
        .await
        .expect_err("should be rejected");
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), 403);
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn subscriber_receives_broadcasts_and_disconnect_drops_count() {
    let front = spawn_front().await;
    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");

    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 1).await);

    front.state.status_stream.broadcast(json!({
        "type": "statuses",
        "statuses": [{"name": "proj", "branch": "main"}],
    }));

    // 接続直後は dispatch の初期同期スナップショット（空でも送られる）が先に
    // 届きうるため、type=="statuses" が来るまで読み飛ばす。
    let parsed =
        recv_json_until(&mut ws, Duration::from_secs(5), |v| v["type"] == "statuses").await;
    assert_eq!(
        parsed,
        json!({"type": "statuses", "statuses": [{"name": "proj", "branch": "main"}]})
    );

    ws.close(None).await.unwrap();
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 0).await);
}

/// 接続すると、既存の pending dispatch がある場合 Python `dispatch.subscribe`
/// と同じく現在のキュー全量を即座に受け取ること（承認待ちを見逃さない）。
#[tokio::test]
async fn connecting_receives_current_dispatch_queue_snapshot() {
    let front = spawn_front().await;
    front.state.dispatch.pending.lock().await.insert(
        "d1".to_string(),
        json!({"workspace": "proj", "text": "hello"}),
    );

    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");

    let parsed = recv_json_until(&mut ws, Duration::from_secs(5), |v| {
        v["type"] == "dispatch_queue"
    })
    .await;
    assert_eq!(parsed["items"][0]["id"], "d1");
}

#[tokio::test]
async fn multiple_subscribers_all_receive_the_same_broadcast() {
    let front = spawn_front().await;
    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws1, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    let (mut ws2, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 2).await);

    front
        .state
        .status_stream
        .broadcast(json!({"type": "session_created", "session_id": "s1"}));

    for ws in [&mut ws1, &mut ws2] {
        let parsed = recv_json_until(ws, Duration::from_secs(5), |v| {
            v["type"] == "session_created"
        })
        .await;
        assert_eq!(
            parsed,
            json!({"type": "session_created", "session_id": "s1"})
        );
    }
}

fn sh_git(repo: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00+00:00")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00+00:00")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// 接続 → git_watch のタスク起動（`ensure_tasks`）→ 実ファイル変更の検知 →
/// `statuses` 配信、という一連が実際に end-to-end で動くことを検証する
/// （`notify`/`notify-debouncer-full` による実 FS イベントに依存する）。
#[tokio::test]
async fn connecting_starts_git_watch_and_detects_real_fs_changes() {
    let front = spawn_front().await;

    let ws_path = front._dir.path().join("repo");
    std::fs::create_dir_all(&ws_path).unwrap();
    sh_git(&ws_path, &["init", "-q", "-b", "main"]);
    sh_git(&ws_path, &["config", "user.email", "t@example.com"]);
    sh_git(&ws_path, &["config", "user.name", "tester"]);
    std::fs::write(ws_path.join("a.txt"), "hello\n").unwrap();
    sh_git(&ws_path, &["add", "-A"]);
    sh_git(&ws_path, &["commit", "-q", "-m", "first"]);

    let mut cfg = front.state.config.load_all();
    cfg.insert(
        "ws_repo".to_string(),
        json!({"name": "repo", "path": ws_path.to_string_lossy()}),
    );
    front.state.config.save_all(&cfg).unwrap();

    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 1).await);

    // 実ファイルを変更して FS イベントを発生させる（未追跡ファイルの追加 →
    // clean=false, changed_files>=1 になるはず）。
    std::fs::write(ws_path.join("new.txt"), "x\n").unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut found = false;
    while tokio::time::Instant::now() < deadline {
        let Ok(Some(Ok(msg))) = tokio::time::timeout(Duration::from_secs(1), ws.next()).await
        else {
            continue;
        };
        let TgMsg::Text(text) = msg else { continue };
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        if parsed["type"] == "statuses" {
            let statuses = parsed["statuses"].as_array().unwrap();
            if statuses
                .iter()
                .any(|s| s["name"] == "repo" && s["clean"] == false)
            {
                found = true;
                break;
            }
        }
    }
    assert!(
        found,
        "should have received a statuses push reflecting the new untracked file"
    );

    ws.close(None).await.unwrap();
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 0).await);
}

fn skip_if_no_tmux() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
}

/// 接続 → agent_watch のタスク起動（`ensure_tasks`）→ 実 tmux セッションの状態
/// ポーリング → `agent_states` 配信、という一連が実際に end-to-end で動くことを
/// 検証する。`TerminalRegistry` に未登録のセッションも tmux 環境変数だけから
/// 拾えることも合わせて確認する（Python `agent_watch` の cache-miss フォールバック
/// 設計と同じ）。
#[tokio::test]
async fn connecting_starts_agent_watch_and_reports_real_tmux_session() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let session_id = any_console_server::util::token_hex(4);
    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    let out = std::process::Command::new("tmux")
        .args([
            "new-session",
            "-d",
            "-s",
            &full_name,
            "-x",
            "80",
            "-y",
            "24",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let url = format!("ws://{}/workspaces/statuses/ws?token={TOKEN}", front.addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 1).await);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut found = false;
    while tokio::time::Instant::now() < deadline {
        let Ok(Some(Ok(msg))) = tokio::time::timeout(Duration::from_secs(1), ws.next()).await
        else {
            continue;
        };
        let TgMsg::Text(text) = msg else { continue };
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        if parsed["type"] == "agent_states" {
            let states = parsed["states"].as_array().unwrap();
            if states.iter().any(|s| s["session_id"] == session_id) {
                found = true;
                break;
            }
        }
    }
    assert!(
        found,
        "should have received an agent_states push for the real tmux session"
    );

    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
    ws.close(None).await.unwrap();
    assert!(wait_for(|| front.state.status_stream.subscriber_count() == 0).await);
}
