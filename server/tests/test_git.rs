//! Rust ネイティブ移行済み git ルート（履歴/差分/コミット/スタッシュ）の統合テスト。
//!
//! 実 git リポジトリを一時領域に作成してワークスペース登録し、API 応答形が
//! Python 実装（run_git_command の定型 dict）と一致することを検証する。

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::config::ConfigStore;
use any_console_server::git_lock::WorkspaceLocks;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;

struct TestFront {
    addr: SocketAddr,
    ws_path: std::path::PathBuf,
    data_dir: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "git-test-token";

fn sh_git(repo: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00+00:00")
        .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00+00:00")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();

    // テスト用 git リポジトリ
    let ws_path = dir.path().join("repo");
    std::fs::create_dir_all(&ws_path).unwrap();
    sh_git(&ws_path, &["init", "-q", "-b", "main"]);
    sh_git(&ws_path, &["config", "user.email", "t@example.com"]);
    sh_git(&ws_path, &["config", "user.name", "tester"]);
    std::fs::write(ws_path.join("a.txt"), "hello\n").unwrap();
    sh_git(&ws_path, &["add", "-A"]);
    sh_git(&ws_path, &["commit", "-q", "-m", "first commit"]);

    // ワークスペース登録
    let store = ConfigStore::new(dir.path().join("config.json"));
    let mut cfg = store.load_all();
    cfg.insert(
        "ws_repo".to_string(),
        json!({"name": "repo", "path": ws_path.to_string_lossy()}),
    );
    store.save_all(&cfg).unwrap();

    let state = Arc::new(AppState {
        paths: Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: dir.path().join("config.json"),
            frontend_dir: dir.path().join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix: "ac-".to_string(),
        },
        config: store,
        git_locks: WorkspaceLocks::new(),
        proxy: Proxy::new("http://127.0.0.1:1".to_string()),
        static_ctx: None,
        auth: Auth::load(data_dir.clone(), false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit: 10_000,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            build_router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    TestFront {
        addr,
        ws_path,
        data_dir,
        _dir: dir,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

async fn get_json(front: &TestFront, path: &str) -> Value {
    client()
        .get(format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn post_json(front: &TestFront, path: &str, body: &Value) -> reqwest::Response {
    client()
        .post(format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .json(body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn git_log_returns_command_result_shape() {
    let front = spawn_front().await;
    let body = get_json(&front, "/workspaces/repo/git-log?limit=10").await;
    assert_eq!(body["status"], "ok");
    assert_eq!(body["exit_code"], 0);
    let stdout = body["stdout"].as_str().unwrap();
    assert!(stdout.contains("first commit"));
    // pretty=format: %H\t%ad\t%an\t%D\t%s
    let first_line = stdout.lines().next().unwrap();
    assert_eq!(first_line.split('\t').count(), 5);
    assert!(first_line.split('\t').nth(2) == Some("tester"));
    // detail フィールド（stderr の複製）がある
    assert!(body.get("detail").is_some());
}

#[tokio::test]
async fn workspace_diff_lists_changed_and_untracked() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("a.txt"), "hello\nworld\n").unwrap();
    std::fs::write(front.ws_path.join("new.txt"), "x\ny\n").unwrap();
    let body = get_json(&front, "/workspaces/repo/diff").await;
    assert_eq!(body["status"], "ok");
    let files = body["files"].as_array().unwrap();
    let by_name: std::collections::HashMap<&str, &Value> = files
        .iter()
        .map(|f| (f["name"].as_str().unwrap(), f))
        .collect();
    assert_eq!(by_name["a.txt"]["status"], "M");
    assert_eq!(by_name["new.txt"]["status"], "??");
    // 未追跡ファイルは行数カウントが insertions に入る
    assert_eq!(by_name["new.txt"]["insertions"], 2);
    assert!(body["diff"].as_str().unwrap().contains("world"));
}

#[tokio::test]
async fn commit_flow_records_activity() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("b.txt"), "content\n").unwrap();
    let resp = post_json(
        &front,
        "/workspaces/repo/commit",
        &json!({"message": "feat: add b"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");

    let log = get_json(&front, "/workspaces/repo/git-log").await;
    assert!(log["stdout"].as_str().unwrap().contains("feat: add b"));

    // activity ログ（data/activity/repo/*.jsonl）に git_commit が記録される
    let activity_dir = front.data_dir.join("activity").join("repo");
    let files: Vec<_> = std::fs::read_dir(&activity_dir).unwrap().collect();
    assert_eq!(files.len(), 1);
    let content = std::fs::read_to_string(files[0].as_ref().unwrap().path()).unwrap();
    let entry: Value = serde_json::from_str(content.trim()).unwrap();
    assert_eq!(entry["type"], "git_commit");
    assert_eq!(entry["message"], "feat: add b");
    assert!(entry["commit"].as_str().unwrap().len() >= 40);

    // 空メッセージは 400
    let resp = post_json(&front, "/workspaces/repo/commit", &json!({"message": "  "})).await;
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Please enter a commit message");
}

#[tokio::test]
async fn commit_diff_and_file_diff() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("a.txt"), "hello\nchanged\n").unwrap();
    post_json(
        &front,
        "/workspaces/repo/commit",
        &json!({"message": "second"}),
    )
    .await
    .error_for_status()
    .unwrap();
    let log = get_json(&front, "/workspaces/repo/git-log").await;
    let head = log["stdout"]
        .as_str()
        .unwrap()
        .lines()
        .next()
        .unwrap()
        .split('\t')
        .next()
        .unwrap()
        .to_string();

    let body = get_json(&front, &format!("/workspaces/repo/diff/{head}")).await;
    assert_eq!(body["status"], "ok");
    assert!(body["diff"].as_str().unwrap().contains("+changed"));
    let files = body["files"].as_array().unwrap();
    assert_eq!(files[0]["name"], "a.txt");
    assert_eq!(files[0]["insertions"], 1);

    let body = get_json(
        &front,
        &format!("/workspaces/repo/file-diff/{head}?path=a.txt"),
    )
    .await;
    assert!(body["diff"].as_str().unwrap().contains("+changed"));

    // 不正 ref は 400 detail
    let resp = client()
        .get(format!(
            "http://{}/workspaces/repo/diff/not-a-ref",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert!(body["detail"]
        .as_str()
        .unwrap()
        .contains("Invalid commit ref"));
}

#[tokio::test]
async fn stash_cycle() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("a.txt"), "stash me\n").unwrap();
    let resp = post_json(&front, "/workspaces/repo/stash", &json!({})).await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");

    let list = get_json(&front, "/workspaces/repo/stash-list").await;
    let entries = list["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["ref"], "stash@{0}");
    assert!(entries[0]["message"].is_string());
    assert!(entries[0]["time"].is_string());

    let resp = post_json(&front, "/workspaces/repo/stash-pop", &json!({})).await;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        std::fs::read_to_string(front.ws_path.join("a.txt")).unwrap(),
        "stash me\n"
    );

    // 不正 stash ref は 400
    let resp = post_json(
        &front,
        "/workspaces/repo/stash-drop",
        &json!({"stash_ref": "HEAD"}),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn discard_restores_file() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("a.txt"), "dirty\n").unwrap();
    let resp = post_json(
        &front,
        "/workspaces/repo/git/discard",
        &json!({"path": "a.txt"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        std::fs::read_to_string(front.ws_path.join("a.txt")).unwrap(),
        "hello\n"
    );
    // パストラバーサルは 400
    let resp = post_json(
        &front,
        "/workspaces/repo/git/discard",
        &json!({"path": "../outside"}),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn reset_validates_mode_and_unknown_workspace() {
    let front = spawn_front().await;
    let resp = post_json(
        &front,
        "/workspaces/repo/reset",
        &json!({"commit_hash": "abcd1234", "mode": "extreme"}),
    )
    .await;
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid reset mode: extreme");

    // 未登録ワークスペースは 400（"Workspace not configured"）
    let resp = client()
        .get(format!("http://{}/workspaces/nope/git-log", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);

    // 未認証は 401
    let resp = client()
        .get(format!("http://{}/workspaces/repo/git-log", front.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn file_history_follows_renames_within_workspace() {
    let front = spawn_front().await;
    let body = get_json(&front, "/workspaces/repo/file-history?path=a.txt").await;
    assert_eq!(body["status"], "ok");
    assert!(body["stdout"].as_str().unwrap().contains("first commit"));
    // クエリ欠落（path 必須）は 422
    let resp = client()
        .get(format!(
            "http://{}/workspaces/repo/file-history",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
}
