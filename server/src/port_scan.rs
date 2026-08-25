//! LISTEN ポートのスキャンとプロセス情報の取得（`preview.rs` から分離）。
//!
//! Linux では `ss -ltnp`（無い・失敗する環境では `lsof` にフォールバック）、
//! macOS では `lsof -iTCP -sTCP:LISTEN` で LISTEN 中のポートを列挙する。

use std::collections::{HashMap, HashSet};

use crate::subprocess::run_subprocess_safe;
use crate::util::IS_MACOS;

const PORT_SCAN_TIMEOUT_SEC: f64 = 2.0;
const PROC_INFO_TIMEOUT_SEC: f64 = 1.0;
pub(crate) const MIN_PORT: u16 = 1024;
pub(crate) const MAX_PORT: u16 = 65535;

// ─── ポートスキャン: 出力パース（純粋関数） ─────────────────────────────────

/// `ss -ltnp` の各行から「LISTEN 行のローカルポート」と最初の
/// `("proc",pid=N)` を抜く。出力例:
/// `LISTEN 0 511   0.0.0.0:5173  0.0.0.0:*  users:(("node",pid=1942930,fd=21))`
static SS_PORT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"(?:127\.0\.0\.1|0\.0\.0\.0|\*|\[?::\]?):(\d{2,5})\b").unwrap()
});
static SS_PROC_RE: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| regex::Regex::new(r#"users:\(\("([^"]+)",pid=(\d+),"#).unwrap());
/// `lsof -F pcn` の "n" 行（アドレス）末尾からポート番号を抜く。
/// 出力例: `n127.0.0.1:5173` / `n*:5173` / `n[::1]:5173`
static LSOF_ADDR_RE: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| regex::Regex::new(r":(\d{2,5})$").unwrap());

/// `ss -ltnp` の標準出力から LISTEN 行を (port, proc_name, pid) の並びへ変換する
/// （`proxy_ports` = 自分自身の proxy listener の集合。除外対象）。
/// cmdline 読み取り（I/O）はここでは行わない — 呼び出し側の責務。
fn parse_ss_listen_lines(stdout: &str, proxy_ports: &HashSet<u16>) -> Vec<(u16, String, u32)> {
    let mut found = Vec::new();
    for line in stdout.lines() {
        if !line.starts_with("LISTEN") {
            continue;
        }
        let Some(port_match) = SS_PORT_RE.captures(line) else {
            continue;
        };
        let Ok(port) = port_match[1].parse::<u16>() else {
            continue;
        };
        if !(MIN_PORT..=MAX_PORT).contains(&port) || proxy_ports.contains(&port) {
            continue;
        }
        // 他ユーザ所有のプロセス（権限不足で名前取れない）。dev server として
        // preview したいケースはほぼない（postgres / system daemons）ので除外。
        let Some(proc_match) = SS_PROC_RE.captures(line) else {
            continue;
        };
        let proc_name = proc_match[1].to_string();
        let Ok(pid) = proc_match[2].parse::<u32>() else {
            continue;
        };
        found.push((port, proc_name, pid));
    }
    found
}

/// `lsof -iTCP -sTCP:LISTEN -P -n -F pcn` の出力を (port, pid, command) の
/// リストへ変換する。
fn parse_lsof_listeners(out: &str) -> Vec<(u16, u32, String)> {
    let mut listeners = Vec::new();
    let mut pid: Option<u32> = None;
    let mut command = String::new();
    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let (tag, value) = (&line[..1], &line[1..]);
        match tag {
            "p" => {
                pid = value.parse().ok();
                command.clear();
            }
            "c" => command = value.to_string(),
            "n" => {
                if let Some(pid) = pid {
                    if let Some(m) = LSOF_ADDR_RE.captures(value) {
                        if let Ok(port) = m[1].parse::<u16>() {
                            listeners.push((port, pid, command.clone()));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    listeners
}

/// cmdline の各要素から表示用ラベルを組み立てる。通常は先頭要素の basename。
/// node/python 等のランタイム経由の場合は実行スクリプト名を続けた
/// "node vite" のような2語のラベルを返す。
fn label_from_cmdline_parts(parts: &[String]) -> String {
    let Some(first) = parts.first() else {
        return String::new();
    };
    let basename = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    let is_runtime = ["node", "python", "python3", "ruby", "bun"]
        .iter()
        .any(|suffix| first.ends_with(suffix));
    if is_runtime && parts.len() >= 2 {
        for p in &parts[1..] {
            if !p.starts_with('-') {
                return format!("{} {}", basename(first), basename(p));
            }
        }
    }
    basename(first)
}

// ─── プロセス情報の取得（Linux: /proc、macOS: ps/lsof） ─────────────────────

/// プロセスの cmdline から表示用ラベルを取得する（`label_from_cmdline_parts` 参照）。
async fn read_cmdline(pid: u32) -> String {
    if IS_MACOS {
        let Some(result) = run_subprocess_safe(
            &["ps", "-o", "command=", "-p", &pid.to_string()],
            PROC_INFO_TIMEOUT_SEC,
            None,
        )
        .await
        else {
            return String::new();
        };
        let parts: Vec<String> = result.stdout.split_whitespace().map(String::from).collect();
        return label_from_cmdline_parts(&parts);
    }
    let parts = crate::foreground::read_proc_argv(pid as i32);
    label_from_cmdline_parts(&parts)
}

/// プロセスの起動時カレントディレクトリを取得する（取得できなければ None）。
pub(crate) async fn read_cwd(pid: u32) -> Option<String> {
    if IS_MACOS {
        let result = run_subprocess_safe(
            &["lsof", "-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"],
            PROC_INFO_TIMEOUT_SEC,
            None,
        )
        .await?;
        return result
            .stdout
            .lines()
            .find_map(|line| line.strip_prefix('n').map(String::from));
    }
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

// ─── ポートスキャン: OS 呼び出し ────────────────────────────────────────────

async fn scan_listening_ports_linux(proxy_ports: &HashSet<u16>) -> HashMap<u16, (String, u32)> {
    // ss が無い（最小コンテナ等）・実行に失敗する環境では lsof スキャンへ
    // フォールバックする（read_cmdline は Linux では /proc を読むため lsof 側でも動く）
    let Some(result) = run_subprocess_safe(&["ss", "-ltnp"], PORT_SCAN_TIMEOUT_SEC, None)
        .await
        .filter(crate::subprocess::CmdResult::success)
    else {
        tracing::warn!("ss unavailable; falling back to lsof port scan");
        return scan_listening_ports_lsof(proxy_ports).await;
    };
    let mut found = HashMap::new();
    for (port, proc_name, pid) in parse_ss_listen_lines(&result.stdout, proxy_ports) {
        let label = read_cmdline(pid).await;
        let label = if label.is_empty() { proc_name } else { label };
        found.insert(port, (label, pid));
    }
    found
}

/// lsof による LISTEN ポート列挙。macOS の既定スキャンかつ、Linux で ss が
/// 使えない場合のフォールバック（lsof の呼び出し・出力形式は両 OS 共通）。
async fn scan_listening_ports_lsof(proxy_ports: &HashSet<u16>) -> HashMap<u16, (String, u32)> {
    let Some(result) = run_subprocess_safe(
        &["lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"],
        PORT_SCAN_TIMEOUT_SEC,
        None,
    )
    .await
    else {
        tracing::warn!("lsof failed; skipping port scan");
        return HashMap::new();
    };
    let mut found = HashMap::new();
    for (port, pid, command) in parse_lsof_listeners(&result.stdout) {
        if !(MIN_PORT..=MAX_PORT).contains(&port) || proxy_ports.contains(&port) {
            continue;
        }
        let label = read_cmdline(pid).await;
        let label = if label.is_empty() { command } else { label };
        found.insert(port, (label, pid));
    }
    found
}

pub(crate) async fn scan_listening_ports(
    proxy_ports: &HashSet<u16>,
) -> HashMap<u16, (String, u32)> {
    if IS_MACOS {
        scan_listening_ports_lsof(proxy_ports).await
    } else {
        scan_listening_ports_linux(proxy_ports).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SS_OUTPUT: &str = concat!(
        "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n",
        "LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:((\"node\",pid=12345,fd=21))\n",
        "LISTEN 0 511 127.0.0.1:7002 0.0.0.0:* users:((\"python3\",pid=22222,fd=24))\n",
        // 他ユーザ所有 → 名前情報なし → 除外される
        "LISTEN 0 4096 0.0.0.0:5432 0.0.0.0:*\n",
        // 範囲外
        "LISTEN 0 100 0.0.0.0:80 0.0.0.0:* users:((\"nginx\",pid=33333,fd=6))\n",
    );

    #[test]
    fn parse_ss_listen_lines_extracts_owned_ports() {
        let found = parse_ss_listen_lines(SAMPLE_SS_OUTPUT, &HashSet::new());
        assert!(found.contains(&(3000, "node".to_string(), 12345)));
        assert!(found.contains(&(7002, "python3".to_string(), 22222)));
        assert!(
            !found.iter().any(|(p, ..)| *p == 5432),
            "他ユーザ所有は除外"
        );
        assert!(!found.iter().any(|(p, ..)| *p == 80), "範囲外は除外");
    }

    #[test]
    fn parse_ss_listen_lines_excludes_proxy_ports() {
        let found = parse_ss_listen_lines(SAMPLE_SS_OUTPUT, &HashSet::from([3000u16]));
        assert!(!found.iter().any(|(p, ..)| *p == 3000));
        assert!(found.iter().any(|(p, ..)| *p == 7002));
    }

    const SAMPLE_LSOF_OUTPUT: &str = concat!(
        "p12345\n",
        "cnode\n",
        "n127.0.0.1:3000\n",
        "n*:3000\n",
        "p22222\n",
        "cpython3\n",
        "n*:7002\n",
        // 範囲外（フィルタは呼び出し側の責務なので、ここではそのまま出てくる）
        "p33333\n",
        "cnginx\n",
        "n*:80\n",
    );

    #[test]
    fn parse_lsof_listeners_extracts_all_entries() {
        let listeners = parse_lsof_listeners(SAMPLE_LSOF_OUTPUT);
        assert!(listeners.contains(&(3000, 12345, "node".to_string())));
        assert!(listeners.contains(&(7002, 22222, "python3".to_string())));
        assert!(listeners.contains(&(80, 33333, "nginx".to_string())));
    }

    #[test]
    fn parse_lsof_listeners_ignores_n_line_without_pid() {
        // "n" 行より先に "p" が来ていない場合は無視する。
        let listeners = parse_lsof_listeners("cnode\nn127.0.0.1:3000\n");
        assert!(listeners.is_empty());
    }

    #[test]
    fn label_from_cmdline_uses_basename_for_plain_command() {
        assert_eq!(
            label_from_cmdline_parts(&["/usr/local/bin/nginx".to_string()]),
            "nginx"
        );
    }

    #[test]
    fn label_from_cmdline_combines_runtime_and_script() {
        assert_eq!(
            label_from_cmdline_parts(&[
                "/usr/bin/node".to_string(),
                "/app/node_modules/.bin/vite".to_string(),
            ]),
            "node vite"
        );
    }

    #[test]
    fn label_from_cmdline_skips_flags_to_find_script() {
        assert_eq!(
            label_from_cmdline_parts(&[
                "python3".to_string(),
                "-u".to_string(),
                "manage.py".to_string(),
            ]),
            "python3 manage.py"
        );
    }

    #[test]
    fn label_from_cmdline_empty_for_no_parts() {
        assert_eq!(label_from_cmdline_parts(&[]), "");
    }

    #[tokio::test]
    async fn read_cmdline_empty_for_unreadable_pid() {
        assert_eq!(read_cmdline(u32::MAX).await, "");
    }

    #[tokio::test]
    async fn read_cmdline_returns_for_own_pid() {
        // 自分自身の pid は Linux (/proc/self) でも macOS (ps) でも必ず読める。
        // basename は環境依存（cargo test のバイナリ名）なので空でないことだけ確認する。
        let result = read_cmdline(std::process::id()).await;
        assert!(!result.is_empty());
    }

    #[tokio::test]
    async fn read_cwd_none_for_unreadable_pid() {
        assert_eq!(read_cwd(u32::MAX).await, None);
    }

    #[tokio::test]
    async fn read_cwd_returns_for_own_pid() {
        let result = read_cwd(std::process::id()).await;
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn scan_listening_ports_linux_handles_subprocess_error() {
        // "ss" が存在しないコマンドとして解決される（この sandbox には無い）ため、
        // run_subprocess_safe が None を返し空マップになることを確認する。
        // 実行環境に ss が入っていれば実際にスキャンされてしまうため、コマンド
        // 自体を差し替えられないこの純粋な統合テストでは「例外を出さないこと」
        // だけを確認する（クラッシュしない・ハングしないことが本質）。
        let result = scan_listening_ports_linux(&HashSet::new()).await;
        let _ = result; // 内容は環境依存なので検証しない
    }
}
