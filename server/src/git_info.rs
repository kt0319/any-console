//! ワークスペースの git ステータス収集パイプライン（Python 側 `api/git_info.py` の移植）。
//!
//! 複数の git クエリを並列実行し、branch / upstream / ahead-behind / diff 統計を
//! 1つの dict に集約する。結果は 5 秒 TTL でキャッシュし、checkout 等の直後の
//! invalidate 中に走っていた古い計算がキャッシュを上書きしないよう世代カウンタで
//! ガードする（Python と同一の設計）。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use crate::git_diff::count_file_lines;
use crate::git_utils::{parse_github_url, run_git_raw, GIT_QUICK_TIMEOUT_SEC};

const GIT_INFO_CACHE_TTL_SEC: u64 = 5;

/// キャッシュエントリ: (格納時刻, git_info の結果 dict)。
type GitInfoEntry = (Instant, Map<String, Value>);

#[derive(Default)]
pub struct GitInfoCache {
    store: Mutex<HashMap<String, GitInfoEntry>>,
    generations: Mutex<HashMap<String, u64>>,
}

impl GitInfoCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn get(&self, key: &str) -> Option<Map<String, Value>> {
        let store = self.store.lock().expect("git info cache poisoned");
        store.get(key).and_then(|(ts, v)| {
            (ts.elapsed() < Duration::from_secs(GIT_INFO_CACHE_TTL_SEC)).then(|| v.clone())
        })
    }

    fn set(&self, key: &str, value: Map<String, Value>) {
        let mut store = self.store.lock().expect("git info cache poisoned");
        store.insert(key.to_string(), (Instant::now(), value));
    }

    fn generation(&self, key: &str) -> u64 {
        *self
            .generations
            .lock()
            .expect("git info generations poisoned")
            .get(key)
            .unwrap_or(&0)
    }

    /// キャッシュ無効化 + 世代を進める（Python `invalidate_git_info_cache` 相当）。
    pub fn invalidate(&self, directory: &Path) {
        let key = directory.to_string_lossy().into_owned();
        self.store
            .lock()
            .expect("git info cache poisoned")
            .remove(&key);
        *self
            .generations
            .lock()
            .expect("git info generations poisoned")
            .entry(key)
            .or_insert(0) += 1;
    }
}

fn empty_git_info() -> Map<String, Value> {
    json!({
        "is_git_repo": false,
        "branch": null,
        "upstream": null,
        "has_upstream": null,
        "has_remote_branch": null,
        "last_commit_date": null,
        "last_commit_message": null,
        "github_url": null,
        "clean": null,
        "ahead": 0,
        "behind": 0,
        "insertions": 0,
        "deletions": 0,
        "changed_files": 0,
    })
    .as_object()
    .expect("object literal")
    .clone()
}

async fn query(directory: &Path, args: &[&str]) -> Option<String> {
    match run_git_raw(args, directory, GIT_QUICK_TIMEOUT_SEC, &[]).await {
        Ok(out) if out.code == 0 => Some(out.stdout),
        _ => None,
    }
}

/// "N insertion" / "N deletion" を diff --shortstat 出力から拾う。
fn extract_stat(text: &str, keyword: &str) -> i64 {
    for (idx, _) in text.match_indices(keyword) {
        let head = &text[..idx];
        let digits: String = head
            .chars()
            .rev()
            .skip_while(|c| c.is_whitespace())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if !digits.is_empty() {
            let n: String = digits.chars().rev().collect();
            return n.parse().unwrap_or(0);
        }
    }
    0
}

fn apply_diff_stats(
    info: &mut Map<String, Value>,
    diff_outputs: &[&str],
    status_out: Option<&str>,
    directory: &Path,
) {
    let mut insertions = info["insertions"].as_i64().unwrap_or(0);
    let mut deletions = info["deletions"].as_i64().unwrap_or(0);
    let mut changed_files = info["changed_files"].as_i64().unwrap_or(0);
    for out in diff_outputs {
        if out.is_empty() {
            continue;
        }
        insertions += extract_stat(out, " insertion");
        deletions += extract_stat(out, " deletion");
    }
    if let Some(status) = status_out {
        for line in status.lines() {
            if line.is_empty() {
                continue;
            }
            changed_files += 1;
            if let Some(file) = line.strip_prefix("?? ") {
                insertions += count_file_lines(&directory.join(file));
            }
        }
    }
    info.insert("insertions".to_string(), json!(insertions));
    info.insert("deletions".to_string(), json!(deletions));
    info.insert("changed_files".to_string(), json!(changed_files));
}

fn parse_revlist_pair(out: &str) -> Option<(i64, i64)> {
    let parts: Vec<&str> = out.split_whitespace().collect();
    if parts.len() == 2 {
        Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
    } else {
        None
    }
}

async fn apply_ahead_behind(
    info: &mut Map<String, Value>,
    revlist_out: Option<&str>,
    directory: &Path,
) {
    let has_upstream = info["has_upstream"] == json!(true);
    if let Some(out) = revlist_out {
        if has_upstream {
            if let Some((a, b)) = parse_revlist_pair(out) {
                info.insert("ahead".to_string(), json!(a));
                info.insert("behind".to_string(), json!(b));
            }
            return;
        }
    }
    let branch = info["branch"].as_str().unwrap_or("").to_string();
    if !branch.is_empty() && info["has_remote_branch"] == json!(true) {
        let range = format!("HEAD...origin/{branch}");
        if let Some(out) = query(directory, &["rev-list", "--left-right", "--count", &range]).await
        {
            if let Some((a, b)) = parse_revlist_pair(&out) {
                info.insert("ahead".to_string(), json!(a));
                info.insert("behind".to_string(), json!(b));
            }
        }
        return;
    }
    if info["has_remote_branch"] == json!(false) {
        if let Some(out) = query(
            directory,
            &["rev-list", "--count", "HEAD", "--not", "--remotes=origin"],
        )
        .await
        {
            if let Ok(n) = out.trim().parse::<i64>() {
                info.insert("ahead".to_string(), json!(n));
            }
        }
    }
}

async fn populate_git_info(info: &mut Map<String, Value>, directory: &Path) {
    // Python の _GIT_INFO_QUERIES と同一の 11 クエリを並列実行する
    let (
        branch,
        symbolic_branch,
        commit_date,
        message,
        remote,
        status,
        diff,
        staged,
        upstream,
        remote_branches,
        revlist,
    ) = tokio::join!(
        query(directory, &["rev-parse", "--abbrev-ref", "HEAD"]),
        query(directory, &["symbolic-ref", "--short", "HEAD"]),
        query(directory, &["log", "-1", "--format=%cI"]),
        query(directory, &["log", "-1", "--format=%s"]),
        query(directory, &["remote", "get-url", "origin"]),
        query(
            directory,
            &[
                "--no-optional-locks",
                "status",
                "--porcelain",
                "--untracked-files=all"
            ]
        ),
        query(directory, &["--no-optional-locks", "diff", "--shortstat"]),
        query(
            directory,
            &["--no-optional-locks", "diff", "--staged", "--shortstat"]
        ),
        query(
            directory,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}"
            ]
        ),
        query(directory, &["branch", "-r", "--format=%(refname:short)"]),
        query(
            directory,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]
        ),
    );

    // branch（unborn HEAD は symbolic-ref で補完）+ リモートブランチ有無
    let branch_out = branch.or(symbolic_branch);
    if let Some(b) = branch_out
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        info.insert("branch".to_string(), json!(b));
    }
    if info["branch"].is_string() {
        let branch_name = info["branch"].as_str().unwrap_or("").to_string();
        let has_remote = remote_branches
            .as_deref()
            .map(|out| {
                let target = format!("origin/{branch_name}");
                out.lines().map(str::trim).any(|c| c == target)
            })
            .unwrap_or(false);
        info.insert("has_remote_branch".to_string(), json!(has_remote));
    }

    if let Some(s) = commit_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        info.insert("last_commit_date".to_string(), json!(s));
    }
    if let Some(s) = message.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        info.insert("last_commit_message".to_string(), json!(s));
    }

    match upstream.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(u) => {
            info.insert("upstream".to_string(), json!(u));
            info.insert("has_upstream".to_string(), json!(true));
        }
        None => {
            info.insert("has_upstream".to_string(), json!(false));
        }
    }

    if let Some(url) = remote.as_deref().and_then(|r| parse_github_url(r.trim())) {
        info.insert("github_url".to_string(), json!(url));
    }

    if let Some(s) = status.as_deref() {
        info.insert("clean".to_string(), json!(s.trim().is_empty()));
    }
    if info["clean"] != json!(true) {
        apply_diff_stats(
            info,
            &[
                diff.as_deref().unwrap_or(""),
                staged.as_deref().unwrap_or(""),
            ],
            status.as_deref(),
            directory,
        );
    }

    apply_ahead_behind(info, revlist.as_deref(), directory).await;
}

/// git ステータス一式（Python `git_info` 相当 — TTL キャッシュ + 世代ガード付き）。
pub async fn git_info(cache: &GitInfoCache, directory: &Path) -> Map<String, Value> {
    let cache_key = directory.to_string_lossy().into_owned();
    if let Some(cached) = cache.get(&cache_key) {
        return cached;
    }
    let gen_at_start = cache.generation(&cache_key);
    let mut info = empty_git_info();
    let is_repo = query(directory, &["rev-parse", "--is-inside-work-tree"])
        .await
        .is_some();
    if is_repo {
        info.insert("is_git_repo".to_string(), json!(true));
        populate_git_info(&mut info, directory).await;
    }
    // 計算中に invalidate（世代が進んだ）されていたら古い結果でキャッシュを
    // 上書きしない（呼び出し元にはそのまま返す）
    if cache.generation(&cache_key) == gen_at_start {
        cache.set(&cache_key, info.clone());
    }
    info
}

/// /workspaces/statuses の要素形式（`git_info_to_status_json` 相当）。
pub async fn git_info_to_status_json(cache: &GitInfoCache, directory: &Path, name: &str) -> Value {
    let mut result = git_info(cache, directory).await;
    result.insert("name".to_string(), json!(name));
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortstat_extraction() {
        let out = " 2 files changed, 10 insertions(+), 3 deletions(-)\n";
        assert_eq!(extract_stat(out, " insertion"), 10);
        assert_eq!(extract_stat(out, " deletion"), 3);
        assert_eq!(
            extract_stat(" 1 file changed, 1 insertion(+)\n", " insertion"),
            1
        );
        assert_eq!(
            extract_stat(" 1 file changed, 1 insertion(+)\n", " deletion"),
            0
        );
        assert_eq!(extract_stat("", " insertion"), 0);
    }

    #[test]
    fn revlist_pair_parse() {
        assert_eq!(parse_revlist_pair("2\t3\n"), Some((2, 3)));
        assert_eq!(parse_revlist_pair("garbage"), None);
    }

    fn sh_git(repo: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[tokio::test]
    async fn git_info_on_real_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        sh_git(repo, &["init", "-q", "-b", "main"]);
        sh_git(repo, &["config", "user.email", "t@example.com"]);
        sh_git(repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("a.txt"), "x\n").unwrap();
        sh_git(repo, &["add", "-A"]);
        sh_git(repo, &["commit", "-q", "-m", "first"]);
        std::fs::write(repo.join("a.txt"), "x\ny\n").unwrap();
        std::fs::write(repo.join("new.txt"), "1\n2\n").unwrap();

        let cache = GitInfoCache::new();
        let info = git_info(&cache, repo).await;
        assert_eq!(info["is_git_repo"], true);
        assert_eq!(info["branch"], "main");
        assert_eq!(info["clean"], false);
        assert_eq!(info["last_commit_message"], "first");
        assert_eq!(info["changed_files"], 2);
        // 変更 1 行 + 未追跡 2 行
        assert_eq!(info["insertions"], 3);
        assert_eq!(info["has_upstream"], false);
        assert_eq!(info["has_remote_branch"], false);

        // キャッシュが効く（同一 Map が返る）
        let again = git_info(&cache, repo).await;
        assert_eq!(again, info);

        // invalidate → クリーンにした状態が反映される
        sh_git(repo, &["add", "-A"]);
        sh_git(repo, &["commit", "-q", "-m", "second"]);
        cache.invalidate(repo);
        let after = git_info(&cache, repo).await;
        assert_eq!(after["clean"], true);
        assert_eq!(after["last_commit_message"], "second");

        // 非 git ディレクトリは is_git_repo=false
        let plain = tempfile::tempdir().unwrap();
        let info = git_info(&cache, plain.path()).await;
        assert_eq!(info["is_git_repo"], false);
        assert_eq!(info["branch"], Value::Null);
    }
}
