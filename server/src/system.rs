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
use serde_json::{json, Value};

use crate::auth::RequireAuth;
use crate::errors::{bad_request, not_found, server_error, ApiError};
use crate::state::AppState;
use crate::subprocess::{
    kill_tmux_by_name, run_subprocess_safe, run_tmux_cmd, tmux_session_exists,
    SYSTEM_CMD_TIMEOUT_SEC,
};
use crate::util::IS_MACOS;
use crate::util::{sanitize_log_value, sanitize_session_segment, token_urlsafe, JsonBody};

const PROCESS_LIST_LIMIT: usize = 10;
const PS_FIELD_COUNT: usize = 11;

// ─── 共通ヘルパー ────────────────────────────────────────────────────────────

/// git 実行（実体は `git_utils::run_git_raw` — C ロケール強制等を共有する。
/// update 系エンドポイントは成否と stderr しか見ないため Option に落とす）。
pub(crate) async fn git(
    root: &Path,
    args: &[&str],
    timeout: f64,
) -> Option<crate::git_utils::GitOutput> {
    crate::git_utils::run_git_raw(args, root, timeout, &[])
        .await
        .ok()
}

/// 成功時のみ trim 済み stdout を返す（実体は `git_utils::run_git_query`。
/// こちらの呼び出し側は行末改行を除いた値を期待するため trim を挟む）。
pub(crate) async fn git_out(root: &Path, args: &[&str], timeout: f64) -> Option<String> {
    crate::git_utils::run_git_query(args, root, timeout)
        .await
        .map(|s| s.trim().to_string())
}

/// update 系エンドポイント共通の「project_root が git リポジトリか」ガード。
pub(crate) async fn ensure_git_repo(root: &Path, error_msg: &str) -> Result<(), ApiError> {
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
pub(crate) async fn get_app_release(root: &Path) -> String {
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

/// 空白区切りで**合計 n 要素**に分割し、最後の要素には残り全体を入れる
/// （Python の `str.split(None, n-1)` 相当 — 実体は `util::split_whitespace_max`）。
fn split_into_fields(line: &str, n: usize) -> Vec<&str> {
    crate::util::split_whitespace_max(line, n.saturating_sub(1))
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
    fn tmux_session_parse() {
        let out = "main\t1700000000\t2\t1\nwork\t1700000100\t1\t0\nbroken-line\n";
        let sessions = parse_tmux_sessions(out);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0]["name"], "main");
        assert_eq!(sessions[0]["created"], 1_700_000_000i64);
        assert_eq!(sessions[0]["attached"], true);
        assert_eq!(sessions[1]["attached"], false);
    }
}
