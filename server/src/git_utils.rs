//! git subprocess 実行と低レベルクエリ（Python 側 `api/git_utils.py` の移植）。
//!
//! Git はライブラリを使わず subprocess のみ（docs/DECISIONS.md）。出力の
//! デコードは UTF-8 + 置換（Python の errors="replace" 相当 = from_utf8_lossy）。

use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::config::ConfigStore;
use crate::errors::{bad_request, server_error, timeout_error, ApiError};
use crate::subprocess::coerce_c_locale;

pub const GIT_QUICK_TIMEOUT_SEC: f64 = 5.0;
pub const GIT_SHORT_TIMEOUT_SEC: f64 = 10.0;
pub const GIT_STANDARD_TIMEOUT_SEC: f64 = 30.0;
pub const GIT_LONG_TIMEOUT_SEC: f64 = 60.0;
pub const BACKGROUND_FETCH_TIMEOUT_SEC: f64 = 15.0;
/// ワークスペースにアイコンが未設定（空文字/キー欠如）の時のデフォルト値。
/// 未設定のままだとタブバー等でjob側アイコンだけが表示され、あたかも
/// jobアイコンがワークスペースを代表しているように見えてしまうため、
/// 読み出し時点で必ず埋める（`ui/components/WorkspaceEditPane.vue` の
/// `DEFAULT_WS_ICON` と同じ値）。
pub const DEFAULT_WORKSPACE_ICON: &str = "mdi-console";

/// バックグラウンドの `git fetch --quiet` を実行し、実行できたかを返す
/// （Python `background_fetch` 相当 — 終了コードは見ない。タイムアウト・OS
/// エラーのみ false）。GIT_TERMINAL_PROMPT=0 で認証プロンプトを無効化する。
pub async fn background_fetch(directory: &Path) -> bool {
    run_git_raw(
        &["fetch", "--quiet"],
        directory,
        BACKGROUND_FETCH_TIMEOUT_SEC,
        &[("GIT_TERMINAL_PROMPT", "0")],
    )
    .await
    .is_ok()
}

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

/// git コマンドの共通実行設定（C ロケール強制・kill_on_drop・cwd・追加 env）。
/// C ロケール強制を経路ごとに書き忘れると、ロケール依存の出力差で
/// サニタイズが壊れる回帰を生むため必ずここを通す（subprocess.rs 参照）。
fn git_command(args: &[&str], cwd: &Path, env: &[(&str, &str)]) -> tokio::process::Command {
    let mut command = tokio::process::Command::new("git");
    command.args(args).kill_on_drop(true).current_dir(cwd);
    coerce_c_locale(&mut command);
    for (k, v) in env {
        command.env(k, v);
    }
    command
}

/// `git <args>` を実行する（Python `run_git_raw` 相当）。
pub async fn run_git_raw(
    args: &[&str],
    cwd: &Path,
    timeout_sec: f64,
    env: &[(&str, &str)],
) -> Result<GitOutput, GitError> {
    let fut = git_command(args, cwd, env).output();
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

/// バイナリ安全な raw 実行（stdout をバイト列のまま返す。`run_git_raw` は
/// from_utf8_lossy で潰すためファイル内容の取得には使えない）。
pub async fn run_git_raw_bytes(
    args: &[&str],
    cwd: &Path,
    timeout_sec: f64,
) -> Result<(i32, Vec<u8>), GitError> {
    let fut = git_command(args, cwd, &[]).output();
    match tokio::time::timeout(Duration::from_secs_f64(timeout_sec), fut).await {
        Ok(Ok(out)) => Ok((out.status.code().unwrap_or(-1), out.stdout)),
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
fn command_result_json(out: &GitOutput) -> Value {
    json!({
        "status": if out.code == 0 { "ok" } else { "error" },
        "exit_code": out.code,
        "stdout": out.stdout,
        "stderr": out.stderr,
        "detail": out.stderr,
    })
}

/// `GitError` を API エラーへ写像する共通規則: タイムアウトは 504
/// `"{op_label} timed out"`、OS エラーは 500 `"{op_label} failed: {e}"`。
/// 呼び出し箇所ごとに文言がばらけないよう、変換は必ずここを通す。
pub fn map_git_error(e: GitError, op_label: &str) -> ApiError {
    match e {
        GitError::Timeout => timeout_error(format!("{op_label} timed out")),
        GitError::Os(e) => server_error(format!("{op_label} failed: {e}")),
    }
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
        Err(e) => {
            let label = if operation.is_empty() {
                args.iter().take(2).copied().collect::<Vec<_>>().join(" ")
            } else {
                operation.to_string()
            };
            Err(map_git_error(e, &format!("git {label}")))
        }
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

/// origin の remote URL から GitHub URL を解決する（Python `git_github_url` 相当）。
pub async fn git_github_url(directory: &Path) -> Option<String> {
    let out = run_git_query(
        &["remote", "get-url", "origin"],
        directory,
        GIT_QUICK_TIMEOUT_SEC,
    )
    .await?;
    parse_github_url(out.trim())
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

/// worktree 表示名 '{base}:{branch}' を (base, branch) に分解する。非該当は None。
/// worktreeのワークスペース名 "base:branch" を base/branch に分解する。
/// コロン区切りはgitのブランチ名規則がコロンを禁止しているため、
/// 区切り文字とブランチ名が衝突しない（非貪欲に最初の':'で区切る）。
pub fn split_worktree_name(name: &str) -> Option<(String, String)> {
    let (base, branch) = name.split_once(':')?;
    if base.is_empty() || branch.is_empty() {
        return None;
    }
    Some((base.to_string(), branch.to_string()))
}

/// 動的worktreeのワークスペース名 'base:branch' を組み立てる（split の逆）。
pub fn worktree_display_name(base: &str, branch: &str) -> String {
    format!("{base}:{branch}")
}

/// worktree 表示名ならベース名を、そうでなければ名前をそのまま返す。
pub fn worktree_base_of(name: &str) -> String {
    split_worktree_name(name)
        .map(|(base, _)| base)
        .unwrap_or_else(|| name.to_string())
}

/// '{base}:{branch}' 形式の動的worktree名からパスを返す（config 未登録の worktree 用）。
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

/// cwd を登録済みワークスペース（および、その配下の動的 worktree）と照合する。
/// `ConfigStore::match_workspace_by_path` はベースワークスペースの登録パスとの
/// 前方一致しか見ないため、worktree（`<base>/.worktrees/<branch>` に作られる、
/// baseのサブディレクトリ）配下のcwdもbase名にマッチしてしまい、
/// worktree自体を区別できない。この関数はまずbase名を解決した上で、cwdが
/// そのリポジトリのworktreeのいずれかに属していないか確認し、該当すれば
/// "{base}:{branch}" 形式で返す（属さなければ従来通りbase名を返す）。
pub async fn match_workspace_with_worktree(config: &ConfigStore, cwd: &str) -> Option<String> {
    let base_name = config.match_workspace_by_path(cwd)?;

    let cfg = config.load_all();
    let key = ConfigStore::find_workspace_key(&cfg, &base_name)?;
    let entry = cfg.get(&key)?;
    let raw_path = entry.get("path").and_then(Value::as_str).unwrap_or("");
    let ws_path = crate::paths::expand_user_path(raw_path);

    // シンボリックリンクを含む一時ディレクトリ（macOSの/var→/private/var等）で
    // cwdとgitが報告するパスの表記が食い違わないよう、両方とも解決してから
    // 比較する（registered_paths_by_resolvedと同じ safe_resolve_str を使う）。
    let cwd_resolved = crate::paths::safe_resolve_str(Path::new(cwd));
    let ws_resolved = crate::paths::safe_resolve_str(&ws_path);

    // ベースパス自体との完全一致ならworktree配下ではあり得ない（worktreeは
    // baseのサブディレクトリに作られる）ため、無駄なgit worktree list
    // サブプロセス起動を避けて早期リターンする。
    if cwd_resolved == ws_resolved || !ws_path.is_dir() {
        return Some(base_name);
    }

    for wt in git_worktree_list(&ws_path).await.into_iter().skip(1) {
        let wt_path = wt.get("path").and_then(Value::as_str).unwrap_or("");
        if wt_path.is_empty() {
            continue;
        }
        let wt_resolved = crate::paths::safe_resolve_str(Path::new(wt_path));
        if cwd_resolved == wt_resolved || cwd_resolved.starts_with(&format!("{wt_resolved}/")) {
            let branch = wt.get("branch").and_then(Value::as_str).unwrap_or("");
            if branch.is_empty() {
                break;
            }
            return Some(worktree_display_name(&base_name, branch));
        }
    }
    Some(base_name)
}

/// 登録済みワークスペースのうち実在する git リポジトリを (表示名, パス) で列挙する
/// （Python `list_git_workspace_paths` 相当 — `~` は展開する）。
pub async fn list_git_workspace_paths(store: &ConfigStore) -> Vec<(String, PathBuf)> {
    let mut result = Vec::new();
    for (ws_id, entry) in store.list_workspace_entries() {
        let p =
            crate::paths::expand_user_path(entry.get("path").and_then(Value::as_str).unwrap_or(""));
        if p.is_dir() && git_is_repo(&p).await {
            let name = crate::config::workspace_display_name(entry.get("name"), &ws_id).to_string();
            result.push((name, p));
        }
    }
    result
}

/// Python `BACKGROUND_EXECUTOR`（max_workers=8）に対応する並列度。
const WORKTREE_DISCOVERY_CONCURRENCY: usize = 8;

/// 1ワークスペース分の動的 worktree 列挙（`dynamic_worktree_entries` の並列化
/// 単位。Python `_entries_for` 相当）。
async fn worktree_entries_for_workspace(
    ws_id: String,
    entry: Value,
    existing_paths: &std::collections::HashSet<String>,
    is_git_repo_map: Option<&std::collections::HashMap<String, bool>>,
    include_github_url: bool,
) -> Vec<Value> {
    let raw_path = entry.get("path").and_then(Value::as_str).unwrap_or("");
    let ws_path = crate::paths::expand_user_path(raw_path);
    if !ws_path.is_dir() {
        return Vec::new();
    }
    let is_git = match is_git_repo_map {
        Some(map) => map.get(&ws_id).copied().unwrap_or(false),
        None => git_is_repo(&ws_path).await,
    };
    if !is_git {
        return Vec::new();
    }
    let base_name = crate::config::workspace_display_name(entry.get("name"), &ws_id).to_string();
    let mut out = Vec::new();
    for wt in git_worktree_list(&ws_path).await.iter().skip(1) {
        let wt_path_str = wt.get("path").and_then(Value::as_str).unwrap_or("");
        if wt_path_str.is_empty() {
            continue;
        }
        let wt_path = std::path::Path::new(wt_path_str);
        if !wt_path.is_dir() || existing_paths.contains(&crate::paths::safe_resolve_str(wt_path)) {
            continue;
        }
        let branch = wt.get("branch").and_then(Value::as_str).unwrap_or("");
        let mut wt_entry = json!({
            "id": Value::Null,
            "name": worktree_display_name(&base_name, branch),
            "path": wt_path_str,
            "is_git_repo": true,
            "branch": branch,
            "icon": entry.get("icon").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(DEFAULT_WORKSPACE_ICON),
            "icon_color": entry.get("icon_color").and_then(Value::as_str).unwrap_or(""),
            "exists": true,
            "worktree": true,
            "worktree_base": base_name,
            "worktree_branch": branch,
        });
        if include_github_url {
            // worktree は main リポジトリと git ディレクトリ（remote 設定含む）を
            // 共有するため、worktree 自身のパスからでも解決できる。
            if let Some(url) = git_github_url(wt_path).await {
                wt_entry["github_url"] = json!(url);
            }
            if let Some(db) = git_default_branch(wt_path).await {
                wt_entry["default_branch"] = json!(db);
            }
        }
        out.push(wt_entry);
    }
    out
}

/// 登録済み git ワークスペースの linked worktree を動的に列挙する
/// （Python `workspaces._dynamic_worktree_entries` 相当）。
/// config に登録されていない worktree のみを返す。
///
/// `is_git_repo_map` が渡された場合、git リポジトリ判定はその値を再利用する
/// （Python と同じく /workspaces のサマリ結果 — expanduser しないパスでの判定 —
/// をそのまま引き継ぐ。バグ互換のため Rust 側でも再判定しない）。
/// `include_github_url` は /workspaces（都度取得、頻度低）でのみ true にする —
/// /workspaces/statuses は git_info() が別途 github_url を解決するため二重に呼ばない。
///
/// ワークスペースごとの処理は Python 版 `BACKGROUND_EXECUTOR.map`
/// （max_workers=8）と同じ並列度・順序保持で実行する（Codex レビュー指摘:
/// 以前は直列だったため、ワークスペース数に比例して遅くなり、頻繁にポーリング
/// される /workspaces/statuses で顕著だった）。
pub async fn dynamic_worktree_entries(
    store: &ConfigStore,
    is_git_repo_map: Option<&std::collections::HashMap<String, bool>>,
    include_github_url: bool,
) -> Vec<Value> {
    let existing_paths: std::collections::HashSet<String> =
        registered_paths_by_resolved(store).into_keys().collect();
    let entries: Vec<(String, Value)> = store.list_workspace_entries().into_iter().collect();
    let results: Vec<Vec<Value>> = futures_util::stream::iter(entries)
        .map(|(ws_id, entry)| {
            let existing_paths = &existing_paths;
            async move {
                worktree_entries_for_workspace(
                    ws_id,
                    entry,
                    existing_paths,
                    is_git_repo_map,
                    include_github_url,
                )
                .await
            }
        })
        .buffered(WORKTREE_DISCOVERY_CONCURRENCY)
        .collect()
        .await;
    results.into_iter().flatten().collect()
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
            split_worktree_name("proj:feat/x"),
            Some(("proj".to_string(), "feat/x".to_string()))
        );
        assert_eq!(
            split_worktree_name("a b:c"),
            Some(("a b".to_string(), "c".to_string()))
        );
        assert_eq!(split_worktree_name("plain-name"), None);
        assert_eq!(split_worktree_name(":no-base"), None);
        assert_eq!(split_worktree_name("no-branch:"), None);
        assert_eq!(worktree_display_name("proj", "feat/x"), "proj:feat/x");
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

    async fn init_repo_with_worktree(dir: &Path, wt_dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@example.com"],
            vec!["config", "user.name", "t"],
            vec!["commit", "--allow-empty", "-q", "-m", "first"],
        ] {
            let r = run_git_raw(&args, dir, 10.0, &[]).await.unwrap();
            assert_eq!(r.code, 0, "{args:?}: {}", r.stderr);
        }
        let r = run_git_raw(
            &["worktree", "add", wt_dir.to_str().unwrap(), "-b", "feat/x"],
            dir,
            10.0,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(r.code, 0, "{}", r.stderr);
    }

    /// `dynamic_worktree_entries` の並列化（`buffered`）が結果の順序を
    /// ワークスペース登録順のまま保つこと（Codex レビュー指摘に沿って直列 →
    /// 並列化した際、`buffer_unordered` 等の完了順ベースの combinator に
    /// 誤って置き換えると、UI の並び順が不安定になる回帰を防ぐ）。
    #[tokio::test]
    async fn dynamic_worktree_entries_preserves_workspace_order_under_concurrency() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::config::ConfigStore::new(dir.path().join("config.json"));

        // 複数ワークスペース分の worktree を並行処理させ、順序が入れ替わらない
        // ことを確認する（登録順: c, a, b — アルファベット順とは異なる）。
        let mut cfg = store.load_all();
        let mut names = Vec::new();
        for label in ["c", "a", "b"] {
            let repo = dir.path().join(format!("repo-{label}"));
            let wt = dir.path().join(format!("wt-{label}"));
            init_repo_with_worktree(&repo, &wt).await;
            let ws_id = format!("ws_{label}");
            cfg.insert(
                ws_id.clone(),
                json!({"name": label, "path": repo.to_string_lossy()}),
            );
            names.push(label.to_string());
        }
        store.save_all(&cfg).unwrap();

        let entries = dynamic_worktree_entries(&store, None, false).await;
        assert_eq!(entries.len(), 3, "{entries:?}");
        let observed_order: Vec<&str> = entries
            .iter()
            .map(|e| e["worktree_base"].as_str().unwrap())
            .collect();
        assert_eq!(observed_order, vec!["c", "a", "b"]);
        for entry in &entries {
            assert_eq!(entry["worktree_branch"], "feat/x");
        }
    }

    fn register_workspace(store: &crate::config::ConfigStore, name: &str, path: &Path) {
        let mut cfg = store.load_all();
        cfg.insert(
            format!("ws_{name}"),
            json!({"name": name, "path": path.to_string_lossy()}),
        );
        store.save_all(&cfg).unwrap();
    }

    // any-console の実際のworktreeレイアウト（server/src/git_worktree.rs の
    // create_worktree: `<base_repo>/.worktrees/<branch>`、baseのサブディレクトリ）
    // を再現する。init_repo_with_worktree自体は任意のパスを渡せば良いだけなので、
    // ここでネストしたパスを渡す。

    #[tokio::test]
    async fn match_workspace_with_worktree_returns_colon_name_for_worktree_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        let wt = repo.join(".worktrees").join("feat-x");
        init_repo_with_worktree(&repo, &wt).await;
        let store = crate::config::ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "proj", &repo);

        let result = match_workspace_with_worktree(&store, wt.to_str().unwrap()).await;
        assert_eq!(result, Some("proj:feat/x".to_string()));

        // worktree配下のサブディレクトリでも同じ結果になること
        let sub = wt.join("src");
        std::fs::create_dir_all(&sub).unwrap();
        let result_sub = match_workspace_with_worktree(&store, sub.to_str().unwrap()).await;
        assert_eq!(result_sub, Some("proj:feat/x".to_string()));
    }

    #[tokio::test]
    async fn match_workspace_with_worktree_returns_plain_name_for_base_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        let wt = repo.join(".worktrees").join("feat-x");
        init_repo_with_worktree(&repo, &wt).await;
        let store = crate::config::ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "proj", &repo);

        let result = match_workspace_with_worktree(&store, repo.to_str().unwrap()).await;
        assert_eq!(result, Some("proj".to_string()));
    }

    #[tokio::test]
    async fn match_workspace_with_worktree_returns_plain_name_for_unrelated_subdir() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        let wt = repo.join(".worktrees").join("feat-x");
        init_repo_with_worktree(&repo, &wt).await;
        let store = crate::config::ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "proj", &repo);

        let src = repo.join("src");
        std::fs::create_dir_all(&src).unwrap();
        let result = match_workspace_with_worktree(&store, src.to_str().unwrap()).await;
        assert_eq!(result, Some("proj".to_string()));
    }

    #[tokio::test]
    async fn match_workspace_with_worktree_none_when_no_registered_match() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::config::ConfigStore::new(dir.path().join("config.json"));
        let result = match_workspace_with_worktree(&store, "/no/such/path").await;
        assert_eq!(result, None);
    }
}
