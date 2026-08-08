//! 履歴・コミット・スタッシュ系 API（Python 側 `api/routers/git_history.py` の移植）。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::errors::{bad_request, ApiError};
use crate::git_helpers::{
    execute_git_action, execute_git_action_with_activity, resolve_workspace_file,
    validate_branch_name, validate_commit_ref, validate_stash_ref,
};
use crate::git_utils::{
    resolve_workspace_path, rev_parse_head, run_git_command, GIT_STANDARD_TIMEOUT_SEC,
};
use crate::state::AppState;
use crate::util::{JsonBody, QueryParams};

const GIT_LOG_MAX_ENTRIES: i64 = 10000;
const GIT_LOG_MAX_SKIP: i64 = 10000;

#[derive(Deserialize)]
pub struct CommitRequest {
    message: String,
}

/// Python `GitActionRequest` と同じ全アクション共用ボディ。
#[derive(Deserialize, Default)]
pub struct GitActionRequest {
    #[serde(default)]
    commit_hash: String,
    #[serde(default)]
    branch: String,
    #[serde(default)]
    stash_ref: String,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default)]
    include_untracked: bool,
}

fn default_mode() -> String {
    "soft".to_string()
}

fn fields(pairs: &[(&str, Value)]) -> Map<String, Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

// ─── GET /workspaces/{name}/git-log ─────────────────────────────────────────

#[derive(Deserialize)]
pub struct GitLogQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    skip: i64,
    #[serde(default)]
    graph: bool,
}

fn default_limit() -> i64 {
    50
}

pub async fn git_log(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<GitLogQuery>,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let safe_limit = q.limit.clamp(1, GIT_LOG_MAX_ENTRIES);
    let safe_skip = q.skip.clamp(0, GIT_LOG_MAX_SKIP);
    let max_count = format!("--max-count={safe_limit}");
    let skip_arg = format!("--skip={safe_skip}");
    let mut args = vec![
        "--no-pager",
        "log",
        "--date-order",
        max_count.as_str(),
        "--date=format-local:%Y-%m-%d %H:%M",
        "--pretty=format:%H\t%ad\t%an\t%D\t%s",
    ];
    if q.graph {
        args.insert(3, "--graph");
    }
    if safe_skip > 0 {
        args.insert(4 + usize::from(q.graph), skip_arg.as_str());
    }
    run_git_command(&args, &ws_path, GIT_STANDARD_TIMEOUT_SEC, "log", &[])
        .await
        .map(Json)
}

// ─── GET /workspaces/{name}/file-history ────────────────────────────────────

#[derive(Deserialize)]
pub struct FileHistoryQuery {
    path: String,
    #[serde(default = "default_limit")]
    limit: i64,
}

pub async fn file_history(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<FileHistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let (ws_path, _, rel) = resolve_workspace_file(&state, &name, &q.path).await?;
    let safe_limit = q.limit.clamp(1, GIT_LOG_MAX_ENTRIES);
    let max_count = format!("--max-count={safe_limit}");
    let rel_str = rel.to_string_lossy().into_owned();
    let args = [
        "--no-pager",
        "log",
        "--follow",
        max_count.as_str(),
        "--date=format-local:%Y-%m-%d %H:%M",
        "--pretty=format:%H\t%ad\t%an\t%s",
        "--",
        rel_str.as_str(),
    ];
    run_git_command(
        &args,
        &ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "log --follow",
        &[],
    )
    .await
    .map(Json)
}

// ─── GET /workspaces/{name}/commit-message ──────────────────────────────────

#[derive(Deserialize)]
pub struct CommitMessageQuery {
    hash: String,
}

pub async fn commit_message(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<CommitMessageQuery>,
) -> Result<Json<Value>, ApiError> {
    let h = validate_commit_ref(&q.hash)?;
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let result = run_git_command(
        &["--no-pager", "log", "-1", "--format=%B", &h],
        &ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "commit-message",
        &[],
    )
    .await?;
    let message = if result["status"] == "ok" {
        result["stdout"].as_str().unwrap_or("").trim().to_string()
    } else {
        String::new()
    };
    Ok(Json(json!({"message": message})))
}

// ─── コミット指定系（cherry-pick / revert）──────────────────────────────────

async fn execute_commit_action(
    state: &Arc<AppState>,
    name: &str,
    commit_hash: &str,
    git_args: &[&str],
    operation: &str,
    event: &str,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    let h = validate_commit_ref(commit_hash)?;
    let mut args: Vec<&str> = git_args.to_vec();
    args.push(&h);
    let short: String = h.chars().take(8).collect();
    execute_git_action_with_activity(
        state,
        name,
        Some(&ws_path),
        &args,
        operation,
        event,
        &format!("commit={short}"),
        true,
        fields(&[("source_commit", json!(h))]),
    )
    .await
    .map(Json)
}

pub async fn cherry_pick(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    execute_commit_action(
        &state,
        &name,
        &body.commit_hash,
        &["cherry-pick"],
        "cherry-pick",
        "git_cherry_pick",
    )
    .await
}

pub async fn revert(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    execute_commit_action(
        &state,
        &name,
        &body.commit_hash,
        &["revert", "--no-edit"],
        "revert",
        "git_revert",
    )
    .await
}

// ─── merge / rebase / reset ─────────────────────────────────────────────────

async fn branch_action(
    state: &Arc<AppState>,
    name: &str,
    branch_raw: &str,
    operation: &str,
    event: &str,
) -> Result<Json<Value>, ApiError> {
    let branch = validate_branch_name(branch_raw)?;
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    let before_hash = rev_parse_head(&ws_path).await;
    execute_git_action_with_activity(
        state,
        name,
        Some(&ws_path),
        &[operation, &branch],
        operation,
        event,
        &format!("branch={branch}"),
        true,
        fields(&[
            ("branch", json!(branch)),
            ("from_commit", json!(before_hash)),
        ]),
    )
    .await
    .map(Json)
}

pub async fn merge(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    branch_action(&state, &name, &body.branch, "merge", "git_merge").await
}

pub async fn rebase(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    branch_action(&state, &name, &body.branch, "rebase", "git_rebase").await
}

pub async fn reset(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    let commit_hash = validate_commit_ref(&body.commit_hash)?;
    if !matches!(body.mode.as_str(), "soft" | "mixed" | "hard") {
        return Err(bad_request(format!("Invalid reset mode: {}", body.mode)));
    }
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let before_hash = rev_parse_head(&ws_path).await;
    let mode_flag = format!("--{}", body.mode);
    let short: String = commit_hash.chars().take(8).collect();
    execute_git_action_with_activity(
        &state,
        &name,
        Some(&ws_path),
        &["reset", &mode_flag, &commit_hash],
        "reset",
        "git_reset",
        &format!("mode={} commit={short}", body.mode),
        false,
        fields(&[
            ("mode", json!(body.mode)),
            ("from_commit", json!(before_hash)),
            ("commit", json!(commit_hash)),
        ]),
    )
    .await
    .map(Json)
}

// ─── commit ─────────────────────────────────────────────────────────────────

pub async fn commit(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<CommitRequest>,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let message = body.message.trim().to_string();
    if message.is_empty() {
        return Err(bad_request("Please enter a commit message"));
    }
    let add_result = run_git_command(
        &["add", "-A"],
        &ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "add",
        &[],
    )
    .await?;
    if add_result["exit_code"] != 0 {
        return Ok(Json(add_result));
    }
    execute_git_action_with_activity(
        &state,
        &name,
        Some(&ws_path),
        &["commit", "-m", &message],
        "commit",
        "git_commit",
        "",
        true,
        fields(&[("message", json!(message))]),
    )
    .await
    .map(Json)
}

// ─── stash ──────────────────────────────────────────────────────────────────

pub async fn stash_list(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let result = run_git_command(
        &["stash", "list", "--format=%gd\t%gs\t%cr"],
        &ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "stash list",
        &[],
    )
    .await?;
    if result["exit_code"] != 0 {
        return Ok(Json(result));
    }
    let mut entries = Vec::new();
    for line in result["stdout"].as_str().unwrap_or("").lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 3 {
            entries.push(json!({"ref": parts[0], "message": parts[1], "time": parts[2]}));
        }
    }
    Ok(Json(json!({"status": "ok", "entries": entries})))
}

pub async fn stash_drop(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    let r = validate_stash_ref(&body.stash_ref)?;
    execute_git_action_with_activity(
        &state,
        &name,
        None,
        &["stash", "drop", &r],
        "stash drop",
        "git_stash_drop",
        &format!("ref={r}"),
        false,
        fields(&[("ref", json!(r))]),
    )
    .await
    .map(Json)
}

pub async fn stash_pop_ref(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GitActionRequest>,
) -> Result<Json<Value>, ApiError> {
    let r = validate_stash_ref(&body.stash_ref)?;
    execute_git_action(
        &state,
        &name,
        &["stash", "pop", &r],
        "stash pop",
        &[],
        &format!("ref={r}"),
    )
    .await
    .map(Json)
}

pub async fn stash(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    // Python は `body: GitActionRequest | None = None`（ボディ無しも許容）
    raw_body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    let include_untracked = if raw_body.is_empty() {
        false
    } else {
        serde_json::from_slice::<GitActionRequest>(&raw_body)
            .map(|b| b.include_untracked)
            .unwrap_or(false)
    };
    let mut args = vec!["stash"];
    if include_untracked {
        args.push("-u");
    }
    execute_git_action(&state, &name, &args, "stash", &[], "")
        .await
        .map(Json)
}

pub async fn stash_pop(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    execute_git_action(&state, &name, &["stash", "pop"], "stash pop", &[], "")
        .await
        .map(Json)
}
