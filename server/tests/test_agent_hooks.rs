//! Rust ネイティブ移行済み `POST /agent-hooks/events` の統合テスト。
//!
//! proxy を介さず Rust ハンドラが直接応答すること・hook 専用トークンでの
//! 認証が効いていること・agent_watch が読む `AgentHookState` へ実際に
//! 反映されることを検証する。upstream は不要（未移行ルートに触れないため、
//! 繋がらないダミーを指す）。

mod common;

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::agent_hooks::hook_state;
use any_console_server::build_router;
use any_console_server::json_store::save_json_file;
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
    let state = common::test_app_state(dir.path(), common::StateOptions::default());
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

#[tokio::test]
async fn missing_or_wrong_hook_token_is_rejected() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);

    let resp = common::client()
        .post(&url)
        .json(&json!({"session": "s1", "event": "Notification"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid hook token");

    let resp = common::client()
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

    let resp = common::client()
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

    let resp = common::client()
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

/// `scripts/claude-code-hook.sh` の実体を子プロセスとして実行し、実サーバへ
/// 実際に届いてstateが更新されることを検証する。`reqwest`でハンドラを直叩き
/// する他のテストと違い、スクリプト自体のクオート処理・環境変数名・payload
/// 組み立て（sed抽出等）にリグレッションが無いことを担保する（過去の
/// hooks-setupクオート不具合・release tarballへのscripts/同梱漏れの再発防止）。
/// スクリプトは curl をバックグラウンドサブシェルで起動して即0終了するため、
/// 送信完了は `wait_for` でポーリングする。
async fn wait_for(cond: impl Fn() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if cond() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    false
}

fn hook_script_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/claude-code-hook.sh")
}

#[tokio::test]
async fn real_hook_script_delivers_event_to_running_server() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);
    let script = hook_script_path();
    assert!(
        script.exists(),
        "scripts/claude-code-hook.sh not found at {script:?}"
    );

    let output = std::process::Command::new(&script)
        .arg("Stop")
        .env("ANY_CONSOLE_HOOK_URL", &url)
        .env("ANY_CONSOLE_HOOK_TOKEN", HOOK_TOKEN)
        .env("ANY_CONSOLE_SESSION", "s1")
        .output()
        .expect("failed to spawn claude-code-hook.sh");
    assert!(
        output.status.success(),
        "claude-code-hook.sh exited non-zero: {:?}",
        output
    );

    assert!(
        wait_for(|| hook_state(&front.state, "s1").is_some()).await,
        "hook_state was not updated by the real hook script within the timeout"
    );
}

/// hookスクリプトの必須環境変数が欠けている場合は何も送らず0終了する
/// （any-console外のtmuxセッションで誤ってhookが有効化されていても無害である
/// ことの担保）。
#[tokio::test]
async fn real_hook_script_is_noop_without_env_vars() {
    let front = spawn_front().await;
    let script = hook_script_path();

    let output = std::process::Command::new(&script)
        .arg("Stop")
        .env_remove("ANY_CONSOLE_HOOK_URL")
        .env_remove("ANY_CONSOLE_HOOK_TOKEN")
        .env_remove("ANY_CONSOLE_SESSION")
        .output()
        .expect("failed to spawn claude-code-hook.sh");
    assert!(output.status.success());

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(hook_state(&front.state, "s1").is_none());
}

#[tokio::test]
async fn out_of_range_fields_are_rejected() {
    let front = spawn_front().await;
    let url = format!("http://{}/agent-hooks/events", front.addr);

    let resp = common::client()
        .post(&url)
        .header("x-hook-token", HOOK_TOKEN)
        .json(&json!({"session": "", "event": "Stop"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}
