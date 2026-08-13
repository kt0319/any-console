//! ジョブ系ルーターの共有ロジック（Python 側 `api/routers/jobs_common.py` +
//! `api/job_models.py` + `api/validators.py` のアイコン検証の移植）。

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::config::ConfigStore;
use crate::errors::{bad_request, not_found, server_error, too_large, ApiError};
use crate::git_utils::split_worktree_name;
use crate::state::AppState;

const WORKSPACE_JOBS_CACHE_TTL_SEC: u64 = 60;
pub const MAX_LABEL_LENGTH: usize = 200;
pub const MAX_COMMAND_LENGTH: usize = 10000;
pub const MAX_ICON_VALUE_LENGTH: usize = 200_000;
pub const COMMON_JOBS_CACHE_KEY: &str = "__common_jobs__";
pub const TERMINAL_JOB_KEY: &str = "terminal";

// ─── アイコン検証（validators.py）───────────────────────────────────────────

/// ICON_PATTERN 相当: mdi- / favicon: / data:image/ / icon:<hash16>.<ext>
fn icon_pattern_matches(icon: &str) -> bool {
    if let Some(rest) = icon.strip_prefix("mdi-") {
        return !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    }
    if let Some(rest) = icon.strip_prefix("favicon:") {
        return !rest.is_empty()
            && rest
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    }
    if let Some(rest) = icon.strip_prefix("data:image/") {
        return !rest.is_empty();
    }
    if let Some(rest) = icon.strip_prefix("icon:") {
        let Some((hash, ext)) = rest.split_once('.') else {
            return false;
        };
        return hash.len() == 16
            && hash
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            && matches!(ext, "png" | "jpg" | "gif" | "webp" | "svg");
    }
    false
}

pub async fn validate_icon(state: &AppState, icon: &str) -> Result<String, ApiError> {
    let icon = icon.trim();
    if icon.is_empty() {
        return Ok(String::new());
    }
    if icon.chars().count() > MAX_ICON_VALUE_LENGTH {
        return Err(too_large("Icon value too long"));
    }
    let normalized = crate::icons::resolve_and_store_icon(&state.paths.icons_dir, icon)
        .await
        .map_err(|e| server_error(e.to_string()))?;
    if !icon_pattern_matches(&normalized) {
        return Err(bad_request(format!("Invalid icon format: {normalized}")));
    }
    Ok(normalized)
}

pub fn validate_icon_color(color: &str) -> Result<String, ApiError> {
    let color = color.trim();
    if color.is_empty() {
        return Ok(String::new());
    }
    let ok = color.starts_with('#')
        && (3..=6).contains(&(color.len() - 1))
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !ok {
        return Err(bad_request(format!("Invalid icon color: {color}")));
    }
    Ok(color.to_string())
}

// ─── ジョブデータのキャッシュ（TTL 60 秒）──────────────────────────────────
//
// Python 側と同じ TTL。移行期間中、Rust の書き込みは Python 側キャッシュを即時
// 無効化できないが、TTL 以内に必ず再読込されるため staleness の上限は従来と同じ。

pub struct JobsCache(crate::util::TtlCache<Map<String, Value>>);

impl Default for JobsCache {
    fn default() -> Self {
        Self::new()
    }
}

impl JobsCache {
    pub fn new() -> Self {
        Self(crate::util::TtlCache::new(Duration::from_secs(
            WORKSPACE_JOBS_CACHE_TTL_SEC,
        )))
    }

    fn get(&self, key: &str) -> Option<Map<String, Value>> {
        self.0.get(key)
    }

    fn set(&self, key: &str, value: Map<String, Value>) {
        self.0.set(key, value);
    }

    fn invalidate(&self, key: &str) {
        self.0.invalidate(key);
    }

    fn invalidate_all(&self) {
        self.0.invalidate_all();
    }
}

fn section_as_map(v: Option<Value>) -> Map<String, Value> {
    v.and_then(|x| x.as_object().cloned()).unwrap_or_default()
}

pub fn load_common_jobs_data(state: &AppState) -> Map<String, Value> {
    if let Some(cached) = state.jobs_cache.get(COMMON_JOBS_CACHE_KEY) {
        return cached;
    }
    let data = section_as_map(state.config.load_global_section("jobs"));
    state.jobs_cache.set(COMMON_JOBS_CACHE_KEY, data.clone());
    data
}

pub fn save_common_jobs_data(state: &AppState, data: Map<String, Value>) -> Result<(), ApiError> {
    commit_common_jobs(
        state,
        Box::new(move |jobs| {
            *jobs = data;
            Ok(())
        }),
    )
}

/// 共通ジョブの読み込み→変更→書き込みを1つの排他ロックの下で行う
/// （`mutate` は commit 時点の最新データに対して適用される — commit と離れた
/// 場所で先に読み込んだ古いスナップショットをそのまま書き戻すと、その間に
/// 別リクエストが加えた変更を lost update してしまうため、`ConfigStore::with_exclusive`
/// の中で毎回読み直す設計にしている）。
pub fn commit_common_jobs(state: &AppState, mutate: JobsMutator) -> Result<(), ApiError> {
    state.config.with_exclusive(|all| {
        let mut jobs = section_as_map(
            all.get(crate::config::GLOBAL_CONFIG_KEY)
                .and_then(Value::as_object)
                .and_then(|g| g.get("jobs"))
                .cloned(),
        );
        mutate(&mut jobs)?;
        ConfigStore::merge_global_section(all, "jobs", Value::Object(jobs));
        Ok(())
    })?;
    state.jobs_cache.invalidate(COMMON_JOBS_CACHE_KEY);
    state.jobs_cache.invalidate_all();
    Ok(())
}

pub fn load_workspace_jobs_data(state: &AppState, identifier: &str) -> Map<String, Value> {
    if let Some(cached) = state.jobs_cache.get(identifier) {
        return cached;
    }
    let cfg = state.config.load_workspace_config(identifier);
    let data = cfg
        .get("jobs")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    state.jobs_cache.set(identifier, data.clone());
    data
}

/// ワークスペースジョブの読み込み→変更→書き込みを1つの排他ロックの下で行う
/// （Python `save_workspace_config_section` は同じくロック下で read-modify-write
/// する。`mutate` は commit 時点の最新データに対して適用される — 詳細は
/// `commit_common_jobs` のコメント参照）。
pub fn commit_workspace_jobs(
    state: &AppState,
    identifier: &str,
    mutate: JobsMutator,
) -> Result<(), ApiError> {
    let identifier_owned = identifier.to_string();
    state.config.with_exclusive(|all| {
        // Python save_workspace_config_section と同じ: エントリの jobs キーだけ差し替える
        let key = ConfigStore::find_workspace_key(all, &identifier_owned)
            .unwrap_or_else(|| identifier_owned.clone());
        let mut entry = all
            .get(&key)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut jobs = entry
            .get("jobs")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        mutate(&mut jobs)?;
        entry.insert("jobs".to_string(), Value::Object(jobs));
        all.insert(key, Value::Object(entry));
        Ok(())
    })?;
    state.jobs_cache.invalidate(identifier);
    Ok(())
}

/// worktree のワークスペースはベースのワークスペースとジョブを共有する。
pub fn resolve_jobs_owner(state: &AppState, identifier: &str) -> String {
    if identifier.is_empty() {
        return identifier.to_string();
    }
    if let Some((base, _branch)) = split_worktree_name(identifier) {
        if state.config.resolve_workspace_id(&base).is_some() {
            return base;
        }
    }
    identifier.to_string()
}

// ─── JobDefinition の整形 ───────────────────────────────────────────────────

/// config のエントリを API 応答の dict に整形する（Python
/// `entry_to_job_definition` + `job_definition_to_dict` 相当）。
pub fn job_entry_to_dict(name: &str, entry: &Value, is_common: Option<bool>) -> Value {
    let s = |k: &str, d: &str| {
        entry
            .get(k)
            .and_then(Value::as_str)
            .unwrap_or(d)
            .to_string()
    };
    let b = |k: &str, d: bool| entry.get(k).and_then(Value::as_bool).unwrap_or(d);
    let mut out = json!({
        "label": s("label", name),
        "command": s("command", ""),
        "icon": s("icon", ""),
        "icon_color": s("icon_color", ""),
        "confirm": b("confirm", true),
        "detached_tab": b("detached_tab", false),
        "notify_phrase": s("notify_phrase", ""),
    });
    if let Some(c) = is_common {
        out["common"] = json!(c);
    }
    out
}

/// 共通ジョブとワークスペースジョブをマージして API 応答形に整形する
/// （Python `serialize_workspace_jobs` 相当）。
pub fn serialize_workspace_jobs(state: &AppState, identifier: &str) -> Map<String, Value> {
    if identifier.is_empty() {
        return Map::new();
    }
    let common = load_common_jobs_data(state);
    let owner = resolve_jobs_owner(state, identifier);
    let ws = load_workspace_jobs_data(state, &owner);
    merge_jobs_serialized(&ws, &common)
}

pub fn merge_jobs_serialized(
    ws_jobs: &Map<String, Value>,
    common_jobs: &Map<String, Value>,
) -> Map<String, Value> {
    let mut merged: Map<String, Value> = Map::new();
    for (is_common, jobs) in [(true, common_jobs), (false, ws_jobs)] {
        for (name, entry) in jobs {
            merged.insert(
                name.clone(),
                job_entry_to_dict(name, entry, Some(is_common)),
            );
        }
    }
    merged
}

/// ジョブ名の存在確認（recent-jobs の除去判定用 — Python `get_workspace_jobs` の
/// キー集合に対応）。
pub fn workspace_job_names(state: &AppState, identifier: &str) -> Vec<String> {
    serialize_workspace_jobs(state, identifier)
        .keys()
        .cloned()
        .collect()
}

// ─── CRUD ヘルパー ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct JobRequest {
    pub label: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub icon_color: String,
    #[serde(default = "yes")]
    pub confirm: bool,
    #[serde(default)]
    pub detached_tab: bool,
    #[serde(default)]
    pub notify_phrase: String,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
pub struct ReorderJobsRequest {
    #[serde(default)]
    pub order: Vec<String>,
}

/// Pydantic の Field(max_length=...) 相当（超過は 422）。settings 側の
/// スニペット/ジョブ検証とエラー文言・ステータスを共有する。
pub fn check_max_len(field: &str, value: &str, max: usize) -> Result<(), ApiError> {
    if value.chars().count() > max {
        return Err(ApiError::new(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            format!("{field} exceeds max length {max}"),
        ));
    }
    Ok(())
}

pub fn check_job_request_lengths(body: &JobRequest) -> Result<(), ApiError> {
    for (v, max, field) in [
        (&body.label, MAX_LABEL_LENGTH, "label"),
        (&body.command, MAX_COMMAND_LENGTH, "command"),
        (&body.icon, MAX_ICON_VALUE_LENGTH, "icon"),
        (&body.icon_color, 20, "icon_color"),
        (&body.notify_phrase, 200, "notify_phrase"),
    ] {
        check_max_len(field, v, max)?;
    }
    Ok(())
}

pub fn generate_job_key(existing: &Map<String, Value>) -> String {
    for _ in 0..20 {
        let candidate = format!("job_{}", crate::util::token_hex(6));
        if !existing.contains_key(&candidate) {
            return candidate;
        }
    }
    format!("job_{}", crate::util::now_epoch())
}

struct ValidatedJob {
    label: String,
    command: String,
}

fn validate_job_fields(body: &JobRequest) -> Result<ValidatedJob, ApiError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(bad_request("Please enter a display name"));
    }
    let command = body.command.trim().to_string();
    if command.is_empty() {
        return Err(bad_request("Command is empty"));
    }
    Ok(ValidatedJob { label, command })
}

/// Python `build_job_entry` と同一（デフォルト値は保存しない）。
async fn build_job_entry(
    state: &AppState,
    v: &ValidatedJob,
    body: &JobRequest,
    notify_phrase: &str,
) -> Result<Value, ApiError> {
    let mut entry = Map::new();
    entry.insert("command".to_string(), json!(v.command));
    if !v.label.is_empty() {
        entry.insert("label".to_string(), json!(v.label));
    }
    let icon = validate_icon(state, &body.icon).await?;
    let icon_color = validate_icon_color(&body.icon_color)?;
    if !icon.is_empty() {
        entry.insert("icon".to_string(), json!(icon));
    }
    if !icon_color.is_empty() {
        entry.insert("icon_color".to_string(), json!(icon_color));
    }
    if !body.confirm {
        entry.insert("confirm".to_string(), json!(false));
    }
    if body.detached_tab {
        entry.insert("detached_tab".to_string(), json!(true));
    }
    if !notify_phrase.is_empty() {
        entry.insert("notify_phrase".to_string(), json!(notify_phrase));
    }
    Ok(Value::Object(entry))
}

/// `commit_workspace_jobs`/`commit_common_jobs` に渡す mutate クロージャの型。
type JobsMutator = Box<dyn FnOnce(&mut Map<String, Value>) -> Result<(), ApiError> + Send>;

/// `data` は job_name 未指定時の自動採番（`generate_job_key`）にのみ使う参考
/// スナップショットで、実際の書き込みは commit 時点の最新データに対して行う
/// （`commit_fn` に渡す mutate クロージャの中で完結させ、`data` を丸ごと
/// 書き戻すことによる lost update を避ける — Codex レビュー指摘）。
/// job_name 指定時（更新）は、commit 時点で該当ジョブが存在するかも
/// 併せて再検証する（TOCTOU を防ぐ）。
pub async fn save_job(
    state: &AppState,
    data: Map<String, Value>,
    commit_fn: impl FnOnce(&AppState, JobsMutator) -> Result<(), ApiError>,
    job_name: Option<String>,
    body: &JobRequest,
    log_context: &str,
) -> Result<Value, ApiError> {
    check_job_request_lengths(body)?;
    let validated = validate_job_fields(body)?;
    let notify_phrase = body.notify_phrase.trim().to_string();
    let is_update = job_name.is_some();
    let job_name = job_name.unwrap_or_else(|| generate_job_key(&data));
    let entry = build_job_entry(state, &validated, body, &notify_phrase).await?;
    let job_name_for_commit = job_name.clone();
    commit_fn(
        state,
        Box::new(move |fresh| {
            if is_update && !fresh.contains_key(&job_name_for_commit) {
                return Err(not_found(format!("Job '{job_name_for_commit}' not found")));
            }
            fresh.insert(job_name_for_commit, entry);
            Ok(())
        }),
    )?;
    tracing::info!("{log_context} job={job_name}");
    Ok(json!({"status": "ok", "name": job_name}))
}

pub fn delete_job(
    state: &AppState,
    commit_fn: impl FnOnce(&AppState, JobsMutator) -> Result<(), ApiError>,
    job_name: &str,
    not_found_msg: &str,
    log_context: &str,
) -> Result<Value, ApiError> {
    let job_name_owned = job_name.to_string();
    let not_found_msg_owned = not_found_msg.to_string();
    commit_fn(
        state,
        Box::new(move |fresh| {
            if fresh.shift_remove(&job_name_owned).is_none() {
                return Err(not_found(not_found_msg_owned));
            }
            Ok(())
        }),
    )?;
    tracing::info!("{log_context} job={job_name}");
    Ok(json!({"status": "ok", "name": job_name}))
}

pub fn reorder_jobs(
    state: &AppState,
    commit_fn: impl FnOnce(&AppState, JobsMutator) -> Result<(), ApiError>,
    order: &[String],
    log_context: &str,
) -> Result<Value, ApiError> {
    let order_owned: Vec<String> = order.to_vec();
    commit_fn(
        state,
        Box::new(move |fresh| {
            let mut want: Vec<&String> = order_owned.iter().collect();
            let mut have: Vec<&String> = fresh.keys().collect();
            want.sort();
            have.sort();
            if want != have {
                return Err(bad_request("Job list mismatch"));
            }
            let mut reordered = Map::new();
            for name in &order_owned {
                if let Some(v) = fresh.get(name) {
                    reordered.insert(name.clone(), v.clone());
                }
            }
            *fresh = reordered;
            Ok(())
        }),
    )?;
    tracing::info!("{log_context} count={}", order.len());
    Ok(json!({"status": "ok"}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_pattern() {
        assert!(icon_pattern_matches("mdi-rocket-launch"));
        assert!(icon_pattern_matches("favicon:example.com"));
        assert!(icon_pattern_matches("data:image/png;base64,AAAA"));
        assert!(icon_pattern_matches("icon:0123456789abcdef.png"));
        assert!(!icon_pattern_matches("icon:short.png"));
        assert!(!icon_pattern_matches("icon:0123456789abcdef.tiff"));
        assert!(!icon_pattern_matches("http://example.com/x.png"));
    }

    #[test]
    fn icon_color_validation() {
        assert_eq!(validate_icon_color(" #fff ").unwrap(), "#fff");
        assert_eq!(validate_icon_color("#00FF00").unwrap(), "#00FF00");
        assert_eq!(validate_icon_color("").unwrap(), "");
        assert!(validate_icon_color("red").is_err());
        assert!(validate_icon_color("#1234567").is_err());
    }

    #[test]
    fn job_entry_dict_defaults() {
        let entry = serde_json::json!({"command": "npm test"});
        let d = job_entry_to_dict("job_x", &entry, Some(false));
        assert_eq!(d["label"], "job_x");
        assert_eq!(d["confirm"], true);
        assert_eq!(d["common"], false);
    }

    #[test]
    fn merge_prefers_workspace_jobs() {
        let mut common = Map::new();
        common.insert("build".to_string(), serde_json::json!({"command": "make"}));
        common.insert("test".to_string(), serde_json::json!({"command": "pytest"}));
        let mut ws = Map::new();
        ws.insert(
            "test".to_string(),
            serde_json::json!({"command": "cargo test"}),
        );
        let merged = merge_jobs_serialized(&ws, &common);
        assert_eq!(merged["build"]["common"], true);
        assert_eq!(merged["test"]["common"], false);
        assert_eq!(merged["test"]["command"], "cargo test");
    }
}
