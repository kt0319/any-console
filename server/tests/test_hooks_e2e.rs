//! `hooks install-claude` が `~/.claude/settings.json` へ登録した実際の
//! コマンド文字列を、本物の `scripts/claude-code-hook.sh` を使って実行し、
//! 稼働中の any-console サーバへ実際に届く（`agent_hooks::hook_state` が
//! 更新される）ところまで一気通貫で検証する統合テスト。
//!
//! `test_agent_hooks.rs`（スクリプトを直接実行）・`test_cli.rs`
//! （ダミースクリプトでの`hooks install-claude`の登録内容検証）は個別には
//! カバーしているが、両者を繋いだ「登録された実コマンドを実行して実サーバが
//! 受信するか」までは検証していなかった。release tarball への `scripts/`
//! 同梱漏れ（2de264b2）・hooks登録コマンドのクオート不具合（47496ec0,
//! 59126f0b）はいずれもこの繋ぎ目で起きたため、ここを一括で回帰検知する。

mod common;

use std::net::SocketAddr;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use any_console_server::agent_hooks::hook_state;
use any_console_server::build_router;
use any_console_server::json_store::save_json_file;
use any_console_server::state::AppState;

const HOOK_TOKEN: &str = "hook-test-token-0123456789abcdef";

struct TestFront {
    addr: SocketAddr,
    state: Arc<AppState>,
    _dir: tempfile::TempDir,
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": "main-token"})).unwrap();
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::write(data_dir.join("hook_token"), format!("{HOOK_TOKEN}\n")).unwrap();
    let state = common::test_app_state(dir.path(), common::StateOptions::default());
    let addr = common::serve(build_router(state.clone())).await;
    TestFront {
        addr,
        state,
        _dir: dir,
    }
}

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_any-console-server")
}

/// リポジトリ本体の `scripts/claude-code-hook.sh` を project_root 配下へ
/// コピーする（ダミーではなく本物を置くことで、release tarball同梱漏れの
/// ようなクラスの不具合をこのテストで検知できるようにする）。
fn copy_real_hook_script(project_root: &Path) {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/claude-code-hook.sh");
    assert!(
        src.exists(),
        "scripts/claude-code-hook.sh not found at {src:?}"
    );
    let dst_dir = project_root.join("scripts");
    std::fs::create_dir_all(&dst_dir).unwrap();
    let dst = dst_dir.join("claude-code-hook.sh");
    std::fs::copy(&src, &dst).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dst).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dst, perms).unwrap();
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

#[tokio::test]
async fn installed_hook_command_reaches_running_server() {
    let front = spawn_front().await;
    let hook_url = format!("http://{}/agent-hooks/events", front.addr);

    let project_root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    copy_real_hook_script(project_root.path());

    let install = Command::new(bin())
        .args(["hooks", "install-claude"])
        .env("ANY_CONSOLE_PROJECT_ROOT", project_root.path())
        .env("HOME", home.path())
        .env_remove("ANY_CONSOLE_DATA_DIR")
        .output()
        .expect("hooks install-claude should run");
    assert!(install.status.success(), "{install:?}");

    let settings_path = home.path().join(".claude").join("settings.json");
    let settings: Value =
        serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
    let command = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
        .as_str()
        .expect("Stop hook command should be registered")
        .to_string();

    // settings.json に登録されるのは Claude Code 自身がシェルへそのまま渡す
    // コマンド文字列（クオート込み）なので、実行も同じ経路（sh -c）で行う
    // ことで登録コマンドのクオート処理自体もこのテストの対象に含める。
    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .env("ANY_CONSOLE_HOOK_URL", &hook_url)
        .env("ANY_CONSOLE_HOOK_TOKEN", HOOK_TOKEN)
        .env("ANY_CONSOLE_SESSION", "s1")
        .output()
        .unwrap_or_else(|e| panic!("failed to run installed hook command {command:?}: {e}"));
    assert!(
        output.status.success(),
        "installed hook command failed: {command:?} {output:?}"
    );

    assert!(
        wait_for(|| hook_state(&front.state, "s1").is_some()).await,
        "hook_state was not updated via the installed command {command:?}"
    );
}
