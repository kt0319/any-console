//! GitHub CLI 連携 API（Python 側 `api/routers/github.py` + `api/gh_utils.py` の移植）。
//!
//! `gh` CLI を subprocess で叩き、ワークスペース単位で 30 秒 TTL キャッシュする
//! （Actions/PR ピルの 10 秒ポーリングとプール圧迫のバランス — gh_utils.py 参照）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

use crate::auth::RequireAuth;
use crate::errors::ApiError;
use crate::git_utils::resolve_workspace_path;
use crate::state::AppState;
use crate::subprocess::run_subprocess_safe;

const GITHUB_CLI_TIMEOUT_SEC: f64 = 8.0;
const PER_WORKSPACE_TTL_SEC: u64 = 30;

#[derive(Default)]
pub struct GhCache {
    store: Mutex<HashMap<String, (Instant, Value)>>,
}

impl GhCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn get(&self, key: &str) -> Option<Value> {
        let store = self.store.lock().expect("gh cache lock poisoned");
        store.get(key).and_then(|(ts, v)| {
            (ts.elapsed() < Duration::from_secs(PER_WORKSPACE_TTL_SEC)).then(|| v.clone())
        })
    }

    fn set(&self, key: &str, value: Value) {
        let mut store = self.store.lock().expect("gh cache lock poisoned");
        store.insert(key.to_string(), (Instant::now(), value));
    }
}

/// gh を `--json` 付きで実行しパースする。失敗はすべて None。
async fn run_gh_json(args: &[&str], cwd: &std::path::Path) -> Option<Value> {
    let mut cmd = vec!["gh"];
    cmd.extend_from_slice(args);
    let result = run_subprocess_safe(&cmd, GITHUB_CLI_TIMEOUT_SEC, Some(cwd)).await?;
    if !result.success() {
        tracing::warn!(
            "gh command failed: {:?} stderr={}",
            args,
            result.stderr.trim()
        );
        return None;
    }
    serde_json::from_str(&result.stdout).ok()
}

async fn github_fetch(
    state: &Arc<AppState>,
    name: &str,
    suffix: &str,
    gh_args: &[&str],
    error_message: &str,
) -> Result<Json<Value>, ApiError> {
    let ws_path = resolve_workspace_path(&state.config, name).await?;
    let cache_key = format!("{name}:{suffix}");
    let data = match state.gh_cache.get(&cache_key) {
        Some(cached) => Some(cached),
        None => {
            let fetched = run_gh_json(gh_args, &ws_path).await;
            if let Some(v) = &fetched {
                state.gh_cache.set(&cache_key, v.clone());
            }
            fetched
        }
    };
    Ok(Json(match data {
        Some(d) => json!({"status": "ok", "data": d}),
        None => json!({"status": "error", "detail": error_message}),
    }))
}

pub async fn issues(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    github_fetch(
        &state,
        &name,
        "issues",
        &[
            "issue",
            "list",
            "--limit",
            "30",
            "--json",
            "number,title,state,author,labels,createdAt,updatedAt",
        ],
        "Failed to fetch issues",
    )
    .await
}

pub async fn pulls(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    github_fetch(
        &state,
        &name,
        "pulls",
        &[
            "pr",
            "list",
            "--limit",
            "30",
            "--json",
            "number,title,state,author,labels,createdAt,updatedAt,headRefName,isDraft",
        ],
        "Failed to fetch pull requests",
    )
    .await
}

pub async fn runs(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    github_fetch(
        &state,
        &name,
        "runs",
        &[
            "run",
            "list",
            "--limit",
            "15",
            "--json",
            "databaseId,displayTitle,status,conclusion,event,headBranch,createdAt,updatedAt,url,workflowName",
        ],
        "Failed to fetch actions",
    )
    .await
}
