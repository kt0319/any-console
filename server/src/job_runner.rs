//! `POST /run` エンドポイント（Python 側 `api/routers/job_runner.py` の移植）。
//!
//! `TERMINAL_JOB`（tmux セッション生成）を扱う。ジョブのコマンドはセッション
//! 作成後に tmux へ送り込まれて実行される（自動実行）。

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::RequireAuth;
use crate::errors::{bad_request, ApiError};
use crate::git_utils::resolve_workspace_path;
use crate::jobs_common::{MAX_COMMAND_LENGTH, TERMINAL_JOB_KEY};
use crate::state::AppState;
use crate::util::{sanitize_log_value, JsonBody};

#[derive(Deserialize)]
pub struct RunRequest {
    job: String,
    #[serde(default)]
    workspace: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    icon_color: Option<String>,
    #[serde(default)]
    job_name: Option<String>,
    #[serde(default)]
    job_label: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    command_vars: HashMap<String, String>,
    #[serde(default)]
    interactive: bool,
}

/// コマンド内の `[[name]]` を command_vars の値で置換する（シェルクォート付き）。
/// 未指定の `[[name]]` はそのまま残す。
fn substitute_placeholders(
    command: Option<&str>,
    vars: &HashMap<String, String>,
) -> Option<String> {
    let command = command?;
    if vars.is_empty() {
        return Some(command.to_string());
    }
    let mut out = String::with_capacity(command.len());
    let bytes = command.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(rest) = command[i..].strip_prefix("[[") {
            if let Some(close) = rest.find("]]") {
                let inner = rest[..close].trim();
                let is_ident = !inner.is_empty()
                    && inner.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
                if is_ident {
                    if let Some(value) = vars.get(inner) {
                        out.push_str(&shell_quote(value));
                        i += 2 + close + 2;
                        continue;
                    }
                }
            }
        }
        let ch = command[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    Some(out)
}

/// `shlex.quote` 相当: 安全な文字（`\w` + `@%+=:,./-`）のみなら無加工、それ以外は
/// 単一引用符で囲み中の `'` を `'"'"'` へエスケープする。
fn shell_quote(value: &str) -> String {
    let is_safe_char = |c: char| {
        c.is_ascii_alphanumeric()
            || matches!(c, '_' | '@' | '%' | '+' | '=' | ':' | ',' | '.' | '/' | '-')
    };
    if !value.is_empty() && value.chars().all(is_safe_char) {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn strip_comment_lines(command: &str) -> String {
    command
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
}

/// ターミナルへ自動投入するコマンドを検証する（複数行シェルスクリプトを許容し、
/// NUL のみ拒否する。空文字列は None とみなす）。
fn validate_terminal_command(command: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(command) = command else {
        return Ok(None);
    };
    let stripped = strip_comment_lines(&command).trim().to_string();
    if stripped.is_empty() {
        return Ok(None);
    }
    if stripped.chars().count() > MAX_COMMAND_LENGTH {
        return Err(bad_request("Command is too long"));
    }
    if stripped.contains('\0') {
        return Err(bad_request("Invalid characters in command"));
    }
    Ok(Some(stripped))
}

pub async fn run_terminal_job(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<RunRequest>,
) -> Result<Json<Value>, ApiError> {
    let ws_path = match body.workspace.as_deref().filter(|w| !w.is_empty()) {
        Some(ws) => Some(resolve_workspace_path(&state.config, ws).await?),
        None => None,
    };

    if body.job != TERMINAL_JOB_KEY {
        return Err(bad_request(format!("Unknown job: {}", body.job)));
    }

    let command = substitute_placeholders(body.command.as_deref(), &body.command_vars);
    let command = validate_terminal_command(command)?;

    let (session_id, session_arc) = state
        .terminal_registry
        .create_registered_session(
            &state.paths.data_dir,
            &state.config,
            state.tls_active,
            &state.paths.tmux_prefix,
            ws_path.as_ref().map(|p| p.to_string_lossy()).as_deref(),
            body.workspace.clone(),
            body.icon.clone(),
            body.icon_color.clone(),
            body.job_name.clone(),
            body.job_label.clone(),
            body.interactive,
        )
        .await?;
    crate::session_watch::notify_session_created(&state, &session_id);

    let tmux_name = { session_arc.lock().await.tmux_session_name.clone() };
    tracing::info!(
        "terminal session created session={session_id} tmux={tmux_name} workspace={}",
        body.workspace.as_deref().unwrap_or("(none)")
    );

    // コマンドはサーバ側で送り込む。ブラウザ接続を待たずにセッション内で実行が
    // 始まるため、接続前に閉じても／無接続でも走り続ける（自動実行）。
    if let Some(command) = command.as_deref() {
        crate::tmux::wait_pane_ready(&tmux_name, crate::tmux::TMUX_PANE_READY_TIMEOUT_SEC).await;
        if !crate::tmux::send_keys_to_tmux(&tmux_name, command, true).await {
            tracing::warn!("autorun send-keys failed session={session_id}");
        }
        let preview: String = command.chars().take(80).collect();
        crate::activity::log_activity(
            &state.paths.data_dir,
            body.workspace.as_deref(),
            "terminal_run",
            [(
                "job".to_string(),
                json!(body
                    .job_name
                    .clone()
                    .unwrap_or_else(|| sanitize_log_value(&preview))),
            )]
            .into_iter()
            .collect(),
        );
    }

    Ok(Json(json!({
        "status": "ok",
        "session_id": session_id,
        "ws_url": format!("/terminal/ws/{session_id}"),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_substitution_quotes_values() {
        let mut vars = HashMap::new();
        vars.insert("name".to_string(), "hello world".to_string());
        let result = substitute_placeholders(Some("echo [[name]]"), &vars).unwrap();
        assert_eq!(result, "echo 'hello world'");
    }

    #[test]
    fn placeholder_left_untouched_when_missing() {
        let vars = HashMap::new();
        let result = substitute_placeholders(Some("echo [[name]]"), &vars).unwrap();
        assert_eq!(result, "echo [[name]]");
    }

    #[test]
    fn placeholder_simple_values_unquoted() {
        let mut vars = HashMap::new();
        vars.insert("branch".to_string(), "feat/x-1.2".to_string());
        let result = substitute_placeholders(Some("git checkout [[branch]]"), &vars).unwrap();
        assert_eq!(result, "git checkout feat/x-1.2");
    }

    #[test]
    fn strip_comment_lines_removes_hash_prefixed() {
        let out = strip_comment_lines("# comment\necho hi\n  # indented comment\nls");
        assert_eq!(out, "echo hi\nls");
    }

    #[test]
    fn validate_terminal_command_rejects_nul_and_long() {
        assert!(validate_terminal_command(Some("\0bad".to_string())).is_err());
        assert!(validate_terminal_command(Some("x".repeat(MAX_COMMAND_LENGTH + 1))).is_err());
        assert_eq!(
            validate_terminal_command(Some("   ".to_string())).unwrap(),
            None
        );
        assert_eq!(validate_terminal_command(None).unwrap(), None);
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("simple"), "simple");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), "'it'\"'\"'s'");
    }
}
