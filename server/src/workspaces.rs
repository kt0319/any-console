//! ワークスペースの一覧・ステータス・登録・設定・削除・候補
//! （Python 側 `api/routers/workspaces.py` の移植）。
//!
//! - GET /workspaces のサマリは Python と同じく **expanduser しない**パスで
//!   判定する（`Path(config["path"])` 直参照のバグ互換 — `~/...` 形式で保存された
//!   ワークスペースは is_git_repo=false / exists=false になる）。
//! - GET /workspaces/statuses は expanduser 済みパス（`list_git_workspace_paths`）
//!   で git_info を並列取得する。
//! - 登録・変更・削除は `git_watch::notify_workspaces_changed()` で監視タスクへ
//!   再収集を促し、status stream へ即時反映する。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::config::{generate_entity_id, ConfigStore};
use crate::errors::{bad_request, conflict, server_error, ApiError};
use crate::git_helpers::validate_workspace_name;
use crate::git_info::git_info_to_status_json;
use crate::git_utils::{
    background_fetch, dynamic_worktree_entries, git_branch, git_default_branch, git_github_url,
    git_is_repo, list_git_workspace_paths, registered_paths_by_resolved, DEFAULT_WORKSPACE_ICON,
};
use crate::icons::resolve_and_store_icon;
use crate::paths::{collapse_user_path, expand_user_path, safe_resolve_str};
use crate::state::AppState;
use crate::util::{JsonBody, QueryParams};

/// Python `BACKGROUND_FETCH_EXECUTOR`（max_workers=4）に対応する並列度。
const BACKGROUND_FETCH_CONCURRENCY: usize = 4;
/// Python `BACKGROUND_EXECUTOR`（max_workers=8）に対応する並列度。
/// `workspace_summary`・`git_info_to_status_json` の並列 fan-out に使う
/// （Codex レビュー指摘: 以前は `join_all` で無制限に並列実行しており、
/// Raspberry Pi 等リソースの限られた実機でワークスペース数が多いとスレッド/
/// プロセス数が跳ね上がりうる — Python 側は元々このプールで上限を設けている）。
const BACKGROUND_EXECUTOR_CONCURRENCY: usize = 8;

fn ensure_workspace_exists(
    store: &ConfigStore,
    name: &str,
) -> Result<Map<String, Value>, ApiError> {
    let cfg = store.load_all();
    ConfigStore::find_workspace_key(&cfg, name)
        .and_then(|key| cfg.get(&key).and_then(Value::as_object).cloned())
        .ok_or_else(|| bad_request(format!("Workspace '{name}' not found")))
}

/// 読み込み済みの config 全体から `__global__` を除く workspace エントリだけを
/// 列挙する（`ConfigStore::list_workspace_entries` の in-memory 版 — 排他ロック内で
/// 既に読み込み済みの `Map` に対して再度ディスク読み込みしないために使う）。
fn workspace_entries(all_config: &Map<String, Value>) -> impl Iterator<Item = (&String, &Value)> {
    all_config
        .iter()
        .filter(|(k, v)| k.as_str() != crate::config::GLOBAL_CONFIG_KEY && v.is_object())
}

// ─── GET /workspaces ────────────────────────────────────────────────────────

/// Python `_workspace_summary` 相当（expanduser しないバグ互換パス判定）。
async fn workspace_summary(ws_id: &str, config: &Value) -> Value {
    let raw_path = config.get("path").and_then(Value::as_str).unwrap_or("");
    let ws_path = PathBuf::from(raw_path);
    let is_dir = ws_path.is_dir();
    let is_git = if is_dir {
        git_is_repo(&ws_path).await
    } else {
        false
    };
    let branch = if is_git {
        git_branch(&ws_path).await
    } else {
        None
    };
    let github_url = if is_git {
        git_github_url(&ws_path).await
    } else {
        None
    };
    let default_branch = if is_git {
        git_default_branch(&ws_path).await
    } else {
        None
    };
    // Python str(Path("")) は "." になる
    let path_str = if raw_path.is_empty() {
        ".".to_string()
    } else {
        ws_path.to_string_lossy().into_owned()
    };
    let mut info = json!({
        "id": ws_id,
        "name": config.get("name").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(ws_id),
        "path": path_str,
        "is_git_repo": is_git,
        "branch": branch,
        "icon": config.get("icon").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(DEFAULT_WORKSPACE_ICON),
        "icon_color": config.get("icon_color").and_then(Value::as_str).unwrap_or(""),
        "group_id": config.get("group_id").and_then(Value::as_str).filter(|s| !s.is_empty()),
        "exists": is_dir,
    });
    if let Some(url) = github_url {
        info["github_url"] = json!(url);
    }
    if let Some(db) = default_branch {
        info["default_branch"] = json!(db);
    }
    info
}

/// Python `_background_fetch`（BACKGROUND_FETCH_EXECUTOR 経由）に対応する
/// fire-and-forget の並列 fetch。
fn spawn_background_fetch(git_dirs: Vec<PathBuf>) {
    if git_dirs.is_empty() {
        return;
    }
    tokio::spawn(async move {
        futures_util::stream::iter(git_dirs)
            .for_each_concurrent(BACKGROUND_FETCH_CONCURRENCY, |dir| async move {
                if !background_fetch(&dir).await {
                    let name = dir
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    tracing::warn!("background fetch failed dir={name}");
                }
            })
            .await;
    });
}

pub async fn list_workspaces(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let entries = state.config.list_workspace_entries();
    if entries.is_empty() {
        return Ok(Json(json!([])));
    }
    let workspace_order: Vec<String> = state
        .config
        .load_global_section("workspace_order")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let order_map: HashMap<&str, usize> = workspace_order
        .iter()
        .enumerate()
        .map(|(i, n)| (n.as_str(), i))
        .collect();
    let mut sorted_items: Vec<(String, Value)> = entries.clone().into_iter().collect();
    sorted_items.sort_by(|(a, _), (b, _)| {
        let key = |name: &str| order_map.get(name).map(|&i| (0, i)).unwrap_or((1, 0));
        key(a).cmp(&key(b)).then_with(|| a.cmp(b))
    });

    // `buffered` は borrow するクロージャ由来の Future を直接 stream::iter に渡すと
    // HRTB 推論に失敗するため、先に Future を確定させてから渡す。
    let summary_futures: Vec<_> = sorted_items
        .iter()
        .map(|(id, cfg)| workspace_summary(id, cfg))
        .collect();
    let mut result: Vec<Value> = futures_util::stream::iter(summary_futures)
        .buffered(BACKGROUND_EXECUTOR_CONCURRENCY)
        .collect()
        .await;

    let is_git_repo_map: HashMap<String, bool> = result
        .iter()
        .map(|r| {
            (
                r["id"].as_str().unwrap_or("").to_string(),
                r["is_git_repo"] == json!(true),
            )
        })
        .collect();
    result.extend(dynamic_worktree_entries(&state.config, Some(&is_git_repo_map), true).await);

    let git_dirs: Vec<PathBuf> = entries
        .values()
        .map(|e| expand_user_path(e.get("path").and_then(Value::as_str).unwrap_or("")))
        .filter(|p| p.is_dir())
        .collect();
    spawn_background_fetch(git_dirs);

    Ok(Json(Value::Array(result)))
}

// ─── GET /workspaces/statuses ───────────────────────────────────────────────

pub async fn list_workspace_statuses(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let mut items: Vec<(PathBuf, String)> = list_git_workspace_paths(&state.config)
        .await
        .into_iter()
        .map(|(name, path)| (path, name))
        .collect();
    for wt in dynamic_worktree_entries(&state.config, None, false).await {
        items.push((
            PathBuf::from(wt["path"].as_str().unwrap_or("")),
            wt["name"].as_str().unwrap_or("").to_string(),
        ));
    }
    let status_futures: Vec<_> = items
        .iter()
        .map(|(path, name)| git_info_to_status_json(&state.git_info_cache, path, name))
        .collect();
    let statuses: Vec<Value> = futures_util::stream::iter(status_futures)
        .buffered(BACKGROUND_EXECUTOR_CONCURRENCY)
        .collect()
        .await;
    Ok(Json(json!({ "statuses": statuses })))
}

// ─── PUT /workspaces/{name}/config ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateConfigRequest {
    #[serde(default)]
    icon: String,
    #[serde(default)]
    icon_color: String,
    #[serde(default)]
    group_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

fn apply_name_update(
    all_config: &Map<String, Value>,
    config: &mut Map<String, Value>,
    ws_id: Option<&str>,
    new_name_raw: &str,
) -> Result<(), ApiError> {
    let new_name = validate_workspace_name(new_name_raw)?;
    for (other_id, other_entry) in workspace_entries(all_config) {
        if Some(other_id.as_str()) == ws_id {
            continue;
        }
        if other_entry.get("name").and_then(Value::as_str) == Some(new_name.as_str()) {
            return Err(conflict(format!("'{new_name}' is already registered")));
        }
    }
    config.insert("name".to_string(), json!(new_name));
    Ok(())
}

fn apply_path_update(
    all_config: &Map<String, Value>,
    config: &mut Map<String, Value>,
    ws_id: Option<&str>,
    new_path_raw: &str,
) -> Result<(), ApiError> {
    let new_path = new_path_raw.trim();
    if new_path.is_empty() {
        return Err(bad_request("Path is required"));
    }
    let abs_path = PathBuf::from(safe_resolve_str(&expand_user_path(new_path)));
    if !abs_path.is_dir() {
        return Err(bad_request(format!("Directory does not exist: {new_path}")));
    }
    for (other_id, other_entry) in workspace_entries(all_config) {
        if Some(other_id.as_str()) == ws_id {
            continue;
        }
        let other_raw = other_entry
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("");
        if safe_resolve_str(&expand_user_path(other_raw)) == abs_path.to_string_lossy() {
            return Err(conflict(format!(
                "Path already used: {}",
                abs_path.display()
            )));
        }
    }
    config.insert("path".to_string(), json!(collapse_user_path(&abs_path)));
    Ok(())
}

pub async fn update_workspace_config(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<UpdateConfigRequest>,
) -> Result<Json<Value>, ApiError> {
    // 早期の 404 判定用（実際の読み込み・書き込みは下のロック内で再度行う —
    // ここでの結果は非同期のアイコン正規化の後に古くなりうるため使わない）。
    ensure_workspace_exists(&state.config, &name)?;
    let icon = resolve_and_store_icon(&state.paths.icons_dir, body.icon.trim())
        .await
        .map_err(|e| server_error(e.to_string()))?;
    let icon_color = body.icon_color.trim().to_string();
    let group_id = body
        .group_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| json!(s))
        .unwrap_or(Value::Null);

    // アイコン正規化（ネットワーク I/O を伴いうる）の完了後、読み込み→変更→書き込みを
    // 1つの排他ロックの下で行う。ここで初めて config を読み直すことで、await の間に
    // 別リクエスト（例: ジョブ CRUD）が同じワークスペースへ加えた変更を
    // 上書きしない（Codex レビュー指摘）。
    state.config.with_exclusive(|all| {
        let ws_id = ConfigStore::find_workspace_key(all, &name);
        let key = ws_id
            .clone()
            .ok_or_else(|| bad_request(format!("Workspace '{name}' not found")))?;
        let mut config = all
            .get(&key)
            .and_then(Value::as_object)
            .cloned()
            .ok_or_else(|| bad_request(format!("Workspace '{name}' not found")))?;

        config.insert("icon".to_string(), json!(icon));
        config.insert("icon_color".to_string(), json!(icon_color));
        config.insert("group_id".to_string(), group_id);
        if let Some(new_name) = body.name.as_deref() {
            apply_name_update(all, &mut config, ws_id.as_deref(), new_name)?;
        }
        if let Some(new_path) = body.path.as_deref() {
            apply_path_update(all, &mut config, ws_id.as_deref(), new_path)?;
        }
        all.insert(key, Value::Object(config));
        Ok(())
    })?;
    crate::git_watch::notify_workspaces_changed(&state);
    tracing::info!("workspace config updated workspace={name}");
    Ok(Json(json!({"status": "ok"})))
}

// ─── POST /workspaces ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddWorkspaceRequest {
    path: String,
    #[serde(default)]
    name: Option<String>,
}

pub async fn add_workspace(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<AddWorkspaceRequest>,
) -> Result<Json<Value>, ApiError> {
    let existing_path = body.path.trim();
    if existing_path.is_empty() {
        return Err(bad_request("Please enter a path"));
    }
    let abs_path = PathBuf::from(safe_resolve_str(&expand_user_path(existing_path)));
    if !abs_path.is_dir() {
        return Err(bad_request(format!(
            "Directory does not exist: {existing_path}"
        )));
    }
    let default_name = abs_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let display_name = validate_workspace_name(
        body.name
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&default_name),
    )?;
    let entries = state.config.list_workspace_entries();
    for entry in entries.values() {
        if entry.get("name").and_then(Value::as_str) == Some(display_name.as_str()) {
            return Err(conflict(format!("'{display_name}' is already registered")));
        }
    }
    let mut new_id = generate_entity_id();
    while entries.contains_key(&new_id) {
        new_id = generate_entity_id();
    }
    let mut config = Map::new();
    config.insert("name".to_string(), json!(display_name));
    config.insert("path".to_string(), json!(collapse_user_path(&abs_path)));
    state
        .config
        .save_workspace_config(&new_id, config)
        .map_err(server_error)?;
    crate::git_watch::notify_workspaces_changed(&state);
    tracing::info!(
        "workspace registered id={} name={} path={}",
        new_id,
        display_name,
        abs_path.display()
    );
    Ok(Json(
        json!({"status": "ok", "id": new_id, "name": display_name}),
    ))
}

// ─── DELETE /workspaces/{name} ──────────────────────────────────────────────

pub async fn delete_workspace(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    ensure_workspace_exists(&state.config, &name)?;
    state
        .config
        .delete_workspace_config(&name)
        .map_err(server_error)?;
    crate::git_watch::notify_workspaces_changed(&state);
    tracing::info!("workspace deleted name={name}");
    Ok(Json(json!({"status": "ok"})))
}

// ─── GET /workspaces/suggest ────────────────────────────────────────────────

const SUGGEST_LIMIT: usize = 50;

/// 入力パスから「列挙するディレクトリ」と「フィルタ文字列」を決める
/// （Python `_resolve_suggest_base` 相当）。
fn resolve_suggest_base(input_path: &str) -> (PathBuf, String) {
    let raw = input_path.trim();
    if raw.is_empty() {
        return (expand_user_path("~"), String::new());
    }
    let trimmed = raw.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() { "/" } else { trimmed };
    let p = expand_user_path(trimmed);
    if p.is_dir() {
        return (p, String::new());
    }
    // Python: p.parent if p.parent != p else p（相対1要素の parent は "."）
    let parent = match p.parent() {
        Some(q) if !q.as_os_str().is_empty() => q.to_path_buf(),
        Some(_) => PathBuf::from("."),
        None => p.clone(),
    };
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    (parent, name)
}

#[derive(Deserialize)]
pub struct SuggestQuery {
    #[serde(default)]
    path: String,
}

pub async fn suggest_workspace_dirs(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<SuggestQuery>,
) -> Result<Json<Value>, ApiError> {
    let (base, filter_str) = resolve_suggest_base(&query.path);
    let base = PathBuf::from(safe_resolve_str(&base));
    let empty = |base: &PathBuf| json!({"base": base.to_string_lossy(), "entries": []});
    if !base.is_dir() {
        return Ok(Json(empty(&base)));
    }

    let existing: std::collections::HashSet<String> = registered_paths_by_resolved(&state.config)
        .into_keys()
        .collect();

    let read = match std::fs::read_dir(&base) {
        Ok(rd) => rd,
        Err(_) => return Ok(Json(empty(&base))),
    };
    let mut children: Vec<PathBuf> = read.filter_map(|e| e.ok().map(|e| e.path())).collect();
    children.sort_by_key(|c| {
        c.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });

    let filter_lower = filter_str.to_lowercase();
    let mut entries = Vec::new();
    for child in children {
        let child_name = child
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !child.is_dir() || child_name.starts_with('.') {
            continue;
        }
        if !filter_lower.is_empty() && !child_name.to_lowercase().starts_with(&filter_lower) {
            continue;
        }
        let child_str = child.to_string_lossy().into_owned();
        entries.push(json!({
            "path": child_str,
            "name": child_name,
            "is_git": child.join(".git").is_dir(),
            "registered": existing.contains(&child_str),
        }));
        if entries.len() >= SUGGEST_LIMIT {
            break;
        }
    }
    Ok(Json(
        json!({"base": base.to_string_lossy(), "entries": entries}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggest_base_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        std::fs::create_dir(base.join("projects")).unwrap();

        // 既存ディレクトリ（末尾スラッシュ有無問わず）: そこを列挙、フィルタなし
        let s = base.to_string_lossy();
        assert_eq!(
            resolve_suggest_base(&s),
            (base.to_path_buf(), String::new())
        );
        assert_eq!(
            resolve_suggest_base(&format!("{s}/")),
            (base.to_path_buf(), String::new())
        );
        // 中途半端なパス: 親を列挙、最後の要素でフィルタ
        assert_eq!(
            resolve_suggest_base(&format!("{s}/proj")),
            (base.to_path_buf(), "proj".to_string())
        );
        // ルートはそのまま
        assert_eq!(
            resolve_suggest_base("///"),
            (PathBuf::from("/"), String::new())
        );
        // 空はホーム
        let (home_base, filter) = resolve_suggest_base("  ");
        assert_eq!(home_base, expand_user_path("~"));
        assert_eq!(filter, "");
    }

    #[test]
    fn workspace_name_validator_via_helpers() {
        assert!(validate_workspace_name("proj-1.2_x").is_ok());
        assert!(validate_workspace_name("  ").is_err());
        assert!(validate_workspace_name("has space").is_err());
        assert!(validate_workspace_name("slash/name").is_err());
    }
}
