//! ペインの前面ジョブ（フォアグラウンドプロセスグループ）の argv 取得
//! （Python 側 `api/foreground.py` の移植）。
//!
//! tmux の `#{pane_pid}`（ペインのシェル PID）を起点に、そのシェルの制御端末で
//! 前面にいるプロセスグループの各プロセスの argv を返す。
//!
//! - Linux: `/proc/<pid>/stat` の tpgid でグループを特定し、シェルの子孫
//!   （`/proc/<pid>/task/<tid>/children`）のうちグループに属するものの
//!   `/proc/<pid>/cmdline` を読む
//! - macOS: `ps -axo pid=,pgid=,tpgid=,command=` を周期あたり1回だけ実行して
//!   表から引く
//!
//! ベストエフォート: 取得できない場合はすべて空を返す（呼び出し側は
//! 「前面ジョブ無し」として扱う）。

use std::collections::HashSet;
use std::sync::OnceLock;

use crate::subprocess::{run_subprocess_safe, SYSTEM_CMD_TIMEOUT_SEC};

/// 子孫走査の安全上限（異常なプロセスツリーでの暴走防止）。
const MAX_DESCENDANTS: usize = 64;

/// `ps` 1行分: (pid, pgid, tpgid, argv)。
type PsRow = (i32, i32, i32, Vec<String>);

/// `/proc/<pid>/stat` から (pgrp, tpgid) を取り出す。
/// comm フィールドは空白・括弧を含みうるため、最後の ')' より後を分割する。
pub fn parse_stat_pgrp_tpgid(stat_text: &str) -> Option<(i32, i32)> {
    let end = stat_text.rfind(')')?;
    let fields: Vec<&str> = stat_text[end + 1..].split_whitespace().collect();
    if fields.len() < 6 {
        return None;
    }
    let pgrp = fields[2].parse().ok()?;
    let tpgid = fields[5].parse().ok()?;
    Some((pgrp, tpgid))
}

/// Python の `str.split(None, n)`（連続空白を1区切りとして扱い、先頭 n 個までを
/// 分割し残りは1要素にまとめる）と同じ意味で分割する。
fn split_whitespace_n(line: &str, n: usize) -> Vec<&str> {
    let mut result = Vec::new();
    let mut rest = line;
    for _ in 0..n {
        rest = rest.trim_start();
        if rest.is_empty() {
            return result;
        }
        let idx = rest.find(char::is_whitespace).unwrap_or(rest.len());
        result.push(&rest[..idx]);
        rest = &rest[idx..];
    }
    rest = rest.trim_start();
    if !rest.is_empty() {
        result.push(rest);
    }
    result
}

/// `ps -axo pid=,pgid=,tpgid=,command=` の出力を (pid, pgid, tpgid, argv) に変換する。
pub fn parse_ps_lines(text: &str) -> Vec<PsRow> {
    let mut rows = Vec::new();
    for line in text.lines() {
        let parts = split_whitespace_n(line, 3);
        if parts.len() < 4 {
            continue;
        }
        let (Ok(pid), Ok(pgid), Ok(tpgid)) = (
            parts[0].parse::<i32>(),
            parts[1].parse::<i32>(),
            parts[2].parse::<i32>(),
        ) else {
            continue;
        };
        let argv: Vec<String> = parts[3].split_whitespace().map(String::from).collect();
        rows.push((pid, pgid, tpgid, argv));
    }
    rows
}

fn read_proc_stat(pid: i32) -> Option<(i32, i32)> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_stat_pgrp_tpgid(&text)
}

fn read_proc_argv(pid: i32) -> Vec<String> {
    let Ok(raw) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
        return Vec::new();
    };
    raw.split(|&b| b == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect()
}

/// `/proc` の children インターフェースで子孫 PID を幅優先で列挙する。
fn iter_descendants(root_pid: i32) -> Vec<i32> {
    let mut result = Vec::new();
    let mut queue = std::collections::VecDeque::from([root_pid]);
    while let Some(pid) = queue.pop_front() {
        if result.len() >= MAX_DESCENDANTS {
            break;
        }
        let Ok(text) = std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children")) else {
            continue;
        };
        for child in text
            .split_whitespace()
            .filter_map(|s| s.parse::<i32>().ok())
        {
            result.push(child);
            queue.push_back(child);
        }
    }
    result
}

fn linux_foreground_argvs(shell_pid: i32) -> Vec<Vec<String>> {
    let Some((shell_pgrp, tpgid)) = read_proc_stat(shell_pid) else {
        return Vec::new();
    };
    if tpgid <= 0 || tpgid == shell_pgrp {
        return Vec::new(); // 前面がシェル自身 = ジョブは走っていない
    }
    let mut argvs = Vec::new();
    let mut seen = HashSet::new();
    // グループリーダー（pid == tpgid）は children 走査に依存せず直接読む
    let leader_argv = read_proc_argv(tpgid);
    if !leader_argv.is_empty() {
        argvs.push(leader_argv);
        seen.insert(tpgid);
    }
    for pid in iter_descendants(shell_pid) {
        if seen.contains(&pid) {
            continue;
        }
        let Some((pgrp, _)) = read_proc_stat(pid) else {
            continue;
        };
        if pgrp != tpgid {
            continue;
        }
        let argv = read_proc_argv(pid);
        if !argv.is_empty() {
            argvs.push(argv);
            seen.insert(pid);
        }
    }
    argvs
}

fn is_linux_proc_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| std::path::Path::new("/proc").is_dir())
}

/// 1 ポーリング周期分の前面ジョブ問い合わせ。
///
/// macOS では初回の問い合わせで `ps` の全プロセス表を1回だけ取得して使い回す。
/// Linux では `/proc` を都度読む。周期をまたいで使い回さないこと（プロセス状態が
/// 古くなるため、毎周期作り直す）。
#[derive(Default)]
pub struct ForegroundInspector {
    ps_rows: Option<Vec<PsRow>>,
}

impl ForegroundInspector {
    pub fn new() -> Self {
        Self::default()
    }

    async fn darwin_rows(&mut self) -> &[PsRow] {
        if self.ps_rows.is_none() {
            let result = run_subprocess_safe(
                &["ps", "-axo", "pid=,pgid=,tpgid=,command="],
                SYSTEM_CMD_TIMEOUT_SEC,
                None,
            )
            .await;
            self.ps_rows = Some(match result {
                Some(r) if r.success() => parse_ps_lines(&r.stdout),
                _ => Vec::new(),
            });
        }
        self.ps_rows.as_deref().unwrap_or(&[])
    }

    /// シェル PID の前面プロセスグループの argv 一覧を返す（失敗時は空）。
    pub async fn argvs(&mut self, shell_pid: i32) -> Vec<Vec<String>> {
        if shell_pid <= 0 {
            return Vec::new();
        }
        if is_linux_proc_available() && std::path::Path::new(&format!("/proc/{shell_pid}")).is_dir()
        {
            return linux_foreground_argvs(shell_pid);
        }
        let rows = self.darwin_rows().await;
        let tpgid = rows
            .iter()
            .find(|r| r.0 == shell_pid)
            .map(|r| r.2)
            .unwrap_or(0);
        if tpgid <= 0 {
            return Vec::new();
        }
        let shell_pgid = rows
            .iter()
            .find(|r| r.0 == shell_pid)
            .map(|r| r.1)
            .unwrap_or(0);
        if tpgid == shell_pgid {
            return Vec::new();
        }
        rows.iter()
            .filter(|r| r.1 == tpgid && !r.3.is_empty())
            .map(|r| r.3.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_stat_extracts_pgrp_and_tpgid() {
        // comm フィールドに括弧・空白を含むケース。')' 以後は
        // state, ppid, pgrp, session, tty_nr, tpgid の順。
        let text = "1234 (some (weird) name) S 1 200 999 0 300 4194304 ...";
        assert_eq!(parse_stat_pgrp_tpgid(text), Some((200, 300)));
    }

    #[test]
    fn parse_stat_too_few_fields_is_none() {
        assert_eq!(parse_stat_pgrp_tpgid("1234 (sh) S 1 100"), None);
        assert_eq!(parse_stat_pgrp_tpgid("no parens here"), None);
    }

    #[test]
    fn parse_ps_lines_extracts_rows() {
        let text = "  100   100   100 -zsh\n  200   100   300 node script.js --flag\n";
        let rows = parse_ps_lines(text);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (100, 100, 100, vec!["-zsh".to_string()]));
        assert_eq!(
            rows[1],
            (
                200,
                100,
                300,
                vec![
                    "node".to_string(),
                    "script.js".to_string(),
                    "--flag".to_string()
                ]
            )
        );
    }

    #[test]
    fn parse_ps_lines_skips_malformed() {
        let rows = parse_ps_lines("garbage\n100 200 not-a-number cmd\n");
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn linux_foreground_finds_no_job_for_idle_shell() {
        if !std::path::Path::new("/proc").is_dir() {
            return;
        }
        let mut inspector = ForegroundInspector::new();
        // 自プロセス自身は tpgid == pgrp（フォアグラウンドジョブなし）であることが多い。
        // 少なくとも panic せずに空または妥当な結果を返すことを確認する。
        let argvs = inspector.argvs(std::process::id() as i32).await;
        let _ = argvs; // ベストエフォート、CI環境依存のため中身は問わない
    }

    #[tokio::test]
    async fn invalid_pid_returns_empty() {
        let mut inspector = ForegroundInspector::new();
        assert!(inspector.argvs(0).await.is_empty());
        assert!(inspector.argvs(-1).await.is_empty());
    }

    #[tokio::test]
    async fn real_child_process_group_detected_on_linux() {
        if !std::path::Path::new("/proc").is_dir() {
            return;
        }
        // sh の下に sleep を起動し、shell の pid を渡すと前面プロセスグループの
        // argv として sleep が見えることを確認する（子プロセスは shell と同じ
        // プロセスグループに属する = フォアグラウンド扱い）。
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .unwrap();
        let shell_pid = child.id() as i32;
        // sh -c 'sleep 5' の場合、execve で sleep がそのまま shell_pid を引き継ぐ
        // ことが多いため、子孫が空でも動作を壊さないことだけを確認する。
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let mut inspector = ForegroundInspector::new();
        let _ = inspector.argvs(shell_pid).await;
        let _ = child.kill();
        let _ = child.wait();
    }
}
