//! direct スコープの API トークンによる制限つきの即時 dispatch の統合テスト（ADR 34）。
//!
//! `test_dispatch.rs` と同様、テスト専用の Router に必要なルートだけを配線する。

mod common;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use any_console_server::auth::{self, DirectTokenLimits, API_TOKEN_SCOPE_DISPATCH};
use any_console_server::config::ConfigStore;
use any_console_server::dispatch::{self};
use any_console_server::json_store::save_json_file;
use any_console_server::state::AppState;
use any_console_server::terminal;
use any_console_server::util::{base64url_encode, now_epoch};

const TOKEN: &str = "direct-test-token";

#[derive(Clone)]
struct ReceivedPush {
    body_len: usize,
}

async fn push_service_handler(
    AxumState(calls): AxumState<Arc<StdMutex<Vec<ReceivedPush>>>>,
    body: axum::body::Bytes,
) -> Json<Value> {
    calls.lock().unwrap().push(ReceivedPush {
        body_len: body.len(),
    });
    Json(json!({"status": "ok"}))
}

fn generate_test_push_subscriber_keys() -> (String, String) {
    let mut raw = [0u8; 32];
    getrandom::fill(&mut raw).unwrap();
    let secret = p256::SecretKey::from_slice(&raw).unwrap();
    use p256::elliptic_curve::sec1::ToSec1Point;
    let public_bytes = secret.public_key().to_sec1_point(false).as_bytes().to_vec();
    let mut auth_secret = [0u8; 16];
    getrandom::fill(&mut auth_secret).unwrap();
    (
        base64url_encode(&public_bytes),
        base64url_encode(&auth_secret),
    )
}

async fn serve_router(router: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

struct Front {
    addr: SocketAddr,
    state: Arc<AppState>,
    repo: std::path::PathBuf,
    push_calls: Arc<StdMutex<Vec<ReceivedPush>>>,
    _dir: tempfile::TempDir,
    _tmux_cleanup: common::TmuxSessionCleanup,
}

impl Front {
    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    fn direct_token(&self, name: &str, limits: &DirectTokenLimits) -> String {
        self.state.auth.create_direct_api_token(name, limits).1
    }

    async fn dispatch(&self, token: &str, body: Value) -> reqwest::Response {
        common::client()
            .post(self.url("/dispatch"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    fn add_worktree(&self, branch: &str, dir_name: &str) {
        let wt = self.repo.parent().unwrap().join(dir_name);
        common::sh_git(
            &self.repo,
            &["worktree", "add", &wt.to_string_lossy(), "-b", branch],
        );
    }
}

fn direct_body() -> Value {
    json!({
        "workspace": "proj",
        "job": "fixer",
        "worktree": "auto/ci-fix",
        "text": "fix the failing test",
        "direct": true,
    })
}

fn direct_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/dispatch", post(dispatch::dispatch))
        .route(
            "/dispatch/{dispatch_id}/decision",
            post(dispatch::dispatch_decide),
        )
        .route(
            "/api-tokens",
            get(auth::list_api_tokens).post(auth::create_api_token),
        )
        .route("/terminal/ws/{session_id}", get(terminal::terminal_ws))
        .with_state(state)
}

async fn spawn_front() -> Front {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let (tmux_prefix, tmux_cleanup) = common::unique_tmux_prefix();

    let repo = dir.path().join("proj");
    std::fs::create_dir_all(&repo).unwrap();
    common::sh_git(&repo, &["init", "-q", "-b", "main"]);
    common::sh_git(&repo, &["config", "user.email", "t@example.com"]);
    common::sh_git(&repo, &["config", "user.name", "tester"]);
    std::fs::write(repo.join("a.txt"), "hi\n").unwrap();
    common::sh_git(&repo, &["add", "-A"]);
    common::sh_git(&repo, &["commit", "-q", "-m", "first"]);

    // `sleep` を既知のエージェントとして識別できるよう、テスト用のマニフェストを置く。
    // 起動したジョブのコマンド行（`sleep 600`）が画面に出たら idle とみなす。
    let manifest_dir = dir.path().join("agent_manifests");
    std::fs::create_dir_all(&manifest_dir).unwrap();
    std::fs::write(
        manifest_dir.join("sleep.toml"),
        r#"id = "sleep"
version = "2026.01.01.1"
min_engine_version = 1
updated_at = "2026-01-01T00:00:00Z"

[[rules]]
id = "idle_literal"
state = "idle"
priority = 100
region = "whole_recent"
contains = ["sleep 600"]
"#,
    )
    .unwrap();

    let store = ConfigStore::new(dir.path().join("config.json"));
    let mut cfg = store.load_all();
    cfg.insert(
        "ws_proj".to_string(),
        json!({"name": "proj", "path": repo.to_string_lossy()}),
    );
    store.save_all(&cfg).unwrap();
    store
        .save_global_section(
            "jobs",
            json!({
                "fixer": {"command": "sleep 600", "label": "Fixer"},
                "build": {"command": "true", "label": "Build"},
            }),
        )
        .unwrap();

    let push_calls: Arc<StdMutex<Vec<ReceivedPush>>> = Arc::new(StdMutex::new(Vec::new()));
    let push_addr = serve_router(
        Router::new()
            .route("/push-endpoint", post(push_service_handler))
            .with_state(push_calls.clone()),
    )
    .await;
    let (p256dh, auth_key) = generate_test_push_subscriber_keys();
    save_json_file(
        &data_dir.join("push_subscriptions.json"),
        &json!([{
            "endpoint": format!("http://{push_addr}/push-endpoint"),
            "keys": {"p256dh": p256dh, "auth": auth_key},
        }]),
    )
    .unwrap();

    let state = common::test_app_state(
        dir.path(),
        common::StateOptions {
            tmux_prefix,
            config: Some(store),
            ..Default::default()
        },
    );
    let addr = serve_router(direct_router(state.clone())).await;
    Front {
        addr,
        state,
        repo,
        push_calls,
        _dir: dir,
        _tmux_cleanup: tmux_cleanup,
    }
}

async fn wait_for(cond: impl Fn() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        if cond() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

#[tokio::test]
async fn direct_token_starts_the_agent_job_in_a_worktree_immediately() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    front.add_worktree("auto/ci-fix", "proj-wt");
    let token = front.direct_token("cron", &DirectTokenLimits::default());

    let resp = front.dispatch(&token, direct_body()).await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "executed");
    assert_eq!(body["workspace"], "proj:auto/ci-fix");
    assert_eq!(body["created"], true);
    assert!(body["session_id"].as_str().is_some());

    assert!(front.state.dispatch.pending.lock().await.is_empty());
    {
        let recent = front.state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["outcome"], "executed");
        assert_eq!(recent[0]["auth"], "direct:cron");
        assert!(recent[0]["token_id"].as_str().unwrap().starts_with("tok_"));
        assert_eq!(recent[0]["id"], body["dispatch_id"]);
        assert_eq!(recent[0]["request"]["worktree"], "auto/ci-fix");
    }
    assert!(
        wait_for(|| !front.push_calls.lock().unwrap().is_empty()).await,
        "a direct run must send a push notification"
    );
    assert!(front.push_calls.lock().unwrap()[0].body_len > 0);

    // 誰もターミナルへ接続していなくても、依頼のテキストが起動したエージェントへ届く。
    let tmux_name = front
        .state
        .terminal_session(body["session_id"].as_str().unwrap())
        .await
        .unwrap()
        .lock()
        .await
        .tmux_session_name
        .clone();
    let mut delivered = false;
    for _ in 0..100 {
        let screen = any_console_server::tmux::capture_visible_pane(&tmux_name)
            .await
            .unwrap_or_default();
        if screen.contains("fix the failing test") {
            delivered = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(
        delivered,
        "the text must be delivered without a websocket attach"
    );

    let activity_dir = front
        .state
        .paths
        .data_dir
        .join("activity")
        .join("proj:auto/ci-fix");
    let logged: String = std::fs::read_dir(&activity_dir)
        .unwrap()
        .filter_map(|e| std::fs::read_to_string(e.unwrap().path()).ok())
        .collect();
    assert!(logged.contains("dispatch_executed"));
    assert!(logged.contains("direct:cron"));
}

#[tokio::test]
async fn direct_token_never_reuses_an_existing_session() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    front.add_worktree("auto/ci-fix", "proj-wt");
    let token = front.direct_token("cron", &DirectTokenLimits::default());
    let first: Value = front
        .dispatch(&token, direct_body())
        .await
        .json()
        .await
        .unwrap();
    let second: Value = front
        .dispatch(&token, direct_body())
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(second["created"], true);
    assert_ne!(first["session_id"], second["session_id"]);
}

#[tokio::test]
async fn direct_requests_that_break_the_restrictions_return_400() {
    let front = spawn_front().await;
    let token = front.direct_token("cron", &DirectTokenLimits::default());

    let mut cases: Vec<(&str, Value)> = Vec::new();
    let mut not_direct = direct_body();
    not_direct["direct"] = json!(false);
    cases.push(("direct omitted as false (cannot queue)", not_direct));
    let mut omitted = direct_body();
    omitted.as_object_mut().unwrap().remove("direct");
    cases.push(("direct omitted", omitted));
    let mut no_job = direct_body();
    no_job.as_object_mut().unwrap().remove("job");
    cases.push(("job omitted", no_job));
    let mut terminal = direct_body();
    terminal["job"] = json!("terminal");
    cases.push(("terminal job", terminal));
    let mut no_worktree = direct_body();
    no_worktree.as_object_mut().unwrap().remove("worktree");
    cases.push(("worktree omitted", no_worktree));
    let mut session = direct_body();
    session["session_id"] = json!("someone-elses-session");
    cases.push(("session_id", session));
    let mut dedup = direct_body();
    dedup["dedup_key"] = json!("k");
    cases.push(("dedup_key", dedup));

    for (label, body) in cases {
        let resp = front.dispatch(&token, body).await;
        assert_eq!(resp.status(), 400, "{label}");
    }
    assert!(front.state.dispatch.pending.lock().await.is_empty());
    assert!(front.state.dispatch.recent.lock().await.is_empty());
}

#[tokio::test]
async fn direct_token_cannot_run_a_job_that_is_not_an_agent() {
    let front = spawn_front().await;
    let token = front.direct_token("cron", &DirectTokenLimits::default());
    // `true` は終了してシェルに戻るため、テキストがシェルへの入力になってしまう。
    let mut body = direct_body();
    body["job"] = json!("build");
    let resp = front.dispatch(&token, body).await;
    assert_eq!(resp.status(), 400);
    let detail: Value = resp.json().await.unwrap();
    assert!(detail["detail"].as_str().unwrap().contains("agent"));

    let mut unknown = direct_body();
    unknown["job"] = json!("no-such-job");
    assert_eq!(front.dispatch(&token, unknown).await.status(), 400);

    assert!(front.state.dispatch.recent.lock().await.is_empty());
    // 回数も消費していない（検証で弾いた要求は数えない）。
    let ledger = front.state.paths.data_dir.join("activity").join("_global");
    assert!(!ledger.exists());
}

#[tokio::test]
async fn main_and_dispatch_scope_direct_requests_are_still_rejected() {
    let front = spawn_front().await;
    let (_meta, dispatch_token) = front
        .state
        .auth
        .create_api_token("ci", API_TOKEN_SCOPE_DISPATCH);
    for token in [TOKEN, dispatch_token.as_str()] {
        let resp = front.dispatch(token, direct_body()).await;
        assert_eq!(resp.status(), 400);
        let body: Value = resp.json().await.unwrap();
        assert!(body["detail"]
            .as_str()
            .unwrap()
            .contains("Direct dispatch execution is no longer supported"));
    }
}

#[tokio::test]
async fn direct_token_is_limited_to_its_allowed_workspaces() {
    let front = spawn_front().await;
    let other = front.direct_token(
        "other-only",
        &DirectTokenLimits {
            allowed_workspaces: Some(vec!["somewhere-else".to_string()]),
            ..Default::default()
        },
    );
    assert_eq!(front.dispatch(&other, direct_body()).await.status(), 403);

    // 許可されたワークスペースなら 403 にはならない（worktree が無いので起動は失敗する）。
    for allowed in ["proj", "ws_proj"] {
        let token = front.direct_token(
            "proj-only",
            &DirectTokenLimits {
                allowed_workspaces: Some(vec![allowed.to_string()]),
                ..Default::default()
            },
        );
        assert_eq!(
            front.dispatch(&token, direct_body()).await.status(),
            400,
            "{allowed}"
        );
    }
}

#[tokio::test]
async fn direct_token_daily_limit_returns_429() {
    let front = spawn_front().await;
    let token = front.direct_token(
        "cron",
        &DirectTokenLimits {
            max_per_day: 2,
            ..Default::default()
        },
    );
    // worktree が無いので起動は失敗するが、受理した試行として数える。
    for _ in 0..2 {
        assert_eq!(front.dispatch(&token, direct_body()).await.status(), 400);
    }
    assert_eq!(front.dispatch(&token, direct_body()).await.status(), 429);

    // 別のトークンの回数には影響しない。
    let other = front.direct_token("other", &DirectTokenLimits::default());
    assert_eq!(front.dispatch(&other, direct_body()).await.status(), 400);
}

#[tokio::test]
async fn expired_direct_token_returns_401() {
    let front = spawn_front().await;
    let token = front.direct_token(
        "old",
        &DirectTokenLimits {
            expires_at: Some(now_epoch() - 1),
            ..Default::default()
        },
    );
    assert_eq!(front.dispatch(&token, direct_body()).await.status(), 401);
}

#[tokio::test]
async fn revoked_direct_token_returns_401() {
    let front = spawn_front().await;
    let (meta, raw) = front
        .state
        .auth
        .create_direct_api_token("cron", &DirectTokenLimits::default());
    assert!(front
        .state
        .auth
        .revoke_api_token(meta["id"].as_str().unwrap()));
    assert_eq!(front.dispatch(&raw, direct_body()).await.status(), 401);
}

#[tokio::test]
async fn direct_token_is_rejected_outside_post_dispatch() {
    let front = spawn_front().await;
    let token = front.direct_token("cron", &DirectTokenLimits::default());

    let decision = common::client()
        .post(front.url("/dispatch/anything/decision"))
        .bearer_auth(&token)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(decision.status(), 401);

    let list = common::client()
        .get(front.url("/api-tokens"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(list.status(), 401);

    let create = common::client()
        .post(front.url("/api-tokens"))
        .bearer_auth(&token)
        .json(&json!({"name": "escalate", "scope": "direct"}))
        .send()
        .await
        .unwrap();
    assert_eq!(create.status(), 401);

    let ws = tokio_tungstenite::connect_async(format!(
        "ws://{}/terminal/ws/some-session?token={token}",
        front.addr
    ))
    .await;
    assert!(ws.is_err(), "the websocket handshake must be refused");
}

#[tokio::test]
async fn failed_direct_run_is_recorded_notified_and_rerunnable_from_history() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let token = front.direct_token("cron", &DirectTokenLimits::default());
    let mut body = direct_body();
    body["worktree"] = json!("auto/later");

    let resp = front.dispatch(&token, body).await;
    assert_eq!(resp.status(), 400);
    let failed_id = {
        let recent = front.state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["outcome"], "failed");
        assert_eq!(recent[0]["auth"], "direct:cron");
        recent[0]["id"].as_str().unwrap().to_string()
    };
    assert!(
        wait_for(|| !front.push_calls.lock().unwrap().is_empty()).await,
        "a failed direct run must be notified too"
    );

    assert!(
        !front.repo.join(".git/refs/heads/auto/later").exists(),
        "a direct run must not create a branch"
    );

    // worktree を用意してから、メイントークンで履歴から再実行する。
    front.add_worktree("auto/later", "proj-later");
    let rerun = common::client()
        .post(front.url(&format!("/dispatch/{failed_id}/decision")))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(rerun.status(), 200);
    let recent = front.state.dispatch.recent.lock().await;
    assert_eq!(recent[0]["outcome"], "executed");
    assert!(
        recent[0].get("auth").is_none(),
        "rerun is a main-token action"
    );
}

#[tokio::test]
async fn issuing_direct_tokens_validates_scope_and_limits() {
    let front = spawn_front().await;
    let post = |body: Value| {
        let client = common::client();
        let url = front.url("/api-tokens");
        async move {
            client
                .post(url)
                .bearer_auth(TOKEN)
                .json(&body)
                .send()
                .await
                .unwrap()
        }
    };

    let ok = post(json!({
        "name": "cron", "scope": "direct", "max_per_day": 3,
        "allowed_workspaces": ["proj"], "expires_at": now_epoch() + 3600,
    }))
    .await;
    assert_eq!(ok.status(), 200);
    let meta: Value = ok.json().await.unwrap();
    assert_eq!(meta["scope"], "direct");
    assert_eq!(meta["max_per_day"], 3);
    assert_eq!(meta["allowed_workspaces"], json!(["proj"]));
    assert!(meta["token"].as_str().is_some());

    let defaults: Value = post(json!({"name": "cron2", "scope": "direct"}))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(defaults["max_per_day"], 10);

    for bad in [
        json!({"name": "x", "scope": "direct", "max_per_day": 0}),
        json!({"name": "x", "scope": "direct", "expires_at": now_epoch() - 1}),
        json!({"name": "x", "scope": "direct", "allowed_workspaces": []}),
        json!({"name": "x", "scope": "admin"}),
        json!({"name": "x", "max_per_day": 3}),
        json!({"name": "x", "scope": "dispatch", "allowed_workspaces": ["proj"]}),
        json!({"name": "x", "scope": "dispatch", "expires_at": now_epoch() - 1}),
    ] {
        assert_eq!(post(bad.clone()).await.status(), 400, "{bad}");
    }

    let legacy: Value = post(json!({"name": "ci"})).await.json().await.unwrap();
    assert_eq!(legacy["scope"], "dispatch");
    assert!(legacy.get("expires_at").is_none());

    let expiring: Value = post(json!({"name": "ci", "expires_at": now_epoch() + 3600}))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(expiring["scope"], "dispatch");
    assert!(expiring["expires_at"].is_i64());
}

#[tokio::test]
async fn expired_dispatch_token_returns_401() {
    let front = spawn_front().await;
    let (_meta, raw) = front
        .state
        .auth
        .create_dispatch_api_token("old", Some(now_epoch() - 1));
    let resp = front
        .dispatch(&raw, json!({"workspace": "proj", "text": "hello"}))
        .await;
    assert_eq!(resp.status(), 401);
    let (_meta, live) = front
        .state
        .auth
        .create_dispatch_api_token("live", Some(now_epoch() + 3600));
    let resp = front
        .dispatch(&live, json!({"workspace": "proj", "text": "hello"}))
        .await;
    assert_eq!(resp.status(), 202);
}

#[tokio::test]
async fn direct_token_creates_a_worktree_for_an_existing_local_branch() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    common::sh_git(&front.repo, &["branch", "auto/ci-fix"]);
    let token = front.direct_token("cron", &DirectTokenLimits::default());

    let resp = front.dispatch(&token, direct_body()).await;
    assert_eq!(resp.status(), 200);
    assert!(front.repo.join(".worktrees/auto-ci-fix/a.txt").exists());
}

#[tokio::test]
async fn direct_token_creates_a_worktree_for_a_branch_that_only_exists_on_origin() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let origin = front.repo.parent().unwrap().join("origin.git");
    std::fs::create_dir_all(&origin).unwrap();
    common::sh_git(&origin, &["init", "-q", "--bare"]);
    common::sh_git(
        &front.repo,
        &["remote", "add", "origin", &origin.to_string_lossy()],
    );
    common::sh_git(&front.repo, &["branch", "auto/ci-fix"]);
    common::sh_git(&front.repo, &["push", "-q", "origin", "auto/ci-fix"]);
    common::sh_git(&front.repo, &["branch", "-D", "auto/ci-fix"]);
    let token = front.direct_token("cron", &DirectTokenLimits::default());

    let resp = front.dispatch(&token, direct_body()).await;
    assert_eq!(resp.status(), 200);
    assert!(front.repo.join(".worktrees/auto-ci-fix/a.txt").exists());
}

#[tokio::test]
async fn direct_token_cannot_take_over_the_branch_checked_out_in_the_main_working_tree() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let token = front.direct_token("cron", &DirectTokenLimits::default());
    let mut body = direct_body();
    body["worktree"] = json!("main");

    let resp = front.dispatch(&token, body).await;
    assert_eq!(resp.status(), 400);
    assert!(!front.repo.join(".worktrees").exists());
}

#[tokio::test]
async fn direct_token_rejects_branch_names_that_look_like_git_options() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let token = front.direct_token("cron", &DirectTokenLimits::default());
    for name in ["--upload-pack", "a..b"] {
        let mut body = direct_body();
        body["worktree"] = json!(name);
        let resp = front.dispatch(&token, body).await;
        assert_eq!(resp.status(), 400, "{name}");
    }
}
