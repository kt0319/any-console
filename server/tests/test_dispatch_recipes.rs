//! `/dispatch/recipes` ルート一式の統合テスト（ADR 34）。
//!
//! `test_dispatch.rs` と同様、テスト専用の Router に必要なルートだけを配線する。
//! recipe は config の global セクション `dispatch_recipes` に実際に書き込んで読ませる。

mod common;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use any_console_server::config::ConfigStore;
use any_console_server::dispatch::{self};
use any_console_server::dispatch_recipes;
use any_console_server::json_store::save_json_file;
use any_console_server::state::AppState;
use any_console_server::util::base64url_encode;

const TOKEN: &str = "recipe-test-token";
const RUN_URL: &str = "https://github.com/kt0319/any-console/actions/runs/42";

fn manual_recipe() -> Value {
    json!({
        "id": "ci-fix",
        "workspace": "proj",
        "branch": "{branch}",
        "job": "fixer",
        "text": "CI failed on {branch}. Run: {url}",
        "dedup": "ci-failure:{workspace}:{branch}",
        "params": {
            "branch": {"pattern": "[A-Za-z0-9._/-]{1,100}", "required": true},
            "url": {"pattern": "https://github\\.com/kt0319/any-console/actions/runs/\\d+", "required": true},
        },
        "approve": "manual",
        "max_per_day": 2,
    })
}

fn auto_recipe() -> Value {
    json!({
        "id": "ci-auto",
        "workspace": "proj",
        "worktree": "auto/ci-fix",
        "job": "fixer",
        "text": "Fix CI: {url}",
        "params": {
            "url": {"pattern": "https://github\\.com/kt0319/any-console/actions/runs/\\d+", "required": true},
        },
        "approve": "auto",
        "max_per_day": 5,
        "cooldown_sec": 600,
    })
}

fn recipe_args() -> Value {
    json!({"branch": "main", "url": RUN_URL})
}

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
    push_calls: Arc<StdMutex<Vec<ReceivedPush>>>,
    _dir: tempfile::TempDir,
    _tmux_cleanup: common::TmuxSessionCleanup,
}

impl Front {
    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    async fn run_recipe(&self, id: &str, token: &str, body: Value) -> reqwest::Response {
        common::client()
            .post(self.url(&format!("/dispatch/recipes/{id}")))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    fn scoped_token(&self, allowed: &[&str]) -> String {
        let allowed: Vec<String> = allowed.iter().map(|s| s.to_string()).collect();
        let (_meta, raw) = self.state.auth.create_api_token_with_recipes(
            "scoped",
            any_console_server::auth::API_TOKEN_SCOPE_DISPATCH,
            &allowed,
        );
        raw
    }
}

fn recipes_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/dispatch", post(dispatch::dispatch))
        .route("/dispatch/recipes", get(dispatch_recipes::list_recipes))
        .route(
            "/dispatch/recipes/{recipe_id}",
            post(dispatch_recipes::run_recipe),
        )
        .route(
            "/dispatch/{dispatch_id}/decision",
            post(dispatch::dispatch_decide),
        )
        .with_state(state)
}

fn git(repo: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn make_repo_with_worktree(dir: &std::path::Path) -> std::path::PathBuf {
    let repo = dir.join("proj");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["config", "user.email", "t@example.com"]);
    git(&repo, &["config", "user.name", "tester"]);
    std::fs::write(repo.join("a.txt"), "hi\n").unwrap();
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "first"]);
    let wt = dir.join("proj-wt");
    git(
        &repo,
        &[
            "worktree",
            "add",
            &wt.to_string_lossy(),
            "-b",
            "auto/ci-fix",
        ],
    );
    repo
}

async fn spawn_front(recipes: Vec<Value>, paused: bool) -> Front {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let (tmux_prefix, tmux_cleanup) = common::unique_tmux_prefix();

    let repo = make_repo_with_worktree(dir.path());
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
            json!({"fixer": {"command": "true", "label": "Fixer"}}),
        )
        .unwrap();
    store
        .save_global_section(dispatch_recipes::RECIPES_CONFIG_KEY, json!(recipes))
        .unwrap();
    if paused {
        store
            .save_global_section(dispatch_recipes::RECIPES_PAUSED_CONFIG_KEY, json!(true))
            .unwrap();
    }

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
    let addr = serve_router(recipes_router(state.clone())).await;
    Front {
        addr,
        state,
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
async fn manual_recipe_queues_one_pending_item() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    let resp = front.run_recipe("ci-fix", TOKEN, recipe_args()).await;
    assert_eq!(resp.status(), 202);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "pending");
    assert_eq!(body["dispatch_id"], body["id"]);

    let pending = front.state.dispatch.pending.lock().await;
    assert_eq!(pending.len(), 1);
    let item = pending.get(body["id"].as_str().unwrap()).unwrap();
    assert_eq!(item["job"], "fixer");
    assert_eq!(item["branch"], "main");
    assert_eq!(item["text"], format!("CI failed on main. Run: {RUN_URL}"));
    assert_eq!(item["dedup_key"], "ci-failure:proj:main");
    assert_eq!(item["origin"], "recipe:ci-fix");
    assert_eq!(item["direct"], false);
}

#[tokio::test]
async fn manual_recipe_coalesces_by_dedup_key() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    for _ in 0..2 {
        let resp = front.run_recipe("ci-fix", TOKEN, recipe_args()).await;
        assert_eq!(resp.status(), 202);
    }
    let pending = front.state.dispatch.pending.lock().await;
    assert_eq!(pending.len(), 1);
    assert_eq!(pending.values().next().unwrap()["retry_count"], 2);
}

#[tokio::test]
async fn origin_survives_discard_into_recent_history() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    let body: Value = front
        .run_recipe("ci-fix", TOKEN, recipe_args())
        .await
        .json()
        .await
        .unwrap();
    let id = body["id"].as_str().unwrap();
    let resp = common::client()
        .post(front.url(&format!("/dispatch/{id}/decision")))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let recent = front.state.dispatch.recent.lock().await;
    assert_eq!(recent[0]["origin"], "recipe:ci-fix");
    assert_eq!(recent[0]["outcome"], "discarded");
}

#[tokio::test]
async fn auto_recipe_launches_without_queue_and_notifies() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front(vec![auto_recipe()], false).await;
    let resp = front
        .run_recipe("ci-auto", TOKEN, json!({"url": RUN_URL}))
        .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "executed");
    assert_eq!(body["workspace"], "proj:auto/ci-fix");
    assert!(body["session_id"].as_str().is_some());

    assert!(front.state.dispatch.pending.lock().await.is_empty());
    {
        let recent = front.state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["origin"], "recipe:ci-auto");
        assert_eq!(recent[0]["outcome"], "executed");
        assert_eq!(recent[0]["id"], body["dispatch_id"]);
    }
    assert!(
        wait_for(|| !front.push_calls.lock().unwrap().is_empty()).await,
        "auto-run must send a push notification"
    );
    assert!(front.push_calls.lock().unwrap()[0].body_len > 0);

    // 直後の再起動は cooldown で止まる
    let again = front
        .run_recipe("ci-auto", TOKEN, json!({"url": RUN_URL}))
        .await;
    assert_eq!(again.status(), 429);
}

#[tokio::test]
async fn auto_recipe_records_failure_when_the_worktree_is_missing() {
    let mut recipe = auto_recipe();
    recipe["worktree"] = json!("auto/does-not-exist");
    let front = spawn_front(vec![recipe], false).await;
    let resp = front
        .run_recipe("ci-auto", TOKEN, json!({"url": RUN_URL}))
        .await;
    assert_eq!(resp.status(), 400);
    let recent = front.state.dispatch.recent.lock().await;
    assert_eq!(recent[0]["origin"], "recipe:ci-auto");
    assert_eq!(recent[0]["outcome"], "failed");
}

#[tokio::test]
async fn body_cannot_override_recipe_contents() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    for (key, value) in [
        ("text", json!("rm -rf /")),
        ("job", json!("terminal")),
        ("worktree", json!("x")),
        ("direct", json!(true)),
        ("workspace", json!("other")),
    ] {
        let mut body = recipe_args();
        body[key] = value;
        let resp = front.run_recipe("ci-fix", TOKEN, body).await;
        assert_eq!(resp.status(), 400, "{key}");
    }
    assert!(front.state.dispatch.pending.lock().await.is_empty());
}

#[tokio::test]
async fn invalid_or_missing_params_return_400() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    let bad_url = front
        .run_recipe(
            "ci-fix",
            TOKEN,
            json!({"branch": "main", "url": "https://evil.example/actions/runs/1"}),
        )
        .await;
    assert_eq!(bad_url.status(), 400);
    let bad_branch = front
        .run_recipe(
            "ci-fix",
            TOKEN,
            json!({"branch": "main; rm -rf /", "url": RUN_URL}),
        )
        .await;
    assert_eq!(bad_branch.status(), 400);
    let missing = front
        .run_recipe("ci-fix", TOKEN, json!({"branch": "main"}))
        .await;
    assert_eq!(missing.status(), 400);
    let not_string = front
        .run_recipe("ci-fix", TOKEN, json!({"branch": 1, "url": RUN_URL}))
        .await;
    assert_eq!(not_string.status(), 400);
}

#[tokio::test]
async fn token_scope_controls_which_recipes_can_run() {
    let front = spawn_front(vec![manual_recipe(), auto_recipe()], false).await;

    let allowed = front.scoped_token(&["ci-fix"]);
    assert_eq!(
        front
            .run_recipe("ci-fix", &allowed, recipe_args())
            .await
            .status(),
        202
    );
    assert_eq!(
        front
            .run_recipe("ci-auto", &allowed, json!({"url": RUN_URL}))
            .await
            .status(),
        403
    );

    let (_meta, legacy) = front
        .state
        .auth
        .create_api_token("legacy", any_console_server::auth::API_TOKEN_SCOPE_DISPATCH);
    assert_eq!(
        front
            .run_recipe("ci-fix", &legacy, recipe_args())
            .await
            .status(),
        403
    );

    let list = |token: &str| {
        common::client()
            .get(front.url("/dispatch/recipes"))
            .bearer_auth(token.to_string())
            .send()
    };
    assert!(!list(&allowed).await.unwrap().status().is_success());
    let main_list = list(TOKEN).await.unwrap();
    assert_eq!(main_list.status(), 200);
    let body: Value = main_list.json().await.unwrap();
    assert_eq!(body["paused"], false);
    let ids: Vec<&str> = body["recipes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["ci-fix", "ci-auto"]);
    assert_eq!(body["recipes"][0]["params"][0]["name"], "branch");
    assert_eq!(body["recipes"][0]["params"][0]["required"], true);
}

#[tokio::test]
async fn recipe_endpoints_require_auth() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    let resp = common::client()
        .post(front.url("/dispatch/recipes/ci-fix"))
        .json(&recipe_args())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn unknown_disabled_or_invalid_recipes_return_404() {
    let mut disabled = manual_recipe();
    disabled["id"] = json!("off");
    disabled["enabled"] = json!(false);
    let mut invalid = manual_recipe();
    invalid["id"] = json!("bad");
    invalid["job"] = json!("terminal");
    let front = spawn_front(vec![manual_recipe(), disabled, invalid], false).await;
    for id in ["nope", "off", "bad"] {
        let resp = front.run_recipe(id, TOKEN, recipe_args()).await;
        assert_eq!(resp.status(), 404, "{id}");
    }
}

#[tokio::test]
async fn paused_recipes_return_409() {
    let front = spawn_front(vec![manual_recipe()], true).await;
    let resp = front.run_recipe("ci-fix", TOKEN, recipe_args()).await;
    assert_eq!(resp.status(), 409);
    assert!(front.state.dispatch.pending.lock().await.is_empty());
}

#[tokio::test]
async fn daily_limit_returns_429_and_survives_a_new_state() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    for branch in ["a", "b"] {
        let resp = front
            .run_recipe("ci-fix", TOKEN, json!({"branch": branch, "url": RUN_URL}))
            .await;
        assert_eq!(resp.status(), 202);
    }
    let over = front.run_recipe("ci-fix", TOKEN, recipe_args()).await;
    assert_eq!(over.status(), 429);

    // 起動回数は activity ログに残るため、メモリ状態が空の別サーバでも同じ上限が効く
    let data_dir = front.state.paths.data_dir.clone();
    let recipe = dispatch_recipes::load_recipes(&front.state).remove(0);
    let fired =
        dispatch_recipes::read_fired(&data_dir, &recipe, any_console_server::util::now_epoch());
    assert_eq!(fired.len(), 2);
}

#[tokio::test]
async fn plain_dispatch_endpoint_is_unchanged() {
    let front = spawn_front(vec![manual_recipe()], false).await;
    let direct = common::client()
        .post(front.url("/dispatch"))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "direct": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(direct.status(), 400);
    let queued = common::client()
        .post(front.url("/dispatch"))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "text": "hello"}))
        .send()
        .await
        .unwrap();
    assert_eq!(queued.status(), 202);
    let pending = front.state.dispatch.pending.lock().await;
    assert!(pending.values().next().unwrap().get("origin").is_none());
}
