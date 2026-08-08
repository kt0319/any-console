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

pub async fn run_subprocess_safe(
    cmd: &[&str],
    timeout_sec: f64,
    cwd: Option<&Path>,
) -> Option<CmdResult> {
    let (program, args) = cmd.split_first()?;
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true);
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

/// `tailscale <args>` を実行し JSON オブジェクトとしてパースして返す。
/// 未インストール・非0終了・JSON不正・非オブジェクトのいずれでも None。
pub async fn run_tailscale_json(args: &[&str]) -> Option<Value> {
    let mut cmd = vec!["tailscale"];
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
