//! Rust ネイティブ移行済み settings / groups ルートの統合テスト。
//!
//! config.json への書き込みが Python 互換フォーマット（正規化・末尾改行・
//! .bak ローテーション）で行われることも確認する。

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
    dir: tempfile::TempDir,
}

const TOKEN: &str = "settings-test-token";

async fn spawn_front() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();
    let state = Arc::new(AppState {
        paths: Paths {
            project_root: dir.path().to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: dir.path().join("config.json"),
            frontend_dir: dir.path().join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix: "ac-".to_string(),
        },
        config: ConfigStore::new(dir.path().join("config.json")),
        git_locks: any_console_server::git_lock::WorkspaceLocks::new(),
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
    TestFront { addr, dir }
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

async fn put_json(front: &TestFront, path: &str, body: &Value) -> reqwest::Response {
    client()
        .put(format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .json(body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn snippets_roundtrip_and_sanitize() {
    let front = spawn_front().await;
    let resp = put_json(
        &front,
        "/snippets",
        &json!({"snippets": [
            {"label": "", "command": "  npm test  "},
            {"label": "L", "command": ""},
        ]}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    // 空 command は除去され、空 label はコマンドのプレビューで補完される
    assert_eq!(
        body["snippets"],
        json!([{"label": "npm test", "command": "npm test"}])
    );

    let got = get_json(&front, "/snippets").await;
    assert_eq!(got["snippets"], body["snippets"]);

    // config.json が Python 互換フォーマットで書かれている
    let text = std::fs::read_to_string(front.dir.path().join("config.json")).unwrap();
    assert!(text.ends_with('\n'));
    assert!(text.contains("\"snippets\""));

    // 上限超過は 422
    let resp = put_json(
        &front,
        "/snippets",
        &json!({"snippets": [{"command": "x".repeat(10001)}]}),
    )
    .await;
    assert_eq!(resp.status(), 422);
}

#[tokio::test]
async fn editor_notifications_and_layout_roundtrip() {
    let front = spawn_front().await;
    assert_eq!(
        get_json(&front, "/settings/editor").await["url_template"],
        ""
    );
    let resp = put_json(
        &front,
        "/settings/editor",
        &json!({"url_template": " vscode://file/{path} "}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        get_json(&front, "/settings/editor").await["url_template"],
        "vscode://file/{path}"
    );

    assert_eq!(
        get_json(&front, "/settings/notifications").await["phrase_notify_grace_sec"],
        20
    );
    let resp = put_json(
        &front,
        "/settings/notifications",
        &json!({"phrase_notify_grace_sec": 601}),
    )
    .await;
    assert_eq!(resp.status(), 422);
    let resp = put_json(
        &front,
        "/settings/notifications",
        &json!({"phrase_notify_grace_sec": 0}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    assert_eq!(
        get_json(&front, "/settings/notifications").await["phrase_notify_grace_sec"],
        0
    );

    assert_eq!(
        get_json(&front, "/settings/layout").await["split"],
        Value::Null
    );
    let resp = put_json(
        &front,
        "/settings/layout",
        &json!({"session_ids": ["a", null], "layout": "grid", "active_pane_index": 1}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let split = get_json(&front, "/settings/layout").await["split"].clone();
    assert_eq!(split["layout"], "grid");
    assert_eq!(split["session_ids"], json!(["a", null]));
    let resp = put_json(&front, "/settings/layout", &json!({"layout": "diagonal"})).await;
    assert_eq!(resp.status(), 400);
    let resp = client()
        .delete(format!("http://{}/settings/layout", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(
        get_json(&front, "/settings/layout").await["split"],
        Value::Null
    );
}

#[tokio::test]
async fn info_pills_normalize_order() {
    let front = spawn_front().await;
    let got = get_json(&front, "/settings/info-pills").await;
    assert_eq!(got["branch"], true);
    assert_eq!(got["order"].as_array().unwrap().len(), 9);

    let resp = put_json(
        &front,
        "/settings/info-pills",
        &json!({"branch": false, "order": ["dispatch", "unknown", "dispatch", "branch"]}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let got = get_json(&front, "/settings/info-pills").await;
    assert_eq!(got["branch"], false);
    let order = got["order"].as_array().unwrap();
    assert_eq!(order[0], "dispatch");
    assert_eq!(order[1], "branch");
    assert_eq!(order.len(), 9, "未知キー除去・欠けキー補完");
}

#[tokio::test]
async fn circle_keypad_validates_counts() {
    let front = spawn_front().await;
    let got = get_json(&front, "/settings/circle-keypad").await;
    assert_eq!(got, json!({"keys": [], "specials": [], "enabled": true}));

    let resp = put_json(
        &front,
        "/settings/circle-keypad",
        &json!({"keys": [{"key": "a"}]}),
    )
    .await;
    assert_eq!(resp.status(), 400);
    let keys: Vec<Value> = (0..8).map(|i| json!({"key": format!("k{i}")})).collect();
    let resp = put_json(
        &front,
        "/settings/circle-keypad",
        &json!({"keys": keys, "specials": [], "enabled": false}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let got = get_json(&front, "/settings/circle-keypad").await;
    assert_eq!(got["enabled"], false);
    assert_eq!(got["keys"].as_array().unwrap().len(), 8);
}

#[tokio::test]
async fn groups_crud_and_workspace_unassign() {
    let front = spawn_front().await;
    // ワークスペースを直接 config に用意（group_id 付与対象）
    let store = ConfigStore::new(front.dir.path().join("config.json"));
    let mut cfg = store.load_all();
    cfg.insert("ws_x".to_string(), json!({"name": "x", "path": "/tmp"}));
    store.save_all(&cfg).unwrap();

    assert_eq!(get_json(&front, "/groups").await, json!([]));
    let resp = client()
        .post(format!("http://{}/groups", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"name": " Dev "}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let created: Value = resp.json().await.unwrap();
    let gid = created["id"].as_str().unwrap().to_string();
    assert!(gid.starts_with("ws_"));
    assert_eq!(created["name"], "Dev");

    // rename
    let resp = put_json(&front, &format!("/groups/{gid}"), &json!({"name": "Dev2"})).await;
    assert_eq!(resp.status(), 200);
    assert_eq!(get_json(&front, "/groups").await[0]["name"], "Dev2");
    let resp = put_json(&front, "/groups/ws_missing", &json!({"name": "X"})).await;
    assert_eq!(resp.status(), 404);

    // ワークスペースへ割り当ててから削除 → group_id がクリアされる
    let mut cfg = store.load_all();
    cfg.get_mut("ws_x").unwrap()["group_id"] = json!(gid.clone());
    store.save_all(&cfg).unwrap();
    let resp = client()
        .delete(format!("http://{}/groups/{gid}", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let cfg = store.load_all();
    assert!(
        !cfg["ws_x"].as_object().unwrap().contains_key("group_id"),
        "null クリア後は正規化で消える"
    );
    assert_eq!(get_json(&front, "/groups").await, json!([]));
}

#[tokio::test]
async fn group_order_sorts_and_returns_ids() {
    let front = spawn_front().await;
    let mut ids = Vec::new();
    for name in ["A", "B", "C"] {
        let resp = client()
            .post(format!("http://{}/groups", front.addr))
            .bearer_auth(TOKEN)
            .json(&json!({"name": name}))
            .send()
            .await
            .unwrap();
        let v: Value = resp.json().await.unwrap();
        ids.push(v["id"].as_str().unwrap().to_string());
    }
    let want = vec![ids[2].clone(), ids[0].clone(), ids[1].clone()];
    let resp = put_json(&front, "/group-order", &json!({"order": want})).await;
    assert_eq!(resp.status(), 200);
    let returned: Value = resp.json().await.unwrap();
    assert_eq!(returned, json!([ids[2], ids[0], ids[1]]));
}

/// 並行 create_group が全件残ること（lost update しないこと）を検証する回帰テスト。
/// load→mutate→save が分離していると、後勝ちの書き込みが先勝ちの新規グループを
/// 消してしまう（Codex レビュー指摘）。
#[tokio::test]
async fn concurrent_group_creation_does_not_lose_updates() {
    let front = spawn_front().await;
    let addr = front.addr;
    let mut handles = Vec::new();
    for i in 0..8 {
        handles.push(tokio::spawn(async move {
            client()
                .post(format!("http://{addr}/groups"))
                .bearer_auth(TOKEN)
                .json(&json!({"name": format!("group-{i}")}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), 200);
    }
    let groups = get_json(&front, "/groups").await;
    let names: std::collections::HashSet<String> = groups
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names.len(), 8, "expected 8 distinct groups, got {groups:?}");
}

#[tokio::test]
async fn export_health_and_import() {
    let front = spawn_front().await;
    let health = get_json(&front, "/settings/config-health").await;
    assert_eq!(health["source"], "empty");

    put_json(
        &front,
        "/settings/editor",
        &json!({"url_template": "e://x"}),
    )
    .await
    .error_for_status()
    .unwrap();
    // export の読み込みがバージョンマイグレーション（v0 → v3 刻印）を起こす
    // （Python も同じ: config_version は読み込み時に刻印される）
    let exported = get_json(&front, "/settings/export").await;
    assert_eq!(exported["__global__"]["editor"]["url_template"], "e://x");
    let health = get_json(&front, "/settings/config-health").await;
    assert_eq!(health["ok"], true);
    assert_eq!(health["config_version"], 3);

    // import: global は丸ごと置換
    let resp = client()
        .post(format!("http://{}/settings/import", front.addr))
        .bearer_auth(TOKEN)
        .json(&json!({"__global__": {"editor": {"url_template": "imported://y"}}}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(
        get_json(&front, "/settings/editor").await["url_template"],
        "imported://y"
    );
    // 不正 JSON は 400
    let resp = client()
        .post(format!("http://{}/settings/import", front.addr))
        .bearer_auth(TOKEN)
        .header("content-type", "application/json")
        .body("{broken")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["detail"], "Invalid JSON");
}

/// import と並行するグループ作成が失われないこと（lost update しないこと）を
/// 検証する回帰テスト（Codex レビュー指摘: load→merge→save が分離していると、
/// import が古いスナップショットで並行変更を上書きしてしまう）。
#[tokio::test]
async fn concurrent_import_and_group_creation_does_not_lose_updates() {
    let front = spawn_front().await;
    let addr = front.addr;

    let mut handles = Vec::new();
    handles.push(tokio::spawn(async move {
        client()
            .post(format!("http://{addr}/settings/import"))
            .bearer_auth(TOKEN)
            .json(&json!({"__global__": {"editor": {"url_template": "imported://race"}}}))
            .send()
            .await
            .unwrap()
            .status()
    }));
    for i in 0..6 {
        handles.push(tokio::spawn(async move {
            client()
                .post(format!("http://{addr}/groups"))
                .bearer_auth(TOKEN)
                .json(&json!({"name": format!("race-group-{i}")}))
                .send()
                .await
                .unwrap()
                .status()
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), 200);
    }

    let groups = get_json(&front, "/groups").await;
    assert_eq!(groups.as_array().unwrap().len(), 6, "groups: {groups:?}");
}

#[tokio::test]
async fn workspace_order_saved() {
    let front = spawn_front().await;
    let resp = put_json(
        &front,
        "/workspace-order",
        &json!({"order": ["ws_b", "ws_a"]}),
    )
    .await;
    assert_eq!(resp.status(), 200);
    let store = ConfigStore::new(front.dir.path().join("config.json"));
    assert_eq!(
        store.load_global_section("workspace_order"),
        Some(json!(["ws_b", "ws_a"]))
    );
}

/// Python の `RecentJobItem`（pydantic）は全フィールドに `max_length` を課す。
/// 以前は一部フィールド（key/workspace/jobCommand/jobUrl）しか検証しておらず、
/// jobName 等の巨大な値がそのまま config.json に保存されてしまっていた
/// （Codex レビュー指摘）。
#[tokio::test]
async fn recent_jobs_rejects_oversized_fields() {
    let front = spawn_front().await;
    let oversized = "x".repeat(300); // MAX_LABEL_LENGTH (200) 超え
    for field in [
        "jobName",
        "jobLabel",
        "jobIcon",
        "jobIconColor",
        "wsIcon",
        "wsIconColor",
        "jobType",
    ] {
        let mut item = json!({"key": "k1", "workspace": "ws1"});
        item[field] = json!(oversized);
        let resp = put_json(&front, "/recent-jobs", &json!({"recent_jobs": [item]})).await;
        assert_eq!(resp.status(), 422, "field {field} should be rejected");
        let body: Value = resp.json().await.unwrap();
        assert!(
            body["detail"].as_str().unwrap().contains(field),
            "{field}: {body:?}"
        );
    }
}

#[tokio::test]
async fn settings_routes_require_auth() {
    let front = spawn_front().await;
    for path in ["/snippets", "/groups", "/settings/export"] {
        let resp = client()
            .get(format!("http://{}{path}", front.addr))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 401, "{path}");
    }
}
