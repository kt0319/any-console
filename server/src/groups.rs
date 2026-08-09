//! ワークスペースグループの CRUD（Python 側 `api/routers/groups.py` の移植）。
//!
//! グループは config.json の `__global__.groups` に保存される。
//! ワークスペースへの割り当ては workspace エントリの group_id フィールドで管理する。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::config::{generate_entity_id, GLOBAL_CONFIG_KEY};
use crate::errors::{bad_request, not_found, ApiError};
use crate::state::AppState;
use crate::util::JsonBody;

fn load_groups(all_config: &Map<String, Value>) -> Vec<Value> {
    all_config
        .get(GLOBAL_CONFIG_KEY)
        .and_then(Value::as_object)
        .and_then(|g| g.get("groups"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

#[derive(Deserialize)]
pub struct GroupRequest {
    name: String,
}

#[derive(Deserialize)]
pub struct GroupOrderRequest {
    order: Vec<String>,
}

pub async fn list_groups(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    Json(Value::Array(load_groups(&state.config.load_all())))
}

pub async fn create_group(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GroupRequest>,
) -> Result<Json<Value>, ApiError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(bad_request("Group name is required"));
    }
    let group_id = generate_entity_id();
    state.config.with_exclusive(|all_config| {
        let mut groups = load_groups(all_config);
        groups.push(json!({"id": &group_id, "name": &name}));
        crate::config::ConfigStore::merge_global_section(
            all_config,
            "groups",
            Value::Array(groups),
        );
        Ok(())
    })?;
    tracing::info!("group created id={group_id} name={name}");
    Ok(Json(json!({"id": group_id, "name": name})))
}

pub async fn update_group(
    State(state): State<Arc<AppState>>,
    Path(group_id): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GroupRequest>,
) -> Result<Json<Value>, ApiError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(bad_request("Group name is required"));
    }
    state.config.with_exclusive(|all_config| {
        let mut groups = load_groups(all_config);
        let found = groups.iter_mut().any(|group| {
            if group.get("id").and_then(Value::as_str) == Some(group_id.as_str()) {
                group["name"] = Value::String(name.clone());
                true
            } else {
                false
            }
        });
        if !found {
            return Err(not_found(format!("Group '{group_id}' not found")));
        }
        crate::config::ConfigStore::merge_global_section(
            all_config,
            "groups",
            Value::Array(groups),
        );
        Ok(())
    })?;
    tracing::info!("group updated id={group_id} name={name}");
    Ok(Json(json!({"id": group_id, "name": name})))
}

pub async fn delete_group(
    State(state): State<Arc<AppState>>,
    Path(group_id): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    state.config.with_exclusive(|all_config| {
        let groups = load_groups(all_config);
        let new_groups: Vec<Value> = groups
            .iter()
            .filter(|g| g.get("id").and_then(Value::as_str) != Some(group_id.as_str()))
            .cloned()
            .collect();
        if new_groups.len() == groups.len() {
            return Err(not_found(format!("Group '{group_id}' not found")));
        }
        // グループに所属するワークスペースの group_id をクリアする
        for (key, entry) in all_config.iter_mut() {
            if key == GLOBAL_CONFIG_KEY {
                continue;
            }
            let Some(obj) = entry.as_object_mut() else {
                continue;
            };
            if obj.get("group_id").and_then(Value::as_str) == Some(group_id.as_str()) {
                obj.insert("group_id".to_string(), Value::Null);
            }
        }
        crate::config::ConfigStore::merge_global_section(
            all_config,
            "groups",
            Value::Array(new_groups),
        );
        Ok(())
    })?;
    tracing::info!("group deleted id={group_id}");
    Ok(Json(json!({"status": "ok"})))
}

pub async fn update_group_order(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<GroupOrderRequest>,
) -> Result<Json<Value>, ApiError> {
    let order_map: std::collections::HashMap<&str, usize> = body
        .order
        .iter()
        .enumerate()
        .map(|(i, gid)| (gid.as_str(), i))
        .collect();
    let ids = state.config.with_exclusive(|all_config| {
        let groups = load_groups(all_config);
        let mut sorted_groups = groups;
        let fallback = sorted_groups.len();
        sorted_groups.sort_by_key(|g| {
            g.get("id")
                .and_then(Value::as_str)
                .and_then(|id| order_map.get(id).copied())
                .unwrap_or(fallback)
        });
        let ids: Vec<Value> = sorted_groups
            .iter()
            .filter_map(|g| g.get("id").cloned())
            .collect();
        crate::config::ConfigStore::merge_global_section(
            all_config,
            "groups",
            Value::Array(sorted_groups),
        );
        Ok(ids)
    })?;
    tracing::info!("group order updated count={}", body.order.len());
    Ok(Json(Value::Array(ids)))
}
