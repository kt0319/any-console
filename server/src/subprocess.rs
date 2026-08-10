//! subprocess 実行ヘルパー（Python 側 `api/common.py` の `run_subprocess_safe` /
//! `run_tailscale_json` に対応）。
//!
//! タイムアウト・コマンド不在・OS エラーはすべて None に落とし、呼び出し側が
//! None ケースを自分で扱う。終了コードに関わらず結果を返す（stderr を見るため）。

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

pub const SYSTEM_CMD_TIMEOUT_SEC: f64 = 5.0;
pub const TMUX_CMD_TIMEOUT_SEC: f64 = 5.0;

#[derive(Debug)]
pub struct CmdResult {
    /// プロセスの終了コード（シグナル死は None）。
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl CmdResult {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

/// CPython の C ロケール強制（PEP 538）を再現する。
///
/// Python バックエンドは C ロケール（LANG 等が未設定 / "C" / "POSIX"）を検出すると
/// 起動時に `LC_CTYPE=C.UTF-8` を注入し、それが subprocess の子にも引き継がれる。
/// tmux はクライアントのロケールが UTF-8 でないとフォーマット出力の制御文字
/// （`-F` のタブ区切り等）を `_` にサニタイズするため、この差があると Python では
/// パースできる出力が Rust では壊れる（実際に detached sessions 一覧が空になる
/// 回帰を起こした）。子プロセスの環境を Python と同一条件に揃える。
pub(crate) fn coerce_c_locale(command: &mut tokio::process::Command) {
    let is_c_locale = |name: &str| match std::env::var(name) {
        Ok(v) => v.is_empty() || v == "C" || v == "POSIX",
        Err(_) => true,
    };
    if is_c_locale("LC_ALL") && is_c_locale("LC_CTYPE") && is_c_locale("LANG") {
        command.env("LC_CTYPE", "C.UTF-8");
    }
}

pub async fn run_subprocess_safe(
    cmd: &[&str],
    timeout_sec: f64,
    cwd: Option<&Path>,
) -> Option<CmdResult> {
    let (program, args) = cmd.split_first()?;
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true);
    coerce_c_locale(&mut command);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let fut = command.output();
    let output = match tokio::time::timeout(Duration::from_secs_f64(timeout_sec), fut).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            tracing::debug!("subprocess failed {}: {}", program, e);
            return None;
        }
        Err(_) => {
            tracing::debug!("subprocess timeout {}", program);
            return None;
        }
    };
    Some(CmdResult {
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// returncode == 0 のときだけ stdout を返す（`system.py` の `_run_cmd_safe`）。
pub async fn run_cmd_safe(cmd: &[&str], timeout_sec: f64, cwd: Option<&Path>) -> Option<String> {
    let result = run_subprocess_safe(cmd, timeout_sec, cwd).await?;
    if result.success() {
        Some(result.stdout)
    } else {
        None
    }
}

/// `tailscale` バイナリを解決する。PATH 上に無い場合でも、Homebrew の
/// 既定インストール先・macOS の Tailscale.app（GUI版はPATHへ自動で
/// 出てこないことがある）だけは追加でフォールバック探索する
/// （旧: any-console スクリプトの `tailscale_hostname()` と同じ規則）。
fn resolve_tailscale_bin() -> Option<&'static str> {
    if let Some(path) = std::env::var_os("PATH") {
        if std::env::split_paths(&path).any(|dir| dir.join("tailscale").is_file()) {
            return Some("tailscale");
        }
    }
    [
        "/usr/local/bin/tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    ]
    .into_iter()
    .find(|candidate| Path::new(candidate).is_file())
}

/// `tailscale <args>` を実行し JSON オブジェクトとしてパースして返す。
/// 未インストール・非0終了・JSON不正・非オブジェクトのいずれでも None。
pub async fn run_tailscale_json(args: &[&str]) -> Option<Value> {
    let bin = resolve_tailscale_bin()?;
    let mut cmd = vec![bin];
    cmd.extend_from_slice(args);
    let result = run_subprocess_safe(&cmd, SYSTEM_CMD_TIMEOUT_SEC, None).await?;
    if !result.success() {
        return None;
    }
    let data: Value = serde_json::from_str(&result.stdout).ok()?;
    data.is_object().then_some(data)
}

// ─── tmux ヘルパー（`api/tmux.py` のサブセット）────────────────────────────

pub async fn run_tmux_cmd(args: &[&str]) -> Option<CmdResult> {
    let mut cmd = vec!["tmux"];
    cmd.extend_from_slice(args);
    run_subprocess_safe(&cmd, TMUX_CMD_TIMEOUT_SEC, None).await
}

pub async fn tmux_session_exists(name: &str) -> bool {
    run_tmux_cmd(&["has-session", "-t", name])
        .await
        .is_some_and(|r| r.success())
}

pub async fn kill_tmux_by_name(name: &str) {
    let _ = run_tmux_cmd(&["kill-session", "-t", name]).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_command_returns_none() {
        assert!(run_subprocess_safe(&["no-such-command-xyz"], 2.0, None)
            .await
            .is_none());
    }

    #[tokio::test]
    async fn captures_stdout_and_code() {
        let r = run_subprocess_safe(&["sh", "-c", "echo out; echo err >&2; exit 3"], 5.0, None)
            .await
            .unwrap();
        assert_eq!(r.code, Some(3));
        assert_eq!(r.stdout, "out\n");
        assert_eq!(r.stderr, "err\n");
        assert!(!r.success());
    }

    #[tokio::test]
    async fn timeout_returns_none() {
        assert!(run_subprocess_safe(&["sleep", "5"], 0.2, None)
            .await
            .is_none());
    }

    #[tokio::test]
    async fn tmux_format_tabs_survive_locale_coercion() {
        // tmux 未導入環境（rust CI ジョブ等）ではスキップ
        if run_subprocess_safe(&["tmux", "-V"], 5.0, None)
            .await
            .is_none()
        {
            return;
        }
        let name = format!("ac-test-{}", crate::util::token_hex(4));
        let created =
            run_subprocess_safe(&["tmux", "new-session", "-d", "-s", &name], 5.0, None).await;
        if !created.is_some_and(|r| r.success()) {
            return; // tmux サーバを起動できない環境ではスキップ
        }
        let fmt = "#{session_name}\t#{session_windows}";
        let r = run_tmux_cmd(&["list-sessions", "-F", fmt]).await.unwrap();
        kill_tmux_by_name(&name).await;
        assert!(r.success());
        // C ロケールでも PEP 538 相当の強制でタブがサニタイズされないこと
        let line = r.stdout.lines().find(|l| l.starts_with(&name)).unwrap();
        assert!(line.contains('\t'), "tab must survive: {line:?}");
    }

    #[tokio::test]
    async fn run_cmd_safe_requires_success() {
        assert_eq!(
            run_cmd_safe(&["sh", "-c", "echo ok"], 5.0, None)
                .await
                .as_deref(),
            Some("ok\n")
        );
        assert!(run_cmd_safe(&["sh", "-c", "exit 1"], 5.0, None)
            .await
            .is_none());
    }
}
