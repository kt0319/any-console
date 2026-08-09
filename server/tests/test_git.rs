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
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        git_watch: any_console_server::git_watch::GitWatchState::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: any_console_server::terminal_session::TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        agent_watch: any_console_server::agent_watch::AgentWatchState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            dir.path().join("agent_manifests"),
            dir.path(),
        ),
        preview: any_console_server::preview::PreviewState::new(),
        pairing: any_console_server::pairing::PairingState::new(),
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

    // 不正な JSON ボディは 422 で拒否し、git stash を実行しない（Codex レビュー
    // 指摘: 以前は parse エラーを黙って include_untracked=false 扱いにして
    // ミューテーションを実行してしまっていた）。
    let resp = client()
        .post(format!("http://{}/workspaces/repo/stash", front.addr))
        .bearer_auth(TOKEN)
        .header("content-type", "application/json")
        .body("{not valid json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
    assert_eq!(
        std::fs::read_to_string(front.ws_path.join("a.txt")).unwrap(),
        "stash me\n",
        "不正ボディでは stash が実行されない"
    );

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

// ─── Phase 2 後半: ブランチ / ファイル / worktree ────────────────────────────

#[tokio::test]
async fn branch_lifecycle_and_listing() {
    let front = spawn_front().await;
    // 作成 → 一覧に current として現れる
    let resp = post_json(
        &front,
        "/workspaces/repo/create-branch",
        &json!({"branch": "feat/x"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");

    let branches = get_json(&front, "/workspaces/repo/branches").await;
    let arr = branches.as_array().unwrap();
    let feat = arr.iter().find(|b| b["name"] == "feat/x").unwrap();
    assert_eq!(feat["current"], true);
    assert_eq!(feat["upstream"], Value::Null);
    // upstream 未設定ブランチの ahead は未 push 件数（origin 不在なので全コミット数）
    assert!(feat["ahead"].as_i64().unwrap() >= 1);

    // main へ戻って削除
    post_json(
        &front,
        "/workspaces/repo/checkout",
        &json!({"branch": "main"}),
    )
    .await
    .error_for_status()
    .unwrap();
    let resp = post_json(
        &front,
        "/workspaces/repo/delete-branch",
        &json!({"branch": "feat/x"}),
    )
    .await;
    assert_eq!(resp.status(), 200);

    // current の削除は 400
    let resp = post_json(
        &front,
        "/workspaces/repo/delete-branch",
        &json!({"branch": "main"}),
    )
    .await;
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Cannot delete the current branch");
}

#[tokio::test]
async fn files_listing_and_content() {
    let front = spawn_front().await;
    std::fs::create_dir(front.ws_path.join("sub")).unwrap();
    std::fs::write(front.ws_path.join("sub/inner.txt"), "inner\n").unwrap();
    std::fs::write(front.ws_path.join("logo.png"), b"\x89PNG fake").unwrap();

    let body = get_json(&front, "/workspaces/repo/files").await;
    assert_eq!(body["status"], "ok");
    let entries = body["entries"].as_array().unwrap();
    // dir が先・name 昇順
    assert_eq!(entries[0]["name"], "sub");
    assert_eq!(entries[0]["type"], "dir");
    assert_eq!(entries[0]["count"], 1);
    let names: Vec<&str> = entries
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"a.txt") && names.contains(&"logo.png"));
    assert!(!names.contains(&".git"));

    let content = get_json(&front, "/workspaces/repo/file-content?path=a.txt").await;
    assert_eq!(content["content"], "hello\n");
    let img = get_json(&front, "/workspaces/repo/file-content?path=logo.png").await;
    assert_eq!(img["image"], true);
    assert!(img["data_url"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));

    // HEAD ref 指定の閲覧（コミット済み内容のみ見える）
    let head = {
        let log = get_json(&front, "/workspaces/repo/git-log").await;
        log["stdout"]
            .as_str()
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .split('\t')
            .next()
            .unwrap()
            .to_string()
    };
    let body = get_json(&front, &format!("/workspaces/repo/files?ref={head}")).await;
    let names: Vec<&str> = body["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"a.txt"));
    assert!(
        !names.contains(&"sub"),
        "未コミットのディレクトリは ref 閲覧に出ない"
    );
    let content = get_json(
        &front,
        &format!("/workspaces/repo/file-content?path=a.txt&ref={head}"),
    )
    .await;
    assert_eq!(content["content"], "hello\n");
}

#[tokio::test]
async fn upload_rename_delete_download_cycle() {
    let front = spawn_front().await;
    // upload（multipart）
    let form = reqwest::multipart::Form::new()
        .text("path", "")
        .text("overwrite", "false")
        .part(
            "file",
            reqwest::multipart::Part::bytes(b"uploaded".to_vec()).file_name("up.txt"),
        );
    let resp = client()
        .post(format!("http://{}/workspaces/repo/upload", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["path"], "up.txt");
    assert_eq!(body["size"], 8);

    // 同名は overwrite 無しで 409
    let form = reqwest::multipart::Form::new().text("path", "").part(
        "file",
        reqwest::multipart::Part::bytes(b"x".to_vec()).file_name("up.txt"),
    );
    let resp = client()
        .post(format!("http://{}/workspaces/repo/upload", front.addr))
        .bearer_auth(TOKEN)
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 409);

    // rename
    let resp = post_json(
        &front,
        "/workspaces/repo/rename",
        &json!({"src": "up.txt", "dest": "renamed.txt"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    assert!(front.ws_path.join("renamed.txt").is_file());

    // download（単一ファイル）
    let resp = client()
        .get(format!(
            "http://{}/workspaces/repo/download?path=renamed.txt",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .contains("renamed.txt"));
    assert_eq!(resp.bytes().await.unwrap().as_ref(), b"uploaded");

    // download（ディレクトリ → zip、.git は除外される）
    let resp = client()
        .get(format!(
            "http://{}/workspaces/repo/download?path=",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.headers()["content-type"], "application/zip");
    let zip_bytes = resp.bytes().await.unwrap();
    assert!(zip_bytes.len() > 4);
    assert_eq!(&zip_bytes[..2], b"PK");

    // delete
    let resp = post_json(
        &front,
        "/workspaces/repo/delete-file",
        &json!({"path": "renamed.txt"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    assert!(!front.ws_path.join("renamed.txt").exists());
    let resp = post_json(
        &front,
        "/workspaces/repo/delete-file",
        &json!({"path": "renamed.txt"}),
    )
    .await;
    assert_eq!(resp.status(), 404);
}

/// 非 ASCII ファイル名のダウンロードが 500 にならず、RFC 5987 の
/// `filename*=utf-8''<percent-encoded>` で Content-Disposition が組み立てられる
/// こと（Codex レビュー指摘: 以前は生の UTF-8 バイト列をヘッダ値へ直接埋め込んで
/// おり、`http` クレートの HeaderValue バリデーションに落ちてレスポンス構築自体が
/// 失敗し 500 になっていた）。
#[tokio::test]
async fn download_with_non_ascii_filename_succeeds_with_rfc5987_header() {
    let front = spawn_front().await;
    std::fs::write(front.ws_path.join("日本語.txt"), b"content").unwrap();

    let resp = client()
        .get(format!(
            "http://{}/workspaces/repo/download?path=%E6%97%A5%E6%9C%AC%E8%AA%9E.txt",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let disposition = resp.headers()["content-disposition"].to_str().unwrap();
    assert_eq!(
        disposition,
        "attachment; filename*=utf-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt"
    );
    assert_eq!(resp.bytes().await.unwrap().as_ref(), b"content");
}

#[tokio::test]
async fn worktree_create_list_delete() {
    let front = spawn_front().await;
    let resp = post_json(
        &front,
        "/workspaces/repo/worktrees",
        &json!({"branch": "wt-branch"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["workspace"]["name"], "repo [wt-branch]");
    let wt_path = body["workspace"]["path"].as_str().unwrap().to_string();
    assert!(std::path::Path::new(&wt_path).is_dir());

    let listing = get_json(&front, "/workspaces/repo/worktrees").await;
    let items = listing["worktrees"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["is_main"], true);
    let wt = items.iter().find(|w| w["branch"] == "wt-branch").unwrap();
    assert_eq!(wt["is_main"], false);

    // 動的 worktree 名でルートが解決できる（git-log が引ける）
    let encoded = "repo%20%5Bwt-branch%5D"; // "repo [wt-branch]"
    let log = get_json(&front, &format!("/workspaces/{encoded}/git-log")).await;
    assert_eq!(log["status"], "ok");

    // メイン worktree の削除は 400
    let main_path = items[0]["path"].as_str().unwrap();
    let resp = client()
        .delete(format!("http://{}/workspaces/repo/worktrees", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"path": main_path}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);

    // worktree 削除
    let resp = client()
        .delete(format!("http://{}/workspaces/repo/worktrees", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"path": wt_path}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    // 無関係パスの削除は 404
    let resp = client()
        .delete(format!("http://{}/workspaces/repo/worktrees", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"path": "/tmp"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}
