//! git subprocess 実行と低レベルクエリ（Python 側 `api/git_utils.py` の移植）。
//!
//! Git はライブラリを使わず subprocess のみ（docs/DECISIONS.md）。出力の
//! デコードは UTF-8 + 置換（Python の errors="replace" 相当 = from_utf8_lossy）。

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use crate::config::ConfigStore;
use crate::errors::{bad_request, server_error, timeout_error, ApiError};
use crate::subprocess::coerce_c_locale;

pub const GIT_QUICK_TIMEOUT_SEC: f64 = 5.0;
pub const GIT_SHORT_TIMEOUT_SEC: f64 = 10.0;
pub const GIT_STANDARD_TIMEOUT_SEC: f64 = 30.0;
pub const GIT_LONG_TIMEOUT_SEC: f64 = 60.0;

#[derive(Debug)]
pub struct GitOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Python の TimeoutExpired / OSError に対応するエラー分類。
#[derive(Debug)]
pub enum GitError {
    Timeout,
    Os(String),
}

/// `git <args>` を実行する（Python `run_git_raw` 相当）。
pub async fn run_git_raw(
    args: &[&str],
    cwd: &Path,
    timeout_sec: f64,
    env: &[(&str, &str)],
) -> Result<GitOutput, GitError> {
    let mut command = tokio::process::Command::new("git");
    command.args(args).kill_on_drop(true).current_dir(cwd);
    coerce_c_locale(&mut command);
    for (k, v) in env {
        command.env(k, v);
    }
    let fut = command.output();
    match tokio::time::timeout(Duration::from_secs_f64(timeout_sec), fut).await {
        Ok(Ok(out)) => Ok(GitOutput {
            // シグナル死は Python では負の returncode になる。-1 で代替する。
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        }),
        Ok(Err(e)) => Err(GitError::Os(e.to_string())),
        Err(_) => Err(GitError::Timeout),
    }
}

/// 成功時のみ stdout を返す（Python `_run_git_query` 相当）。
pub async fn run_git_query(args: &[&str], cwd: &Path, timeout_sec: f64) -> Option<String> {
    match run_git_raw(args, cwd, timeout_sec, &[]).await {
        Ok(out) if out.code == 0 => Some(out.stdout),
        _ => None,
    }
}

/// API 応答用の定型 dict（Python `command_result_dict` 相当）。
pub fn command_result_json(out: &GitOutput) -> Value {
    json!({
        "status": if out.code == 0 { "ok" } else { "error" },
        "exit_code": out.code,
        "stdout": out.stdout,
        "stderr": out.stderr,
        "detail": out.stderr,
    })
}

/// git コマンドを実行し定型 dict を返す（Python `run_git_command` 相当）。
/// タイムアウトは 504、OS エラーは 500 に写像する。
pub async fn run_git_command(
    args: &[&str],
    cwd: &Path,
    timeout_sec: f64,
    operation: &str,
    env: &[(&str, &str)],
) -> Result<Value, ApiError> {
    match run_git_raw(args, cwd, timeout_sec, env).await {
        Ok(out) => Ok(command_result_json(&out)),
        Err(GitError::Timeout) => {
            let label = if operation.is_empty() {
                args.iter().take(2).copied().collect::<Vec<_>>().join(" ")
            } else {
                operation.to_string()
            };
            Err(timeout_error(format!("git {label} timed out")))
        }
        Err(GitError::Os(e)) => Err(server_error(format!("git failed to run: {e}"))),
    }
}

/// ref を解決したハッシュ文字列（失敗時は空文字 — Python `rev_parse` 相当）。
pub async fn rev_parse(directory: &Path, git_ref: &str) -> String {
    run_git_query(&["rev-parse", git_ref], directory, GIT_STANDARD_TIMEOUT_SEC)
        .await
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

pub async fn rev_parse_head(directory: &Path) -> String {
    rev_parse(directory, "HEAD").await
}

/// SSH agent ソケットの補完（Python `ssh_env` 相当）。
/// SSH_AUTH_SOCK が未設定なら既知の候補パスを探して環境変数の追加分として返す。
pub fn ssh_env_additions() -> Vec<(String, String)> {
    if std::env::var("SSH_AUTH_SOCK").is_ok_and(|v| !v.is_empty()) {
        return Vec::new();
    }
    // SAFETY: getuid は常に成功する。
    let uid = unsafe { libc::getuid() };
    for cand in [
        format!("/run/user/{uid}/gnupg/S.gpg-agent.ssh"),
        format!("/run/user/{uid}/ssh-agent.socket"),
    ] {
        if std::path::Path::new(&cand).exists() {
            return vec![("SSH_AUTH_SOCK".to_string(), cand)];
        }
    }
    Vec::new()
}

/// リモート（origin）のデフォルトブランチ名（`refs/remotes/origin/HEAD` から解決）。
pub async fn git_default_branch(directory: &Path) -> Option<String> {
    let out = run_git_query(
        &["symbolic-ref", "refs/remotes/origin/HEAD"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await?;
    let git_ref = out.trim();
    git_ref
        .strip_prefix("refs/remotes/origin/")
        .map(String::from)
}

/// ローカルのリモート追跡 ref からリモートブランチ名一覧を返す（読み取り専用）。
pub async fn git_remote_branches(directory: &Path) -> Vec<String> {
    let Some(out) = run_git_query(
        &["for-each-ref", "--format=%(refname)", "refs/remotes"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await
    else {
        tracing::warn!("git_remote_branches failed dir={}", directory.display());
        return Vec::new();
    };
    let mut branches: Vec<String> = Vec::new();
    for git_ref in out.trim().lines() {
        let git_ref = git_ref.trim();
        let Some(b) = git_ref.strip_prefix("refs/remotes/") else {
            continue;
        };
        if b.is_empty() || b.rsplit('/').next() == Some("HEAD") {
            continue;
        }
        let b = match b.split_once('/') {
            Some((_, rest)) => rest,
            None => b,
        };
        if !branches.iter().any(|x| x == b) {
            branches.push(b.to_string());
        }
    }
    branches
}

/// 登録済みワークスペースの resolve 済みパス -> 表示名 の対応表
/// （Python `registered_paths_by_resolved` 相当）。
pub fn registered_paths_by_resolved(
    store: &ConfigStore,
) -> std::collections::HashMap<String, String> {
    let mut result = std::collections::HashMap::new();
    for entry in store.list_workspace_entries().values() {
        let p = entry.get("path").and_then(Value::as_str).unwrap_or("");
        if p.is_empty() {
            continue;
        }
        let resolved = crate::paths::safe_resolve_str(&crate::paths::expand_user_path(p));
        result.insert(
            resolved,
            entry
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        );
    }
    result
}

pub async fn git_branch(directory: &Path) -> Option<String> {
    let out = run_git_query(
        &["rev-parse", "--abbrev-ref", "HEAD"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await?;
    let trimmed = out.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

pub async fn git_is_repo(directory: &Path) -> bool {
    run_git_query(
        &["rev-parse", "--is-inside-work-tree"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await
    .is_some()
}

pub async fn git_branches(directory: &Path) -> Vec<String> {
    match run_git_query(
        &["branch", "--format=%(refname:short)"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await
    {
        Some(out) => out
            .trim()
            .lines()
            .filter(|b| !b.is_empty())
            .map(String::from)
            .collect(),
        None => {
            tracing::warn!("git_branches failed dir={}", directory.display());
            Vec::new()
        }
    }
}

pub fn parse_github_url(remote_url: &str) -> Option<String> {
    if !remote_url.contains("github.com") {
        return None;
    }
    let url = remote_url.strip_suffix(".git").unwrap_or(remote_url);
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        return Some(format!("https://github.com/{rest}"));
    }
    Some(url.to_string())
}

// ─── worktree ───────────────────────────────────────────────────────────────

/// `git worktree list --porcelain` の出力をパースする純粋関数。
pub fn parse_worktree_porcelain(output: &str) -> Vec<Value> {
    let new_entry = |path: &str| {
        json!({
            "path": path, "branch": Value::Null, "head": Value::Null,
            "bare": false, "detached": false, "locked": false,
        })
    };
    let mut worktrees: Vec<Value> = Vec::new();
    let mut current: Option<Value> = None;
    for line in output.lines() {
        if line.trim().is_empty() {
            if let Some(c) = current.take() {
                worktrees.push(c);
            }
        } else if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(c) = current.take() {
                worktrees.push(c);
            }
            current = Some(new_entry(path));
        } else if let Some(c) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") {
                c["head"] = json!(head);
            } else if let Some(branch) = line.strip_prefix("branch ") {
                c["branch"] = json!(branch.strip_prefix("refs/heads/").unwrap_or(branch));
            } else if line == "detached" {
                c["detached"] = json!(true);
            } else if line == "bare" {
                c["bare"] = json!(true);
            } else if line.starts_with("locked") {
                c["locked"] = json!(true);
            }
        }
    }
    if let Some(c) = current.take() {
        worktrees.push(c);
    }
    worktrees
}

pub async fn git_worktree_list(directory: &Path) -> Vec<Value> {
    match run_git_query(
        &["worktree", "list", "--porcelain"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await
    {
        Some(out) => parse_worktree_porcelain(&out),
        None => {
            tracing::warn!("git_worktree_list failed dir={}", directory.display());
            Vec::new()
        }
    }
}

/// worktree 表示名 '{base} [{branch}]' を (base, branch) に分解する。非該当は None。
pub fn split_worktree_name(name: &str) -> Option<(String, String)> {
    // Python: ^(.+?)\s+\[(.+)\]$（非貪欲 base + 空白 + [branch]）
    let stripped = name.strip_suffix(']')?;
    let open = stripped.find('[')?;
    let branch = &stripped[open + 1..];
    let base = stripped[..open].trim_end();
    if base.is_empty() || branch.is_empty() {
        return None;
    }
    // '[' の直前に空白が必要（"a[b]" は非該当）
    if !stripped[..open].ends_with(char::is_whitespace) {
        return None;
    }
    Some((base.to_string(), branch.to_string()))
}

/// 動的worktreeの表示名 '{base} [{branch}]' を組み立てる（split の逆）。
pub fn worktree_display_name(base: &str, branch: &str) -> String {
    format!("{base} [{branch}]")
}

/// '{base} [{branch}]' 形式の動的worktree名からパスを返す（config 未登録の worktree 用）。
pub async fn find_dynamic_worktree_path(store: &ConfigStore, name: &str) -> Option<PathBuf> {
    let (base_name, branch) = split_worktree_name(name)?;
    for entry in store.list_workspace_entries().values() {
        if entry.get("name").and_then(Value::as_str) != Some(base_name.as_str()) {
            continue;
        }
        let raw_path = entry.get("path").and_then(Value::as_str).unwrap_or("");
        let base_path = crate::paths::expand_user_path(raw_path);
        if !base_path.is_dir() {
            continue;
        }
        for wt in git_worktree_list(&base_path).await.iter().skip(1) {
            if wt.get("branch").and_then(Value::as_str) == Some(branch.as_str()) {
                let p = PathBuf::from(wt.get("path").and_then(Value::as_str).unwrap_or(""));
                if p.is_dir() {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// 登録済み git ワークスペースの linked worktree を動的に列挙する
/// （Python `workspaces._dynamic_worktree_entries` の include_github_url=False 版）。
/// config に登録されていない worktree のみを返す。
pub async fn dynamic_worktree_entries(store: &ConfigStore) -> Vec<Value> {
    let existing_paths: std::collections::HashSet<String> =
        registered_paths_by_resolved(store).into_keys().collect();
    let mut out = Vec::new();
    for (ws_id, entry) in store.list_workspace_entries() {
        let raw_path = entry.get("path").and_then(Value::as_str).unwrap_or("");
        let ws_path = crate::paths::expand_user_path(raw_path);
        if !ws_path.is_dir() || !git_is_repo(&ws_path).await {
            continue;
        }
        let base_name = entry
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(&ws_id)
            .to_string();
        for wt in git_worktree_list(&ws_path).await.iter().skip(1) {
            let wt_path_str = wt.get("path").and_then(Value::as_str).unwrap_or("");
            if wt_path_str.is_empty() {
                continue;
            }
            let wt_path = std::path::Path::new(wt_path_str);
            if !wt_path.is_dir()
                || existing_paths.contains(&crate::paths::safe_resolve_str(wt_path))
            {
                continue;
            }
            let branch = wt.get("branch").and_then(Value::as_str).unwrap_or("");
            out.push(json!({
                "id": Value::Null,
                "name": worktree_display_name(&base_name, branch),
                "path": wt_path_str,
                "is_git_repo": true,
                "branch": branch,
                "icon": entry.get("icon").and_then(Value::as_str).unwrap_or(""),
                "icon_color": entry.get("icon_color").and_then(Value::as_str).unwrap_or(""),
                "exists": true,
                "worktree": true,
                "worktree_base": base_name,
                "worktree_branch": branch,
            }));
        }
    }
    out
}

/// workspace 名（ID / 表示名 / 動的worktree名）からパスを解決する
/// （Python `common.resolve_workspace_path` 相当）。
pub async fn resolve_workspace_path(
    store: &ConfigStore,
    workspace: &str,
) -> Result<PathBuf, ApiError> {
    if workspace.is_empty() {
        return Err(bad_request("Workspace not configured: "));
    }
    let cfg = store.load_all();
    let key = ConfigStore::find_workspace_key(&cfg, workspace);
    let ws_path_str = key
        .and_then(|k| cfg.get(&k).cloned())
        .and_then(|e| e.get("path").and_then(Value::as_str).map(String::from))
        .unwrap_or_default();
    if !ws_path_str.is_empty() {
        let ws_path = crate::paths::expand_user_path(&ws_path_str);
        if !ws_path.is_dir() {
            return Err(bad_request(format!("Workspace not found: {workspace}")));
        }
        return Ok(ws_path);
    }
    if let Some(dynamic) = find_dynamic_worktree_path(store, workspace).await {
        return Ok(dynamic);
    }
    Err(bad_request(format!(
        "Workspace not configured: {workspace}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_url_parsing() {
        assert_eq!(
            parse_github_url("git@github.com:owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
        assert_eq!(
            parse_github_url("https://github.com/owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
        assert!(parse_github_url("https://gitlab.com/x/y.git").is_none());
    }

    #[test]
    fn worktree_porcelain_parsing() {
        let out = "worktree /home/u/main\nHEAD abc123\nbranch refs/heads/main\n\nworktree /home/u/wt\nHEAD def456\ndetached\nlocked reason\n";
        let wts = parse_worktree_porcelain(out);
        assert_eq!(wts.len(), 2);
        assert_eq!(wts[0]["path"], "/home/u/main");
        assert_eq!(wts[0]["branch"], "main");
        assert_eq!(wts[1]["detached"], true);
        assert_eq!(wts[1]["locked"], true);
        assert_eq!(wts[1]["branch"], Value::Null);
    }

    #[test]
    fn worktree_name_split_roundtrip() {
        assert_eq!(
            split_worktree_name("proj [feat/x]"),
            Some(("proj".to_string(), "feat/x".to_string()))
        );
        assert_eq!(
            split_worktree_name("a b [c]"),
            Some(("a b".to_string(), "c".to_string()))
        );
        assert_eq!(split_worktree_name("plain-name"), None);
        assert_eq!(split_worktree_name("a[b]"), None);
        assert_eq!(worktree_display_name("proj", "feat/x"), "proj [feat/x]");
    }

    #[tokio::test]
    async fn git_raw_and_queries_on_real_repo() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@example.com"],
            vec!["config", "user.name", "t"],
            vec!["commit", "--allow-empty", "-q", "-m", "first"],
        ] {
            let r = run_git_raw(&args, p, 10.0, &[]).await.unwrap();
            assert_eq!(r.code, 0, "{args:?}: {}", r.stderr);
        }
        assert!(git_is_repo(p).await);
        assert_eq!(git_branch(p).await.as_deref(), Some("main"));
        assert_eq!(git_branches(p).await, vec!["main".to_string()]);
        let cmd = run_git_command(&["log", "--oneline"], p, 10.0, "log", &[])
            .await
            .unwrap();
        assert_eq!(cmd["status"], "ok");
        assert!(cmd["stdout"].as_str().unwrap().contains("first"));
    }
}
