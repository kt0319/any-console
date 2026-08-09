//! `/dispatch` ルート一式の統合テスト。
//!
//! これらのルートはまだ `build_router` に配線されていない（Phase 5 の設計判断 —
//! ターミナル WS・`/run` と同時に配線する）ため、テスト専用の Router を直接
//! 組み立てる。Python 側の migration_bridge（push 通知・dispatch キュー中継・
//! dispatch scope API トークン検証）はフェイクの upstream サーバで代替する。

use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message as TgMsg;

use any_console_server::auth::Auth;
use any_console_server::config::ConfigStore;
use any_console_server::dispatch::{self, DispatchState};
use any_console_server::git_lock::WorkspaceLocks;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::terminal;
use any_console_server::terminal_session::TerminalRegistry;

const TOKEN: &str = "dispatch-test-token";
const SCOPED_TOKEN: &str = "scoped-dispatch-token";

#[derive(Default, Clone)]
struct FakeUpstreamCalls {
    push: Arc<StdMutex<Vec<Value>>>,
    queue: Arc<StdMutex<Vec<Value>>>,
    session_events: Arc<StdMutex<Vec<Value>>>,
}

async fn verify_token_handler(
    AxumState(_calls): AxumState<FakeUpstreamCalls>,
    Json(body): Json<Value>,
) -> Json<Value> {
    if body["token"] == SCOPED_TOKEN {
        Json(json!({"ok": true, "label": "token:tok_1"}))
    } else {
        Json(json!({"ok": false, "label": null}))
    }
}

async fn send_push_handler(
    AxumState(calls): AxumState<FakeUpstreamCalls>,
    Json(body): Json<Value>,
) -> Json<Value> {
    calls.push.lock().unwrap().push(body);
    Json(json!({"status": "ok"}))
}

async fn dispatch_queue_handler(
    AxumState(calls): AxumState<FakeUpstreamCalls>,
    Json(body): Json<Value>,
) -> Json<Value> {
    calls.queue.lock().unwrap().push(body);
    Json(json!({"status": "ok"}))
}

async fn session_event_handler(
    AxumState(calls): AxumState<FakeUpstreamCalls>,
    Json(body): Json<Value>,
) -> Json<Value> {
    calls.session_events.lock().unwrap().push(body);
    Json(json!({"status": "ok"}))
}

fn upstream_router(calls: FakeUpstreamCalls) -> Router {
    Router::new()
        .route(
            "/internal/verify-dispatch-api-token",
            post(verify_token_handler),
        )
        .route("/internal/send-push", post(send_push_handler))
        .route("/internal/dispatch-queue", post(dispatch_queue_handler))
        .route("/internal/session-event", post(session_event_handler))
        .with_state(calls)
}

async fn spawn(router: Router) -> SocketAddr {
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

struct TestFront {
    addr: SocketAddr,
    state: Arc<AppState>,
    calls: FakeUpstreamCalls,
    _dir: tempfile::TempDir,
}

fn dispatch_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/dispatch", post(dispatch::dispatch))
        .route(
            "/dispatch/{dispatch_id}/decision",
            post(dispatch::dispatch_decision),
        )
        .route(
            "/dispatch/{dispatch_id}/rerun",
            post(dispatch::dispatch_rerun),
        )
        .route("/terminal/ws/{session_id}", get(terminal::terminal_ws))
        .route(
            "/terminal/sessions/{session_id}/detached",
            put(terminal::set_terminal_detached),
        )
        .with_state(state)
}

fn make_repo(path: &std::path::Path) {
    std::fs::create_dir_all(path).unwrap();
    let sh = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    sh(&["init", "-q", "-b", "main"]);
    sh(&["config", "user.email", "t@example.com"]);
    sh(&["config", "user.name", "tester"]);
    std::fs::write(path.join("a.txt"), "hi\n").unwrap();
    sh(&["add", "-A"]);
    sh(&["commit", "-q", "-m", "first"]);
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let tmux_prefix = format!("ac-test-{}-", any_console_server::util::token_hex(3));

    let ws_path = dir.path().join("proj");
    make_repo(&ws_path);
    let config_file = dir.path().join("config.json");
    let store = ConfigStore::new(config_file.clone());
    let mut cfg = store.load_all();
    cfg.insert(
        "ws_proj".to_string(),
        json!({"name": "proj", "path": ws_path.to_string_lossy()}),
    );
    store.save_all(&cfg).unwrap();

    let calls = FakeUpstreamCalls::default();
    let upstream_addr = spawn(upstream_router(calls.clone())).await;

    let state = Arc::new(AppState {
        paths: Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: config_file.clone(),
            frontend_dir: dir.path().join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix,
        },
        config: store,
        git_locks: WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: TerminalRegistry::new(),
        dispatch: DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            dir.path().join("agent_manifests"),
            dir.path(),
        ),
        proxy: Proxy::new(format!("http://{upstream_addr}")),
        static_ctx: None,
        auth: Auth::load(data_dir, false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit: 10_000,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router_state = state.clone();
    tokio::spawn(async move {
        axum::serve(
            listener,
            dispatch_router(router_state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    TestFront {
        addr,
        state,
        calls,
        _dir: dir,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

fn skip_if_no_tmux() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
}

/// workspace の（当日1ファイルしかないはずの）activity.jsonl から末尾（最新）の
/// `event_type` エントリの "auth" フィールドを読む。
fn latest_activity_auth(data_dir: &std::path::Path, workspace: &str, event_type: &str) -> String {
    let dir = data_dir.join("activity").join(workspace);
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{dir:?}: {e}"))
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    let path = entries
        .last()
        .unwrap_or_else(|| panic!("no activity file in {dir:?}"));
    let content = std::fs::read_to_string(path.path()).unwrap();
    content
        .lines()
        .rev()
        .find_map(|line| {
            let v: Value = serde_json::from_str(line).ok()?;
            (v["type"] == event_type).then(|| v["auth"].as_str().unwrap_or("").to_string())
        })
        .unwrap_or_else(|| panic!("no {event_type} entry found in {path:?}"))
}

async fn wait_for(cond: impl Fn() -> bool) -> bool {
    // CI や `cargo test` の全体並列実行下では CPU 競合で遅延しうるため、多少
    // 余裕を持たせる。
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
async fn dispatch_requires_auth() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn direct_dispatch_creates_session_and_sends_push() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "direct": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["created"], true);
    let session_id = body["session_id"].as_str().unwrap().to_string();

    assert!(wait_for(|| !front.calls.push.lock().unwrap().is_empty()).await);
    assert!(wait_for(|| !front.calls.session_events.lock().unwrap().is_empty()).await);

    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    assert!(any_console_server::subprocess::tmux_session_exists(&full_name).await);
    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}

#[tokio::test]
async fn scoped_token_direct_dispatch_rejected() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(SCOPED_TOKEN)
        .json(&json!({"workspace": "proj", "direct": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(
        body["detail"],
        "Direct execution is not allowed for dispatch token"
    );
}

#[tokio::test]
async fn scoped_token_queued_dispatch_ignores_session_id() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(SCOPED_TOKEN)
        .json(&json!({"workspace": "proj", "session_id": "someone-elses-session"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "pending");
}

#[tokio::test]
async fn queued_dispatch_then_decision_approve_launches_session() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202);
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    assert!(wait_for(|| !front.calls.queue.lock().unwrap().is_empty()).await);
    {
        let queued = front.calls.queue.lock().unwrap();
        let last = queued.last().unwrap();
        assert_eq!(last["items"][0]["id"], dispatch_id);
    }

    let resp = client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"approved": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["created"], true);
    let session_id = body["session_id"].as_str().unwrap().to_string();
    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    assert!(any_console_server::subprocess::tmux_session_exists(&full_name).await);
    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}

#[tokio::test]
async fn decision_reject_removes_from_pending() {
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    let resp = client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"approved": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 二度目の decision は 404（既に消えている）
    let resp = client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"approved": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn dedup_key_supersedes_previous_pending_item() {
    let front = spawn_front().await;
    let post_dispatch = |text: &str| {
        let addr = front.addr;
        let text = text.to_string();
        async move {
            client()
                .post(format!("http://{addr}/dispatch"))
                .bearer_auth(TOKEN)
                .json(&json!({"workspace": "proj", "dedup_key": "ci-failure", "text": text}))
                .send()
                .await
                .unwrap()
        }
    };
    let resp1 = post_dispatch("first").await;
    let id1: Value = resp1.json().await.unwrap();
    let resp2 = post_dispatch("second").await;
    let id2: Value = resp2.json().await.unwrap();
    // 同じ dedup_key の再送は古い項目の ID を引き継ぐ
    assert_eq!(id1["id"], id2["id"]);

    assert!(wait_for(|| !front.calls.queue.lock().unwrap().is_empty()).await);
    let queued = front.calls.queue.lock().unwrap();
    let last = queued.last().unwrap();
    assert_eq!(last["items"].as_array().unwrap().len(), 1);
    assert_eq!(last["items"][0]["request"]["text"], "second");
    assert_eq!(last["items"][0]["request"]["retry_count"], 2);
}

/// 同じ dedup_key を持つ dispatch が並行到着しても pending に1件しか残らないこと
/// （Codex レビュー指摘: 検索と挿入が別ロックだと両方とも「初回」と誤判定し、
/// coalesce されず複数件が積まれてしまう）。
// マルチスレッド runtime にする: `tokio::sync::Mutex::lock().await` は非競合時に
// 即座に完了し実際には yield しないため、既定の current_thread runtime では
// 2つのロック区間に分かれた検索→挿入の隙間に別タスクが割り込む機会がほぼ無く、
// 本番（`#[tokio::main]` = multi_thread）で起きる並行実行の競合を再現できない。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_dedup_dispatch_requests_do_not_duplicate_pending_item() {
    let front = spawn_front().await;
    let addr = front.addr;
    let mut handles = Vec::new();
    for i in 0..8 {
        handles.push(tokio::spawn(async move {
            client()
                .post(format!("http://{addr}/dispatch"))
                .bearer_auth(TOKEN)
                .json(&json!({"workspace": "proj", "dedup_key": "ci-failure", "text": format!("run-{i}")}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), 202);
    }
    // dispatch キューへの反映（resolve_dedup_and_insert）は各リクエストの応答を
    // 返す前に同期的に完了しているため、状態は直接 state.dispatch.pending から
    // 確認する。upstream への broadcast_dispatch_queue は fire-and-forget（別
    // タスク）で配信順の保証が無いため、front.calls.queue の「最後の要素」に
    // 依存すると、CPU 競合下でスナップショットの到着順が入れ替わってフレークする。
    let pending = front.state.dispatch.pending.lock().await;
    assert_eq!(pending.len(), 1, "dedup_key で1件に集約される: {pending:?}");
    let (_, item) = pending.iter().next().unwrap();
    assert_eq!(item["retry_count"], json!(8), "{item:?}");
}

/// 同じ dispatch_id への decision(approved) が並行到着しても launch は1回しか
/// 実行されないこと（Codex レビュー指摘: 取得と削除が別ロックだと両方が
/// Some を引き当てて二重にセッションが起動してしまう）。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_decision_approvals_launch_session_only_once() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202);
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    let addr = front.addr;
    let mut handles = Vec::new();
    for _ in 0..5 {
        let dispatch_id = dispatch_id.clone();
        handles.push(tokio::spawn(async move {
            client()
                .post(format!("http://{addr}/dispatch/{dispatch_id}/decision"))
                .bearer_auth(TOKEN)
                .json(&json!({"approved": true}))
                .send()
                .await
                .unwrap()
        }));
    }
    let mut ok_bodies = Vec::new();
    let mut not_found_count = 0;
    for h in handles {
        let resp = h.await.unwrap();
        match resp.status().as_u16() {
            200 => ok_bodies.push(resp.json::<Value>().await.unwrap()),
            404 => not_found_count += 1,
            other => panic!("unexpected status {other}"),
        }
    }
    assert_eq!(
        ok_bodies.len(),
        1,
        "承認は1回だけ成功する（残りは既に消費済みで404）: not_found={not_found_count}"
    );
    assert_eq!(not_found_count, 4);

    let session_id = ok_bodies[0]["session_id"].as_str().unwrap().to_string();
    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    assert!(any_console_server::subprocess::tmux_session_exists(&full_name).await);
    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}

/// pending_text の tmux 環境変数永続化が実際に機能することを end-to-end で検証する
/// （dispatch.rs 冒頭の設計判断コメントで説明している中核の修正点）。
#[tokio::test]
async fn approved_new_session_flushes_pending_text_over_ws() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "text": "echo pending-text-arrived", "enter": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    let resp = client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"approved": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["created"], true);
    let session_id = body["session_id"].as_str().unwrap().to_string();

    // WS クライアントが後から接続しても pending text が flush される
    let url = format!(
        "ws://{}/terminal/ws/{session_id}?token={TOKEN}&cols=80&rows=24",
        front.addr
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");

    let mut collected = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline && !collected.contains("pending-text-arrived") {
        match tokio::time::timeout(Duration::from_millis(500), ws.next()).await {
            Ok(Some(Ok(TgMsg::Binary(b)))) => collected.push_str(&String::from_utf8_lossy(&b)),
            _ => continue,
        }
    }
    assert!(
        collected.contains("pending-text-arrived"),
        "collected: {collected:?}"
    );

    ws.close(None).await.unwrap();
    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}

#[tokio::test]
async fn dispatch_rerun_run_true_executes_immediately() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    // まず承認済みの履歴を作る
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();
    let resp = client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"approved": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let first_session = body["session_id"].as_str().unwrap().to_string();
    any_console_server::subprocess::kill_tmux_by_name(&format!(
        "{}{first_session}",
        front.state.paths.tmux_prefix
    ))
    .await;

    // 履歴に残った dispatch_id（decision 側で record_recent された新しい ID とは
    // 別）を使い、match="none" にして必ず新規セッションを作らせて rerun を検証する。
    let recent_id = {
        let recent = front.state.dispatch.recent.lock().await;
        recent[0]["id"].as_str().unwrap().to_string()
    };
    let resp = client()
        .post(format!("http://{}/dispatch/{recent_id}/rerun", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"run": true, "match": "none"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    let new_session = body["session_id"].as_str().unwrap().to_string();
    assert_ne!(new_session, first_session);

    // Python 版 `Depends(verify_token)` と同じく、実際に認証された経路のラベルが
    // activity ログへ残ること（Codex レビュー指摘: 以前は "main" 固定だった。
    // メイントークン認証時のラベルは生の Bearer 値そのもの — Python の
    // `_authenticate` も同じ挙動）。
    assert_eq!(
        latest_activity_auth(&front.state.paths.data_dir, "proj", "dispatch_executed"),
        TOKEN
    );

    any_console_server::subprocess::kill_tmux_by_name(&format!(
        "{}{new_session}",
        front.state.paths.tmux_prefix
    ))
    .await;
}

#[tokio::test]
async fn existing_session_reuse_sends_text_directly_without_pending_env() {
    if skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    // 1回目の dispatch でセッションを作る
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "direct": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let session_id = body["session_id"].as_str().unwrap().to_string();

    // 2回目は同じセッションを再利用（match=any）してテキストを直接送る
    let resp = client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "direct": true, "text": "echo direct-reuse-text"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["created"], false);
    assert_eq!(body["session_id"], session_id);

    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    let found = wait_for(|| {
        let out = std::process::Command::new("tmux")
            .args(["capture-pane", "-t", &full_name, "-p"])
            .output();
        out.map(|o| String::from_utf8_lossy(&o.stdout).contains("direct-reuse-text"))
            .unwrap_or(false)
    })
    .await;
    assert!(found, "text should be sent directly to the reused session");

    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}
