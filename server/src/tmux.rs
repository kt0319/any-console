//! tmux セッション管理（Python 側 `api/tmux.py` の移植）。
//!
//! セッションの作成・アタッチ（PTY 経由）・メタデータ永続化（tmux 環境変数）・
//! ペイン状態の問い合わせを担う。クエリ系コマンドは `subprocess::run_tmux_cmd`
//! （C ロケール強制込み）を再利用する。

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use crate::config::ConfigStore;
use crate::pty::{self, ExecSpec, PtyChild};
use crate::subprocess::{run_tmux_cmd, CmdResult};

pub const TMUX_PANE_READY_TIMEOUT_SEC: f64 = 2.0;
pub const TMUX_PANE_POLL_INTERVAL_SEC: f64 = 0.05;
pub const TERMINAL_DEFAULT_COLS: u16 = 80;
pub const TERMINAL_DEFAULT_ROWS: u16 = 24;
pub const TERMINAL_TERM_TYPE: &str = "xterm-256color";

/// tmux 環境変数名 → TerminalSession 属性名（永続化する属性を増やす場合は
/// ここと `TMUX_META_ENV_NAMES` の両方に反映する — Python 側の対応コメント参照）。
pub const TMUX_ATTR_ENV_NAMES: &[&str] = &[
    "TMUX_WORKSPACE",
    "TMUX_ICON",
    "TMUX_ICON_COLOR",
    "TMUX_JOB_NAME",
    "TMUX_JOB_LABEL",
    "TMUX_INTERACTIVE",
];

/// `load_tmux_metadata` が読み取る全キー（TMUX_DETACHED・TMUX_PENDING_* は
/// 個別管理のため `TMUX_ATTR_ENV_NAMES` とは別枠）。TMUX_PENDING_TEXT/_ENTER は
/// dispatch（`dispatch.rs`）が新規セッションへ予約するテキストの永続化に使う
/// （プロセスをまたいでも tmux 環境変数経由で安全に受け渡せる）。
const TMUX_META_ENV_NAMES: &[&str] = &[
    "TMUX_WORKSPACE",
    "TMUX_ICON",
    "TMUX_ICON_COLOR",
    "TMUX_JOB_NAME",
    "TMUX_JOB_LABEL",
    "TMUX_INTERACTIVE",
    "TMUX_DETACHED",
    "TMUX_PENDING_TEXT",
    "TMUX_PENDING_ENTER",
];

// ─── hook 用環境変数（Python `agent_hooks.hook_session_env` 相当）─────────────

fn connect_bind_host(host: &str) -> String {
    if matches!(host, "0.0.0.0" | "::" | "") {
        "127.0.0.1".to_string()
    } else {
        host.to_string()
    }
}

/// hook 専用トークンを返す（無ければ生成して `data/hook_token` に保存する。
/// Python の `agent_hooks.get_hook_token` と同一ファイル・同一 best-effort 挙動 —
/// 初回作成時のプロセス間競合はガードしない。0600 で保存する）。
fn get_hook_token(data_dir: &Path) -> String {
    let path = data_dir.join("hook_token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let token = crate::util::token_urlsafe(24);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::write(&path, format!("{token}\n")).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
    token
}

/// tmux セッションへ注入する hook 用環境変数（失敗時は空 — そのセッションでは
/// hooks が無効になるだけでセッション生成自体は妨げない）。
fn hook_session_env(
    data_dir: &Path,
    config: &ConfigStore,
    tmux_session_name: &str,
) -> Vec<(String, String)> {
    let (host, port) = config.resolve_bind();
    let host = connect_bind_host(&host);
    vec![
        (
            "ANY_CONSOLE_SESSION".to_string(),
            tmux_session_name.to_string(),
        ),
        (
            "ANY_CONSOLE_HOOK_URL".to_string(),
            format!("http://{host}:{port}/agent-hooks/events"),
        ),
        (
            "ANY_CONSOLE_HOOK_TOKEN".to_string(),
            get_hook_token(data_dir),
        ),
    ]
}

// ─── セッション作成 ─────────────────────────────────────────────────────────

/// XDG_RUNTIME_DIR / DBUS_SESSION_BUS_ADDRESS の既定値（`systemd-run --user` に必要）。
fn systemd_user_env_defaults() -> Vec<(String, String)> {
    let uid = unsafe { libc::getuid() };
    let mut extra = Vec::new();
    if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
        extra.push(("XDG_RUNTIME_DIR".to_string(), format!("/run/user/{uid}")));
    }
    if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
        extra.push((
            "DBUS_SESSION_BUS_ADDRESS".to_string(),
            format!("unix:path=/run/user/{uid}/bus"),
        ));
    }
    extra
}

async fn run_session_cmd(
    program: &str,
    args: &[String],
    cwd: &Path,
    env: &[(String, String)],
    timeout_sec: f64,
) -> bool {
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true).current_dir(cwd);
    for (k, v) in env {
        command.env(k, v);
    }
    let fut = command.status();
    matches!(
        tokio::time::timeout(Duration::from_secs_f64(timeout_sec), fut).await,
        Ok(Ok(status)) if status.success()
    )
}

/// tmux ベースセッションを作成する（Python `create_tmux_session` 相当）。
/// `systemd-run --user --scope --quiet` 経由を優先し（cgroup 隔離）、失敗時は
/// プレーンな `tmux` 直接実行にフォールバックする。
pub async fn create_tmux_session(
    data_dir: &Path,
    config: &ConfigStore,
    workspace_path: Option<&str>,
    session_name: &str,
) -> std::io::Result<()> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let cwd_buf = match workspace_path {
        Some(p) if Path::new(p).is_dir() => std::path::PathBuf::from(p),
        _ => std::path::PathBuf::from(&home),
    };

    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".to_string());
    let mut env: Vec<(String, String)> = vec![
        ("TERM".to_string(), TERMINAL_TERM_TYPE.to_string()),
        ("DISPLAY".to_string(), display.clone()),
    ];
    if let Some(ws) = workspace_path {
        env.push(("WORKSPACE".to_string(), ws.to_string()));
    }
    env.extend(hook_session_env(data_dir, config, session_name));

    let cols = TERMINAL_DEFAULT_COLS.to_string();
    let rows = TERMINAL_DEFAULT_ROWS.to_string();
    let tmux_args: Vec<String> = [
        "tmux",
        "new-session",
        "-d",
        "-s",
        session_name,
        "-e",
        &format!("DISPLAY={display}"),
        "-x",
        &cols,
        "-y",
        &rows,
        &shell,
        ";",
        "set-option",
        "-t",
        session_name,
        "status",
        "off",
        ";",
        "set-option",
        "-t",
        session_name,
        "mouse",
        "off",
        ";",
        "set-option",
        "-t",
        session_name,
        "history-limit",
        "100000",
        ";",
        "set-option",
        "-t",
        session_name,
        "set-clipboard",
        "on",
        ";",
        "set-option",
        "-t",
        session_name,
        "window-size",
        "latest",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let mut systemd_env = env.clone();
    systemd_env.extend(systemd_user_env_defaults());
    let mut systemd_args = vec![
        "--user".to_string(),
        "--scope".to_string(),
        "--quiet".to_string(),
    ];
    systemd_args.extend(tmux_args.clone());
    if run_session_cmd(
        "systemd-run",
        &systemd_args,
        &cwd_buf,
        &systemd_env,
        crate::subprocess::TMUX_CMD_TIMEOUT_SEC,
    )
    .await
    {
        return Ok(());
    }
    if run_session_cmd(
        "tmux",
        &tmux_args[1..], // "tmux" 自体は program 側で指定
        &cwd_buf,
        &env,
        crate::subprocess::TMUX_CMD_TIMEOUT_SEC,
    )
    .await
    {
        return Ok(());
    }
    Err(std::io::Error::other(format!(
        "failed to create tmux session={session_name}"
    )))
}

// ─── アタッチ（PTY）───────────────────────────────────────────────────────

/// ベースセッションへ独立した tmux クライアントとして PTY 経由でアタッチする
/// （Python `attach_tmux_session` 相当）。
pub fn attach_tmux_session(session_name: &str, cols: u16, rows: u16) -> std::io::Result<PtyChild> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string());
    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string());
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let env: Vec<(&str, &str)> = vec![
        ("TERM", TERMINAL_TERM_TYPE),
        ("HOME", home.as_str()),
        ("PATH", path.as_str()),
        ("LANG", lang.as_str()),
        ("SHELL", shell.as_str()),
    ];
    let spec = ExecSpec::resolve("tmux", &["attach-session", "-t", session_name], &env)?;
    pty::spawn(&spec, cols, rows)
}

// ─── クエリ・メタデータ ─────────────────────────────────────────────────────

pub async fn send_keys_to_tmux(session_name: &str, text: &str, enter: bool) -> bool {
    let ok = run_tmux_cmd(&["send-keys", "-t", session_name, "--", text])
        .await
        .is_some_and(|r| r.success());
    if !ok || !enter {
        return ok;
    }
    run_tmux_cmd(&["send-keys", "-t", session_name, "Enter"])
        .await
        .is_some_and(|r| r.success())
}

/// ペインのシェルが起動するまで短時間ポーリングする（ベストエフォート）。
pub async fn wait_pane_ready(session_name: &str, timeout_sec: f64) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs_f64(timeout_sec);
    while tokio::time::Instant::now() < deadline {
        if let Some(r) = run_tmux_cmd(&[
            "display-message",
            "-t",
            session_name,
            "-p",
            "#{pane_current_command}",
        ])
        .await
        {
            if r.success() && !r.stdout.trim().is_empty() {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_secs_f64(TMUX_PANE_POLL_INTERVAL_SEC)).await;
    }
    false
}

pub async fn load_tmux_metadata(tmux_name: &str) -> HashMap<String, String> {
    let Some(r) = run_tmux_cmd(&["show-environment", "-t", tmux_name]).await else {
        tracing::warn!("load_tmux_metadata failed session={tmux_name} result=None");
        return HashMap::new();
    };
    if !r.success() {
        tracing::warn!(
            "load_tmux_metadata failed session={tmux_name} returncode={:?}",
            r.code
        );
        return HashMap::new();
    }
    parse_show_environment(&r.stdout, TMUX_META_ENV_NAMES)
}

fn parse_show_environment(stdout: &str, allowed: &[&str]) -> HashMap<String, String> {
    let mut meta = HashMap::new();
    for line in stdout.trim().lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if allowed.contains(&key) {
            meta.insert(key.to_string(), value.to_string());
        }
    }
    meta
}

/// 可視ペインの内容をプレーンテキストで返す（失敗時は None。スクロールバックは含まない）。
pub async fn capture_visible_pane(tmux_name: &str) -> Option<String> {
    let r = run_tmux_cmd(&["capture-pane", "-p", "-t", tmux_name]).await?;
    r.success().then_some(r.stdout)
}

async fn display_message(tmux_name: &str, fmt: &str) -> Option<String> {
    let r = run_tmux_cmd(&["display-message", "-t", tmux_name, "-p", fmt]).await?;
    r.success().then(|| r.stdout.trim().to_string())
}

async fn display_message_int(tmux_name: &str, fmt: &str) -> Option<i64> {
    display_message(tmux_name, fmt).await?.parse().ok()
}

pub async fn get_session_cwd(tmux_name: &str) -> Option<String> {
    display_message(tmux_name, "#{pane_current_path}")
        .await
        .filter(|s| !s.is_empty())
}

/// ペインのカレントディレクトリから最長前方一致するワークスペース名を返す
/// （Python `detect_workspace_from_tmux` 相当。照合は `config::match_workspace_by_path`）。
pub async fn detect_workspace_from_tmux(config: &ConfigStore, tmux_name: &str) -> Option<String> {
    let pane_path = display_message(tmux_name, "#{pane_current_path}").await;
    match pane_path {
        Some(p) => config.match_workspace_by_path(&p),
        None => {
            tracing::warn!("detect_workspace_from_tmux failed session={tmux_name}");
            None
        }
    }
}

pub async fn get_window_width(tmux_name: &str) -> Option<i64> {
    display_message_int(tmux_name, "#{window_width}").await
}

pub async fn get_tmux_created(tmux_name: &str) -> Option<i64> {
    display_message_int(tmux_name, "#{session_created}").await
}

/// tmux セッションの環境変数を複数まとめて設定する（`save_metadata` 等の共通化）。
pub async fn set_environment(tmux_name: &str, pairs: &[(&str, &str)]) -> Option<CmdResult> {
    if pairs.is_empty() {
        return None;
    }
    let mut args: Vec<&str> = Vec::new();
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            args.push(";");
        }
        args.extend(["set-environment", "-t", tmux_name, k, v]);
    }
    run_tmux_cmd(&args).await
}

pub async fn unset_environment(tmux_name: &str, key: &str) -> Option<CmdResult> {
    run_tmux_cmd(&["set-environment", "-u", "-t", tmux_name, key]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_show_environment_filters_allowed_keys() {
        let out = "TMUX_WORKSPACE=proj\nTMUX_ICON=star\nOTHER=x\nTMUX_DETACHED=1\n";
        let meta = parse_show_environment(out, TMUX_META_ENV_NAMES);
        assert_eq!(meta.get("TMUX_WORKSPACE"), Some(&"proj".to_string()));
        assert_eq!(meta.get("TMUX_DETACHED"), Some(&"1".to_string()));
        assert!(!meta.contains_key("OTHER"));
    }

    #[test]
    fn connect_bind_host_maps_wildcards() {
        assert_eq!(connect_bind_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(connect_bind_host("::"), "127.0.0.1");
        assert_eq!(connect_bind_host(""), "127.0.0.1");
        assert_eq!(connect_bind_host("192.168.1.5"), "192.168.1.5");
    }

    #[test]
    fn hook_token_persists_across_calls() {
        let dir = tempfile::tempdir().unwrap();
        let t1 = get_hook_token(dir.path());
        let t2 = get_hook_token(dir.path());
        assert_eq!(t1, t2);
        assert!(!t1.is_empty());
    }

    fn skip_if_no_tmux() -> bool {
        std::process::Command::new("tmux")
            .arg("-V")
            .output()
            .map(|o| !o.status.success())
            .unwrap_or(true)
    }

    #[tokio::test]
    async fn create_attach_and_kill_real_session() {
        if skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let name = format!("ac-test-{}", crate::util::token_hex(4));

        create_tmux_session(dir.path(), &config, None, &name)
            .await
            .expect("session should be created");
        assert!(crate::subprocess::tmux_session_exists(&name).await);

        set_environment(&name, &[("TMUX_WORKSPACE", "proj"), ("TMUX_ICON", "star")]).await;
        let meta = load_tmux_metadata(&name).await;
        assert_eq!(meta.get("TMUX_WORKSPACE"), Some(&"proj".to_string()));

        assert!(wait_pane_ready(&name, TMUX_PANE_READY_TIMEOUT_SEC).await);
        assert!(send_keys_to_tmux(&name, "echo hi-from-test", true).await);

        let child = attach_tmux_session(&name, 80, 24).expect("attach should succeed");
        let pty = crate::pty::AsyncPty::new(child.master).unwrap();
        let mut buf = [0u8; 4096];
        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline
            && !String::from_utf8_lossy(&collected).contains("hi-from-test")
        {
            if let Ok(Ok(n)) =
                tokio::time::timeout(Duration::from_millis(500), pty.read(&mut buf)).await
            {
                if n == 0 {
                    break;
                }
                collected.extend_from_slice(&buf[..n]);
            }
        }
        assert!(String::from_utf8_lossy(&collected).contains("hi-from-test"));

        crate::pty::close(pty.into_inner(), child.pid);
        crate::subprocess::kill_tmux_by_name(&name).await;
        assert!(!crate::subprocess::tmux_session_exists(&name).await);
    }
}
