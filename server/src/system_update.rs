//! `GET /system/update/check`・`POST /system/update/apply` — セルフアップデート
//! （`system.rs` から分離）。git clone 構成のみ対象（バイナリ配布では
//! `updatable: false` になり UI から呼ばれない）。

use std::path::Path;
use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};

use crate::auth::RequireAuth;
use crate::errors::{conflict, server_error, ApiError};
use crate::state::AppState;
use crate::subprocess::SYSTEM_CMD_TIMEOUT_SEC;
use crate::system::{ensure_git_repo, get_app_release, git, git_out};

const GIT_FETCH_TIMEOUT_SEC: f64 = 30.0;

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
