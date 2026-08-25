//! 差分系 API（Python 側 `api/routers/git_diff.py` + `git_diff_utils.py` の移植）。

use std::path::Path as FsPath;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::errors::ApiError;
use crate::git_helpers::{
    execute_git_action, is_stash_ref, resolve_workspace_file, validate_commit_ref,
};
use crate::git_utils::{
    resolve_workspace_path, run_git_command, GIT_SHORT_TIMEOUT_SEC, GIT_STANDARD_TIMEOUT_SEC,
};
use crate::state::AppState;
use crate::util::{JsonBody, QueryParams};

const MAX_DIFF_SIZE: usize = 10 * 1024 * 1024;

fn truncate_diff(diff_text: &str) -> String {
    if diff_text.len() > MAX_DIFF_SIZE {
        // Python は文字数だが diff は実質 ASCII 主体。バイト境界で安全に切る
        let mut end = MAX_DIFF_SIZE;
        while !diff_text.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n... (truncated)", &diff_text[..end])
    } else {
        diff_text.to_string()
    }
}

/// ファイル行数（Python `count_file_lines` — 読めなければ 0）。
pub fn count_file_lines(path: &FsPath) -> i64 {
    match std::fs::read(path) {
        Ok(bytes) => {
            bytes.iter().filter(|&&b| b == b'\n').count() as i64
                + i64::from(!bytes.is_empty() && *bytes.last().unwrap() != b'\n')
        }
        Err(_) => 0,
    }
}

// ─── numstat / ファイルリスト整形（git_diff_utils.py）───────────────────────

fn resolve_rename_path(path: &str) -> String {
    // `{old => new}` 形式を new で置換する
    let (Some(start), Some(end)) = (path.find('{'), path.find('}')) else {
        return path.to_string();
    };
    if end < start {
        return path.to_string();
    }
    let inner = &path[start + 1..end];
    let Some((_, new_name)) = inner.split_once(" => ") else {
        return path.to_string();
    };
    format!("{}{}{}", &path[..start], new_name.trim(), &path[end + 1..])
}

pub fn parse_numstat(stdout: &str) -> Map<String, Value> {
    let mut stats = Map::new();
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 || parts[2].is_empty() {
            continue;
        }
        let (ins_raw, del_raw, path) = (parts[0], parts[1], parts[2]);
        let parse = |raw: &str| -> Value {
            if raw == "-" {
                Value::Null
            } else {
                json!(raw.parse::<i64>().unwrap_or(0))
            }
        };
        let stat = json!({"insertions": parse(ins_raw), "deletions": parse(del_raw)});
        stats.insert(path.to_string(), stat.clone());
        let resolved = resolve_rename_path(path);
        if resolved != path {
            stats.insert(resolved, stat);
        }
    }
    stats
}

fn parse_numstat_result(result: &Value) -> Map<String, Value> {
    if result["exit_code"] != 0 {
        return Map::new();
    }
    result["stdout"]
        .as_str()
        .map(parse_numstat)
        .unwrap_or_default()
}

fn build_file_entry(name: &str, numstat: &Map<String, Value>, status: Option<&str>) -> Value {
    let stat = numstat.get(name).and_then(Value::as_object);
    let mut entry = Map::new();
    entry.insert("name".to_string(), json!(name));
    entry.insert(
        "insertions".to_string(),
        stat.and_then(|s| s.get("insertions"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    entry.insert(
        "deletions".to_string(),
        stat.and_then(|s| s.get("deletions"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    if let Some(st) = status {
        entry.insert("status".to_string(), json!(st));
    }
    Value::Object(entry)
}

fn build_file_list(files_result: &Value, numstat: &Map<String, Value>) -> Vec<Value> {
    let mut files = Vec::new();
    if files_result["exit_code"] == 0 {
        for f in files_result["stdout"].as_str().unwrap_or("").lines() {
            let file_name = f.trim();
            if !file_name.is_empty() {
                files.push(build_file_entry(file_name, numstat, None));
            }
        }
    }
    files
}

// ─── diff 応答の組み立て ────────────────────────────────────────────────────

async fn build_diff_response(
    ws_path: &FsPath,
    full_args: &[&str],
    stat_args: &[&str],
    operation_prefix: &str,
) -> Result<Value, ApiError> {
    let diff_result = run_git_command(
        full_args,
        ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        operation_prefix,
        &[],
    )
    .await?;
    let mut numstat_args: Vec<&str> = stat_args.to_vec();
    numstat_args.push("--numstat");
    let numstat_result = run_git_command(
        &numstat_args,
        ws_path,
        GIT_SHORT_TIMEOUT_SEC,
        &format!("{operation_prefix} --numstat"),
        &[],
    )
    .await?;
    let mut name_only_args: Vec<&str> = stat_args.to_vec();
    name_only_args.push("--name-only");
    let name_only_result = run_git_command(
        &name_only_args,
        ws_path,
        GIT_SHORT_TIMEOUT_SEC,
        &format!("{operation_prefix} --name-only"),
        &[],
    )
    .await?;
    let files = build_file_list(&name_only_result, &parse_numstat_result(&numstat_result));
    Ok(json!({
        "status": diff_result["status"],
        "files": files,
        "diff": truncate_diff(diff_result["stdout"].as_str().unwrap_or("")),
        "stderr": diff_result["stderr"],
    }))
}

// ─── ルート ─────────────────────────────────────────────────────────────────

pub async fn commit_diff(
    State(state): State<Arc<AppState>>,
    Path((name, commit_hash)): Path<(String, String)>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    if is_stash_ref(&commit_hash) {
        return build_diff_response(
            &ws_path,
            &["stash", "show", "-p", &commit_hash],
            &["stash", "show", &commit_hash],
            "stash show",
        )
        .await
        .map(Json);
    }
    validate_commit_ref(&commit_hash)?;
    let parent = format!("{commit_hash}~1");
    build_diff_response(
        &ws_path,
        &["--no-pager", "diff", &parent, &commit_hash],
        &["diff", &parent, &commit_hash],
        "diff",
    )
    .await
    .map(Json)
}

#[derive(Deserialize)]
pub struct FileDiffQuery {
    path: String,
}

pub async fn file_commit_diff(
    State(state): State<Arc<AppState>>,
    Path((name, commit_hash)): Path<(String, String)>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<FileDiffQuery>,
) -> Result<Json<Value>, ApiError> {
    validate_commit_ref(&commit_hash)?;
    let (ws_path, _, rel) = resolve_workspace_file(&state, &name, &q.path).await?;
    let rel_str = rel.to_string_lossy().into_owned();
    let diff_result = run_git_command(
        &[
            "--no-pager",
            "show",
            "--format=",
            &commit_hash,
            "--",
            &rel_str,
        ],
        &ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "show",
        &[],
    )
    .await?;
    Ok(Json(json!({
        "status": diff_result["status"],
        "diff": truncate_diff(diff_result["stdout"].as_str().unwrap_or("")),
        "stderr": diff_result["stderr"],
        "exit_code": diff_result["exit_code"],
    })))
}

pub async fn workspace_diff(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let status_result = run_git_command(
        &["status", "--porcelain", "--untracked-files=all"],
        &ws_path,
        GIT_SHORT_TIMEOUT_SEC,
        "status",
        &[],
    )
    .await?;
    let diff_result =
        run_git_command(&["diff"], &ws_path, GIT_STANDARD_TIMEOUT_SEC, "diff", &[]).await?;
    let diff_staged_result = run_git_command(
        &["diff", "--staged"],
        &ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "diff --staged",
        &[],
    )
    .await?;
    let numstat_result = run_git_command(
        &["diff", "--numstat", "HEAD"],
        &ws_path,
        GIT_SHORT_TIMEOUT_SEC,
        "diff --numstat HEAD",
        &[],
    )
    .await?;
    let mut numstat = parse_numstat_result(&numstat_result);
    let mut files = Vec::new();
    if status_result["exit_code"] == 0 {
        for line in status_result["stdout"].as_str().unwrap_or("").lines() {
            if line.len() > 3 {
                let status_code = line[..2].trim();
                let file_name = &line[3..];
                if status_code == "??" && !numstat.contains_key(file_name) {
                    numstat.insert(
                        file_name.to_string(),
                        json!({
                            "insertions": count_file_lines(&ws_path.join(file_name)),
                            "deletions": 0,
                        }),
                    );
                }
                files.push(build_file_entry(file_name, &numstat, Some(status_code)));
            }
        }
    }
    let mut parts = Vec::new();
    for r in [&diff_staged_result, &diff_result] {
        let stdout = r["stdout"].as_str().unwrap_or("");
        if r["exit_code"] == 0 && !stdout.is_empty() {
            parts.push(stdout.to_string());
        }
    }
    let diff_text = parts.join("\n");
    Ok(Json(
        json!({"status": "ok", "files": files, "diff": truncate_diff(&diff_text)}),
    ))
}

#[derive(Deserialize)]
pub struct DiscardRequest {
    path: String,
}

pub async fn discard(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<DiscardRequest>,
) -> Result<Json<Value>, ApiError> {
    let (ws_path, _, _) = resolve_workspace_file(&state, &name, &body.path).await?;
    execute_git_action(
        &state,
        &name,
        &ws_path,
        &["restore", &body.path],
        "restore",
        &[],
        &format!("path={}", body.path),
    )
    .await
    .map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_parsing_with_renames() {
        let out = "10\t2\tsrc/main.rs\n-\t-\tassets/logo.png\n3\t1\tsrc/{old.rs => new.rs}\n";
        let stats = parse_numstat(out);
        assert_eq!(stats["src/main.rs"]["insertions"], 10);
        assert_eq!(stats["assets/logo.png"]["insertions"], Value::Null);
        assert_eq!(stats["src/new.rs"]["deletions"], 1);
        assert!(stats.contains_key("src/{old.rs => new.rs}"));
    }

    #[test]
    fn file_entry_and_truncate() {
        let mut numstat = Map::new();
        numstat.insert(
            "a.txt".to_string(),
            json!({"insertions": 1, "deletions": 2}),
        );
        let e = build_file_entry("a.txt", &numstat, Some("M"));
        assert_eq!(e["insertions"], 1);
        assert_eq!(e["status"], "M");
        let e = build_file_entry("missing.txt", &numstat, None);
        assert_eq!(e["insertions"], Value::Null);
        assert!(truncate_diff("short").eq("short"));
    }

    #[test]
    fn count_lines() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.txt");
        std::fs::write(&p, "a\nb\nc\n").unwrap();
        assert_eq!(count_file_lines(&p), 3);
        std::fs::write(&p, "a\nb\nc").unwrap();
        assert_eq!(count_file_lines(&p), 3);
        assert_eq!(count_file_lines(&dir.path().join("missing")), 0);
    }
}
