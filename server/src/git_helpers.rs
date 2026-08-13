//! git ルーター共通ヘルパー（Python 側 `api/routers/git_helpers.py` +
//! `api/validators.py` の該当分の移植）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::activity::log_activity;
use crate::errors::{bad_request, ApiError};
use crate::git_utils::{
    resolve_workspace_path, rev_parse_head, run_git_command, GIT_LONG_TIMEOUT_SEC,
};
use crate::state::AppState;

// ─── validators（api/validators.py）────────────────────────────────────────

pub fn validate_workspace_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(bad_request("Workspace name is required"));
    }
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if !ok {
        return Err(bad_request(format!("Invalid workspace name: {name}")));
    }
    Ok(name.to_string())
}

pub fn validate_branch_name(branch: &str) -> Result<String, ApiError> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(bad_request("Branch is required"));
    }
    let ok = branch
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-'));
    if !ok {
        return Err(bad_request(format!("Invalid branch name: {branch}")));
    }
    Ok(branch.to_string())
}

/// commit を指す ref（4〜40桁の小文字16進ハッシュ、または stash エントリ）を検証する。
pub fn validate_commit_ref(commit_ref: &str) -> Result<String, ApiError> {
    let is_hash = (4..=40).contains(&commit_ref.len())
        && commit_ref
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
    if is_hash || is_stash_ref(commit_ref) {
        return Ok(commit_ref.to_string());
    }
    Err(bad_request(format!("Invalid commit ref: {commit_ref}")))
}

pub fn is_stash_ref(s: &str) -> bool {
    s.strip_prefix("stash@{")
        .and_then(|rest| rest.strip_suffix('}'))
        .is_some_and(|digits| !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
}

pub fn validate_stash_ref(stash_ref: &str) -> Result<String, ApiError> {
    let r = stash_ref.trim();
    if is_stash_ref(r) {
        Ok(r.to_string())
    } else {
        Err(bad_request(format!("Invalid stash ref: {r}")))
    }
}

// ─── git action 実行の定型 ──────────────────────────────────────────────────

/// ワークスペースロック下で git コマンドを実行する（Python `execute_git_action`）。
///
/// Python 側の `invalidate_git_info`（= status stream への即時 nudge）に対応して、
/// ローカルの git_info キャッシュを無効化し、`git_watch::nudge_workspace` で
/// status stream へ即時反映を促す（`invalidate_and_publish_git_info` 参照）。
pub async fn execute_git_action(
    state: &Arc<AppState>,
    name: &str,
    args: &[&str],
    operation: &str,
    env: &[(&str, &str)],
    log_extra: &str,
) -> Result<Value, ApiError> {
    let _guard = state.git_locks.acquire(name).await?;
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    let result = run_git_command(args, &ws_path, GIT_LONG_TIMEOUT_SEC, operation, env).await?;
    let extra = if log_extra.is_empty() {
        String::new()
    } else {
        format!(" {log_extra}")
    };
    tracing::info!(
        "git {} workspace={}{} rc={}",
        operation,
        name,
        extra,
        result["exit_code"]
    );
    invalidate_and_publish_git_info(state, name, &ws_path);
    Ok(result)
}

/// Python `invalidate_git_info` の Rust 対応: ローカルキャッシュの無効化 +
/// status stream への即時 nudge（`git_watch::nudge_workspace`）。
pub fn invalidate_and_publish_git_info(state: &Arc<AppState>, name: &str, ws_path: &Path) {
    state.git_info_cache.invalidate(ws_path);
    crate::git_watch::nudge_workspace(state, name.to_string());
}

/// `run_git_command` の結果が失敗なら stderr（空なら fallback 文言）を 400 で返す。
pub fn ensure_git_result_ok(result: &Value, fallback: &str) -> Result<(), ApiError> {
    if result["exit_code"] != 0 {
        let stderr = result["stderr"].as_str().unwrap_or("").trim();
        return Err(bad_request(if stderr.is_empty() {
            fallback.to_string()
        } else {
            stderr.to_string()
        }));
    }
    Ok(())
}

/// activity ログ用の (key, value) ペア配列を `Map` へ変換する定型
/// （git_history / git_branches の各エンドポイントが使う）。
pub fn activity_fields(pairs: &[(&str, Value)]) -> Map<String, Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

/// execute_git_action の成功時に activity を記録する定型（Python
/// `execute_git_action_with_activity`）。resolve_head=true なら成功後の HEAD を
/// commit フィールドに載せる。
#[allow(clippy::too_many_arguments)]
pub async fn execute_git_action_with_activity(
    state: &Arc<AppState>,
    name: &str,
    ws_path: Option<&Path>,
    args: &[&str],
    operation: &str,
    event: &str,
    env: &[(&str, &str)],
    log_extra: &str,
    resolve_head: bool,
    mut activity_fields: Map<String, Value>,
) -> Result<Value, ApiError> {
    let result = execute_git_action(state, name, args, operation, env, log_extra).await?;
    if result["status"] == "ok" {
        if resolve_head {
            if let Some(ws) = ws_path {
                let head = rev_parse_head(ws).await;
                activity_fields.insert("commit".to_string(), Value::String(head));
            }
        }
        log_activity(&state.paths.data_dir, Some(name), event, activity_fields);
    }
    Ok(result)
}

// ─── パス検証 ───────────────────────────────────────────────────────────────

/// ワークスペース配下の相対パスを解決・検証する（Python `resolve_workspace_file`）。
/// パストラバーサルと .git 配下へのアクセスを 400 で拒否する。
pub async fn resolve_workspace_file(
    state: &Arc<AppState>,
    name: &str,
    path: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    let (target, rel) = resolve_and_validate_workspace_path(&ws_path, path)?;
    Ok((ws_path, target, rel))
}

/// Python `Path.resolve()`（strict=False）相当: 対象を丸ごと `canonicalize`
/// できればそれを使い（既存ファイル — シンボリックリンクも解決済み）、できなければ
/// （新規作成対象など末尾が存在しない）存在する最長の先頭部分だけ `canonicalize`
/// して、存在しない残りをそのまま連結する。
///
/// レキシカルな `..`/`.` 正規化だけでは、途中の構成要素が外部を指す
/// シンボリックリンクの場合の脱出を見逃す（例: `ws_root/external` が
/// `/home/user` を指すシンボリックリンクのとき、`external/.ssh/config` は
/// レキシカルには `ws_root` 配下に見えるが、実体は `ws_root` の外にある —
/// Codex レビュー指摘）。実体解決してから配下検証する必要がある。
fn resolve_path_following_symlinks(path: &Path) -> PathBuf {
    if let Ok(full) = path.canonicalize() {
        return full;
    }
    let components: Vec<std::path::Component> = path.components().collect();
    let mut split_at = components.len();
    while split_at > 0 {
        split_at -= 1;
        let prefix: PathBuf = components[..=split_at].iter().collect();
        if let Ok(canon_prefix) = prefix.canonicalize() {
            let remainder: PathBuf = components[split_at + 1..].iter().collect();
            return canon_prefix.join(remainder);
        }
    }
    path.to_path_buf()
}

pub fn resolve_and_validate_workspace_path(
    ws_path: &Path,
    path: &str,
) -> Result<(PathBuf, PathBuf), ApiError> {
    // Python は (ws_path / path).resolve() 後に relative_to で配下検証する。
    let ws_root = ws_path
        .canonicalize()
        .unwrap_or_else(|_| ws_path.to_path_buf());
    let joined = ws_root.join(path);
    // まず素朴な `..`/`.` のレキシカル正規化（相対指定の解決）。
    let mut normalized = PathBuf::new();
    for comp in joined.components() {
        match comp {
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err(bad_request("Invalid path"));
                }
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    // シンボリックリンクを解決した実体パスで封じ込め検証する（既存ファイルの
    // 読み書き・リネーム・削除・ダウンロードいずれも対象— 新規作成のみ末尾が
    // 実在しないため resolve_path_following_symlinks がその手前まで解決する）。
    let resolved = resolve_path_following_symlinks(&normalized);
    let rel = resolved
        .strip_prefix(&ws_root)
        .map_err(|_| bad_request("Invalid path"))?
        .to_path_buf();
    if rel.components().any(|c| c.as_os_str() == ".git") {
        return Err(bad_request("Invalid path"));
    }
    Ok((resolved, rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_name_validation() {
        assert!(validate_branch_name("feat/x-1.2_D").is_ok());
        assert!(validate_branch_name("  main  ").is_ok());
        assert!(validate_branch_name("").is_err());
        assert!(validate_branch_name("bad name").is_err());
        assert!(validate_branch_name("bad;rm -rf").is_err());
    }

    #[test]
    fn commit_ref_validation() {
        assert!(validate_commit_ref("abcd").is_ok());
        assert!(validate_commit_ref(&"a1b2c3d4".repeat(5)).is_ok()); // 40桁
        assert!(validate_commit_ref("stash@{0}").is_ok());
        assert!(validate_commit_ref("abc").is_err()); // 3桁
        assert!(validate_commit_ref("ABCD").is_err()); // 大文字
        assert!(validate_commit_ref("main").is_err());
        assert!(validate_stash_ref(" stash@{12} ").is_ok());
        assert!(validate_stash_ref("stash@{}").is_err());
    }

    #[test]
    fn workspace_path_traversal_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        std::fs::create_dir(ws.join("src")).unwrap();
        let (_, rel) = resolve_and_validate_workspace_path(ws, "src/main.rs").unwrap();
        assert_eq!(rel, PathBuf::from("src/main.rs"));
        assert!(resolve_and_validate_workspace_path(ws, "../outside").is_err());
        assert!(resolve_and_validate_workspace_path(ws, "src/../../outside").is_err());
        assert!(resolve_and_validate_workspace_path(ws, ".git/config").is_err());
        assert!(resolve_and_validate_workspace_path(ws, "src/.git/config").is_err());
    }

    /// シンボリックリンク経由の脱出は、レキシカルには配下に見えても実体解決後に
    /// 拒否されること（Codex レビュー指摘: `ws/external` が外部ディレクトリを指す
    /// シンボリックリンクのとき `external/secret.txt` は実体としては ws の外）。
    #[cfg(unix)]
    #[test]
    fn workspace_symlink_escape_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().join("ws");
        std::fs::create_dir(&ws).unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"top secret").unwrap();

        std::os::unix::fs::symlink(&outside, ws.join("external")).unwrap();

        // 既存ファイル（symlink 自体は resolve 済みで実体解決される）
        assert!(resolve_and_validate_workspace_path(&ws, "external/secret.txt").is_err());
        // symlink 配下の新規作成対象（末尾が存在しない）も拒否される
        assert!(resolve_and_validate_workspace_path(&ws, "external/new-file.txt").is_err());

        // symlink を挟まない通常パスは引き続き成功する
        std::fs::create_dir(ws.join("src")).unwrap();
        let (target, rel) = resolve_and_validate_workspace_path(&ws, "src/main.rs").unwrap();
        assert_eq!(rel, PathBuf::from("src/main.rs"));
        assert!(target.starts_with(ws.canonicalize().unwrap()));
    }
}
