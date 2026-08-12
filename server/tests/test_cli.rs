//! `any-console-server` の軽量CLIサブコマンド（config/workspaces/jobs/auth）の
//! 統合テスト。実バイナリをサブプロセスとして呼び、`ANY_CONSOLE_PROJECT_ROOT`で
//! 隔離した一時ディレクトリに対して動作することを確認する（各テストが同一
//! プロセス内で環境変数を書き換えると他のテストと競合するため、
//! `./any-console`スクリプトが実際に行うのと同じ「呼ぶたびに新規プロセス」
//! の形でテストする）。

use std::path::Path;
use std::process::Command;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_any-console-server")
}

fn run(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(bin())
        .args(args)
        .env("ANY_CONSOLE_PROJECT_ROOT", root)
        .env_remove("ANY_CONSOLE_DATA_DIR")
        .output()
        .expect("binary should run")
}

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn config_get_port_and_host_default_when_unconfigured() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(dir.path(), &["config", "get-port"]);
    assert!(out.status.success());
    assert_eq!(stdout(&out), "8888");

    let out = run(dir.path(), &["config", "get-host"]);
    assert!(out.status.success());
    assert_eq!(stdout(&out), "0.0.0.0");
}

#[test]
fn config_set_bind_persists_and_is_read_back() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(dir.path(), &["config", "set-bind", "127.0.0.1", "9999"]);
    assert!(out.status.success(), "{:?}", out);

    assert_eq!(stdout(&run(dir.path(), &["config", "get-port"])), "9999");
    assert_eq!(
        stdout(&run(dir.path(), &["config", "get-host"])),
        "127.0.0.1"
    );
}

#[test]
fn config_set_bind_rejects_invalid_port() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(
        dir.path(),
        &["config", "set-bind", "127.0.0.1", "not-a-port"],
    );
    assert!(!out.status.success());
}

#[test]
fn config_set_ssl_and_get_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(
        dir.path(),
        &["config", "set-ssl", "/tmp/cert.pem", "/tmp/key.pem"],
    );
    assert!(out.status.success());
    assert_eq!(
        stdout(&run(dir.path(), &["config", "get", "ssl_certfile"])),
        "/tmp/cert.pem"
    );
    assert_eq!(
        stdout(&run(dir.path(), &["config", "get", "ssl_keyfile"])),
        "/tmp/key.pem"
    );
    // 未設定キーは空文字（旧python版と同じ挙動）。
    assert_eq!(stdout(&run(dir.path(), &["config", "get", "nope"])), "");
}

#[test]
fn workspaces_register_dedups_by_resolved_path_and_name_collision() {
    let dir = tempfile::tempdir().unwrap();
    let ws_a = dir.path().join("myproject");
    std::fs::create_dir_all(&ws_a).unwrap();
    let ws_b = dir.path().join("other").join("myproject");
    std::fs::create_dir_all(&ws_b).unwrap();

    let out = run(
        dir.path(),
        &["workspaces", "register", ws_a.to_str().unwrap()],
    );
    assert!(out.status.success());
    assert_eq!(stdout(&out), "Registered: myproject");

    // 同じパスをもう一度 → 何も登録しない。
    let out = run(
        dir.path(),
        &["workspaces", "register", ws_a.to_str().unwrap()],
    );
    assert_eq!(stdout(&out), "No new workspaces registered");

    // 別パスだが同名（basename衝突）→ サフィックス付きで登録。
    let out = run(
        dir.path(),
        &["workspaces", "register", ws_b.to_str().unwrap()],
    );
    assert_eq!(stdout(&out), "Registered: myproject-2");

    // 存在しないディレクトリは無視される。
    let missing = dir.path().join("does-not-exist");
    let out = run(
        dir.path(),
        &["workspaces", "register", missing.to_str().unwrap()],
    );
    assert_eq!(stdout(&out), "No new workspaces registered");
}

#[test]
fn workspaces_discover_runs_without_error() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(dir.path(), &["workspaces", "discover"]);
    assert!(out.status.success());
}

#[test]
fn jobs_register_ai_agents_dedups_by_command_and_skips_unknown_tools() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(
        dir.path(),
        &["jobs", "register-ai-agents", "claude", "not-a-real-tool"],
    );
    assert!(out.status.success());
    assert_eq!(stdout(&out), "Registered: Claude Code");

    // 同じcommandをもう一度 → 二重登録しない。
    let out = run(dir.path(), &["jobs", "register-ai-agents", "claude"]);
    assert_eq!(stdout(&out), "No new AI agent jobs registered");
}

#[test]
fn auth_ensure_token_prints_once_then_stays_silent() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(dir.path(), &["auth", "ensure-token"]);
    assert!(out.status.success());
    let token = stdout(&out);
    assert!(!token.is_empty());

    let auth_file = dir.path().join("data").join("auth.json");
    assert!(auth_file.is_file());
    let saved: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&auth_file).unwrap()).unwrap();
    assert_eq!(saved["token"], token);

    // 2回目は既にファイルがあるので何も出力しない。
    let out = run(dir.path(), &["auth", "ensure-token"]);
    assert!(out.status.success());
    assert_eq!(stdout(&out), "");
}

#[test]
fn unknown_subcommands_exit_nonzero_with_message() {
    let dir = tempfile::tempdir().unwrap();
    let out = run(dir.path(), &["config", "bogus"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("Error:"));
}

// ─── hooks install-claude ───────────────────────────────────────────────
//
// `~/.claude/settings.json` を書き換えるため、`HOME` もプロジェクトルートと
// 同様に一時ディレクトリへ隔離する（実ユーザーの設定に触れない）。

fn run_hooks(project_root: &Path, home: &Path, args: &[&str]) -> std::process::Output {
    Command::new(bin())
        .args(args)
        .env("ANY_CONSOLE_PROJECT_ROOT", project_root)
        .env("HOME", home)
        .env_remove("ANY_CONSOLE_DATA_DIR")
        .output()
        .expect("binary should run")
}

/// `hooks install-claude` はプロジェクトルート配下の `scripts/claude-code-hook.sh`
/// の実在を要求する（内容は問わない）。
fn write_dummy_hook_script(project_root: &Path) {
    let scripts_dir = project_root.join("scripts");
    std::fs::create_dir_all(&scripts_dir).unwrap();
    std::fs::write(
        scripts_dir.join("claude-code-hook.sh"),
        "#!/bin/sh\nexit 0\n",
    )
    .unwrap();
}

#[test]
fn hooks_install_claude_creates_settings_and_is_idempotent() {
    let project_root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    write_dummy_hook_script(project_root.path());

    let out = run_hooks(
        project_root.path(),
        home.path(),
        &["hooks", "install-claude"],
    );
    assert!(out.status.success());
    assert!(stdout(&out).starts_with("Installed hooks for: PreToolUse"));

    let settings_path = home.path().join(".claude").join("settings.json");
    let settings: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
    for event in [
        "PreToolUse",
        "PostToolUse",
        "UserPromptSubmit",
        "PreCompact",
        "Notification",
        "Stop",
        "SessionEnd",
    ] {
        let command = settings["hooks"][event][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(command.ends_with(&format!("claude-code-hook.sh {event}")));
    }

    // 2回目は同じイベントを重複登録しない。
    let out = run_hooks(
        project_root.path(),
        home.path(),
        &["hooks", "install-claude"],
    );
    assert!(out.status.success());
    assert!(stdout(&out).starts_with("Already installed for all events:"));
    let settings_after: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(settings_after["hooks"]["Stop"].as_array().unwrap().len(), 1);
}

#[test]
fn hooks_install_claude_merges_without_clobbering_existing_settings() {
    let project_root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    write_dummy_hook_script(project_root.path());

    let claude_dir = home.path().join(".claude");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(
        claude_dir.join("settings.json"),
        r#"{
  "otherSetting": true,
  "hooks": { "Stop": [{"hooks": [{"type": "command", "command": "/some/other/existing-hook.sh Stop"}]}] }
}"#,
    )
    .unwrap();

    let out = run_hooks(
        project_root.path(),
        home.path(),
        &["hooks", "install-claude"],
    );
    assert!(out.status.success());

    let settings: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(claude_dir.join("settings.json")).unwrap())
            .unwrap();
    assert_eq!(settings["otherSetting"], true);
    let stop_entries = settings["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(
        stop_entries.len(),
        2,
        "既存のStopフックを残したまま追加されること"
    );
    assert!(claude_dir.join("settings.json.bak").is_file());
}

#[test]
fn hooks_install_claude_errors_when_script_missing() {
    let project_root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    // write_dummy_hook_script を呼ばない = scripts/claude-code-hook.sh が無い状態。

    let out = run_hooks(
        project_root.path(),
        home.path(),
        &["hooks", "install-claude"],
    );
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("hook script not found"));
}
