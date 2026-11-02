//! Dispatch recipes（ADR 34）。サーバ側に登録した定型の dispatch 定義。
//!
//! 起動側（外部 API）は recipe ID と検証済みの引数だけを渡す。プロンプト・job・
//! worktree はここの定義（config の global セクション `dispatch_recipes`）で固定され、
//! 引数は宣言済みパターンで検証した文字列として、テンプレートへ埋め込まれるだけ
//! （シェルやコマンドラインには渡さない）。条件を満たす recipe（`approve: auto`）に
//! 限り承認キューを経由せず即時起動する。
//!
//! 起動回数の上限（`max_per_day` / `cooldown_sec`）は、既存の activity ログ
//! （`data/activity/{workspace}/{日付}.jsonl`）の `recipe_fired` イベントを数えて
//! 判定する。新しい保存ファイルを増やさず、再起動してもリセットされない。
//! `RECENT_LIMIT` が 10 件の dispatch 履歴は手動の dispatch と共有のため、数え落として
//! 上限を超えてしまう（fail-open）ので使わない。

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path as FsPath;
use std::sync::{Arc, OnceLock};

use axum::extract::{Path, State};
use axum::Json;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::auth::RequireAuth;
use crate::dispatch::DispatchRequest;
use crate::errors::{bad_request, conflict, forbidden, not_found, too_many_requests, ApiError};
use crate::jobs_common::{serialize_workspace_jobs, TERMINAL_JOB_KEY};
use crate::state::AppState;
use crate::util::{default_true, now_epoch, JsonBody};

pub const RECIPES_CONFIG_KEY: &str = "dispatch_recipes";
pub const RECIPES_PAUSED_CONFIG_KEY: &str = "dispatch_recipes_paused";
pub const RECIPE_ORIGIN_PREFIX: &str = "recipe:";
const ACTIVITY_EVENT_FIRED: &str = "recipe_fired";

const RECIPE_ID_MAX_LEN: usize = 64;
const PARAM_VALUE_MAX_LEN: usize = 200;
const REF_MAX_LEN: usize = 200;
const DEDUP_MAX_LEN: usize = 300;
const TEXT_MAX_LEN: usize = 4000;
const RATE_WINDOW_SEC: i64 = 24 * 60 * 60;
const BUILTIN_VAR_WORKSPACE: &str = "workspace";

// ─── 定義とバリデーション ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Approve {
    Manual,
    Auto,
}

impl Approve {
    pub fn as_str(self) -> &'static str {
        match self {
            Approve::Manual => "manual",
            Approve::Auto => "auto",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ParamSpec {
    pattern: Regex,
    pub required: bool,
}

#[derive(Debug, Clone)]
pub struct Recipe {
    pub id: String,
    pub enabled: bool,
    pub workspace: String,
    worktree: Option<String>,
    branch: Option<String>,
    create_branch: bool,
    base_branch: Option<String>,
    job: String,
    text: String,
    dedup: Option<String>,
    pub params: BTreeMap<String, ParamSpec>,
    pub approve: Approve,
    pub max_per_day: Option<u32>,
    pub cooldown_sec: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRecipe {
    id: String,
    #[serde(default = "default_true")]
    enabled: bool,
    workspace: String,
    #[serde(default)]
    worktree: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    create_branch: bool,
    #[serde(default)]
    base_branch: Option<String>,
    job: String,
    text: String,
    #[serde(default)]
    dedup: Option<String>,
    #[serde(default)]
    params: BTreeMap<String, RawParam>,
    #[serde(default)]
    approve: Option<String>,
    #[serde(default)]
    max_per_day: Option<u32>,
    #[serde(default)]
    cooldown_sec: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawParam {
    #[serde(default)]
    pattern: Option<String>,
    #[serde(default)]
    required: bool,
}

fn template_var_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{([A-Za-z0-9_]+)\}").expect("template var regex"))
}

fn template_vars(template: &str) -> BTreeSet<String> {
    template_var_regex()
        .captures_iter(template)
        .map(|c| c[1].to_string())
        .collect()
}

fn expand_template(template: &str, vars: &BTreeMap<String, String>) -> String {
    template_var_regex()
        .replace_all(template, |caps: &regex::Captures| {
            vars.get(&caps[1]).cloned().unwrap_or_default()
        })
        .into_owned()
}

pub fn is_valid_recipe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= RECIPE_ID_MAX_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_param_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// ブランチ・worktree 名として展開後に許す形（git のオプションや親ディレクトリ
/// 参照として解釈される形を除く）。
fn is_safe_ref(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= REF_MAX_LEN
        && !s.starts_with(['-', '/'])
        && !s.contains("..")
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-'))
}

fn is_safe_dedup_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= DEDUP_MAX_LEN
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/' | '-' | ':' | '@'))
}

fn has_control_char(s: &str) -> bool {
    s.chars().any(char::is_control)
}

/// `job_exists(workspace, job)` は `approve: auto` のときだけ呼ぶ。
pub fn parse_recipe(
    value: &Value,
    job_exists: &dyn Fn(&str, &str) -> bool,
) -> Result<Recipe, String> {
    let raw: RawRecipe = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;

    if !is_valid_recipe_id(&raw.id) {
        return Err(format!("invalid id (expected [a-z0-9-]+): {}", raw.id));
    }
    if raw.workspace.trim().is_empty() {
        return Err("workspace is required".to_string());
    }
    if raw.job.trim().is_empty() || raw.job == TERMINAL_JOB_KEY {
        return Err("job must be a workspace job (terminal is not allowed)".to_string());
    }
    if raw.text.trim().is_empty() {
        return Err("text is required".to_string());
    }
    if raw.max_per_day == Some(0) {
        return Err("max_per_day must be 1 or more".to_string());
    }

    let mut params = BTreeMap::new();
    for (name, p) in raw.params {
        if !is_valid_param_name(&name) || name == BUILTIN_VAR_WORKSPACE {
            return Err(format!("invalid param name: {name}"));
        }
        let source = p
            .pattern
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("param {name}: pattern is required"))?;
        let pattern = Regex::new(&format!("^(?:{source})$"))
            .map_err(|e| format!("param {name}: invalid pattern: {e}"))?;
        params.insert(
            name,
            ParamSpec {
                pattern,
                required: p.required,
            },
        );
    }

    let mut allowed_vars: HashSet<&str> = params.keys().map(String::as_str).collect();
    allowed_vars.insert(BUILTIN_VAR_WORKSPACE);
    let templates = [
        ("worktree", raw.worktree.as_deref()),
        ("branch", raw.branch.as_deref()),
        ("base_branch", raw.base_branch.as_deref()),
        ("text", Some(raw.text.as_str())),
        ("dedup", raw.dedup.as_deref()),
    ];
    for (field, template) in templates {
        for var in template.map(template_vars).unwrap_or_default() {
            if !allowed_vars.contains(var.as_str()) {
                return Err(format!("{field}: undeclared template variable {{{var}}}"));
            }
        }
    }

    let approve = match raw.approve.as_deref().unwrap_or("manual") {
        "manual" => Approve::Manual,
        "auto" => Approve::Auto,
        other => return Err(format!("invalid approve: {other}")),
    };
    if approve == Approve::Auto {
        if raw.worktree.as_deref().is_none_or(|w| w.trim().is_empty()) {
            return Err("approve: auto requires worktree".to_string());
        }
        if raw.max_per_day.is_none() {
            return Err("approve: auto requires max_per_day (1 or more)".to_string());
        }
        if !job_exists(&raw.workspace, &raw.job) {
            return Err(format!(
                "approve: auto requires a defined job: {} (workspace {})",
                raw.job, raw.workspace
            ));
        }
    }

    Ok(Recipe {
        id: raw.id,
        enabled: raw.enabled,
        workspace: raw.workspace,
        worktree: raw.worktree.filter(|s| !s.is_empty()),
        branch: raw.branch.filter(|s| !s.is_empty()),
        create_branch: raw.create_branch,
        base_branch: raw.base_branch.filter(|s| !s.is_empty()),
        job: raw.job,
        text: raw.text,
        dedup: raw.dedup.filter(|s| !s.is_empty()),
        params,
        approve,
        max_per_day: raw.max_per_day,
        cooldown_sec: raw.cooldown_sec,
    })
}

/// 不正な recipe はログに出して無効扱いにする（サーバの起動は止めない）。
/// id が重複した場合は先に定義されたものだけを有効にする。
pub fn parse_recipes(items: &[Value], job_exists: &dyn Fn(&str, &str) -> bool) -> Vec<Recipe> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut recipes = Vec::new();
    for (index, item) in items.iter().enumerate() {
        match parse_recipe(item, job_exists) {
            Ok(recipe) if seen.contains(&recipe.id) => {
                tracing::warn!(
                    "dispatch recipe ignored index={index} id={}: duplicate id",
                    recipe.id
                );
            }
            Ok(recipe) => {
                seen.insert(recipe.id.clone());
                recipes.push(recipe);
            }
            Err(e) => tracing::warn!("dispatch recipe ignored index={index}: {e}"),
        }
    }
    recipes
}

pub fn load_recipes(state: &AppState) -> Vec<Recipe> {
    let items = state.config.load_global_array(RECIPES_CONFIG_KEY);
    parse_recipes(&items, &|workspace, job| {
        serialize_workspace_jobs(state, workspace).contains_key(job)
    })
}

pub fn recipes_paused(state: &AppState) -> bool {
    state
        .config
        .load_global_section(RECIPES_PAUSED_CONFIG_KEY)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

// ─── 引数の検証とテンプレート展開 ────────────────────────────────────────────

/// 展開済みの dispatch 内容。`dispatch::DispatchRequest` の元になる。
#[derive(Debug, PartialEq)]
pub struct Rendered {
    pub workspace: String,
    pub worktree: Option<String>,
    pub branch: Option<String>,
    pub create_branch: bool,
    pub base_branch: Option<String>,
    pub job: String,
    pub text: String,
    pub dedup_key: Option<String>,
}

impl Recipe {
    /// 宣言済み以外のキー・文字列以外の値・パターン違反・制御文字はエラー。
    /// 未指定の任意引数は空文字として展開する。
    pub fn render(&self, args: &Map<String, Value>) -> Result<Rendered, String> {
        for key in args.keys() {
            if !self.params.contains_key(key) {
                return Err(format!("Unknown field: {key}"));
            }
        }
        let mut vars: BTreeMap<String, String> = BTreeMap::new();
        vars.insert(BUILTIN_VAR_WORKSPACE.to_string(), self.workspace.clone());
        for (name, spec) in &self.params {
            let value = match args.get(name) {
                Some(Value::String(s)) => s.as_str(),
                Some(_) => return Err(format!("{name}: must be a string")),
                None if spec.required => return Err(format!("{name}: is required")),
                None => "",
            };
            if !value.is_empty() || spec.required {
                if value.chars().count() > PARAM_VALUE_MAX_LEN {
                    return Err(format!("{name}: too long (max {PARAM_VALUE_MAX_LEN})"));
                }
                if has_control_char(value) || !spec.pattern.is_match(value) {
                    return Err(format!("{name}: does not match the declared pattern"));
                }
            }
            vars.insert(name.clone(), value.to_string());
        }

        let expand_ref =
            |field: &str, template: &Option<String>| -> Result<Option<String>, String> {
                let Some(template) = template else {
                    return Ok(None);
                };
                let expanded = expand_template(template, &vars);
                if expanded.is_empty() {
                    return Ok(None);
                }
                if !is_safe_ref(&expanded) {
                    return Err(format!("{field}: expanded value is not allowed"));
                }
                Ok(Some(expanded))
            };
        let dedup_key = match &self.dedup {
            None => None,
            Some(template) => {
                let expanded = expand_template(template, &vars);
                if !is_safe_dedup_key(&expanded) {
                    return Err("dedup: expanded value is not allowed".to_string());
                }
                Some(expanded)
            }
        };
        let text = expand_template(&self.text, &vars);
        if text.chars().count() > TEXT_MAX_LEN {
            return Err(format!("text: too long (max {TEXT_MAX_LEN})"));
        }

        Ok(Rendered {
            workspace: self.workspace.clone(),
            worktree: expand_ref("worktree", &self.worktree)?,
            branch: expand_ref("branch", &self.branch)?,
            create_branch: self.create_branch,
            base_branch: expand_ref("base_branch", &self.base_branch)?,
            job: self.job.clone(),
            text,
            dedup_key,
        })
    }
}

impl Rendered {
    pub fn into_dispatch_request(self) -> Result<DispatchRequest, ApiError> {
        serde_json::from_value(json!({
            "workspace": self.workspace,
            "worktree": self.worktree,
            "job": self.job,
            "text": self.text,
            "branch": self.branch,
            "create_branch": self.create_branch,
            "base_branch": self.base_branch,
            "dedup_key": self.dedup_key,
        }))
        .map_err(|e| crate::errors::server_error(e.to_string()))
    }
}

// ─── 起動回数の上限 ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fired {
    pub at: i64,
    pub auto: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LimitExceeded {
    DailyCap { max: u32 },
    Cooldown { retry_after_sec: i64 },
}

impl LimitExceeded {
    fn detail(&self, recipe_id: &str) -> String {
        match self {
            LimitExceeded::DailyCap { max } => {
                format!("Recipe {recipe_id}: daily limit reached ({max} per 24h)")
            }
            LimitExceeded::Cooldown { retry_after_sec } => {
                format!("Recipe {recipe_id}: cooling down (retry in {retry_after_sec}s)")
            }
        }
    }
}

pub fn check_limits(recipe: &Recipe, fired: &[Fired], now: i64) -> Result<(), LimitExceeded> {
    if let Some(max) = recipe.max_per_day {
        let in_window = fired
            .iter()
            .filter(|f| f.at > now - RATE_WINDOW_SEC && f.at <= now)
            .count();
        if in_window >= max as usize {
            return Err(LimitExceeded::DailyCap { max });
        }
    }
    if recipe.approve == Approve::Auto && recipe.cooldown_sec > 0 {
        let cooldown = recipe.cooldown_sec as i64;
        let last_auto = fired.iter().filter(|f| f.auto).map(|f| f.at).max();
        if let Some(last) = last_auto.filter(|last| now - last < cooldown) {
            return Err(LimitExceeded::Cooldown {
                retry_after_sec: cooldown - (now - last),
            });
        }
    }
    Ok(())
}

fn fired_log_path(data_dir: &FsPath, workspace: &str, date: &str) -> std::path::PathBuf {
    data_dir
        .join("activity")
        .join(workspace)
        .join(format!("{date}.jsonl"))
}

/// 直近 24 時間（UTC の前日・当日のログファイル）の `recipe_fired` を読む。
pub fn read_fired(data_dir: &FsPath, recipe: &Recipe, now: i64) -> Vec<Fired> {
    let mut dates = vec![crate::util::utc_date_of_epoch(now - RATE_WINDOW_SEC)];
    let today = crate::util::utc_date_of_epoch(now);
    if dates[0] != today {
        dates.push(today);
    }
    let mut fired = Vec::new();
    for date in dates {
        let Ok(content) =
            std::fs::read_to_string(fired_log_path(data_dir, &recipe.workspace, &date))
        else {
            continue;
        };
        for line in content.lines() {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if entry["type"].as_str() != Some(ACTIVITY_EVENT_FIRED)
                || entry["recipe"].as_str() != Some(recipe.id.as_str())
            {
                continue;
            }
            if let Some(at) = entry["at"].as_i64() {
                fired.push(Fired {
                    at,
                    auto: entry["mode"].as_str() == Some(Approve::Auto.as_str()),
                });
            }
        }
    }
    fired
}

fn record_fired(data_dir: &FsPath, recipe: &Recipe, now: i64) {
    crate::activity::log_activity(
        data_dir,
        Some(&recipe.workspace),
        ACTIVITY_EVENT_FIRED,
        crate::git_helpers::activity_fields(&[
            ("recipe", json!(recipe.id)),
            ("at", json!(now)),
            ("mode", json!(recipe.approve.as_str())),
        ]),
    );
}

// ─── ルート ─────────────────────────────────────────────────────────────────

fn recipe_summary(recipe: &Recipe) -> Value {
    let params: Vec<Value> = recipe
        .params
        .iter()
        .map(|(name, spec)| json!({"name": name, "required": spec.required}))
        .collect();
    json!({
        "id": recipe.id,
        "enabled": recipe.enabled,
        "workspace": recipe.workspace,
        "approve": recipe.approve.as_str(),
        "params": params,
    })
}

/// `GET /dispatch/recipes`。メイントークン（デバイス cookie 含む）のみ。
pub async fn list_recipes(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let recipes: Vec<Value> = load_recipes(&state).iter().map(recipe_summary).collect();
    Json(json!({"paused": recipes_paused(&state), "recipes": recipes}))
}

/// `POST /dispatch/recipes/{id}`。ボディは recipe の `params` だけ。
pub async fn run_recipe(
    State(state): State<Arc<AppState>>,
    Path(recipe_id): Path<String>,
    headers: http::HeaderMap,
    JsonBody(args): JsonBody<Map<String, Value>>,
) -> Result<axum::response::Response, ApiError> {
    use axum::response::IntoResponse;

    let bearer = crate::auth::bearer_from_headers(&headers);
    let (auth_label, token_entry) =
        crate::dispatch::verify_dispatch_auth(&state, bearer, &headers).await?;
    if let Some(entry) = &token_entry {
        let allowed = entry["allowed_recipes"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(recipe_id.as_str())));
        if !allowed {
            return Err(forbidden("This token is not allowed to run the recipe"));
        }
    }

    let recipe = load_recipes(&state)
        .into_iter()
        .find(|r| r.id == recipe_id && r.enabled)
        .ok_or_else(|| not_found(format!("Recipe not found: {recipe_id}")))?;
    if recipes_paused(&state) {
        return Err(conflict("Dispatch recipes are paused"));
    }
    let request = recipe
        .render(&args)
        .map_err(bad_request)?
        .into_dispatch_request()?;

    {
        let _gate = state.dispatch.recipe_gate.lock().await;
        let now = now_epoch();
        let fired = read_fired(&state.paths.data_dir, &recipe, now);
        check_limits(&recipe, &fired, now).map_err(|e| too_many_requests(e.detail(&recipe.id)))?;
        record_fired(&state.paths.data_dir, &recipe, now);
    }

    let origin = format!("{RECIPE_ORIGIN_PREFIX}{}", recipe.id);
    match recipe.approve {
        Approve::Manual => {
            let id = crate::dispatch::enqueue_recipe(&state, request, &auth_label, &origin).await?;
            Ok((
                axum::http::StatusCode::ACCEPTED,
                Json(json!({"status": "pending", "id": id, "dispatch_id": id})),
            )
                .into_response())
        }
        Approve::Auto => {
            let (dispatch_id, result) =
                crate::dispatch::execute_recipe_auto(&state, request, &auth_label, &origin).await?;
            Ok(Json(json!({
                "status": "executed",
                "dispatch_id": dispatch_id,
                "session_id": result["session_id"],
                "workspace": result["workspace"],
                "created": result["created"],
            }))
            .into_response())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn any_job(_: &str, _: &str) -> bool {
        true
    }

    fn base() -> Value {
        json!({
            "id": "ci-fix",
            "workspace": "any-console",
            "worktree": "auto/ci-{branch}",
            "branch": "{branch}",
            "job": "claude",
            "text": "CI failed on {branch} in {workspace}. Run: {url}",
            "dedup": "ci-failure:{workspace}:{branch}",
            "params": {
                "branch": {"pattern": "[A-Za-z0-9._/-]{1,100}", "required": true},
                "url": {"pattern": "https://github\\.com/kt0319/any-console/actions/runs/\\d+(/.*)?", "required": true},
            },
            "approve": "manual",
            "max_per_day": 5,
            "cooldown_sec": 600,
        })
    }

    fn with(mut v: Value, key: &str, value: Value) -> Value {
        v[key] = value;
        v
    }

    fn args(pairs: &[(&str, &str)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect()
    }

    fn valid_args() -> Map<String, Value> {
        args(&[
            ("branch", "feature/x"),
            (
                "url",
                "https://github.com/kt0319/any-console/actions/runs/42",
            ),
        ])
    }

    fn parse(v: &Value) -> Result<Recipe, String> {
        parse_recipe(v, &any_job)
    }

    #[test]
    fn valid_recipe_parses() {
        let r = parse(&base()).unwrap();
        assert_eq!(r.id, "ci-fix");
        assert_eq!(r.approve, Approve::Manual);
        assert_eq!(r.params.len(), 2);
    }

    #[test]
    fn terminal_job_is_rejected() {
        let err = parse(&with(base(), "job", json!("terminal"))).unwrap_err();
        assert!(err.contains("terminal"), "{err}");
    }

    #[test]
    fn undeclared_template_variable_is_rejected() {
        let err = parse(&with(base(), "text", json!("fix {secret}"))).unwrap_err();
        assert!(err.contains("secret"), "{err}");
        let err = parse(&with(base(), "worktree", json!("auto/{nope}"))).unwrap_err();
        assert!(err.contains("worktree"), "{err}");
    }

    #[test]
    fn workspace_is_a_builtin_variable() {
        assert!(parse(&with(base(), "text", json!("in {workspace}"))).is_ok());
    }

    #[test]
    fn param_pattern_is_required_and_must_compile() {
        let mut v = base();
        v["params"]["branch"] = json!({"required": true});
        assert!(parse(&v).unwrap_err().contains("pattern is required"));
        let mut v = base();
        v["params"]["branch"] = json!({"pattern": "([", "required": true});
        assert!(parse(&v).unwrap_err().contains("invalid pattern"));
    }

    #[test]
    fn param_named_workspace_is_rejected() {
        let mut v = base();
        v["params"]["workspace"] = json!({"pattern": ".+"});
        assert!(parse(&v).is_err());
    }

    #[test]
    fn unknown_recipe_field_is_rejected() {
        let v = with(base(), "triggers", json!([{"on": "github.run_failed"}]));
        assert!(parse(&v).is_err());
    }

    #[test]
    fn invalid_id_is_rejected() {
        assert!(parse(&with(base(), "id", json!("CI_Fix"))).is_err());
        assert!(parse(&with(base(), "id", json!(""))).is_err());
    }

    #[test]
    fn auto_requires_worktree_max_per_day_and_existing_job() {
        let auto = with(base(), "approve", json!("auto"));
        assert!(parse(&auto).is_ok());

        let mut no_worktree = auto.clone();
        no_worktree.as_object_mut().unwrap().remove("worktree");
        no_worktree["branch"] = json!("x");
        assert!(parse(&no_worktree).unwrap_err().contains("worktree"));

        let mut no_cap = auto.clone();
        no_cap.as_object_mut().unwrap().remove("max_per_day");
        assert!(parse(&no_cap).unwrap_err().contains("max_per_day"));

        assert!(parse(&with(auto.clone(), "max_per_day", json!(0)))
            .unwrap_err()
            .contains("max_per_day"));

        let err = parse_recipe(&auto, &|_, _| false).unwrap_err();
        assert!(err.contains("job"), "{err}");
    }

    #[test]
    fn auto_does_not_fall_back_to_manual_on_error() {
        let mut v = with(base(), "approve", json!("auto"));
        v.as_object_mut().unwrap().remove("max_per_day");
        assert!(parse(&v).is_err());
        assert!(parse(&with(base(), "approve", json!("sometimes"))).is_err());
    }

    #[test]
    fn manual_does_not_check_job_existence() {
        assert!(parse_recipe(&base(), &|_, _| false).is_ok());
    }

    #[test]
    fn duplicate_ids_keep_only_the_first() {
        let first = base();
        let second = with(base(), "text", json!("second {branch} {url}"));
        let recipes = parse_recipes(&[first, second], &any_job);
        assert_eq!(recipes.len(), 1);
        assert!(recipes[0].text.starts_with("CI failed"));
    }

    #[test]
    fn invalid_recipes_are_skipped_without_dropping_valid_ones() {
        let bad = with(base(), "id", json!("bad id"));
        let good = with(base(), "id", json!("good"));
        let recipes = parse_recipes(&[bad, good], &any_job);
        assert_eq!(recipes.len(), 1);
        assert_eq!(recipes[0].id, "good");
    }

    #[test]
    fn render_expands_templates() {
        let r = parse(&base()).unwrap().render(&valid_args()).unwrap();
        assert_eq!(r.worktree.as_deref(), Some("auto/ci-feature/x"));
        assert_eq!(r.branch.as_deref(), Some("feature/x"));
        assert_eq!(
            r.dedup_key.as_deref(),
            Some("ci-failure:any-console:feature/x")
        );
        assert!(r.text.contains("any-console"));
        assert!(r.text.contains("runs/42"));
        assert_eq!(r.job, "claude");
    }

    #[test]
    fn render_rejects_undeclared_missing_nonstring_and_mismatched_args() {
        let recipe = parse(&base()).unwrap();
        for key in ["text", "job", "worktree", "direct"] {
            let mut a = valid_args();
            a.insert(key.to_string(), json!("x"));
            assert!(recipe.render(&a).unwrap_err().contains("Unknown field"));
        }
        let mut missing = valid_args();
        missing.remove("url");
        assert!(recipe.render(&missing).unwrap_err().contains("required"));
        let mut not_string = valid_args();
        not_string.insert("branch".to_string(), json!(1));
        assert!(recipe.render(&not_string).unwrap_err().contains("string"));
        let mut bad_url = valid_args();
        bad_url.insert(
            "url".to_string(),
            json!("https://evil.example/actions/runs/1"),
        );
        assert!(recipe.render(&bad_url).unwrap_err().contains("pattern"));
    }

    #[test]
    fn render_rejects_control_characters_and_overlong_values() {
        let recipe = parse(&base()).unwrap();
        let mut a = valid_args();
        a.insert("branch".to_string(), json!("a\nb"));
        assert!(recipe.render(&a).is_err());
        let mut long = valid_args();
        long.insert(
            "branch".to_string(),
            json!("a".repeat(PARAM_VALUE_MAX_LEN + 1)),
        );
        assert!(recipe.render(&long).unwrap_err().contains("too long"));
    }

    #[test]
    fn render_revalidates_expanded_refs_even_if_the_pattern_allows_them() {
        let mut v = base();
        v["params"]["branch"] = json!({"pattern": ".+", "required": true});
        let recipe = parse(&v).unwrap();
        for bad in ["--upload-pack=x", "a/../b", "a b", "a;b", "/abs"] {
            let mut a = valid_args();
            a.insert("branch".to_string(), json!(bad));
            assert!(recipe.render(&a).is_err(), "{bad}");
        }
    }

    #[test]
    fn optional_param_missing_expands_to_empty() {
        let mut v = base();
        v["params"]["note"] = json!({"pattern": "[a-z]+"});
        v["text"] = json!("branch {branch} note={note}");
        let r = parse(&v).unwrap().render(&valid_args()).unwrap();
        assert_eq!(r.text, "branch feature/x note=");
    }

    #[test]
    fn rendered_converts_to_dispatch_request_with_defaults() {
        let req = parse(&base())
            .unwrap()
            .render(&valid_args())
            .unwrap()
            .into_dispatch_request()
            .unwrap();
        assert_eq!(req.workspace, "any-console");
        assert_eq!(req.job, "claude");
        assert!(!req.direct);
        assert!(req.session_id.is_none());
        assert!(req.enter);
    }

    fn fired(at: i64, auto: bool) -> Fired {
        Fired { at, auto }
    }

    #[test]
    fn daily_cap_counts_only_the_last_24_hours() {
        let recipe = parse(&with(base(), "max_per_day", json!(2))).unwrap();
        let now = 1_000_000;
        let old = fired(now - RATE_WINDOW_SEC - 1, false);
        assert!(check_limits(&recipe, &[old, fired(now - 10, false)], now).is_ok());
        let two = [fired(now - 10, false), fired(now - 20, false)];
        assert_eq!(
            check_limits(&recipe, &two, now),
            Err(LimitExceeded::DailyCap { max: 2 })
        );
    }

    #[test]
    fn cooldown_applies_to_auto_recipes_after_the_last_auto_run() {
        let auto = parse(&with(
            with(base(), "approve", json!("auto")),
            "cooldown_sec",
            json!(600),
        ))
        .unwrap();
        let now = 1_000_000;
        assert_eq!(
            check_limits(&auto, &[fired(now - 100, true)], now),
            Err(LimitExceeded::Cooldown {
                retry_after_sec: 500
            })
        );
        assert!(check_limits(&auto, &[fired(now - 601, true)], now).is_ok());
        let manual = parse(&base()).unwrap();
        assert!(check_limits(&manual, &[fired(now - 1, true)], now).is_ok());
    }

    #[test]
    fn fired_events_round_trip_through_the_activity_log() {
        let dir = tempfile::tempdir().unwrap();
        let recipe = parse(&with(base(), "approve", json!("auto"))).unwrap();
        let other = parse(&with(base(), "id", json!("other"))).unwrap();
        let now = now_epoch();
        record_fired(dir.path(), &recipe, now);
        record_fired(dir.path(), &other, now);
        let fired = read_fired(dir.path(), &recipe, now);
        assert_eq!(
            fired,
            vec![Fired {
                at: now,
                auto: true
            }]
        );
    }
}
