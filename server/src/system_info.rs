//! `GET /system/info` — サーバのシステム情報収集（`system.rs` から分離）。
//!
//! IP・OS 名・uptime・CPU 温度・メモリ・ディスク・tailscale・gh 認証ユーザを
//! 個別の best-effort プローブ（失敗時は None → フィールド省略）で集める。

use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::state::AppState;
use crate::subprocess::{
    run_cmd_safe, run_subprocess_safe, run_tailscale_json, SYSTEM_CMD_TIMEOUT_SEC,
};
use crate::system::get_app_release;
use crate::util::IS_MACOS;

// ─── GET /system/info ───────────────────────────────────────────────────────

pub(crate) fn hostname() -> String {
    let mut buf = [0u8; 256];
    // SAFETY: gethostname はバッファへ NUL 終端文字列を書くだけ。
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if rc == 0 {
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).into_owned()
    } else {
        String::new()
    }
}

/// Python `getpass.getuser()` と同じ解決順: env チェーン → pwd データベース。
pub(crate) fn current_user() -> String {
    for key in ["LOGNAME", "USER", "LNAME", "USERNAME"] {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    // SAFETY: getpwuid_r は与えたバッファへ結果を書くだけ。result が NULL なら未検出。
    unsafe {
        let uid = libc::getuid();
        let mut pwd: libc::passwd = std::mem::zeroed();
        // c_char は x86_64/mac では i8、aarch64-linux では u8 とターゲット依存の
        // ため、i8/u8 を直接書かず c_char で確保する。
        let mut buf = [0 as libc::c_char; 1024];
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let rc = libc::getpwuid_r(uid, &mut pwd, buf.as_mut_ptr(), buf.len(), &mut result);
        if rc == 0 && !result.is_null() && !pwd.pw_name.is_null() {
            return std::ffi::CStr::from_ptr(pwd.pw_name)
                .to_string_lossy()
                .into_owned();
        }
        uid.to_string()
    }
}

async fn get_ip() -> Option<String> {
    if !IS_MACOS {
        if let Some(out) = run_cmd_safe(&["hostname", "-I"], SYSTEM_CMD_TIMEOUT_SEC, None).await {
            if let Some(first) = out.split_whitespace().next() {
                return Some(first.to_string());
            }
        }
    }
    // フォールバック: 自ホスト名の名前解決（Python socket.gethostbyname 相当）
    use std::net::ToSocketAddrs;
    let host = hostname();
    if host.is_empty() {
        return None;
    }
    format!("{host}:0")
        .to_socket_addrs()
        .ok()?
        .find(|a| a.is_ipv4())
        .map(|a| a.ip().to_string())
}

async fn get_os_name() -> Option<String> {
    if IS_MACOS {
        let ver = run_cmd_safe(
            &["sw_vers", "-productVersion"],
            SYSTEM_CMD_TIMEOUT_SEC,
            None,
        )
        .await
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
        return Some(if ver.is_empty() {
            "macOS".to_string()
        } else {
            format!("macOS {ver}")
        });
    }
    let os_release = std::fs::read_to_string("/etc/os-release").ok()?;
    os_release
        .lines()
        .find_map(|l| l.strip_prefix("PRETTY_NAME="))
        .map(|v| v.trim_matches('"').to_string())
}

fn format_uptime_seconds(elapsed: i64) -> String {
    let (days, rem) = (elapsed / 86400, elapsed % 86400);
    let (hours, rem) = (rem / 3600, rem % 3600);
    let minutes = rem / 60;
    let mut parts = Vec::new();
    if days > 0 {
        parts.push(format!("{days} day{}", if days != 1 { "s" } else { "" }));
    }
    if hours > 0 {
        parts.push(format!("{hours} hour{}", if hours != 1 { "s" } else { "" }));
    }
    if minutes > 0 {
        parts.push(format!(
            "{minutes} minute{}",
            if minutes != 1 { "s" } else { "" }
        ));
    }
    if parts.is_empty() {
        "up 0 minutes".to_string()
    } else {
        format!("up {}", parts.join(", "))
    }
}

async fn get_uptime() -> Option<String> {
    if IS_MACOS {
        let out = run_cmd_safe(
            &["sysctl", "-n", "kern.boottime"],
            SYSTEM_CMD_TIMEOUT_SEC,
            None,
        )
        .await?;
        let boot: i64 = regex_capture_int(&out, "sec")?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;
        return Some(format_uptime_seconds(now - boot));
    }
    run_cmd_safe(&["uptime", "-p"], SYSTEM_CMD_TIMEOUT_SEC, None)
        .await
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// `sec = 12345` 形式から整数を取り出す（macOS kern.boottime 用の簡易パーサ）。
fn regex_capture_int(text: &str, key: &str) -> Option<i64> {
    let idx = text.find(key)?;
    let rest = &text[idx + key.len()..];
    let rest = rest.trim_start().strip_prefix('=')?.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn get_cpu_temp() -> Option<String> {
    if IS_MACOS {
        return None;
    }
    let raw = std::fs::read_to_string("/sys/class/thermal/thermal_zone0/temp").ok()?;
    let milli: f64 = raw.trim().parse::<i64>().ok()? as f64;
    Some(format!("{:.1} °C", milli / 1000.0))
}

fn parse_meminfo(meminfo: &str) -> Option<String> {
    let mut total_kb: Option<f64> = None;
    let mut available_kb: f64 = 0.0;
    for line in meminfo.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        match parts[0] {
            "MemTotal:" => total_kb = parts[1].parse().ok(),
            "MemAvailable:" => available_kb = parts[1].parse().unwrap_or(0.0),
            _ => {}
        }
    }
    let total_gb = total_kb? / 1024.0 / 1024.0;
    let used_gb = total_gb - available_kb / 1024.0 / 1024.0;
    Some(format!("{used_gb:.1} / {total_gb:.1} GB"))
}

async fn get_memory() -> Option<String> {
    if IS_MACOS {
        let memsize = run_cmd_safe(
            &["sysctl", "-n", "hw.memsize"],
            SYSTEM_CMD_TIMEOUT_SEC,
            None,
        )
        .await?;
        let total_bytes: f64 = memsize.trim().parse::<i64>().ok()? as f64;
        let vmstat = run_cmd_safe(&["vm_stat"], SYSTEM_CMD_TIMEOUT_SEC, None).await?;
        let page_size = vmstat
            .find("page size of ")
            .and_then(|i| {
                let digits: String = vmstat[i + "page size of ".len()..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                digits.parse::<f64>().ok()
            })
            .unwrap_or(16384.0);
        let mut free_pages = 0.0;
        for key in ["Pages free", "Pages inactive", "Pages speculative"] {
            if let Some(i) = vmstat.find(key) {
                let rest = vmstat[i + key.len()..].trim_start_matches(':').trim_start();
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                free_pages += digits.parse::<f64>().unwrap_or(0.0);
            }
        }
        let available = free_pages * page_size;
        let total_gb = total_bytes / 1024f64.powi(3);
        let used_gb = (total_bytes - available) / 1024f64.powi(3);
        return Some(format!("{used_gb:.1} / {total_gb:.1} GB"));
    }
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    parse_meminfo(&meminfo)
}

/// `shutil.disk_usage("/")` 相当（used は f_bfree 基準）。
fn get_disk() -> Option<String> {
    let path = std::ffi::CString::new("/").ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: statvfs は st を埋めるだけ。
    if unsafe { libc::statvfs(path.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let frsize = st.f_frsize as f64;
    let total = st.f_blocks as f64 * frsize;
    let used = (st.f_blocks - st.f_bfree) as f64 * frsize;
    Some(format!(
        "{:.1} / {:.1} GB",
        used / 1024f64.powi(3),
        total / 1024f64.powi(3)
    ))
}

async fn get_tailscale_info() -> Option<Value> {
    let version_out = run_cmd_safe(&["tailscale", "version"], SYSTEM_CMD_TIMEOUT_SEC, None).await?;
    let version = version_out.lines().next().map(str::trim).unwrap_or("");
    if version.is_empty() {
        return None;
    }
    let serve_running = run_tailscale_json(&["serve", "status", "--json"])
        .await
        .map(|d| {
            let truthy = |v: Option<&Value>| {
                v.is_some_and(|x| !x.is_null() && x != &json!({}) && x != &json!([]))
            };
            truthy(d.get("TCP")) || truthy(d.get("Web"))
        });
    Some(json!({
        "version": version,
        "serve_running": serve_running,
    }))
}

/// `gh` CLIがログイン済みならそのユーザー名（GitHubログイン名）を返す。
/// 未インストール・未ログイン・タイムアウトはすべてNone（ScreenEmpty.vueの
/// Setup項目・ServerInfo.vueは「未ログイン」扱いにする）。
async fn gh_auth_user() -> Option<String> {
    let result = run_subprocess_safe(
        &["gh", "api", "user", "--jq", ".login"],
        SYSTEM_CMD_TIMEOUT_SEC,
        None,
    )
    .await?;
    if !result.success() {
        return None;
    }
    let login = result.stdout.trim();
    if login.is_empty() {
        None
    } else {
        Some(login.to_string())
    }
}

pub async fn info(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let root = &state.paths.project_root;
    let mut info = Map::new();
    info.insert("hostname".into(), Value::String(hostname()));
    info.insert("user".into(), Value::String(current_user()));
    info.insert(
        "install_dir".into(),
        Value::String(root.to_string_lossy().into_owned()),
    );
    let release = get_app_release(root).await;
    if !release.is_empty() {
        info.insert("version".into(), Value::String(release));
    }
    // .gitが無い（バイナリ配布インストール）場合はupdate系エンドポイントが
    // 使えないため、UI（ServerInfo.vue）がUpdateカード自体を出し分ける判定に使う。
    info.insert(
        "updatable".into(),
        Value::Bool(crate::git_utils::git_is_repo(root).await),
    );
    if let Some(v) = get_ip().await {
        info.insert("ip".into(), Value::String(v));
    }
    if let Some(v) = get_os_name().await {
        info.insert("os".into(), Value::String(v));
    }
    if let Some(v) = get_uptime().await {
        info.insert("uptime".into(), Value::String(v));
    }
    if let Some(v) = get_cpu_temp() {
        info.insert("cpu_temp".into(), Value::String(v));
    }
    if let Some(v) = get_memory().await {
        info.insert("memory".into(), Value::String(v));
    }
    if let Some(v) = get_disk() {
        info.insert("disk".into(), Value::String(v));
    }
    if let Some(v) = get_tailscale_info().await {
        info.insert("tailscale".into(), v);
    }
    let gh_user = gh_auth_user().await;
    info.insert("gh_authenticated".into(), Value::Bool(gh_user.is_some()));
    if let Some(user) = gh_user {
        info.insert("gh_user".into(), Value::String(user));
    }
    Json(Value::Object(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uptime_formatting_matches_python() {
        assert_eq!(format_uptime_seconds(0), "up 0 minutes");
        assert_eq!(format_uptime_seconds(60), "up 1 minute");
        assert_eq!(format_uptime_seconds(3600 + 120), "up 1 hour, 2 minutes");
        assert_eq!(
            format_uptime_seconds(2 * 86400 + 3 * 3600 + 60),
            "up 2 days, 3 hours, 1 minute"
        );
    }

    #[test]
    fn meminfo_parsing() {
        let sample = "MemTotal:       16384000 kB\nMemFree:  100 kB\nMemAvailable:    8192000 kB\n";
        assert_eq!(parse_meminfo(sample).unwrap(), "7.8 / 15.6 GB");
        assert!(parse_meminfo("Garbage: x\n").is_none());
    }

    #[test]
    fn boottime_capture() {
        let s = "{ sec = 1700000000, usec = 123 } Tue Nov 14 2023";
        assert_eq!(regex_capture_int(s, "sec"), Some(1_700_000_000));
        assert_eq!(regex_capture_int("no match", "sec"), None);
    }
}
