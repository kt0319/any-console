//! git worktree の作成・一覧・削除（Python 側 `api/routers/git_worktree.py` の移植）。
//!
//! worktree を作成すると、その作業ツリーは動的 worktree 名（'{base}:{branch}'）で
//! 参照できる。作成・削除後は Python と同じ位置で `invalidate_and_publish_git_info`
//! （ローカルキャッシュ無効化 + Python 側 status stream への nudge）を呼ぶ。

use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::RequireAuth;
use crate::errors::{bad_request, conflict, not_found, ApiError};
use crate::git_helpers::validate_branch_name;
use crate::git_utils::{
    git_branches, git_is_repo, git_worktree_list, registered_paths_by_resolved,
    resolve_workspace_path, run_git_command, worktree_display_name, GIT_LONG_TIMEOUT_SEC,
};
use crate::paths::safe_resolve_str;
use crate::state::AppState;
use crate::util::JsonBody;

/// ワークスペース名/ディレクトリ名に使える文字へ正規化する。
fn sanitize_segment(value: &str) -> String {
    let mut cleaned = String::new();
    let mut prev_dash = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
            cleaned.push(c);
            prev_dash = false;
        } else if !prev_dash {
            // 連続する不正文字は 1 つの '-' へ（Python の正規表現 [^...]+ → "-" と同一）
            cleaned.push('-');
            prev_dash = true;
        }
    }
    let cleaned = cleaned
        .trim_matches(|c| matches!(c, '-' | '.' | '_'))
        .to_string();
    if cleaned.is_empty() {
        "wt".to_string()
    } else {
        cleaned
    }
}

fn main_worktree_path(worktrees: &[Value]) -> Option<PathBuf> {
    worktrees
        .first()
        .and_then(|wt| wt.get("path").and_then(Value::as_str))
        .map(PathBuf::from)
}

async fn resolve_git_repo_path(state: &Arc<AppState>, name: &str) -> Result<PathBuf, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    if !git_is_repo(&ws_path).await {
        return Err(bad_request(format!(
            "Workspace '{name}' is not a git repository"
        )));
    }
    Ok(ws_path)
}

pub async fn list_worktrees(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_git_repo_path(&state, &name).await?;
    let worktrees = git_worktree_list(&ws_path).await;
    let registered = registered_paths_by_resolved(&state.config);
    let main_path = main_worktree_path(&worktrees);
    let mut items = Vec::new();
    for wt in &worktrees {
        let path = wt.get("path").and_then(Value::as_str).unwrap_or("");
        let resolved = safe_resolve_str(FsPath::new(path));
        let is_main = main_path.as_deref() == Some(FsPath::new(path));
        items.push(json!({
            "path": path,
            "branch": wt.get("branch").cloned().unwrap_or(Value::Null),
            "head": wt.get("head").cloned().unwrap_or(Value::Null),
            "detached": wt.get("detached").cloned().unwrap_or(json!(false)),
            "bare": wt.get("bare").cloned().unwrap_or(json!(false)),
            "locked": wt.get("locked").cloned().unwrap_or(json!(false)),
            "is_main": is_main,
            "workspace": registered.get(&resolved).cloned().map(Value::String).unwrap_or(Value::Null),
        }));
    }
    Ok(Json(json!({"worktrees": items})))
}

#[derive(Deserialize)]
pub struct CreateWorktreeRequest {
    branch: String,
    #[serde(default)]
    base: Option<String>,
}

pub async fn create_worktree(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<CreateWorktreeRequest>,
) -> Result<Json<Value>, ApiError> {
    let branch = validate_branch_name(&body.branch)?;
    let base = match body.base.as_deref().filter(|b| !b.is_empty()) {
        Some(b) => Some(validate_branch_name(b)?),
        None => None,
    };

    let _guard = state.git_locks.acquire(&name).await?;
    let ws_path = resolve_git_repo_path(&state, &name).await?;
    let worktrees = git_worktree_list(&ws_path).await;
    let main_path = main_worktree_path(&worktrees).unwrap_or_else(|| ws_path.clone());

    // メイン作業ツリー内の ".worktrees/<safe-branch>" に作る
    let target = main_path.join(".worktrees").join(sanitize_segment(&branch));
    if target.exists() {
        return Err(conflict(format!(
            "Worktree path already exists: {}",
            target.display()
        )));
    }

    let target_str = target.to_string_lossy().into_owned();
    let existing_branches = git_branches(&ws_path).await;
    let mut args: Vec<&str> = if existing_branches.contains(&branch) {
        vec!["worktree", "add", &target_str, &branch]
    } else {
        vec!["worktree", "add", &target_str, "-b", &branch]
    };
    if !existing_branches.contains(&branch) {
        if let Some(b) = base.as_deref() {
            args.push(b);
        }
    }

    let result =
        run_git_command(&args, &ws_path, GIT_LONG_TIMEOUT_SEC, "worktree add", &[]).await?;
    crate::git_helpers::invalidate_and_publish_git_info(&state, &name, &ws_path);
    crate::git_helpers::ensure_git_result_ok(&result, "Failed to create worktree")?;

    let base_config = state.config.load_workspace_config(&name);
    let base_display = base_config
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(&name);
    let display_name = worktree_display_name(base_display, &branch);
    tracing::info!(
        "worktree created workspace={} branch={} path={}",
        name,
        branch,
        target.display()
    );

    Ok(Json(json!({
        "status": "ok",
        "workspace": {"name": display_name, "path": target_str, "branch": branch},
    })))
}

#[derive(Deserialize)]
pub struct DeleteWorktreeRequest {
    path: String,
    #[serde(default)]
    force: bool,
}

pub async fn delete_worktree(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<DeleteWorktreeRequest>,
) -> Result<Json<Value>, ApiError> {
    let _guard = state.git_locks.acquire(&name).await?;
    let ws_path = resolve_git_repo_path(&state, &name).await?;
    let worktrees = git_worktree_list(&ws_path).await;
    let main_path = main_worktree_path(&worktrees);

    let target = FsPath::new(&body.path);
    let target_resolved = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());

    // 対象がこのリポジトリの worktree であることを検証（任意パス削除を防ぐ）
    let known: std::collections::HashSet<PathBuf> = worktrees
        .iter()
        .filter_map(|wt| wt.get("path").and_then(Value::as_str))
        .map(|p| {
            let path = FsPath::new(p);
            path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
        })
        .collect();
    if !known.contains(&target_resolved) && !known.contains(&target.to_path_buf()) {
        return Err(not_found("Worktree not found for this repository"));
    }
    if let Some(main) = &main_path {
        let main_resolved = main.canonicalize().unwrap_or_else(|_| main.clone());
        if target_resolved == main_resolved {
            return Err(bad_request("Cannot remove the main worktree"));
        }
    }

    let mut args = vec!["worktree", "remove", &body.path];
    if body.force {
        args.push("--force");
    }
    let result = run_git_command(
        &args,
        &ws_path,
        GIT_LONG_TIMEOUT_SEC,
        "worktree remove",
        &[],
    )
    .await?;
    crate::git_helpers::invalidate_and_publish_git_info(&state, &name, &ws_path);
    crate::git_helpers::ensure_git_result_ok(&result, "Failed to remove worktree")?;
    // 削除自体は成功しても、過去の失敗した削除試行や外部からの手動削除で
    // .git/worktrees/<id> のメタデータだけが孤立して残っていることがある。
    // pruneは対象が無くても無害なので、ベストエフォートで毎回実行しておく
    // （失敗してもこの削除操作自体は成功扱いのまま進める）。
    let _ = run_git_command(
        &["worktree", "prune"],
        &ws_path,
        GIT_LONG_TIMEOUT_SEC,
        "worktree prune",
        &[],
    )
    .await;
    tracing::info!("worktree removed workspace={} path={}", name, body.path);
    Ok(Json(json!({"status": "ok"})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_sanitization() {
        assert_eq!(sanitize_segment("feat/some branch!"), "feat-some-branch");
        assert_eq!(sanitize_segment("ok_name-1.2"), "ok_name-1.2");
        assert_eq!(sanitize_segment("///"), "wt");
        assert_eq!(sanitize_segment("-.leading"), "leading");
    }
}
