//! ワークスペースルート（一覧/ステータス/登録/設定/削除/候補）の統合テスト。
//!
//! 実 git リポジトリを一時領域に作成し、Python 実装（api/routers/workspaces.py）と
//! 同じ応答形・エラー形（`detail`）であることを検証する。

mod common;

use std::net::SocketAddr;

use serde_json::{json, Value};

use any_console_server::build_router;
use any_console_server::config::ConfigStore;
use any_console_server::json_store::save_json_file;

struct TestFront {
    addr: SocketAddr,
    ws_path: std::path::PathBuf,
    config_file: std::path::PathBuf,
    dir: tempfile::TempDir,
}

const TOKEN: &str = "ws-test-token";

fn sh_git(repo: &std::path::Path, args: &[&str]) {
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

fn make_repo(path: &std::path::Path) {
    std::fs::create_dir_all(path).unwrap();
    sh_git(path, &["init", "-q", "-b", "main"]);
    sh_git(path, &["config", "user.email", "t@example.com"]);
    sh_git(path, &["config", "user.name", "tester"]);
    std::fs::write(path.join("a.txt"), "hello\n").unwrap();
    sh_git(path, &["add", "-A"]);
    sh_git(path, &["commit", "-q", "-m", "first commit"]);
}

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();

    let ws_path = dir.path().join("repo");
    make_repo(&ws_path);

    let config_file = dir.path().join("config.json");
    let store = ConfigStore::new(config_file.clone());
    let mut cfg = store.load_all();
    cfg.insert(
        "ws_repo".to_string(),
        json!({"name": "repo", "path": ws_path.to_string_lossy()}),
    );
    store.save_all(&cfg).unwrap();

    let state = common::test_app_state(
        dir.path(),
        common::StateOptions {
            config: Some(store),
            ..Default::default()
        },
    );
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
        config_file,
        dir,
    }
}

async fn get_json(front: &TestFront, path: &str) -> Value {
    common::client()
        .get(format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

async fn send_json(
    front: &TestFront,
    method: reqwest::Method,
    path: &str,
    body: &Value,
) -> reqwest::Response {
    common::client()
        .request(method, format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .json(body)
        .send()
        .await
        .unwrap()
}

fn load_config(front: &TestFront) -> Value {
    serde_json::from_str(&std::fs::read_to_string(&front.config_file).unwrap()).unwrap()
}

#[tokio::test]
async fn list_workspaces_returns_summary() {
    let front = spawn_front().await;
    let body = get_json(&front, "/workspaces").await;
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    let ws = &items[0];
    assert_eq!(ws["id"], "ws_repo");
    assert_eq!(ws["name"], "repo");
    assert_eq!(ws["path"].as_str(), front.ws_path.to_str());
    assert_eq!(ws["is_git_repo"], true);
    assert_eq!(ws["branch"], "main");
    assert_eq!(ws["exists"], true);
    assert_eq!(ws["icon"], "");
    assert_eq!(ws["icon_color"], "");
    assert_eq!(ws["group_id"], Value::Null);
    // remote 未設定なので github_url / default_branch は含まれない
    assert!(ws.get("github_url").is_none());
    assert!(ws.get("default_branch").is_none());
}

#[tokio::test]
async fn list_workspaces_includes_dynamic_worktrees_and_respects_order() {
    let front = spawn_front().await;
    // 2 つ目のワークスペースと linked worktree を作る
    let ws2 = front.dir.path().join("second");
    make_repo(&ws2);
    let wt_path = front.dir.path().join("wt-feat");
    sh_git(
        &front.ws_path,
        &["worktree", "add", wt_path.to_str().unwrap(), "-b", "feat/x"],
    );
    let store = ConfigStore::new(front.config_file.clone());
    let mut cfg = store.load_all();
    cfg.insert(
        "ws_second".to_string(),
        json!({"name": "second", "path": ws2.to_string_lossy()}),
    );
    let mut global = cfg
        .get("__global__")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    global.insert(
        "workspace_order".to_string(),
        json!(["ws_second", "ws_repo"]),
    );
    cfg.insert("__global__".to_string(), Value::Object(global));
    store.save_all(&cfg).unwrap();

    let body = get_json(&front, "/workspaces").await;
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 3);
    // workspace_order の順（second が先）→ 動的 worktree は末尾
    assert_eq!(items[0]["id"], "ws_second");
    assert_eq!(items[1]["id"], "ws_repo");
    let wt = &items[2];
    assert_eq!(wt["id"], Value::Null);
    assert_eq!(wt["name"], "repo:feat/x");
    assert_eq!(wt["worktree"], true);
    assert_eq!(wt["worktree_base"], "repo");
    assert_eq!(wt["worktree_branch"], "feat/x");
}

#[tokio::test]
async fn workspace_statuses_shape() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("a.txt"), "hello\nchanged\n").unwrap();
    let body = get_json(&front, "/workspaces/statuses").await;
    let statuses = body["statuses"].as_array().unwrap();
    assert_eq!(statuses.len(), 1);
    let st = &statuses[0];
    assert_eq!(st["name"], "repo");
    assert_eq!(st["is_git_repo"], true);
    assert_eq!(st["branch"], "main");
    assert_eq!(st["clean"], false);
    assert_eq!(st["changed_files"], 1);
    assert_eq!(st["last_commit_message"], "first commit");
    // remote 未設定 → 未公開コミット数（rev-list --not --remotes=origin）が ahead
    assert_eq!(st["ahead"], 1);
    assert_eq!(st["behind"], 0);
}

#[tokio::test]
async fn add_update_delete_workspace_roundtrip() {
    let front = spawn_front().await;
    let new_dir = front.dir.path().join("newproj");
    std::fs::create_dir_all(&new_dir).unwrap();

    // 登録
    let res = send_json(
        &front,
        reqwest::Method::POST,
        "/workspaces",
        &json!({"path": new_dir.to_string_lossy()}),
    )
    .await;
    assert_eq!(res.status(), 200);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["name"], "newproj");
    let new_id = body["id"].as_str().unwrap().to_string();
    assert!(new_id.starts_with("ws_"));

    // 名前重複は 409
    let res = send_json(
        &front,
        reqwest::Method::POST,
        "/workspaces",
        &json!({"path": new_dir.to_string_lossy()}),
    )
    .await;
    assert_eq!(res.status(), 409);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["detail"], "'newproj' is already registered");

    // 存在しないパスは 400
    let res = send_json(
        &front,
        reqwest::Method::POST,
        "/workspaces",
        &json!({"path": "/no/such/dir-xyz", "name": "other"}),
    )
    .await;
    assert_eq!(res.status(), 400);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["detail"], "Directory does not exist: /no/such/dir-xyz");

    // 設定更新（既存名への変更は 409）
    let res = send_json(
        &front,
        reqwest::Method::PUT,
        &format!("/workspaces/{new_id}/config"),
        &json!({"name": "repo"}),
    )
    .await;
    assert_eq!(res.status(), 409);

    // 設定更新（icon_color とリネーム）
    let res = send_json(
        &front,
        reqwest::Method::PUT,
        &format!("/workspaces/{new_id}/config"),
        &json!({"icon_color": " #ff0000 ", "name": "renamed", "group_id": ""}),
    )
    .await;
    assert_eq!(res.status(), 200);
    let cfg = load_config(&front);
    assert_eq!(cfg[&new_id]["name"], "renamed");
    assert_eq!(cfg[&new_id]["icon_color"], "#ff0000");
    // group_id="" は None → 正規化でキーごと落ちる
    assert!(cfg[&new_id].get("group_id").is_none());

    // 削除（表示名でも解決される）+ workspace_order からも除去
    let store = ConfigStore::new(front.config_file.clone());
    store
        .save_global_section("workspace_order", json!([new_id.clone(), "ws_repo"]))
        .unwrap();
    let res = send_json(
        &front,
        reqwest::Method::DELETE,
        "/workspaces/renamed",
        &json!({}),
    )
    .await;
    assert_eq!(res.status(), 200);
    let cfg = load_config(&front);
    assert!(cfg.get(&new_id).is_none());
    assert_eq!(cfg["__global__"]["workspace_order"], json!(["ws_repo"]));

    // 未登録の削除は 400
    let res = send_json(
        &front,
        reqwest::Method::DELETE,
        "/workspaces/renamed",
        &json!({}),
    )
    .await;
    assert_eq!(res.status(), 400);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["detail"], "Workspace 'renamed' not found");
}

#[tokio::test]
async fn update_workspace_path_validation() {
    let front = spawn_front().await;
    // 空パスは 400
    let res = send_json(
        &front,
        reqwest::Method::PUT,
        "/workspaces/repo/config",
        &json!({"path": "  "}),
    )
    .await;
    assert_eq!(res.status(), 400);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["detail"], "Path is required");

    // 存在しないディレクトリは 400
    let res = send_json(
        &front,
        reqwest::Method::PUT,
        "/workspaces/repo/config",
        &json!({"path": "/no/such/dir-abc"}),
    )
    .await;
    assert_eq!(res.status(), 400);

    // 有効なパスへ変更できる
    let moved = front.dir.path().join("moved");
    std::fs::create_dir_all(&moved).unwrap();
    let res = send_json(
        &front,
        reqwest::Method::PUT,
        "/workspaces/repo/config",
        &json!({"path": moved.to_string_lossy()}),
    )
    .await;
    assert_eq!(res.status(), 200);
    let cfg = load_config(&front);
    let canon = moved.canonicalize().unwrap();
    assert_eq!(cfg["ws_repo"]["path"].as_str(), canon.to_str());
}

#[tokio::test]
async fn suggest_lists_directories_with_filters() {
    let front = spawn_front().await;
    let base = front.dir.path().join("scan");
    std::fs::create_dir_all(base.join("alpha")).unwrap();
    std::fs::create_dir_all(base.join("beta")).unwrap();
    std::fs::create_dir_all(base.join(".hidden")).unwrap();
    std::fs::write(base.join("file.txt"), "x").unwrap();
    make_repo(&base.join("gitproj"));

    let body = get_json(
        &front,
        &format!("/workspaces/suggest?path={}", base.to_string_lossy()),
    )
    .await;
    let entries = body["entries"].as_array().unwrap();
    let names: Vec<&str> = entries
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    // 小文字ソート順・ドットディレクトリとファイルは除外
    assert_eq!(names, vec!["alpha", "beta", "gitproj"]);
    let git_entry = entries.iter().find(|e| e["name"] == "gitproj").unwrap();
    assert_eq!(git_entry["is_git"], true);
    assert_eq!(git_entry["registered"], false);

    // 前方一致フィルタ（大文字小文字を無視）
    let body = get_json(
        &front,
        &format!("/workspaces/suggest?path={}/AL", base.to_string_lossy()),
    )
    .await;
    let entries = body["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["name"], "alpha");

    // 存在しないベースは空
    let body = get_json(&front, "/workspaces/suggest?path=/no/such/base-xyz/").await;
    assert_eq!(body["entries"], json!([]));
}

/// ワークスペース設定更新（アイコン等）とジョブ作成が同じワークスペースへ並行して
/// 起きても、どちらも失われないこと（lost update しないこと）を検証する回帰
/// テスト（Codex レビュー指摘: config 更新はアイコン正規化の await を挟むため、
/// その間に別リクエストが加えた変更を古いスナップショットで上書きしうる）。
#[tokio::test]
async fn concurrent_config_update_and_job_creation_does_not_lose_updates() {
    let front = spawn_front().await;
    let addr = front.addr;

    let mut handles = Vec::new();
    for i in 0..6 {
        handles.push(tokio::spawn(async move {
            common::client()
                .put(format!("http://{addr}/workspaces/repo/config"))
                .bearer_auth(TOKEN)
                .json(&json!({"icon": format!("mdi-icon-{i}"), "icon_color": "#111111"}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for i in 0..6 {
        handles.push(tokio::spawn(async move {
            common::client()
                .post(format!("http://{addr}/workspaces/repo/jobs"))
                .bearer_auth(TOKEN)
                .json(&json!({"label": format!("job-{i}"), "command": "echo hi"}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), 200);
    }

    // アイコン更新は何かしらの値で残っている（最後に勝った1件）。
    let cfg = load_config(&front);
    let icon = cfg["ws_repo"]["icon"].as_str().unwrap();
    assert!(icon.starts_with("mdi-icon-"), "icon: {icon}");

    // ジョブは全 6 件残っている（lost update していない）。
    let jobs = get_json(&front, "/workspaces/repo/jobs").await;
    assert_eq!(jobs.as_object().unwrap().len(), 6, "jobs: {jobs:?}");
}

#[tokio::test]
async fn workspaces_routes_require_auth() {
    let front = spawn_front().await;
    for (method, path) in [
        (reqwest::Method::GET, "/workspaces"),
        (reqwest::Method::GET, "/workspaces/statuses"),
        (reqwest::Method::GET, "/workspaces/suggest"),
        (reqwest::Method::DELETE, "/workspaces/repo"),
    ] {
        let res = common::client()
            .request(method.clone(), format!("http://{}{path}", front.addr))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 401, "{method} {path}");
        let body: Value = res.json().await.unwrap();
        assert_eq!(body["detail"], "Invalid token");
    }
}
