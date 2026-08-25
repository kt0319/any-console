//! ブランチ操作 API（Python 側 `api/routers/git_branches.py` の移植）。
//!
//! push / pull / fetch は SSH agent ソケットの補完（`ssh_env_additions`）付きで
//! 実行する。pull は Python の RLock 再入に相当する箇所をロック1回取得の
//! 直列コードに展開している（tokio Mutex は非再入のため）。

use std::path::Path as FsPath;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::activity::log_activity;
use crate::auth::RequireAuth;
use crate::errors::{bad_request, ApiError};
use crate::git_helpers::{
    activity_fields, execute_git_action, execute_git_action_with_activity, validate_branch_name,
    validate_commit_ref,
};
use crate::git_utils::{
    git_branch, git_branches, git_default_branch, git_remote_branches, resolve_workspace_path,
    rev_parse, run_git_command, ssh_env_additions, GIT_LONG_TIMEOUT_SEC, GIT_STANDARD_TIMEOUT_SEC,
};
use crate::state::AppState;
use crate::util::JsonBody;

const COMMIT_PREVIEW_LIMIT: usize = 3;

fn env_refs(env: &[(String, String)]) -> Vec<(&str, &str)> {
    env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
}

async fn get_current_branch(ws_path: &FsPath) -> Result<String, ApiError> {
    git_branch(ws_path)
        .await
        .ok_or_else(|| bad_request("Cannot get current branch"))
}

/// リビジョン範囲を指定する引数列（例: `["abcd..HEAD"]`）のコミット件数と
/// 直近メッセージを返す。`git log`/`git rev-list` の両方に同じリビジョン
/// 指定を渡す（`--count` の有無以外は共通）。
async fn commits_for(ws_path: &FsPath, revs: &[&str]) -> Result<Value, ApiError> {
    let limit = COMMIT_PREVIEW_LIMIT.to_string();
    let mut log_args: Vec<&str> = vec!["log"];
    log_args.extend_from_slice(revs);
    log_args.extend_from_slice(&["--pretty=format:%s", "-n", &limit]);
    let log = run_git_command(
        &log_args,
        ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "log range",
        &[],
    )
    .await?;

    let mut count_args: Vec<&str> = vec!["rev-list", "--count"];
    count_args.extend_from_slice(revs);
    let count_res = run_git_command(
        &count_args,
        ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "rev-list count",
        &[],
    )
    .await?;
    if log["exit_code"] != 0 || count_res["exit_code"] != 0 {
        return Ok(json!({"count": 0, "messages": []}));
    }
    let count = count_res["stdout"]
        .as_str()
        .unwrap_or("")
        .trim()
        .parse::<i64>()
        .unwrap_or(0);
    let messages: Vec<&str> = log["stdout"]
        .as_str()
        .unwrap_or("")
        .lines()
        .filter(|l| !l.is_empty())
        .collect();
    Ok(json!({"count": count, "messages": messages}))
}

/// range_expr（例: "abcd..HEAD"）のコミット件数と直近メッセージを返す。
async fn commits_between(ws_path: &FsPath, range_expr: &str) -> Result<Value, ApiError> {
    commits_for(ws_path, &[range_expr]).await
}

/// upstream が未設定の初回pushで使う: HEAD から到達可能だが、どのリモート
/// 追跡ブランチにも含まれないコミットを返す（比較対象となる単一refが
/// push -u で初めて作られるため、`commits_between` の範囲式が使えない）。
async fn commits_not_on_any_remote(ws_path: &FsPath) -> Result<Value, ApiError> {
    commits_for(ws_path, &["HEAD", "--not", "--remotes"]).await
}

// ─── upstream 追跡情報のパース ──────────────────────────────────────────────

pub fn parse_upstream_track(track: &str) -> Value {
    let mut body = track.trim();
    if body.starts_with('[') && body.ends_with(']') {
        body = &body[1..body.len() - 1];
    }
    if body.is_empty() {
        return json!({"ahead": 0, "behind": 0, "gone": false});
    }
    if body == "gone" {
        return json!({"ahead": 0, "behind": 0, "gone": true});
    }
    let mut ahead = 0i64;
    let mut behind = 0i64;
    for part in body.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(ahead);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(behind);
        }
    }
    json!({"ahead": ahead, "behind": behind, "gone": false})
}

async fn branch_tracking_info(ws_path: &FsPath) -> Result<Map<String, Value>, ApiError> {
    let res = run_git_command(
        &[
            "for-each-ref",
            "--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname)",
            "refs/heads",
        ],
        ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "for-each-ref upstream",
        &[],
    )
    .await?;
    let mut info = Map::new();
    if res["exit_code"] != 0 {
        return Ok(info);
    }
    for line in res["stdout"].as_str().unwrap_or("").lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() != 4 {
            continue;
        }
        let (name, upstream, track, tip) = (parts[0], parts[1], parts[2], parts[3]);
        let mut entry = parse_upstream_track(track);
        entry["upstream"] = if upstream.is_empty() {
            Value::Null
        } else {
            json!(upstream)
        };
        entry["tip"] = json!(tip);
        info.insert(name.to_string(), entry);
    }
    Ok(info)
}

/// upstream 未設定ブランチの「未 push 件数」を 1 回の rev-list --parents で数える
/// （Python `_unpublished_commit_counts` と同一アルゴリズム）。
pub fn count_unpublished(parents_output: &str, tips: &Map<String, Value>) -> Map<String, Value> {
    let mut parents: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
    for line in parents_output.lines() {
        let mut hashes = line.split_whitespace();
        if let Some(head) = hashes.next() {
            parents.insert(head, hashes.collect());
        }
    }
    let mut counts = Map::new();
    for (branch, tip) in tips {
        let tip = tip.as_str().unwrap_or("");
        if !parents.contains_key(tip) {
            counts.insert(branch.clone(), json!(0));
            continue;
        }
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        seen.insert(tip);
        let mut stack = vec![tip];
        while let Some(current) = stack.pop() {
            for parent in parents.get(current).map(|v| v.as_slice()).unwrap_or(&[]) {
                // 表に無い親は origin 到達済み＝そこで打ち切る（数えない）
                if parents.contains_key(parent) && seen.insert(parent) {
                    stack.push(parent);
                }
            }
        }
        counts.insert(branch.clone(), json!(seen.len() as i64));
    }
    counts
}

// ─── GET /workspaces/{name}/branches ────────────────────────────────────────

pub async fn list_branches(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let branches = git_branches(&ws_path).await;
    let current = git_branch(&ws_path).await;
    let default_branch = git_default_branch(&ws_path).await;
    let tracking = branch_tracking_info(&ws_path).await?;

    let mut no_upstream_tips = Map::new();
    for b in &branches {
        if let Some(t) = tracking.get(b) {
            let has_upstream = t.get("upstream").is_some_and(|u| !u.is_null());
            let tip = t.get("tip").and_then(Value::as_str).unwrap_or("");
            if !has_upstream && !tip.is_empty() {
                no_upstream_tips.insert(b.clone(), json!(tip));
            }
        }
    }
    let unpublished = if no_upstream_tips.is_empty() {
        Map::new()
    } else {
        let res = run_git_command(
            &[
                "rev-list",
                "--branches",
                "--not",
                "--remotes=origin",
                "--parents",
            ],
            &ws_path,
            GIT_STANDARD_TIMEOUT_SEC,
            "rev-list unpublished",
            &[],
        )
        .await?;
        if res["exit_code"] != 0 {
            no_upstream_tips
                .keys()
                .map(|b| (b.clone(), json!(0)))
                .collect()
        } else {
            count_unpublished(res["stdout"].as_str().unwrap_or(""), &no_upstream_tips)
        }
    };

    let mut out = Vec::new();
    for b in &branches {
        let t = tracking.get(b).cloned().unwrap_or(json!({}));
        let upstream = t.get("upstream").cloned().unwrap_or(Value::Null);
        let ahead = if upstream.is_null() {
            unpublished.get(b).cloned().unwrap_or(json!(0))
        } else {
            t.get("ahead").cloned().unwrap_or(json!(0))
        };
        out.push(json!({
            "name": b,
            "current": Some(b.as_str()) == current.as_deref(),
            "is_default": Some(b.as_str()) == default_branch.as_deref(),
            "upstream": upstream,
            "ahead": ahead,
            "behind": t.get("behind").cloned().unwrap_or(json!(0)),
            "gone": t.get("gone").cloned().unwrap_or(json!(false)),
        }));
    }
    Ok(Json(Value::Array(out)))
}

pub async fn list_remote_branches(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    // 読み取り専用。リモート追跡 ref の更新は POST /workspaces/{name}/fetch が担う
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    Ok(Json(json!(git_remote_branches(&ws_path).await)))
}

// ─── ブランチ CRUD / checkout ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DeleteBranchRequest {
    branch: String,
    #[serde(default)]
    remote: bool,
}

#[derive(Deserialize)]
pub struct CheckoutRequest {
    branch: String,
    #[serde(default)]
    start_point: Option<String>,
    #[serde(default)]
    base_branch: Option<String>,
}

pub async fn delete_branch(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<DeleteBranchRequest>,
) -> Result<Json<Value>, ApiError> {
    let branch = validate_branch_name(&body.branch)?;
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    if body.remote {
        let remote_ref = format!("origin/{branch}");
        let before_hash = rev_parse(&ws_path, &remote_ref).await;
        let env = ssh_env_additions();
        return execute_git_action_with_activity(
            &state,
            &name,
            &ws_path,
            &["push", "origin", "--delete", &branch],
            "delete remote branch",
            "git_delete_branch",
            &env_refs(&env),
            &format!("branch={branch}"),
            false,
            activity_fields(&[
                ("branch", json!(branch)),
                ("remote", json!(true)),
                ("commit", json!(before_hash)),
            ]),
        )
        .await
        .map(Json);
    }
    if branch == get_current_branch(&ws_path).await? {
        return Err(bad_request("Cannot delete the current branch"));
    }
    let before_hash = rev_parse(&ws_path, &branch).await;
    execute_git_action_with_activity(
        &state,
        &name,
        &ws_path,
        &["branch", "-D", &branch],
        "delete branch",
        "git_delete_branch",
        &[],
        &format!("branch={branch}"),
        false,
        activity_fields(&[
            ("branch", json!(branch)),
            ("remote", json!(false)),
            ("commit", json!(before_hash)),
        ]),
    )
    .await
    .map(Json)
}

pub async fn create_branch(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<CheckoutRequest>,
) -> Result<Json<Value>, ApiError> {
    let branch = validate_branch_name(&body.branch)?;
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let mut args = vec!["checkout".to_string(), "-b".to_string(), branch.clone()];
    if let Some(sp) = body.start_point.as_deref().filter(|s| !s.is_empty()) {
        args.push(validate_commit_ref(sp)?);
    } else if let Some(bb) = body.base_branch.as_deref().filter(|s| !s.is_empty()) {
        args.push(validate_branch_name(bb)?);
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    execute_git_action_with_activity(
        &state,
        &name,
        &ws_path,
        &arg_refs,
        "create-branch",
        "git_create_branch",
        &[],
        &format!("branch={branch}"),
        true,
        activity_fields(&[("branch", json!(branch))]),
    )
    .await
    .map(Json)
}

pub async fn checkout_branch(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<CheckoutRequest>,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let branch = validate_branch_name(&body.branch)?;
    let local_branches = git_branches(&ws_path).await;
    let origin_ref = format!("origin/{branch}");
    let args: Vec<&str> = if local_branches.contains(&branch) {
        vec!["checkout", &branch]
    } else {
        vec!["checkout", "-b", &branch, &origin_ref]
    };
    execute_git_action_with_activity(
        &state,
        &name,
        &ws_path,
        &args,
        "checkout",
        "git_checkout",
        &[],
        &format!("branch={branch}"),
        true,
        activity_fields(&[("branch", json!(branch))]),
    )
    .await
    .map(Json)
}

// ─── pull / push / fetch ────────────────────────────────────────────────────

async fn stash_if_dirty(ws_path: &FsPath, env: &[(&str, &str)]) -> Result<bool, ApiError> {
    let dirty = run_git_command(
        &["status", "--porcelain"],
        ws_path,
        GIT_STANDARD_TIMEOUT_SEC,
        "status",
        &[],
    )
    .await?;
    if dirty["stdout"].as_str().unwrap_or("").trim().is_empty() {
        return Ok(false);
    }
    let result = run_git_command(&["stash"], ws_path, GIT_LONG_TIMEOUT_SEC, "stash", env).await?;
    Ok(result["exit_code"] == 0)
}

async fn unstash(
    ws_path: &FsPath,
    env: &[(&str, &str)],
    result: &mut Value,
) -> Result<(), ApiError> {
    let pop = run_git_command(
        &["stash", "pop"],
        ws_path,
        GIT_LONG_TIMEOUT_SEC,
        "stash pop",
        env,
    )
    .await?;
    if pop["exit_code"] != 0 {
        let stderr = result["stderr"].as_str().unwrap_or("").to_string();
        result["stderr"] = json!(format!(
            "{stderr}\n⚠️ stash pop failed:\n{}",
            pop["stderr"].as_str().unwrap_or("")
        ));
    }
    Ok(())
}

pub async fn pull(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    // Python は外側の workspace_write_lock + execute_git_action の RLock 再入。
    // tokio Mutex は非再入のためロック1回で直列に実行する。
    let _guard = state.git_locks.acquire(&name).await?;
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let env_owned = ssh_env_additions();
    let env = env_refs(&env_owned);
    let before_hash = rev_parse(&ws_path, "HEAD").await;
    let before_upstream = rev_parse(&ws_path, "@{u}").await;
    let stashed = stash_if_dirty(&ws_path, &env).await?;
    let mut result = run_git_command(
        &["pull", "--rebase"],
        &ws_path,
        GIT_LONG_TIMEOUT_SEC,
        "pull",
        &env,
    )
    .await?;
    tracing::info!("git pull workspace={} rc={}", name, result["exit_code"]);
    // Python は execute_git_action 内で invalidate する（unstash より前）
    crate::git_helpers::invalidate_and_publish_git_info(&state, &name, &ws_path);
    if stashed {
        unstash(&ws_path, &env, &mut result).await?;
    }
    if result["status"] == "ok" && !before_hash.is_empty() {
        let after_upstream = if before_upstream.is_empty() {
            String::new()
        } else {
            rev_parse(&ws_path, "@{u}").await
        };
        // pull前のHEAD（before_hash）を起点に数える。before_upstream..after_upstream
        // だと、auto_fetch_loop（git_watch.rs）のバックグラウンドfetchで
        // pullボタンを押す前に既にupstreamが最新化されているケースで差分が
        // 0になり、実際には新しいコミットを取り込んだのに「Already up to
        // date」と誤表示していた。before_hashを起点にすればfetchのタイミングに
        // 依らず正しく数えられ、--rebaseでローカル未push分のハッシュが
        // 書き換わっても（それらはafter_upstreamに含まれないため）誤カウント
        // しない。
        result["commits"] = if !after_upstream.is_empty() {
            commits_between(&ws_path, &format!("{before_hash}..{after_upstream}")).await?
        } else {
            commits_between(&ws_path, &format!("{before_hash}..HEAD")).await?
        };
        let after_hash = rev_parse(&ws_path, "HEAD").await;
        log_activity(
            &state.paths.data_dir,
            Some(&name),
            "git_pull",
            activity_fields(&[
                ("from_commit", json!(before_hash)),
                ("commit", json!(after_hash)),
            ]),
        );
    }
    Ok(Json(result))
}

pub async fn push(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let before_hash = rev_parse(&ws_path, "@{u}").await;
    let pending = commits_between(&ws_path, "@{u}..HEAD").await?;
    let env_owned = ssh_env_additions();
    let mut result = execute_git_action(
        &state,
        &name,
        &ws_path,
        &["push"],
        "push",
        &env_refs(&env_owned),
        "",
    )
    .await?;
    if result["status"] == "ok" {
        result["commits"] = pending;
        let commit = rev_parse(&ws_path, "HEAD").await;
        log_activity(
            &state.paths.data_dir,
            Some(&name),
            "git_push",
            activity_fields(&[
                ("from_commit", json!(before_hash)),
                ("commit", json!(commit)),
            ]),
        );
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct PushBranchRequest {
    branch: String,
}

pub async fn push_branch(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<PushBranchRequest>,
) -> Result<Json<Value>, ApiError> {
    let branch = validate_branch_name(&body.branch)?;
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let before_hash = rev_parse(&ws_path, &format!("origin/{branch}")).await;
    let pending = commits_between(&ws_path, &format!("origin/{branch}..{branch}")).await?;
    let env_owned = ssh_env_additions();
    let refspec = format!("{branch}:{branch}");
    let mut result = execute_git_action(
        &state,
        &name,
        &ws_path,
        &["push", "-u", "origin", &refspec],
        "push branch",
        &env_refs(&env_owned),
        &format!("branch={branch}"),
    )
    .await?;
    if result["status"] == "ok" {
        result["commits"] = pending;
        let commit = rev_parse(&ws_path, &branch).await;
        log_activity(
            &state.paths.data_dir,
            Some(&name),
            "git_push",
            activity_fields(&[
                ("branch", json!(branch)),
                ("from_commit", json!(before_hash)),
                ("commit", json!(commit)),
            ]),
        );
    }
    Ok(Json(result))
}

pub async fn set_upstream(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let branch = get_current_branch(&ws_path).await?;
    let env_owned = ssh_env_additions();
    let upstream_ref = format!("origin/{branch}");
    execute_git_action_with_activity(
        &state,
        &name,
        &ws_path,
        &["branch", "--set-upstream-to", &upstream_ref],
        "set upstream",
        "git_set_upstream",
        &env_refs(&env_owned),
        &format!("branch={branch}"),
        false,
        activity_fields(&[("branch", json!(branch))]),
    )
    .await
    .map(Json)
}

pub async fn push_upstream(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let pending = commits_not_on_any_remote(&ws_path).await?;
    let env_owned = ssh_env_additions();
    let mut result = execute_git_action_with_activity(
        &state,
        &name,
        &ws_path,
        &["push", "-u", "origin", "HEAD"],
        "push upstream",
        "git_push",
        &env_refs(&env_owned),
        "",
        true,
        Map::new(),
    )
    .await?;
    if result["status"] == "ok" {
        result["commits"] = pending;
    }
    Ok(Json(result))
}

pub async fn fetch(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, &name).await?;
    let env_owned = ssh_env_additions();
    execute_git_action_with_activity(
        &state,
        &name,
        &ws_path,
        &["fetch", "--prune"],
        "fetch",
        "git_fetch",
        &env_refs(&env_owned),
        "",
        false,
        Map::new(),
    )
    .await
    .map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_track_parsing() {
        assert_eq!(
            parse_upstream_track("[ahead 2, behind 3]"),
            json!({"ahead": 2, "behind": 3, "gone": false})
        );
        assert_eq!(
            parse_upstream_track("[gone]"),
            json!({"ahead": 0, "behind": 0, "gone": true})
        );
        assert_eq!(
            parse_upstream_track(""),
            json!({"ahead": 0, "behind": 0, "gone": false})
        );
        assert_eq!(
            parse_upstream_track("[ahead 5]"),
            json!({"ahead": 5, "behind": 0, "gone": false})
        );
    }

    #[test]
    fn unpublished_counts_stop_at_origin_reachable() {
        // c3 -> c2 -> c1 -> (origin到達済み c0)
        let parents_out = "c3 c2\nc2 c1\nc1 c0\n";
        let mut tips = Map::new();
        tips.insert("feat".to_string(), json!("c3"));
        tips.insert("old".to_string(), json!("c1"));
        tips.insert("published".to_string(), json!("c0"));
        let counts = count_unpublished(parents_out, &tips);
        assert_eq!(counts["feat"], 3);
        assert_eq!(counts["old"], 1);
        assert_eq!(counts["published"], 0, "表に無い tip は origin 到達済み");
    }
}
