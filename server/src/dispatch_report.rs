//! Dispatch 実行ごとの結果報告（ADR 36）。
//!
//! `report: true` のエージェントジョブで起動した新規セッションにだけ、実行（`dispatch_id`）専用の
//! 報告先 URL とトークンを環境変数（`ANY_CONSOLE_REPORT_URL` / `ANY_CONSOLE_REPORT_TOKEN`）で
//! 注入する。トークンは依頼文・ログ・履歴に残さず、履歴にはその HMAC だけを保存する。
//!
//! 報告は recent 履歴の該当項目（`dispatch_id` が実行の識別子）に `report` として保存する。
//! `report.submitted` はエージェントの自己申告、`report.verified` はサーバが確認できた事実で、
//! 報告を受理しただけでは検証済みにならない。成果物はコミットとブランチ名だけを受け付け、
//! ファイルパスは受け付けない（任意ファイルの公開・読み出しを構造的に避ける）。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::auth::constant_time_eq;
use crate::errors::{bad_request, conflict, unauthorized, unprocessable, ApiError};
use crate::state::AppState;
use crate::util::{now_epoch, JsonBody};

pub const REPORT_URL_ENV: &str = "ANY_CONSOLE_REPORT_URL";
pub const REPORT_TOKEN_ENV: &str = "ANY_CONSOLE_REPORT_TOKEN";
pub const REPORT_TOKEN_HEADER: &str = "x-report-token";
pub const MAX_REPORT_BODY_BYTES: usize = 64 * 1024;
const REPORT_TOKEN_BYTES: usize = 24;
const GIT_VERIFY_TIMEOUT_SEC: f64 = 5.0;

const MAX_SUMMARY_CHARS: usize = 2000;
const MAX_LINE_CHARS: usize = 500;
const MAX_NAME_CHARS: usize = 200;
const MAX_DETAIL_CHARS: usize = 1000;
const MAX_LIST_ITEMS: usize = 50;
const MAX_VERIFICATIONS: usize = 30;
const MAX_COMMITS: usize = 20;
const MIN_COMMIT_HEX: usize = 7;
const MAX_COMMIT_HEX: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportStatus {
    Completed,
    Partial,
    Unable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationResult {
    Passed,
    Failed,
    Skipped,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Verification {
    pub name: String,
    pub result: VerificationResult,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Artifacts {
    #[serde(default)]
    pub commits: Vec<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub preview_port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReportBody {
    pub summary: String,
    pub status: ReportStatus,
    #[serde(default)]
    pub changes: Vec<String>,
    #[serde(default)]
    pub verifications: Vec<Verification>,
    #[serde(default)]
    pub open_issues: Vec<String>,
    #[serde(default)]
    pub decisions_needed: Vec<String>,
    #[serde(default)]
    pub artifacts: Artifacts,
}

fn check_text(field: &str, value: &str, max: usize, required: bool) -> Result<(), ApiError> {
    let len = value.trim().chars().count();
    if required && len == 0 {
        return Err(unprocessable(format!("{field} must not be empty")));
    }
    if value.chars().count() > max {
        return Err(unprocessable(format!("{field} exceeds max length {max}")));
    }
    Ok(())
}

fn check_lines(field: &str, items: &[String]) -> Result<(), ApiError> {
    if items.len() > MAX_LIST_ITEMS {
        return Err(unprocessable(format!(
            "{field} exceeds max items {MAX_LIST_ITEMS}"
        )));
    }
    items
        .iter()
        .try_for_each(|line| check_text(field, line, MAX_LINE_CHARS, true))
}

fn is_commit_hex(value: &str) -> bool {
    (MIN_COMMIT_HEX..=MAX_COMMIT_HEX).contains(&value.len())
        && value.bytes().all(|b| b.is_ascii_hexdigit())
}

impl ReportBody {
    pub fn validate(&self) -> Result<(), ApiError> {
        check_text("summary", &self.summary, MAX_SUMMARY_CHARS, true)?;
        check_lines("changes", &self.changes)?;
        check_lines("open_issues", &self.open_issues)?;
        check_lines("decisions_needed", &self.decisions_needed)?;
        if self.verifications.len() > MAX_VERIFICATIONS {
            return Err(unprocessable(format!(
                "verifications exceeds max items {MAX_VERIFICATIONS}"
            )));
        }
        for v in &self.verifications {
            check_text("verifications.name", &v.name, MAX_NAME_CHARS, true)?;
            check_text("verifications.detail", &v.detail, MAX_DETAIL_CHARS, false)?;
        }
        if self.artifacts.commits.len() > MAX_COMMITS {
            return Err(unprocessable(format!(
                "artifacts.commits exceeds max items {MAX_COMMITS}"
            )));
        }
        if let Some(bad) = self.artifacts.commits.iter().find(|c| !is_commit_hex(c)) {
            return Err(unprocessable(format!(
                "artifacts.commits must be {MIN_COMMIT_HEX}-{MAX_COMMIT_HEX} hex characters: {bad}"
            )));
        }
        if let Some(branch) = &self.artifacts.branch {
            let branch = crate::git_helpers::validate_branch_name(branch)?;
            if branch.starts_with('-') || branch.contains("..") {
                return Err(unprocessable(format!("Invalid branch name: {branch}")));
            }
        }
        Ok(())
    }
}

// ─── 実行ごとのトークン ──────────────────────────────────────────────────────

/// 報告が有効な実行の報告先。`token` は環境変数でセッションへ渡すだけで、永続化しない。
pub struct ReportRun {
    token: String,
    url: String,
}

impl ReportRun {
    pub fn new(state: &AppState, dispatch_id: &str) -> Self {
        Self {
            token: crate::util::token_urlsafe(REPORT_TOKEN_BYTES),
            // dispatch_id は base64url 文字のみ（`token_urlsafe`）なのでそのままパスに使える。
            url: format!(
                "{}/dispatch/{}/report",
                crate::tmux::local_server_url(&state.config),
                dispatch_id
            ),
        }
    }

    pub fn session_env(&self) -> Vec<(String, String)> {
        vec![
            (REPORT_URL_ENV.to_string(), self.url.clone()),
            (REPORT_TOKEN_ENV.to_string(), self.token.clone()),
        ]
    }

    pub fn token_hash(&self, state: &AppState) -> String {
        hash_report_token(state, &self.token)
    }
}

fn hash_report_token(state: &AppState, token: &str) -> String {
    crate::devices::hash_secret(&state.paths.data_dir, state.auth.devices(), token)
}

/// エージェントへ渡す依頼文の末尾に付ける報告手順。トークンの値は含めず、環境変数名だけを示す。
pub fn report_instruction() -> String {
    format!(
        r#"

---
[any-console 結果報告]
作業の最後に、結果を any-console へ1回だけ報告してください（利用者はこの報告で結果を確認します）。
実施していない検証は "skipped"、確認できなかったものは "unknown" とし、成功したと書かないでください。
環境変数の値は表示せず、そのまま使ってください。

curl -sS -X POST "${url_env}" -H "X-Report-Token: ${token_env}" -H "Content-Type: application/json" -d @- <<'JSON'
{{"summary": "何ができたか", "status": "completed|partial|unable",
 "changes": ["変更内容"],
 "verifications": [{{"name": "cargo test", "result": "passed|failed|skipped|unknown", "detail": ""}}],
 "open_issues": ["未解決事項"], "decisions_needed": ["利用者に判断してほしいこと"],
 "artifacts": {{"commits": ["コミットハッシュ"], "branch": "ブランチ名", "preview_port": 3000}}}}
JSON"#,
        url_env = REPORT_URL_ENV,
        token_env = REPORT_TOKEN_ENV,
    )
}

// ─── 履歴項目への書き込み ────────────────────────────────────────────────────

/// recent の項目から取り出した、報告の受理に必要な情報。
struct ReportTarget {
    effective_workspace: String,
    existing_submitted: Option<Value>,
}

async fn authorize_report(
    state: &AppState,
    dispatch_id: &str,
    provided_token: &str,
) -> Result<ReportTarget, ApiError> {
    if provided_token.is_empty() {
        return Err(unauthorized("Invalid report token"));
    }
    let provided_hash = hash_report_token(state, provided_token);
    let recent = state.dispatch.recent.lock().await;
    // 未知の dispatch_id と不一致のトークンは区別せず同じ応答にする。
    let item = recent
        .iter()
        .find(|r| r["id"] == dispatch_id)
        .filter(|r| {
            r["report_token_hash"]
                .as_str()
                .is_some_and(|stored| constant_time_eq(stored, &provided_hash))
        })
        .ok_or_else(|| unauthorized("Invalid report token"))?;
    if item["outcome"] != "executed" {
        return Err(conflict("Dispatch was not executed"));
    }
    Ok(ReportTarget {
        effective_workspace: item["request"]["effective_workspace"]
            .as_str()
            .or_else(|| item["request"]["workspace"].as_str())
            .unwrap_or_default()
            .to_string(),
        existing_submitted: item["report"].get("submitted").cloned(),
    })
}

/// サーバが確認できる事実だけを集める。確認できなかったものは null（成功扱いにしない）。
async fn verify_artifacts(state: &AppState, workspace: &str, artifacts: &Artifacts) -> Value {
    let ws_path = crate::git_utils::resolve_workspace_path(&state.config, workspace)
        .await
        .ok();
    let mut commits = Map::new();
    for commit in &artifacts.commits {
        let exists = match &ws_path {
            Some(path) => {
                let spec = format!("{commit}^{{commit}}");
                crate::git_utils::run_git_raw(
                    &["cat-file", "-e", &spec],
                    path,
                    GIT_VERIFY_TIMEOUT_SEC,
                    &[],
                )
                .await
                .ok()
                .map(|out| out.code == 0)
            }
            None => None,
        };
        commits.insert(commit.clone(), json!(exists));
    }
    let branch_exists = match (&artifacts.branch, &ws_path) {
        (Some(branch), Some(path)) => {
            let spec = format!("refs/heads/{branch}");
            crate::git_utils::run_git_raw(
                &["rev-parse", "--verify", "--quiet", &spec],
                path,
                GIT_VERIFY_TIMEOUT_SEC,
                &[],
            )
            .await
            .ok()
            .map(|out| out.code == 0)
        }
        _ => None,
    };
    json!({"commits": commits, "branch_exists": branch_exists})
}

/// `POST /dispatch/{id}/report`。実行専用トークン（`X-Report-Token`）で認証し、メイントークンや
/// hook トークンでは受け付けない。同じ内容の再送は成功扱い、異なる内容の2回目は 409。
pub async fn post_report(
    State(state): State<Arc<AppState>>,
    Path(dispatch_id): Path<String>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<ReportBody>,
) -> Result<Json<Value>, ApiError> {
    let token = headers
        .get(REPORT_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let target = authorize_report(&state, &dispatch_id, token).await?;
    body.validate()?;
    let submitted = serde_json::to_value(&body).map_err(|e| bad_request(e.to_string()))?;

    if let Some(existing) = &target.existing_submitted {
        return duplicate_response(existing, &submitted);
    }

    let verified = verify_artifacts(&state, &target.effective_workspace, &body.artifacts).await;
    let report = json!({
        "submitted": submitted,
        "reported_at": now_epoch(),
        "verified": verified,
    });

    let (session_id, status) = {
        let mut recent = state.dispatch.recent.lock().await;
        let item = recent
            .iter_mut()
            .find(|r| r["id"] == dispatch_id)
            .ok_or_else(|| unauthorized("Invalid report token"))?;
        // 検証中に別の報告が先に入った場合も、同じ規則で重複/競合を判定する。
        if let Some(existing) = item["report"].get("submitted") {
            return duplicate_response(existing, &report["submitted"]);
        }
        item["report"] = report;
        (item["session_id"].as_str().map(str::to_string), body.status)
    };
    crate::dispatch::persist_recent(&state).await;
    crate::dispatch::broadcast_queue(&state).await;
    notify_reported(&state, &dispatch_id, &target.effective_workspace, status);
    crate::activity::log_activity(
        &state.paths.data_dir,
        Some(&target.effective_workspace),
        "dispatch_reported",
        crate::git_helpers::activity_fields(&[
            ("dispatch_id", json!(dispatch_id)),
            ("session_id", json!(session_id)),
            ("status", json!(status)),
        ]),
    );
    Ok(Json(json!({"status": "ok", "duplicate": false})))
}

fn duplicate_response(existing: &Value, submitted: &Value) -> Result<Json<Value>, ApiError> {
    if existing == submitted {
        Ok(Json(json!({"status": "ok", "duplicate": true})))
    } else {
        Err(conflict(
            "A different report was already submitted for this run",
        ))
    }
}

/// 通知本文には依頼内容や結果の全文を載せない（ワークスペースと状態だけ）。
fn notify_reported(
    state: &Arc<AppState>,
    dispatch_id: &str,
    workspace: &str,
    status: ReportStatus,
) {
    let label = match status {
        ReportStatus::Completed => "reported completed",
        ReportStatus::Partial => "reported partial",
        ReportStatus::Unable => "reported unable",
    };
    crate::push::spawn_push_notification(
        state,
        "Dispatch report",
        format!("{workspace}\n{label}"),
        format!("/?openDispatchQueue=1&dispatchId={dispatch_id}"),
        "dispatch",
        None,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    const TOKEN: &str = "run-token-1";

    fn state_in(dir: &tempfile::TempDir) -> Arc<AppState> {
        Arc::new(crate::state::test_app_state(dir.path(), "test-", 10_000))
    }

    fn valid_body() -> ReportBody {
        serde_json::from_value(json!({
            "summary": "added the feature",
            "status": "partial",
            "changes": ["edited a.rs"],
            "verifications": [
                {"name": "cargo test", "result": "passed"},
                {"name": "e2e", "result": "skipped", "detail": "no browser"}
            ],
            "open_issues": ["docs missing"],
            "decisions_needed": ["merge now?"],
            "artifacts": {"commits": [], "branch": null, "preview_port": 3000}
        }))
        .unwrap()
    }

    async fn seed_run(state: &Arc<AppState>, id: &str, token: &str, outcome: &str) {
        let hash = hash_report_token(state, token);
        state.dispatch.recent.lock().await.insert(
            0,
            json!({
                "id": id,
                "outcome": outcome,
                "session_id": format!("sess-{id}"),
                "request": {"workspace": "proj", "effective_workspace": "proj", "text": "do it"},
                "report_token_hash": hash,
            }),
        );
    }

    fn headers_with(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(REPORT_TOKEN_HEADER, HeaderValue::from_str(token).unwrap());
        h
    }

    async fn report(
        state: &Arc<AppState>,
        id: &str,
        token: &str,
        body: ReportBody,
    ) -> Result<Json<Value>, ApiError> {
        post_report(
            State(state.clone()),
            Path(id.to_string()),
            headers_with(token),
            JsonBody(body),
        )
        .await
    }

    async fn stored_report(state: &Arc<AppState>, id: &str) -> Value {
        let recent = state.dispatch.recent.lock().await;
        recent.iter().find(|r| r["id"] == id).unwrap()["report"].clone()
    }

    #[tokio::test]
    async fn accepted_report_is_stored_as_self_report_without_marking_it_verified() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "run1", TOKEN, "executed").await;

        let res = report(&state, "run1", TOKEN, valid_body()).await.unwrap();
        assert_eq!(res.0["duplicate"], false);

        let stored = stored_report(&state, "run1").await;
        assert_eq!(stored["submitted"]["status"], "partial");
        assert_eq!(stored["submitted"]["verifications"][1]["result"], "skipped");
        assert!(stored["reported_at"].as_i64().unwrap() > 0);
        assert_eq!(stored["verified"]["branch_exists"], Value::Null);
    }

    #[tokio::test]
    async fn report_survives_restart_via_persisted_recent() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "run1", TOKEN, "executed").await;
        let _ = report(&state, "run1", TOKEN, valid_body()).await.unwrap();

        let restarted = state_in(&dir);
        crate::dispatch::load_persisted_and_seed_bridge(&restarted).await;
        let stored = stored_report(&restarted, "run1").await;
        assert_eq!(stored["submitted"]["summary"], "added the feature");
        // 再起動後も、保存済みのトークンハッシュで同じ実行の再送を判定できる。
        let dup = report(&restarted, "run1", TOKEN, valid_body())
            .await
            .unwrap();
        assert_eq!(dup.0["duplicate"], true);
    }

    #[tokio::test]
    async fn wrong_missing_or_unknown_credentials_are_rejected_identically() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "run1", TOKEN, "executed").await;

        for (id, token) in [("run1", "wrong"), ("run1", ""), ("nope", TOKEN)] {
            let err = report(&state, id, token, valid_body()).await.unwrap_err();
            assert_eq!(
                err.status,
                axum::http::StatusCode::UNAUTHORIZED,
                "{id}/{token}"
            );
        }
        assert!(stored_report(&state, "run1").await.is_null());
    }

    #[tokio::test]
    async fn token_of_another_run_cannot_report_and_does_not_touch_the_new_run() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "old", "old-token", "executed").await;
        // 再実行: 新しい dispatch_id と新しいトークンを持つ別の試行。
        seed_run(&state, "new", "new-token", "executed").await;

        let err = report(&state, "new", "old-token", valid_body())
            .await
            .unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::UNAUTHORIZED);

        // 遅れて届いた古い実行の報告は、古い実行にだけ保存される。
        let _ = report(&state, "old", "old-token", valid_body())
            .await
            .unwrap();
        assert!(stored_report(&state, "new").await.is_null());
        assert!(!stored_report(&state, "old").await.is_null());
    }

    #[tokio::test]
    async fn identical_resend_is_a_noop_and_different_second_report_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "run1", TOKEN, "executed").await;
        let _ = report(&state, "run1", TOKEN, valid_body()).await.unwrap();
        let first = stored_report(&state, "run1").await;

        let dup = report(&state, "run1", TOKEN, valid_body()).await.unwrap();
        assert_eq!(dup.0["duplicate"], true);

        let mut changed = valid_body();
        changed.summary = "rewrote history".to_string();
        changed.status = ReportStatus::Completed;
        let err = report(&state, "run1", TOKEN, changed).await.unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::CONFLICT);
        assert_eq!(stored_report(&state, "run1").await, first);
    }

    #[tokio::test]
    async fn report_for_a_failed_launch_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "run1", TOKEN, "failed").await;
        let err = report(&state, "run1", TOKEN, valid_body())
            .await
            .unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::CONFLICT);
    }

    #[test]
    fn malformed_or_oversized_reports_are_rejected() {
        let mut empty_summary = valid_body();
        empty_summary.summary = "  ".to_string();
        assert!(empty_summary.validate().is_err());

        let mut huge = valid_body();
        huge.summary = "x".repeat(MAX_SUMMARY_CHARS + 1);
        assert!(huge.validate().is_err());

        let mut many = valid_body();
        many.changes = vec!["c".to_string(); MAX_LIST_ITEMS + 1];
        assert!(many.validate().is_err());

        let mut bad_commit = valid_body();
        bad_commit.artifacts.commits = vec!["--output=/tmp/x".to_string()];
        assert!(bad_commit.validate().is_err());

        let mut bad_branch = valid_body();
        bad_branch.artifacts.branch = Some("../../etc".to_string());
        assert!(bad_branch.validate().is_err());

        let mut ok = valid_body();
        ok.artifacts.commits = vec!["abc1234".to_string()];
        ok.artifacts.branch = Some("feat/x".to_string());
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn unknown_fields_such_as_file_paths_are_not_accepted() {
        let with_files = json!({
            "summary": "s", "status": "completed",
            "artifacts": {"files": ["/etc/passwd"]}
        });
        assert!(serde_json::from_value::<ReportBody>(with_files).is_err());
        let bad_status = json!({"summary": "s", "status": "verified"});
        assert!(serde_json::from_value::<ReportBody>(bad_status).is_err());
        let bad_result = json!({
            "summary": "s", "status": "completed",
            "verifications": [{"name": "t", "result": "ok"}]
        });
        assert!(serde_json::from_value::<ReportBody>(bad_result).is_err());
    }

    #[tokio::test]
    async fn server_verifies_commits_and_branch_against_the_workspace_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@example.com"],
            vec!["config", "user.name", "t"],
            vec!["commit", "-q", "--allow-empty", "-m", "init"],
        ] {
            crate::git_utils::sh_git(&repo, &args);
        }
        let head = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&repo)
            .output()
            .unwrap();
        let head = String::from_utf8(head.stdout).unwrap().trim().to_string();
        std::fs::write(
            dir.path().join("config.json"),
            json!({"proj": {"path": repo}}).to_string(),
        )
        .unwrap();
        let state = state_in(&dir);

        let artifacts = Artifacts {
            commits: vec![head.clone(), "deadbee".to_string()],
            branch: Some("main".to_string()),
            preview_port: None,
        };
        let verified = verify_artifacts(&state, "proj", &artifacts).await;
        assert_eq!(verified["commits"][&head], true);
        assert_eq!(verified["commits"]["deadbee"], false);
        assert_eq!(verified["branch_exists"], true);

        let missing_ws = verify_artifacts(&state, "unknown", &artifacts).await;
        assert_eq!(missing_ws["commits"]["deadbee"], Value::Null);
        assert_eq!(missing_ws["branch_exists"], Value::Null);
    }

    #[tokio::test]
    async fn broadcast_payload_never_contains_the_token_hash() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(&dir);
        seed_run(&state, "run1", TOKEN, "executed").await;
        let payload = crate::dispatch::queue_payload(&state).await;
        let text = payload.to_string();
        assert!(!text.contains("report_token_hash"));
        assert!(!text.contains(&hash_report_token(&state, TOKEN)));
    }

    #[test]
    fn run_env_targets_only_that_run_and_instruction_carries_no_secret() {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::state::test_app_state(dir.path(), "test-", 10_000);
        let run = ReportRun::new(&state, "run1");
        let env = run.session_env();
        let url = &env.iter().find(|(k, _)| k == REPORT_URL_ENV).unwrap().1;
        assert!(url.ends_with("/dispatch/run1/report"));
        let token = &env.iter().find(|(k, _)| k == REPORT_TOKEN_ENV).unwrap().1;
        assert!(token.len() >= 32);
        assert_ne!(&run.token_hash(&state), token);

        let instruction = report_instruction();
        assert!(instruction.contains("$ANY_CONSOLE_REPORT_URL"));
        assert!(instruction.contains("$ANY_CONSOLE_REPORT_TOKEN"));
        assert!(!instruction.contains(token.as_str()));
        assert!(!instruction.contains(url.as_str()));
        let a = ReportRun::new(&state, "run1");
        let b = ReportRun::new(&state, "run1");
        assert_ne!(a.token, b.token);
    }
}
