//! ワークスペースジョブ / 共通ジョブの CRUD（Python 側 `api/routers/jobs.py` の移植）。
//!
//! ジョブ実行（/run・dispatch）はターミナルサブシステムに依存するため Python の
//! まま（Phase 5 で移行）。ここは config.json のジョブ定義 CRUD と一覧のみ。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde_json::{Map, Value};

use crate::auth::RequireAuth;
use crate::config::GLOBAL_CONFIG_KEY;
use crate::errors::{not_found, ApiError};
use crate::git_utils::{dynamic_worktree_entries, resolve_workspace_path};
use crate::jobs_common::{
    delete_job, load_common_jobs_data, load_workspace_jobs_data, merge_jobs_serialized,
    reorder_jobs, resolve_jobs_owner, save_common_jobs_data, save_job, save_workspace_jobs_data,
    serialize_workspace_jobs, JobRequest, ReorderJobsRequest,
};
use crate::state::AppState;
use crate::util::JsonBody;

// ─── GET /jobs/workspaces ───────────────────────────────────────────────────

pub async fn list_all_workspace_jobs(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let all_config = state.config.load_all();
    let common_jobs = all_config
        .get(GLOBAL_CONFIG_KEY)
        .and_then(|g| g.get("jobs"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let entries: Vec<(String, Value)> = all_config
        .iter()
        .filter(|(k, v)| k.as_str() != GLOBAL_CONFIG_KEY && v.is_object())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    // 表示名 -> jobs（worktree_base の解決用）
    let mut jobs_by_name: std::collections::HashMap<String, Map<String, Value>> =
        std::collections::HashMap::new();
    for (ws_id, entry) in &entries {
        let display = entry
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(ws_id);
        let jobs = entry
            .get("jobs")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        jobs_by_name.insert(display.to_string(), jobs);
    }

    let mut sorted_entries = entries.clone();
    sorted_entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut result = Map::new();
    for (ws_id, entry) in &sorted_entries {
        let display = entry
            .get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(ws_id)
            .to_string();
        let base = entry
            .get("worktree_base")
            .and_then(Value::as_str)
            .unwrap_or("");
        let ws_jobs = if !base.is_empty() && jobs_by_name.contains_key(base) {
            jobs_by_name[base].clone()
        } else {
            entry
                .get("jobs")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default()
        };
        result.insert(
            display,
            Value::Object(merge_jobs_serialized(&ws_jobs, &common_jobs)),
        );
    }
    // 動的 worktree（config 未登録）はベースのジョブ定義を引き継ぐ
    for wt in dynamic_worktree_entries(&state.config, None, false).await {
        let name = wt
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if name.is_empty() || result.contains_key(&name) {
            continue;
        }
        let base = wt
            .get("worktree_base")
            .and_then(Value::as_str)
            .unwrap_or("");
        let wt_jobs = jobs_by_name.get(base).cloned().unwrap_or_default();
        result.insert(
            name,
            Value::Object(merge_jobs_serialized(&wt_jobs, &common_jobs)),
        );
    }
    Ok(Json(Value::Object(result)))
}

// ─── ワークスペースジョブ ───────────────────────────────────────────────────

pub async fn list_workspace_jobs(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    resolve_workspace_path(&state.config, &name).await?;
    Ok(Json(Value::Object(serialize_workspace_jobs(&state, &name))))
}

/// ws_jobs_context 相当: パス解決 + ジョブ共有オーナーの解決 + データロード。
async fn ws_jobs_data(
    state: &Arc<AppState>,
    name: &str,
) -> Result<(String, Map<String, Value>), ApiError> {
    resolve_workspace_path(&state.config, name).await?;
    let owner = resolve_jobs_owner(state, name);
    let data = load_workspace_jobs_data(state, &owner);
    Ok((owner, data))
}

pub async fn create_workspace_job(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<JobRequest>,
) -> Result<Json<Value>, ApiError> {
    let (owner, data) = ws_jobs_data(&state, &name).await?;
    let log_context = format!("job created workspace={name}");
    save_job(
        &state,
        data,
        move |s, d| save_workspace_jobs_data(s, &owner, d),
        None,
        &body,
        &log_context,
    )
    .await
    .map(Json)
}

pub async fn reorder_workspace_jobs(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<ReorderJobsRequest>,
) -> Result<Json<Value>, ApiError> {
    let (owner, data) = ws_jobs_data(&state, &name).await?;
    let log_context = format!("jobs reordered workspace={name}");
    reorder_jobs(
        &state,
        data,
        move |s, d| save_workspace_jobs_data(s, &owner, d),
        &body.order,
        &log_context,
    )
    .map(Json)
}

pub async fn update_workspace_job(
    State(state): State<Arc<AppState>>,
    Path((name, job_name)): Path<(String, String)>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<JobRequest>,
) -> Result<Json<Value>, ApiError> {
    let (owner, data) = ws_jobs_data(&state, &name).await?;
    if !data.contains_key(&job_name) {
        return Err(not_found(format!("Job '{job_name}' not found")));
    }
    let log_context = format!("job updated workspace={name}");
    save_job(
        &state,
        data,
        move |s, d| save_workspace_jobs_data(s, &owner, d),
        Some(job_name),
        &body,
        &log_context,
    )
    .await
    .map(Json)
}

pub async fn delete_workspace_job(
    State(state): State<Arc<AppState>>,
    Path((name, job_name)): Path<(String, String)>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let (owner, data) = ws_jobs_data(&state, &name).await?;
    let log_context = format!("job deleted workspace={name}");
    delete_job(
        &state,
        data,
        move |s, d| save_workspace_jobs_data(s, &owner, d),
        &job_name,
        &format!("Job '{job_name}' not found"),
        &log_context,
    )
    .map(Json)
}

// ─── 共通ジョブ ─────────────────────────────────────────────────────────────

pub async fn list_common_jobs(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let data = load_common_jobs_data(&state);
    let mut out = Map::new();
    for (name, entry) in &data {
        out.insert(
            name.clone(),
            crate::jobs_common::job_entry_to_dict(name, entry, None),
        );
    }
    Ok(Json(Value::Object(out)))
}

pub async fn create_common_job(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<JobRequest>,
) -> Result<Json<Value>, ApiError> {
    let data = load_common_jobs_data(&state);
    save_job(
        &state,
        data,
        save_common_jobs_data,
        None,
        &body,
        "common job created",
    )
    .await
    .map(Json)
}

pub async fn update_common_job(
    State(state): State<Arc<AppState>>,
    Path(job_name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<JobRequest>,
) -> Result<Json<Value>, ApiError> {
    let data = load_common_jobs_data(&state);
    if !data.contains_key(&job_name) {
        return Err(not_found(format!("Common job '{job_name}' not found")));
    }
    save_job(
        &state,
        data,
        save_common_jobs_data,
        Some(job_name),
        &body,
        "common job updated",
    )
    .await
    .map(Json)
}

pub async fn delete_common_job(
    State(state): State<Arc<AppState>>,
    Path(job_name): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let data = load_common_jobs_data(&state);
    delete_job(
        &state,
        data,
        save_common_jobs_data,
        &job_name,
        &format!("Common job '{job_name}' not found"),
        "common job deleted",
    )
    .map(Json)
}

pub async fn reorder_common_jobs(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<ReorderJobsRequest>,
) -> Result<Json<Value>, ApiError> {
    let data = load_common_jobs_data(&state);
    reorder_jobs(
        &state,
        data,
        save_common_jobs_data,
        &body.order,
        "common jobs reordered",
    )
    .map(Json)
}
