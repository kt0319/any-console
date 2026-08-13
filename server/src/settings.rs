//! 設定 API（Python 側 `api/routers/settings.py` のサブセット移植 +
//! `api/routers/workspaces.py` の PUT /workspace-order）。
//!
//! config.json のグローバルセクションを読み書きするルートを移行する。
//! GET/PUT /settings/auth（auth.json ドメイン）は `crate::auth` 側に実装がある
//! （`/devices/*`・`/auth/check` 等との atomic cutover 単位のため）。

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::config::{ConfigStore, GLOBAL_CONFIG_KEY};
use crate::errors::{bad_request, too_large, ApiError};
use crate::jobs_common::{check_max_len, MAX_COMMAND_LENGTH, MAX_LABEL_LENGTH};
use crate::state::AppState;
use crate::util::{truncate_chars, JsonBody};

const LABEL_PREVIEW_LEN: usize = 20;
const MAX_IMPORT_SIZE: usize = 1024 * 1024;
const PHRASE_NOTIFY_IDLE_GRACE_SEC: i64 = 20;
const PHRASE_NOTIFY_GRACE_SEC_MAX: i64 = 600;

fn save_global(store: &ConfigStore, key: &str, value: Value) -> Result<(), ApiError> {
    store
        .save_global_section(key, value)
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e))
}

// ─── /settings/config-health・/settings/export・/settings/import ────────────

pub async fn config_health(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    Json(state.config.check_health())
}

pub async fn export_settings(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Json<Value> {
    Json(Value::Object(state.config.load_all()))
}

pub async fn import_settings(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    if body.len() > MAX_IMPORT_SIZE {
        return Err(too_large("Import data too large (max 1MB)"));
    }
    let data: Value = serde_json::from_slice(&body).map_err(|_| bad_request("Invalid JSON"))?;
    let Some(data) = data.as_object() else {
        return Err(bad_request("Expected JSON object"));
    };
    // 読み込み→マージ→書き込みを1つの排他ロックの下で行う。分離していると、
    // マージ元に使った読み込み後に別リクエストが加えた変更（ワークスペース登録・
    // ジョブ CRUD 等）を、インポートが古いスナップショットで丸ごと上書きして
    // しまう（Codex レビュー指摘）。
    state
        .config
        .with_exclusive(|current| {
            for (identifier, ws_config) in data {
                apply_import_entry(current, identifier, ws_config);
            }
            Ok(())
        })
        // `with_exclusive` は書き込み失敗を一律 500 として扱うが、Python の
        // /settings/import は不正なインポートデータによる検証エラー（ValueError）を
        // 400 として返す。ここだけはその契約を保つため 400 へ読み替える
        // （I/O 障害等サーバ起因の失敗は考えにくいが、区別する情報が無いため
        // インポート特有の「投入データが悪い」を優先する）。
        .map_err(|e| {
            if e.status == axum::http::StatusCode::INTERNAL_SERVER_ERROR {
                bad_request(e.detail)
            } else {
                e
            }
        })?;
    Ok(Json(json!({"status": "ok"})))
}

/// Python `_apply_import_entry` と同一: global は丸ごと置換、workspace は
/// 既存エントリ（パスが実在するもの）にのみマージし、name は既存を維持する。
fn apply_import_entry(current: &mut Map<String, Value>, identifier: &str, ws_config: &Value) {
    let Some(ws_obj) = ws_config.as_object() else {
        return;
    };
    if identifier == GLOBAL_CONFIG_KEY {
        current.insert(identifier.to_string(), ws_config.clone());
        return;
    }
    let Some(target_id) = ConfigStore::find_workspace_key(current, identifier) else {
        return;
    };
    let existing = current
        .get(&target_id)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let path = existing.get("path").and_then(Value::as_str).unwrap_or("");
    if !crate::paths::expand_user_path(path).is_dir() {
        return;
    }
    let mut merged = existing.clone();
    for (k, v) in ws_obj {
        merged.insert(k.clone(), v.clone());
    }
    let name = existing
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(&target_id);
    merged.insert("name".to_string(), Value::String(name.to_string()));
    current.insert(target_id.clone(), Value::Object(merged));
}

// ─── /settings/editor ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct EditorSettings {
    #[serde(default)]
    url_template: String,
}

pub async fn get_editor(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let editor = state
        .config
        .load_global_section("editor")
        .unwrap_or(json!({}));
    let url_template = editor
        .as_object()
        .and_then(|o| o.get("url_template"))
        .and_then(Value::as_str)
        .unwrap_or("");
    Json(json!({"url_template": url_template}))
}

pub async fn put_editor(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<EditorSettings>,
) -> Result<Json<Value>, ApiError> {
    check_max_len("url_template", &body.url_template, 2000)?;
    let url_template = body.url_template.trim().to_string();
    save_global(
        &state.config,
        "editor",
        json!({"url_template": url_template}),
    )?;
    Ok(Json(json!({"status": "ok", "url_template": url_template})))
}

// ─── /settings/notifications ────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct NotificationSettings {
    #[serde(default = "default_grace")]
    phrase_notify_grace_sec: i64,
}

fn default_grace() -> i64 {
    PHRASE_NOTIFY_IDLE_GRACE_SEC
}

/// Python `notification_grace_sec` と同一の解決規則。
pub(crate) fn notification_grace_sec(store: &ConfigStore) -> i64 {
    let raw = store.load_global_section("notifications");
    let Some(obj) = raw.as_ref().and_then(Value::as_object) else {
        return PHRASE_NOTIFY_IDLE_GRACE_SEC;
    };
    match obj.get("phrase_notify_grace_sec") {
        Some(Value::Number(n)) if !obj["phrase_notify_grace_sec"].is_boolean() => n
            .as_i64()
            .filter(|&v| v >= 0)
            .unwrap_or(PHRASE_NOTIFY_IDLE_GRACE_SEC),
        _ => PHRASE_NOTIFY_IDLE_GRACE_SEC,
    }
}

pub async fn get_notifications(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Json<Value> {
    Json(json!({"phrase_notify_grace_sec": notification_grace_sec(&state.config)}))
}

pub async fn put_notifications(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<NotificationSettings>,
) -> Result<Json<Value>, ApiError> {
    let v = body.phrase_notify_grace_sec;
    if !(0..=PHRASE_NOTIFY_GRACE_SEC_MAX).contains(&v) {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("phrase_notify_grace_sec must be between 0 and {PHRASE_NOTIFY_GRACE_SEC_MAX}"),
        ));
    }
    save_global(
        &state.config,
        "notifications",
        json!({"phrase_notify_grace_sec": v}),
    )?;
    Ok(Json(json!({"status": "ok", "phrase_notify_grace_sec": v})))
}

// ─── /settings/info-pills ───────────────────────────────────────────────────

const INFO_PILL_FIELDS: &[&str] = &[
    "files",
    "history",
    "changes",
    "branch",
    "prs",
    "actions",
    "devserver",
    "add",
    "dispatch",
];

/// 未知のキーを除外し、重複は初出のみ残し、欠けているキーはデフォルト順で末尾に補う。
fn normalize_pill_order(order: &[String]) -> Vec<String> {
    let mut known: Vec<String> = Vec::new();
    for key in order {
        if INFO_PILL_FIELDS.contains(&key.as_str()) && !known.contains(key) {
            known.push(key.clone());
        }
    }
    for key in INFO_PILL_FIELDS {
        if !known.iter().any(|k| k == key) {
            known.push(key.to_string());
        }
    }
    known
}

#[derive(Deserialize)]
pub struct InfoPillSettings {
    #[serde(default = "yes")]
    branch: bool,
    #[serde(default = "yes")]
    history: bool,
    #[serde(default = "yes")]
    prs: bool,
    #[serde(default = "yes")]
    actions: bool,
    #[serde(default = "yes")]
    changes: bool,
    #[serde(default = "yes")]
    devserver: bool,
    #[serde(default = "yes")]
    files: bool,
    #[serde(default = "yes")]
    add: bool,
    #[serde(default = "yes")]
    dispatch: bool,
    #[serde(default)]
    order: Vec<String>,
}

fn yes() -> bool {
    true
}

pub async fn get_info_pills(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let raw = state
        .config
        .load_global_section("info_pills")
        .unwrap_or(json!({}));
    let raw = raw.as_object().cloned().unwrap_or_default();
    let mut result = Map::new();
    for field in [
        "branch",
        "history",
        "prs",
        "actions",
        "changes",
        "devserver",
        "files",
        "add",
        "dispatch",
    ] {
        let v = raw
            .get(field)
            .map(|v| v.as_bool().unwrap_or(true) || v.as_i64().is_some_and(|n| n != 0))
            .unwrap_or(true);
        result.insert(field.to_string(), Value::Bool(v));
    }
    let order: Vec<String> = raw
        .get("order")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    result.insert(
        "order".to_string(),
        Value::Array(
            normalize_pill_order(&order)
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    Json(Value::Object(result))
}

pub async fn put_info_pills(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<InfoPillSettings>,
) -> Result<Json<Value>, ApiError> {
    let mut data = Map::new();
    for (key, v) in [
        ("branch", body.branch),
        ("history", body.history),
        ("prs", body.prs),
        ("actions", body.actions),
        ("changes", body.changes),
        ("devserver", body.devserver),
        ("files", body.files),
        ("add", body.add),
        ("dispatch", body.dispatch),
    ] {
        data.insert(key.to_string(), Value::Bool(v));
    }
    data.insert(
        "order".to_string(),
        Value::Array(
            normalize_pill_order(&body.order)
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    save_global(&state.config, "info_pills", Value::Object(data.clone()))?;
    let mut resp = Map::new();
    resp.insert("status".to_string(), Value::String("ok".to_string()));
    resp.extend(data);
    Ok(Json(Value::Object(resp)))
}

// ─── /settings/circle-keypad ────────────────────────────────────────────────

const CIRCLE_KEYPAD_KEY_COUNT: usize = 8;
const CIRCLE_KEYPAD_SPECIAL_COUNT: usize = 4;
const CIRCLE_KEYPAD_LABEL_MAX: usize = 20;
const CIRCLE_KEYPAD_ACTION_MAX: usize = 60;
const CIRCLE_KEYPAD_KEY_NAME_MAX: usize = 30;

#[derive(Deserialize, serde::Serialize)]
pub struct CircleKeypadKeyDef {
    key: String,
    #[serde(default)]
    ctrl: bool,
    #[serde(default)]
    shift: bool,
    #[serde(default)]
    alt: bool,
    #[serde(default)]
    label: String,
}

#[derive(Deserialize, serde::Serialize)]
pub struct CircleKeypadSpecialDef {
    label: String,
    action: String,
    #[serde(default)]
    payload: Option<Map<String, Value>>,
}

#[derive(Deserialize)]
pub struct CircleKeypadSettings {
    #[serde(default)]
    keys: Vec<CircleKeypadKeyDef>,
    #[serde(default)]
    specials: Vec<CircleKeypadSpecialDef>,
    #[serde(default = "yes")]
    enabled: bool,
}

pub async fn get_circle_keypad(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Json<Value> {
    let raw = state
        .config
        .load_global_section("circle_keypad")
        .unwrap_or(json!({}));
    let raw = raw.as_object().cloned().unwrap_or_default();
    let keys = raw
        .get("keys")
        .filter(|v| v.is_array())
        .cloned()
        .unwrap_or(json!([]));
    let specials = raw
        .get("specials")
        .filter(|v| v.is_array())
        .cloned()
        .unwrap_or(json!([]));
    let enabled = raw
        .get("enabled")
        .map(|v| !matches!(v, Value::Bool(false) | Value::Null))
        .unwrap_or(true);
    Json(json!({"keys": keys, "specials": specials, "enabled": enabled}))
}

pub async fn put_circle_keypad(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<CircleKeypadSettings>,
) -> Result<Json<Value>, ApiError> {
    for k in &body.keys {
        check_max_len("key", &k.key, CIRCLE_KEYPAD_KEY_NAME_MAX)?;
        check_max_len("label", &k.label, CIRCLE_KEYPAD_LABEL_MAX)?;
    }
    for s in &body.specials {
        check_max_len("label", &s.label, CIRCLE_KEYPAD_LABEL_MAX)?;
        check_max_len("action", &s.action, CIRCLE_KEYPAD_ACTION_MAX)?;
    }
    if !matches!(body.keys.len(), 0 | CIRCLE_KEYPAD_KEY_COUNT) {
        return Err(bad_request(format!(
            "keys must have 0 or {CIRCLE_KEYPAD_KEY_COUNT} items"
        )));
    }
    if !matches!(body.specials.len(), 0 | CIRCLE_KEYPAD_SPECIAL_COUNT) {
        return Err(bad_request(format!(
            "specials must have 0 or {CIRCLE_KEYPAD_SPECIAL_COUNT} items"
        )));
    }
    let data = json!({
        "keys": body.keys,
        "specials": body.specials,
        "enabled": body.enabled,
    });
    save_global(&state.config, "circle_keypad", data)?;
    Ok(Json(json!({"status": "ok"})))
}

// ─── /settings/layout ───────────────────────────────────────────────────────

const SPLIT_LAYOUT_VALUES: &[&str] = &["horizontal", "vertical", "grid"];
const SPLIT_SESSION_IDS_MAX: usize = 16;

#[derive(Deserialize, serde::Serialize)]
pub struct SplitLayoutSettings {
    #[serde(default)]
    session_ids: Vec<Option<String>>,
    #[serde(default = "default_layout")]
    layout: String,
    #[serde(default)]
    active_pane_index: i64,
}

fn default_layout() -> String {
    "horizontal".to_string()
}

pub async fn get_layout(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let raw = state
        .config
        .load_global_section("layout")
        .unwrap_or(json!({}));
    let split = raw
        .as_object()
        .and_then(|o| o.get("split"))
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or(Value::Null);
    Json(json!({"split": split}))
}

pub async fn put_layout(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<SplitLayoutSettings>,
) -> Result<Json<Value>, ApiError> {
    if !SPLIT_LAYOUT_VALUES.contains(&body.layout.as_str()) {
        let mut sorted: Vec<&str> = SPLIT_LAYOUT_VALUES.to_vec();
        sorted.sort_unstable();
        return Err(bad_request(format!(
            "layout must be one of: {}",
            sorted.join(", ")
        )));
    }
    if body.session_ids.len() > SPLIT_SESSION_IDS_MAX {
        return Err(bad_request(format!(
            "session_ids must have at most {SPLIT_SESSION_IDS_MAX} items"
        )));
    }
    let split = serde_json::to_value(&body).expect("serializable");
    save_global(&state.config, "layout", json!({"split": split}))?;
    Ok(Json(json!({"status": "ok"})))
}

pub async fn delete_layout(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    save_global(&state.config, "layout", json!({}))?;
    Ok(Json(json!({"status": "ok"})))
}

// ─── /snippets ──────────────────────────────────────────────────────────────

fn default_label(command: &str) -> String {
    let chars: Vec<char> = command.chars().collect();
    if chars.len() > LABEL_PREVIEW_LEN {
        format!(
            "{}...",
            chars[..LABEL_PREVIEW_LEN].iter().collect::<String>()
        )
    } else {
        command.to_string()
    }
}

#[derive(Deserialize)]
pub struct SnippetItem {
    #[serde(default)]
    label: String,
    command: String,
}

#[derive(Deserialize)]
pub struct UpdateSnippetsRequest {
    #[serde(default)]
    snippets: Vec<SnippetItem>,
}

/// スニペット1件を正規化する（GET/PUT で必ず同じ結果になるようここへ集約する）。
/// command が trim 後に空なら None。label が空なら `default_label(command)` を
/// 補い、双方を最大長へ切り詰める。
fn normalize_snippet(label: &str, command: &str) -> Option<Value> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }
    let label = label.trim();
    let label = if label.is_empty() {
        default_label(command)
    } else {
        label.to_string()
    };
    Some(json!({
        "label": truncate_chars(&label, MAX_LABEL_LENGTH),
        "command": truncate_chars(command, MAX_COMMAND_LENGTH),
    }))
}

pub async fn get_snippets(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let raw = state
        .config
        .load_global_section("snippets")
        .unwrap_or(json!([]));
    let items = raw.as_array().cloned().unwrap_or_default();
    let sanitized: Vec<Value> = items
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|obj| {
            let label = obj.get("label").and_then(Value::as_str).unwrap_or("");
            let command = obj.get("command").and_then(Value::as_str).unwrap_or("");
            normalize_snippet(label, command)
        })
        .collect();
    Json(json!({"snippets": sanitized}))
}

pub async fn put_snippets(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<UpdateSnippetsRequest>,
) -> Result<Json<Value>, ApiError> {
    for item in &body.snippets {
        check_max_len("label", &item.label, MAX_LABEL_LENGTH)?;
        check_max_len("command", &item.command, MAX_COMMAND_LENGTH)?;
    }
    let snippets: Vec<Value> = body
        .snippets
        .iter()
        .filter_map(|item| normalize_snippet(&item.label, &item.command))
        .collect();
    save_global(&state.config, "snippets", Value::Array(snippets.clone()))?;
    Ok(Json(json!({"status": "ok", "snippets": snippets})))
}

// ─── /recent-jobs ───────────────────────────────────────────────────────────
//
// Phase 1 では jobs 解決に依存するため保留していたが、jobs_common の移行
// （Phase 3）で解禁。GET はジョブが削除→再作成されて参照先が消えた
// スナップショットを除去し、除去があれば compare_and_update で排他ロック下に
// 書き戻す（除去計算中に割り込んだ他クライアントの PUT を上書きしない）。

fn recent_job_still_exists(state: &AppState, item: &Value) -> bool {
    let workspace = item.get("workspace").and_then(Value::as_str).unwrap_or("");
    let job_name = item.get("jobName").and_then(Value::as_str).unwrap_or("");
    if workspace.is_empty() || job_name.is_empty() {
        return true;
    }
    let owner = crate::jobs_common::resolve_jobs_owner(state, workspace);
    if state.config.resolve_workspace_id(&owner).is_none() {
        return true; // 判定できない場合は素通し（Python と同一）
    }
    crate::jobs_common::workspace_job_names(state, workspace)
        .iter()
        .any(|n| n == job_name)
}

fn prune_recent_jobs(state: &AppState, raw: &Value) -> Vec<Value> {
    let items = raw.as_array().cloned().unwrap_or_default();
    items
        .into_iter()
        .filter(|item| {
            item.is_object()
                && !item
                    .get("key")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .is_empty()
        })
        .filter(|item| recent_job_still_exists(state, item))
        .collect()
}

pub async fn get_recent_jobs(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let raw = state
        .config
        .load_global_section("recent_jobs")
        .unwrap_or(json!([]));
    let valid = Value::Array(prune_recent_jobs(&state, &raw));
    let result = if valid != raw {
        state
            .config
            .compare_and_update_global_section("recent_jobs", &raw, valid)
            .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e))?
    } else {
        valid
    };
    // v4 リネーム（jobDetachedTab → jobDetached）の過渡期対応: 開いたままの
    // 旧 SPA バンドルは GET 応答で自前キャッシュを丸ごと置き換えた上で
    // jobDetachedTab しか読まないため、応答にのみ同値のミラーを併載する
    // （保存形は jobDetached のみ）。旧バンドルが淘汰されたら削除してよい。
    let mut result = result;
    if let Some(items) = result.as_array_mut() {
        for item in items {
            if let Some(obj) = item.as_object_mut() {
                if obj.get("jobDetached") == Some(&Value::Bool(true)) {
                    obj.insert("jobDetachedTab".to_string(), Value::Bool(true));
                }
            }
        }
    }
    Ok(Json(json!({"recent_jobs": result})))
}

#[derive(Deserialize, serde::Serialize)]
pub struct RecentJobItem {
    key: String,
    #[serde(default)]
    workspace: String,
    #[serde(default, rename = "wsIcon")]
    ws_icon: String,
    #[serde(default, rename = "wsIconColor")]
    ws_icon_color: String,
    #[serde(default, rename = "jobName")]
    job_name: String,
    #[serde(default, rename = "jobLabel")]
    job_label: String,
    #[serde(default, rename = "jobIcon")]
    job_icon: String,
    #[serde(default, rename = "jobIconColor")]
    job_icon_color: String,
    #[serde(default, rename = "jobCommand")]
    job_command: String,
    #[serde(default, rename = "jobConfirm")]
    job_confirm: Option<bool>,
    /// v4 リネーム（jobDetachedTab → jobDetached）の過渡期対応。serde の
    /// alias ではなく独立フィールドで受ける — GET 応答のミラー（`get_recent_jobs`）
    /// を丸ごと PUT し返す旧 SPA は両キーを同時に送ってくるため、alias だと
    /// duplicate field エラーで保存が壊れる。新キーが明示されていればそちらを
    /// 正とし（新キー優先）、無ければ legacy を採用する（`detached()`）。
    /// 保存形は jobDetached のみ（`skip_serializing`）。
    #[serde(
        default,
        rename = "jobDetached",
        skip_serializing_if = "Option::is_none"
    )]
    job_detached: Option<bool>,
    #[serde(default, rename = "jobDetachedTab", skip_serializing)]
    job_detached_tab_legacy: Option<bool>,
    #[serde(default)]
    pinned: bool,
}

impl RecentJobItem {
    /// detached の実効値（新キー優先で legacy へフォールバック）。
    fn detached(&self) -> bool {
        self.job_detached
            .or(self.job_detached_tab_legacy)
            .unwrap_or(false)
    }
}

#[derive(Deserialize)]
pub struct UpdateRecentJobsRequest {
    #[serde(default)]
    recent_jobs: Vec<RecentJobItem>,
}

pub async fn put_recent_jobs(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<UpdateRecentJobsRequest>,
) -> Result<Json<Value>, ApiError> {
    // Python の RecentJobItem（pydantic）が全フィールドに max_length を課しているのと
    // 同じ制約を課す（Codex レビュー指摘: 一部フィールドしか検証していなかったため、
    // Python 版なら 422 になる巨大な jobName 等がそのまま config.json に保存され、
    // API 契約が変わってしまっていた）。
    for item in &body.recent_jobs {
        for (v, max, field) in [
            (&item.key, MAX_LABEL_LENGTH, "key"),
            (&item.workspace, MAX_LABEL_LENGTH, "workspace"),
            (&item.ws_icon, MAX_LABEL_LENGTH, "wsIcon"),
            (&item.ws_icon_color, MAX_LABEL_LENGTH, "wsIconColor"),
            (&item.job_name, MAX_LABEL_LENGTH, "jobName"),
            (&item.job_label, MAX_LABEL_LENGTH, "jobLabel"),
            (&item.job_icon, MAX_LABEL_LENGTH, "jobIcon"),
            (&item.job_icon_color, MAX_LABEL_LENGTH, "jobIconColor"),
            (&item.job_command, MAX_COMMAND_LENGTH, "jobCommand"),
        ] {
            check_max_len(field, v, max)?;
        }
    }
    // Python は Pydantic model_dump（全フィールドをキャメルケースで保存）
    let recent_jobs: Vec<Value> = body
        .recent_jobs
        .iter()
        .filter(|item| !item.key.trim().is_empty())
        .map(|item| {
            let mut v = serde_json::to_value(item).expect("serializable");
            // legacy キー（jobDetachedTab）でしか指定されていない場合も、
            // 保存形は常に実効値の jobDetached に畳み込む（過渡期対応）。
            if let Some(obj) = v.as_object_mut() {
                obj.insert("jobDetached".to_string(), json!(item.detached()));
            }
            v
        })
        .collect();
    save_global(
        &state.config,
        "recent_jobs",
        Value::Array(recent_jobs.clone()),
    )?;
    Ok(Json(json!({"status": "ok", "recent_jobs": recent_jobs})))
}

// ─── PUT /workspace-order（workspaces.py から）──────────────────────────────

#[derive(Deserialize)]
pub struct WorkspaceOrderRequest {
    order: Vec<String>,
}

pub async fn put_workspace_order(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<WorkspaceOrderRequest>,
) -> Result<Json<Value>, ApiError> {
    let count = body.order.len();
    save_global(
        &state.config,
        "workspace_order",
        Value::Array(body.order.into_iter().map(Value::String).collect()),
    )?;
    tracing::info!("workspace order updated count={count}");
    Ok(Json(json!({"status": "ok"})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pill_order_normalization() {
        let out = normalize_pill_order(&["branch".into(), "unknown".into(), "branch".into()]);
        assert_eq!(out[0], "branch");
        assert_eq!(out.len(), INFO_PILL_FIELDS.len());
        assert!(!out.contains(&"unknown".to_string()));
        // 欠けたキーはデフォルト順で末尾補完
        let default_out = normalize_pill_order(&[]);
        assert_eq!(
            default_out,
            INFO_PILL_FIELDS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn default_label_previews_long_commands() {
        assert_eq!(default_label("ls"), "ls");
        let long = "a".repeat(30);
        assert_eq!(default_label(&long), format!("{}...", "a".repeat(20)));
    }
}
