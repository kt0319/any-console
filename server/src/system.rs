//! システム情報・自己更新・tmux 管理 API（Python 側 `api/routers/system.py` の移植）。
//!
//! 全エンドポイントとも共有 JSON ファイルへの書き込みを持たないため、Phase 1 の
//! 最初の Rust ネイティブ移行対象。Linux / macOS の二系統分岐は Python と同じ
//! 判定・同じコマンドを用いる（クロスプラットフォーム一級サポートの方針）。

use std::path::Path;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::errors::{bad_request, conflict, not_found, server_error, ApiError};
use crate::state::AppState;
use crate::subprocess::{
    kill_tmux_by_name, run_cmd_safe, run_subprocess_safe, run_tailscale_json, run_tmux_cmd,
    tmux_session_exists, SYSTEM_CMD_TIMEOUT_SEC,
};
use crate::util::IS_MACOS;
use crate::util::{sanitize_log_value, sanitize_session_segment, token_urlsafe, JsonBody};

const PROCESS_LIST_LIMIT: usize = 10;
const PS_FIELD_COUNT: usize = 11;
const GIT_FETCH_TIMEOUT_SEC: f64 = 30.0;

// ─── 共通ヘルパー ────────────────────────────────────────────────────────────

/// git 実行（実体は `git_utils::run_git_raw` — C ロケール強制等を共有する。
/// update 系エンドポイントは成否と stderr しか見ないため Option に落とす）。
async fn git(root: &Path, args: &[&str], timeout: f64) -> Option<crate::git_utils::GitOutput> {
    crate::git_utils::run_git_raw(args, root, timeout, &[])
        .await
        .ok()
}

/// 成功時のみ trim 済み stdout を返す（実体は `git_utils::run_git_query`。
/// こちらの呼び出し側は行末改行を除いた値を期待するため trim を挟む）。
async fn git_out(root: &Path, args: &[&str], timeout: f64) -> Option<String> {
    crate::git_utils::run_git_query(args, root, timeout)
        .await
        .map(|s| s.trim().to_string())
}

/// update 系エンドポイント共通の「project_root が git リポジトリか」ガード。
async fn ensure_git_repo(root: &Path, error_msg: &str) -> Result<(), ApiError> {
    if !crate::git_utils::git_is_repo(root).await {
        return Err(server_error(error_msg));
    }
    Ok(())
}

/// 人間が読めるバージョン文字列。リリースタグ基準（例: v0.5.0-38-g844f239）。
/// git clone構成では`git describe`を使うが、バイナリ配布（`.git`が存在しない
/// インストール）では常に失敗するため、ビルド時に埋め込まれた
/// `CARGO_PKG_VERSION`（release-pleaseがタグと同期させる、
/// `release-please-config.json`のextra-files参照）へフォールバックする。
async fn get_app_release(root: &Path) -> String {
    let release = git_out(
        root,
        &["describe", "--tags", "--always"],
        SYSTEM_CMD_TIMEOUT_SEC,
    )
    .await
    .unwrap_or_default();
    if !release.is_empty() {
        return release;
    }
    format!("v{}", env!("CARGO_PKG_VERSION"))
}

/// 最終コミットの日時文字列（例: `2026-07-15 12:34`）。`/auth/check` が使う
/// （バージョン表記自体は `get_app_release` を使う）。
pub(crate) async fn get_app_commit_date(root: &Path) -> String {
    git_out(
        root,
        &["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M"],
        SYSTEM_CMD_TIMEOUT_SEC,
    )
    .await
    .unwrap_or_default()
}

/// 空白区切りで**合計 n 要素**に分割し、最後の要素には残り全体
/// （先頭空白を除去）を入れる（Python の `str.split(None, n-1)` 相当）。
/// `foreground.rs` の `split_whitespace_n`（maxsplit=n で最大 n+1 要素）とは
/// n の解釈が異なるので注意。
fn split_into_fields(line: &str, n: usize) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut rest = line.trim_start();
    while parts.len() + 1 < n && !rest.is_empty() {
        match rest.find(char::is_whitespace) {
            Some(idx) => {
                parts.push(&rest[..idx]);
                rest = rest[idx..].trim_start();
            }
            None => break,
        }
    }
    if !rest.is_empty() {
        parts.push(rest);
    }
    parts
}

// ─── GET /system/processes ──────────────────────────────────────────────────

pub async fn processes(_auth: RequireAuth) -> Result<Json<Value>, ApiError> {
    let cmd: &[&str] = if IS_MACOS {
        &["ps", "aux", "-r"]
    } else {
        &["ps", "aux", "--sort=-%cpu"]
    };
    let result = run_subprocess_safe(cmd, SYSTEM_CMD_TIMEOUT_SEC, None).await;
    let result = match result {
        Some(r) if r.success() => r,
        _ => return Err(server_error("ps command failed")),
    };
    Ok(Json(Value::Array(parse_ps_output(&result.stdout))))
}

fn parse_ps_output(stdout: &str) -> Vec<Value> {
    let mut processes = Vec::new();
    for line in stdout.trim().lines().skip(1).take(PROCESS_LIST_LIMIT) {
        let parts = split_into_fields(line, PS_FIELD_COUNT);
        if parts.len() < PS_FIELD_COUNT {
            continue;
        }
        let (Ok(pid), Ok(cpu), Ok(mem)) = (
            parts[1].parse::<i64>(),
            parts[2].parse::<f64>(),
            parts[3].parse::<f64>(),
        ) else {
            continue;
        };
        let command = parts[10];
        let name = command
            .split_whitespace()
            .next()
            .map(|c| {
                Path::new(c)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_default()
            .unwrap_or_default();
        processes.push(json!({
            "pid": pid,
            "name": name,
            "cpu": cpu,
            "mem": mem,
            "command": command,
        }));
    }
    processes
}

// ─── POST /client-errors ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ClientErrorReport {
    r#type: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    stack: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    lineno: Option<i64>,
    #[serde(default)]
    colno: Option<i64>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    user_agent: String,
    #[serde(default)]
    info: String,
}

pub async fn client_errors(
    _auth: RequireAuth,
    JsonBody(body): JsonBody<ClientErrorReport>,
) -> Result<Json<Value>, ApiError> {
    // Pydantic の max_length 制約に対応する検証（超過は 422）
    for (value, max, field) in [
        (&body.r#type, 40, "type"),
        (&body.message, 2000, "message"),
        (&body.stack, 10000, "stack"),
        (&body.source, 500, "source"),
        (&body.url, 500, "url"),
        (&body.user_agent, 500, "user_agent"),
        (&body.info, 1000, "info"),
    ] {
        crate::jobs_common::check_max_len(field, value, max)?;
    }
    tracing::warn!(
        "client-error type={} url={} message={} info={} source={}:{}:{} ua={}\n{}",
        sanitize_log_value(&body.r#type),
        sanitize_log_value(&body.url),
        sanitize_log_value(&body.message),
        sanitize_log_value(&body.info),
        sanitize_log_value(&body.source),
        body.lineno.map_or("?".to_string(), |v| v.to_string()),
        body.colno.map_or("?".to_string(), |v| v.to_string()),
        sanitize_log_value(&body.user_agent),
        sanitize_log_value(&body.stack),
    );
    Ok(Json(json!({"status": "ok"})))
}

// ─── POST /system/process/kill ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ProcessKillBody {
    pid: i32,
}

pub async fn process_kill(
    _auth: RequireAuth,
    JsonBody(body): JsonBody<ProcessKillBody>,
) -> Result<Json<Value>, ApiError> {
    // SAFETY: kill(2) の呼び出しのみ。エラーは errno で分類する。
    let rc = unsafe { libc::kill(body.pid, libc::SIGTERM) };
    if rc != 0 {
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
        return Err(match errno {
            libc::ESRCH => not_found("Process not found"),
            libc::EPERM => bad_request("Permission denied"),
            _ => server_error("kill failed"),
        });
    }
    Ok(Json(json!({"ok": true})))
}

// ─── POST /system/tmux/kill ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TmuxNameBody {
    name: String,
}

pub async fn tmux_kill(
    _auth: RequireAuth,
    JsonBody(body): JsonBody<TmuxNameBody>,
) -> Result<Json<Value>, ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad_request("Empty session name"));
    }
    if !tmux_session_exists(name).await {
        return Err(not_found("Session not found"));
    }
    kill_tmux_by_name(name).await;
    Ok(Json(json!({"ok": true})))
}

// ─── POST /system/tmux/adopt ────────────────────────────────────────────────

pub async fn tmux_adopt(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<TmuxNameBody>,
) -> Result<Json<Value>, ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(bad_request("Empty session name"));
    }
    let prefix = &state.paths.tmux_prefix;
    if name.starts_with(prefix.as_str()) {
        return Err(bad_request("Already managed by any-console"));
    }
    if !tmux_session_exists(name).await {
        return Err(not_found("Session not found"));
    }
    let safe = sanitize_session_segment(name);
    let session_id = format!("{safe}-{}", token_urlsafe(6));
    let new_name = format!("{prefix}{session_id}");
    let result = run_tmux_cmd(&["rename-session", "-t", name, &new_name]).await;
    match result {
        Some(r) if r.success() => {}
        other => {
            let stderr = other
                .map(|r| r.stderr.trim().to_string())
                .unwrap_or_default();
            let reason = if stderr.is_empty() {
                "unknown".to_string()
            } else {
                stderr
            };
            return Err(server_error(format!(
                "Failed to rename tmux session: {reason}"
            )));
        }
    }
    tracing::info!("adopted external tmux session {} -> {}", name, new_name);
    Ok(Json(
        json!({"ok": true, "session_id": session_id, "tmux_name": new_name}),
    ))
}

// ─── GET /system/tmux-info ──────────────────────────────────────────────────

pub async fn tmux_info(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let mut info = json!({
        "version": "", "sessions": [], "available": false,
        // prefix: フロントが「any-console 管理セッション」を判別するための実効値
        "prefix": state.paths.tmux_prefix,
    });
    if let Some(r) = run_tmux_cmd(&["-V"]).await {
        if r.success() {
            info["version"] = Value::String(r.stdout.trim().replace("tmux ", ""));
            info["available"] = Value::Bool(true);
        }
    }
    let fmt = "#{session_name}\t#{session_created}\t#{session_windows}\t#{session_attached}";
    if let Some(r) = run_tmux_cmd(&["list-sessions", "-F", fmt]).await {
        if r.success() {
            info["sessions"] = Value::Array(parse_tmux_sessions(&r.stdout));
        }
    }
    Json(info)
}

fn parse_tmux_sessions(stdout: &str) -> Vec<Value> {
    let mut sessions = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 4 {
            continue;
        }
        sessions.push(json!({
            "name": parts[0],
            "created": parts[1].parse::<i64>().unwrap_or(0),
            "windows": parts[2].parse::<i64>().unwrap_or(0),
            "attached": parts[3] == "1",
        }));
    }
    sessions
}

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

// ─── GET /system/update/check・POST /system/update/apply ────────────────────

async fn git_remote(root: &Path) -> String {
    git_out(root, &["remote"], SYSTEM_CMD_TIMEOUT_SEC)
        .await
        .and_then(|o| o.lines().next().map(str::to_string))
        .unwrap_or_else(|| "origin".to_string())
}

/// バージョン降順で最新のリリースタグを返す（無ければ空文字）。
async fn latest_release_tag(root: &Path) -> String {
    git_out(root, &["tag", "--sort=-v:refname"], SYSTEM_CMD_TIMEOUT_SEC)
        .await
        .and_then(|o| o.lines().next().map(str::to_string))
        .unwrap_or_default()
}

pub async fn update_check(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let root = &state.paths.project_root;
    ensure_git_repo(root, "Not a git repository; cannot check for updates").await?;
    let remote = git_remote(root).await;
    let fetched = git(
        root,
        &["fetch", "--tags", "--force", "--quiet", &remote],
        GIT_FETCH_TIMEOUT_SEC,
    )
    .await;
    let fetch_ok = fetched.is_some_and(|r| r.success());

    let current_release = git_out(
        root,
        &["describe", "--tags", "--abbrev=0"],
        SYSTEM_CMD_TIMEOUT_SEC,
    )
    .await
    .unwrap_or_default();
    let latest_release = latest_release_tag(root).await;

    let mut behind = 0i64;
    let mut update_available = false;
    if !latest_release.is_empty() && latest_release != current_release {
        if current_release.is_empty() {
            update_available = true;
        } else {
            let range = format!("{current_release}..{latest_release}");
            let cnt = git_out(
                root,
                &["rev-list", "--count", &range],
                SYSTEM_CMD_TIMEOUT_SEC,
            )
            .await;
            if let Some(n) = cnt.and_then(|c| c.parse::<i64>().ok()) {
                if n > 0 {
                    update_available = true;
                    behind = n;
                }
            }
        }
    }

    Ok(Json(json!({
        "version": get_app_release(root).await,
        "current_release": current_release,
        "latest_release": latest_release,
        "behind": behind,
        "update_available": update_available,
        "fetch_ok": fetch_ok,
    })))
}

pub async fn update_apply(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let root = &state.paths.project_root;
    ensure_git_repo(root, "Not a git repository; cannot update").await?;
    if git_out(root, &["status", "--porcelain"], SYSTEM_CMD_TIMEOUT_SEC)
        .await
        .is_some_and(|o| !o.is_empty())
    {
        return Err(conflict(
            "Uncommitted changes present. Commit or stash before updating.",
        ));
    }

    let remote = git_remote(root).await;
    let fetched = git(
        root,
        &["fetch", "--tags", "--force", &remote],
        GIT_FETCH_TIMEOUT_SEC,
    )
    .await;
    if !fetched.is_some_and(|r| r.success()) {
        return Err(server_error("git fetch failed"));
    }

    let latest = latest_release_tag(root).await;
    if latest.is_empty() {
        return Err(server_error("No release tags found"));
    }

    let result = git(
        root,
        &["-c", "advice.detachedHead=false", "checkout", &latest],
        SYSTEM_CMD_TIMEOUT_SEC,
    )
    .await;
    let result = match result {
        None => return Err(server_error("git checkout failed to run")),
        Some(r) if !r.success() => {
            let stderr: String = r.stderr.trim().chars().take(300).collect();
            return Err(server_error(format!("git checkout failed: {stderr}")));
        }
        Some(r) => r,
    };
    drop(result);

    Ok(Json(json!({
        "ok": true,
        "version": get_app_release(root).await,
        "checked_out": latest,
        "restart_required": true,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_into_fields_keeps_command_tail() {
        let line = "root       123  1.5  2.0 100 200 ?  S  10:00  0:01 /usr/bin/python3 -m uvicorn api.main:app";
        let parts = split_into_fields(line, 11);
        assert_eq!(parts.len(), 11);
        assert_eq!(parts[1], "123");
        assert_eq!(parts[10], "/usr/bin/python3 -m uvicorn api.main:app");
    }

    #[test]
    fn parse_ps_output_limits_and_shapes() {
        let header = "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND";
        let mut lines = vec![header.to_string()];
        for i in 0..15 {
            lines.push(format!(
                "user {} {}.0 1.0 100 200 ? S 10:00 0:0{} /bin/proc{} --flag value",
                100 + i,
                i,
                i,
                i
            ));
        }
        let out = parse_ps_output(&lines.join("\n"));
        assert_eq!(out.len(), 10);
        assert_eq!(out[0]["pid"], 100);
        assert_eq!(out[0]["name"], "proc0");
        assert_eq!(out[0]["command"], "/bin/proc0 --flag value");
        assert_eq!(out[3]["cpu"], 3.0);
    }

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
    fn tmux_session_parse() {
        let out = "main\t1700000000\t2\t1\nwork\t1700000100\t1\t0\nbroken-line\n";
        let sessions = parse_tmux_sessions(out);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0]["name"], "main");
        assert_eq!(sessions[0]["created"], 1_700_000_000i64);
        assert_eq!(sessions[0]["attached"], true);
        assert_eq!(sessions[1]["attached"], false);
    }

    #[test]
    fn boottime_capture() {
        let s = "{ sec = 1700000000, usec = 123 } Tue Nov 14 2023";
        assert_eq!(regex_capture_int(s, "sec"), Some(1_700_000_000));
        assert_eq!(regex_capture_int("no match", "sec"), None);
    }
}
