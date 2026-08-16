//! `/dispatch` ルート一式の統合テスト。
//!
//! これらのルートはまだ `build_router` に配線されていない（Phase 5 の設計判断 —
//! ターミナル WS・`/run` と同時に配線する）ため、テスト専用の Router を直接
//! 組み立てる。dispatch キューの配信は `state.status_stream`（ネイティブ
//! broadcast channel）を直接購読して検証する。dispatch scope API トークン検証は
//! `Auth::verify_and_touch_api_token` へネイティブに移行済みのため、フェイクではなく
//! `Auth::create_api_token` で実際に発行したトークンを使う。push 通知は
//! `crate::push` へネイティブに移行済みのため、フェイクの Web Push サービスへ
//! 実際に暗号化された HTTP リクエストが飛ぶことを検証する（暗号の正しさ自体は
//! `push.rs` の RFC 8291 ユニットテストで別途検証済み — ここでは配線のみ確認）。

mod common;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message as TgMsg;

use any_console_server::config::ConfigStore;
use any_console_server::dispatch::{self};
use any_console_server::json_store::save_json_file;
use any_console_server::state::AppState;
use any_console_server::terminal;
use any_console_server::util::base64url_encode;

const TOKEN: &str = "dispatch-test-token";

/// フェイクの Web Push サービス（fcm.googleapis.com 相当）が受け取ったリクエスト。
#[derive(Clone)]
struct ReceivedPush {
    content_encoding: String,
    authorization: String,
    body_len: usize,
}

async fn push_service_handler(
    AxumState(calls): AxumState<Arc<StdMutex<Vec<ReceivedPush>>>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Json<Value> {
    calls.lock().unwrap().push(ReceivedPush {
        content_encoding: headers
            .get("content-encoding")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string(),
        authorization: headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string(),
        body_len: body.len(),
    });
    Json(json!({"status": "ok"}))
}

/// テスト用の P-256 購読者（UA）キーペアを生成し、push.rs が期待する
/// `p256dh`（65 byte 非圧縮点）/`auth`（16 byte）を base64url で返す。
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

fn push_service_router(calls: Arc<StdMutex<Vec<ReceivedPush>>>) -> Router {
    Router::new()
        .route("/push-endpoint", post(push_service_handler))
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
    scoped_token: String,
    push_calls: Arc<StdMutex<Vec<ReceivedPush>>>,
    _dir: tempfile::TempDir,
}

fn dispatch_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/dispatch", post(dispatch::dispatch))
        .route(
            "/dispatch/{dispatch_id}/decision",
            post(dispatch::dispatch_execute),
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
    let tmux_prefix = common::unique_tmux_prefix();

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

    let push_calls: Arc<StdMutex<Vec<ReceivedPush>>> = Arc::new(StdMutex::new(Vec::new()));
    let push_service_addr = spawn(push_service_router(push_calls.clone())).await;
    let (p256dh, auth_key) = generate_test_push_subscriber_keys();
    save_json_file(
        &data_dir.join("push_subscriptions.json"),
        &json!([{
            "endpoint": format!("http://{push_service_addr}/push-endpoint"),
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
    let (_meta, scoped_token) = state
        .auth
        .create_api_token("scoped", any_console_server::auth::API_TOKEN_SCOPE_DISPATCH);
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
        scoped_token,
        push_calls,
        _dir: dir,
    }
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

/// `state.status_stream` の broadcast channel から、`pred` に一致する最初の
/// メッセージを受け取るまで読み進める（agent_watch のポーリングループ等が
/// 同時に無関係なメッセージを送ることがあるため、次の1件を決め打ちしない）。
async fn recv_broadcast_matching(
    rx: &mut tokio::sync::broadcast::Receiver<Value>,
    pred: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        assert!(
            remaining > Duration::ZERO,
            "timed out waiting for broadcast"
        );
        let msg = tokio::time::timeout(remaining, rx.recv())
            .await
            .expect("timed out waiting for broadcast")
            .unwrap();
        if pred(&msg) {
            return msg;
        }
    }
}

#[tokio::test]
async fn dispatch_requires_auth() {
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn direct_dispatch_is_rejected() {
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "direct": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(
        body["detail"],
        "Direct dispatch execution is no longer supported; submit to the approval queue instead"
    );
}

#[tokio::test]
async fn scoped_token_direct_dispatch_rejected() {
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(&front.scoped_token)
        .json(&json!({"workspace": "proj", "direct": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(
        body["detail"],
        "Direct dispatch execution is no longer supported; submit to the approval queue instead"
    );
}

#[tokio::test]
async fn scoped_token_queued_dispatch_ignores_session_id() {
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(&front.scoped_token)
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
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let mut rx = front.state.status_stream.tx.subscribe();
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202);
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    // キューへの挿入が status stream 購読者へネイティブ配信される。
    let broadcast = recv_broadcast_matching(&mut rx, |m| m["type"] == "dispatch_queue").await;
    assert_eq!(broadcast["items"][0]["id"], dispatch_id);

    assert!(wait_for(|| !front.push_calls.lock().unwrap().is_empty()).await);
    let received = front.push_calls.lock().unwrap()[0].clone();
    assert_eq!(received.content_encoding, "aes128gcm");
    assert!(received.authorization.starts_with("vapid t="));
    assert!(
        received.body_len > 16 + 4 + 1 + 65,
        "should include ECE header + ciphertext"
    );

    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
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
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // pendingからは消えているが、破棄済みでも履歴（recent）からは同じidで
    // 再実行できる（「Recently executed」のrejected項目もUIから再実行可能な
    // 仕様と一致させる）。
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let session_id = body["session_id"].as_str().unwrap().to_string();
    any_console_server::subprocess::kill_tmux_by_name(&format!(
        "{}{session_id}",
        front.state.paths.tmux_prefix
    ))
    .await;
}

#[tokio::test]
async fn dedup_key_supersedes_previous_pending_item() {
    let front = spawn_front().await;
    let mut rx = front.state.status_stream.tx.subscribe();
    let post_dispatch = |text: &str| {
        let addr = front.addr;
        let text = text.to_string();
        async move {
            common::client()
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

    // 2回目の dispatch による status stream 配信は、1件に集約されたキューを積む。
    let broadcast = recv_broadcast_matching(&mut rx, |m| {
        m["type"] == "dispatch_queue" && m["items"][0]["request"]["text"] == "second"
    })
    .await;
    assert_eq!(broadcast["items"].as_array().unwrap().len(), 1);
    assert_eq!(broadcast["items"][0]["request"]["retry_count"], 2);
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
            common::client()
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
    // 確認する。
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
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = common::client()
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
            common::client()
                .post(format!("http://{addr}/dispatch/{dispatch_id}/decision"))
                .bearer_auth(TOKEN)
                .json(&json!({"executed": true}))
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
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "text": "echo pending-text-arrived", "enter": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
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

/// 承認された text が複数行（改行を含む）の場合でも、全行が欠落せずに
/// flush されること（Codex レビュー指摘: pending text は1行の tmux 環境変数
/// 値として永続化するため、素朴に生テキストを入れると改行以降が
/// `show-environment` のパース時に失われていた）。
#[tokio::test]
async fn approved_new_session_flushes_multiline_pending_text_over_ws() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({
            "workspace": "proj",
            "text": "echo multiline-marker-one\necho multiline-marker-two",
            "enter": true,
        }))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();

    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let session_id = body["session_id"].as_str().unwrap().to_string();

    let url = format!(
        "ws://{}/terminal/ws/{session_id}?token={TOKEN}&cols=80&rows=24",
        front.addr
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect");

    let mut collected = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline
        && !(collected.contains("multiline-marker-one")
            && collected.contains("multiline-marker-two"))
    {
        match tokio::time::timeout(Duration::from_millis(500), ws.next()).await {
            Ok(Some(Ok(TgMsg::Binary(b)))) => collected.push_str(&String::from_utf8_lossy(&b)),
            _ => continue,
        }
    }
    assert!(
        collected.contains("multiline-marker-one"),
        "first line missing, collected: {collected:?}"
    );
    assert!(
        collected.contains("multiline-marker-two"),
        "second line missing (this is the exact failure mode the fix addresses), collected: {collected:?}"
    );

    ws.close(None).await.unwrap();
    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}

#[tokio::test]
async fn decided_dispatch_re_executed_from_history() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    // まず承認済みの履歴を作る
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
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
    // 別）を使い、match="none" にして必ず新規セッションを作らせて再実行を検証する。
    let recent_id = {
        let recent = front.state.dispatch.recent.lock().await;
        recent[0]["id"].as_str().unwrap().to_string()
    };
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{recent_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true, "match": "none"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    let new_session = body["session_id"].as_str().unwrap().to_string();
    assert_ne!(new_session, first_session);

    // 実際に認証された経路のラベルが activity ログへ残ること。メイントークン
    // 認証時のラベルは "main" — Python 版は生の Bearer 値そのものを記録して
    // いたが、恒久クレデンシャルが activity ログへ平文で永続化されてしまう
    // ため Rust 版では記録しない（POST /dispatch 本体と同じラベル）。
    let auth_label = latest_activity_auth(&front.state.paths.data_dir, "proj", "dispatch_executed");
    assert_eq!(auth_label, "main");
    assert!(!auth_label.contains(TOKEN));

    any_console_server::subprocess::kill_tmux_by_name(&format!(
        "{}{new_session}",
        front.state.paths.tmux_prefix
    ))
    .await;
}

#[tokio::test]
async fn existing_session_reuse_sends_text_directly_without_pending_env() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    // 1回目の dispatch でセッションを作る
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let session_id = body["session_id"].as_str().unwrap().to_string();

    // 2回目は同じセッションを再利用（match=any）してテキストを直接送る
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj", "text": "echo direct-reuse-text"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
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

/// Rust 再起動直後を模した状況（レジストリには無いが tmux には実在するセッション）
/// を明示的な `session_id` で dispatch すると、指定したそのセッションが解決される
/// こと（Codex レビュー指摘: 以前は registry-only の `get` が None を返し、
/// 明示的な選択が無視されて別セッションの再利用や新規セッション作成に
/// フォールバックしていた）。
#[tokio::test]
async fn explicit_session_id_hydrates_unregistered_but_live_tmux_session() {
    if common::skip_if_no_tmux() {
        return;
    }
    let front = spawn_front().await;
    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"workspace": "proj"}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let session_id = body["session_id"].as_str().unwrap().to_string();

    // レジストリから外して「Rust 再起動直後、tmux だけは生きている」状態を再現する。
    front.state.terminal_registry.remove(&session_id).await;
    assert!(front
        .state
        .terminal_registry
        .get(&session_id)
        .await
        .is_none());

    let resp = common::client()
        .post(format!("http://{}/dispatch", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({
            "workspace": "proj",
            "session_id": session_id,
            "text": "echo cold-session-reuse",
        }))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let dispatch_id = body["id"].as_str().unwrap().to_string();
    let resp = common::client()
        .post(format!(
            "http://{}/dispatch/{dispatch_id}/decision",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .json(&json!({"executed": true}))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["created"], false);
    assert_eq!(
        body["session_id"], session_id,
        "指定した既存セッションがそのまま再利用されるはず（別セッション作成は不可）"
    );

    let full_name = format!("{}{session_id}", front.state.paths.tmux_prefix);
    let found = wait_for(|| {
        let out = std::process::Command::new("tmux")
            .args(["capture-pane", "-t", &full_name, "-p"])
            .output();
        out.map(|o| String::from_utf8_lossy(&o.stdout).contains("cold-session-reuse"))
            .unwrap_or(false)
    })
    .await;
    assert!(found, "text should reach the explicitly selected session");

    any_console_server::subprocess::kill_tmux_by_name(&full_name).await;
}

/// status stream 購読者への配信は、新規接続時に `broadcast_current_queue` で
/// 現在の全量スナップショットを再送する設計のため（`dispatch.rs` 参照）、
/// 個々のミューテーションごとの broadcast に加えて追加の定期再送は不要。
#[tokio::test]
async fn queue_snapshot_is_resent_on_new_subscription() {
    let front = spawn_front().await;
    front
        .state
        .dispatch
        .pending
        .lock()
        .await
        .insert("d1".to_string(), json!({"workspace": "proj"}));

    let mut rx = front.state.status_stream.tx.subscribe();
    dispatch::broadcast_current_queue(&front.state).await;
    let broadcast = recv_broadcast_matching(&mut rx, |m| m["type"] == "dispatch_queue").await;
    assert_eq!(broadcast["items"][0]["id"], "d1");
}
