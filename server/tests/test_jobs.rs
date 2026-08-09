//! Rust ネイティブ移行済み jobs / recent-jobs ルートの統合テスト。

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::config::ConfigStore;
use any_console_server::json_store::save_json_file;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;

struct TestFront {
    addr: SocketAddr,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "jobs-test-token";

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();

    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    let store = ConfigStore::new(dir.path().join("config.json"));
    let mut cfg = store.load_all();
    cfg.insert(
        "ws_proj".to_string(),
        json!({"name": "proj", "path": ws_path.to_string_lossy()}),
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
        git_locks: any_console_server::git_lock::WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: any_console_server::terminal_session::TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            dir.path().join("agent_manifests"),
            dir.path(),
        ),
        proxy: Proxy::new("http://127.0.0.1:1".to_string()),
        static_ctx: None,
        auth: Auth::load(data_dir, false),
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
    TestFront { addr, _dir: dir }
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

async fn send_json(
    front: &TestFront,
    method: reqwest::Method,
    path: &str,
    body: &Value,
) -> reqwest::Response {
    client()
        .request(method, format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .json(body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn workspace_job_crud_cycle() {
    let front = spawn_front().await;
    assert_eq!(get_json(&front, "/workspaces/proj/jobs").await, json!({}));

    // 作成
    let resp = send_json(
        &front,
        reqwest::Method::POST,
        "/workspaces/proj/jobs",
        &json!({"label": "Test", "command": "  npm test  ", "confirm": false}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let created: Value = resp.json().await.unwrap();
    let job_name = created["name"].as_str().unwrap().to_string();
    assert!(job_name.starts_with("job_"));

    let jobs = get_json(&front, "/workspaces/proj/jobs").await;
    assert_eq!(jobs[&job_name]["label"], "Test");
    assert_eq!(jobs[&job_name]["command"], "npm test");
    assert_eq!(jobs[&job_name]["confirm"], false);
    assert_eq!(jobs[&job_name]["common"], false);

    // 更新（存在しないジョブは 404）
    let resp = send_json(
        &front,
        reqwest::Method::PUT,
        "/workspaces/proj/jobs/no-such-job",
        &json!({"label": "X", "command": "y"}),
    )
    .await;
    assert_eq!(resp.status(), 404);
    let resp = send_json(
        &front,
        reqwest::Method::PUT,
        &format!("/workspaces/proj/jobs/{job_name}"),
        &json!({"label": "Renamed", "command": "cargo test"}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let jobs = get_json(&front, "/workspaces/proj/jobs").await;
    assert_eq!(jobs[&job_name]["label"], "Renamed");

    // バリデーション: 空 label / 空 command / browser で URL 無し
    for body in [
        json!({"label": " ", "command": "x"}),
        json!({"label": "L", "command": " "}),
        json!({"label": "L", "type": "browser", "url": ""}),
    ] {
        let resp = send_json(
            &front,
            reqwest::Method::POST,
            "/workspaces/proj/jobs",
            &body,
        )
        .await;
        assert_eq!(resp.status(), 400, "{body}");
    }

    // 削除
    let resp = client()
        .delete(format!(
            "http://{}/workspaces/proj/jobs/{job_name}",
            front.addr
        ))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(get_json(&front, "/workspaces/proj/jobs").await, json!({}));
}

#[tokio::test]
async fn common_jobs_merge_and_reorder() {
    let front = spawn_front().await;
    // 共通ジョブ2つ作成
    let mut names = Vec::new();
    for label in ["Build", "Deploy"] {
        let resp = send_json(
            &front,
            reqwest::Method::POST,
            "/common/jobs",
            &json!({"label": label, "command": label.to_lowercase()}),
        )
        .await;
        assert_eq!(resp.status(), 200);
        let v: Value = resp.json().await.unwrap();
        names.push(v["name"].as_str().unwrap().to_string());
    }
    let common = get_json(&front, "/common/jobs").await;
    assert_eq!(common[&names[0]]["label"], "Build");
    assert!(
        common[&names[0]].get("common").is_none(),
        "共通一覧に common フラグは無い"
    );

    // ワークスペース一覧では common: true でマージされる
    let ws_jobs = get_json(&front, "/workspaces/proj/jobs").await;
    assert_eq!(ws_jobs[&names[0]]["common"], true);

    // /jobs/workspaces にも反映される
    let all = get_json(&front, "/jobs/workspaces").await;
    assert_eq!(all["proj"][&names[1]]["label"], "Deploy");

    // 並び替え（不一致は 400）
    let resp = send_json(
        &front,
        reqwest::Method::PUT,
        "/common/job-order",
        &json!({"order": [names[1], names[0]]}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let common = get_json(&front, "/common/jobs").await;
    let keys: Vec<&str> = common
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys, vec![names[1].as_str(), names[0].as_str()]);
    let resp = send_json(
        &front,
        reqwest::Method::PUT,
        "/common/job-order",
        &json!({"order": [names[0]]}),
    )
    .await;
    assert_eq!(resp.status(), 400);
}

/// 並行ジョブ作成が全件残ること（lost update しないこと）を検証する回帰テスト
/// （Codex レビュー指摘: load→mutate→save が分離していると後勝ちの書き込みが
/// 先勝ちの新規ジョブを消してしまう）。共通ジョブ・ワークスペースジョブの
/// 両方で確認する。
#[tokio::test]
async fn concurrent_job_creation_does_not_lose_updates() {
    let front = spawn_front().await;
    let addr = front.addr;

    let mut handles = Vec::new();
    for i in 0..8 {
        handles.push(tokio::spawn(async move {
            client()
                .post(format!("http://{addr}/common/jobs"))
                .bearer_auth(TOKEN)
                .json(&json!({"label": format!("common-{i}"), "command": "echo hi"}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), 200);
    }
    let common = get_json(&front, "/common/jobs").await;
    assert_eq!(
        common.as_object().unwrap().len(),
        8,
        "common jobs: {common:?}"
    );

    let mut handles = Vec::new();
    for i in 0..8 {
        handles.push(tokio::spawn(async move {
            client()
                .post(format!("http://{addr}/workspaces/proj/jobs"))
                .bearer_auth(TOKEN)
                .json(&json!({"label": format!("ws-{i}"), "command": "echo hi"}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), 200);
    }
    let ws_jobs = get_json(&front, "/workspaces/proj/jobs").await;
    // ws_jobs は共通ジョブとマージされているので 8 (workspace) + 8 (common) = 16
    assert_eq!(
        ws_jobs.as_object().unwrap().len(),
        16,
        "ws jobs: {ws_jobs:?}"
    );
}

#[tokio::test]
async fn recent_jobs_roundtrip_and_prune() {
    let front = spawn_front().await;
    // ジョブを1つ作る
    let resp = send_json(
        &front,
        reqwest::Method::POST,
        "/workspaces/proj/jobs",
        &json!({"label": "Test", "command": "npm test"}),
    )
    .await;
    let created: Value = resp.json().await.unwrap();
    let job_name = created["name"].as_str().unwrap().to_string();

    // recent-jobs に「実在するジョブ」と「消えたジョブ」を保存
    let resp = send_json(
        &front,
        reqwest::Method::PUT,
        "/recent-jobs",
        &json!({"recent_jobs": [
            {"key": "k1", "workspace": "proj", "jobName": job_name, "pinned": true},
            {"key": "k2", "workspace": "proj", "jobName": "job_deleted"},
            {"key": "k3"},
        ]}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["recent_jobs"].as_array().unwrap().len(), 3);
    // Python model_dump と同じく全フィールドを返す
    assert_eq!(body["recent_jobs"][0]["jobType"], "command");
    assert_eq!(body["recent_jobs"][0]["pinned"], true);

    // GET で参照先が消えたスナップショット（k2）だけ除去される
    let got = get_json(&front, "/recent-jobs").await;
    let keys: Vec<&str> = got["recent_jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["key"].as_str().unwrap())
        .collect();
    assert_eq!(keys, vec!["k1", "k3"], "k2 は job が存在しないため除去");
}
