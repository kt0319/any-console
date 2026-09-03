//! `/workspaces/{name}/pull` の統合テスト。
//!
//! bare リモート + 2つのクローンでリモートに新規コミットがある状況を作り、
//! POST /pull の応答が実際に取り込んだコミットを正しく報告することを検証する。

mod common;

use std::net::SocketAddr;

use serde_json::{json, Value};

use any_console_server::build_router;
use any_console_server::config::ConfigStore;
use any_console_server::json_store::save_json_file;

struct TestFront {
    addr: SocketAddr,
    ws_path: std::path::PathBuf,
    _dir: tempfile::TempDir,
}

const TOKEN: &str = "git-remote-test-token";

/// bareリモート・2クローン（clone_a: 新規コミットをpushする側、clone_b:
/// pullする側 = ワークスペース登録対象）を用意する。clone_bは初期コミットの
/// 時点でcloneするため、後からclone_aが積むコミット分だけbehindになる。
async fn spawn_front_with_remote() -> TestFront {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    save_json_file(&data_dir.join("auth.json"), &json!({"token": TOKEN})).unwrap();

    let remote_path = dir.path().join("remote.git");
    common::sh_git(
        dir.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );

    let clone_a = dir.path().join("clone_a");
    common::sh_git(
        dir.path(),
        &[
            "clone",
            "-q",
            remote_path.to_str().unwrap(),
            clone_a.to_str().unwrap(),
        ],
    );
    common::sh_git(&clone_a, &["config", "user.email", "a@example.com"]);
    common::sh_git(&clone_a, &["config", "user.name", "a"]);
    std::fs::write(clone_a.join("a.txt"), "hello\n").unwrap();
    common::sh_git(&clone_a, &["add", "-A"]);
    common::sh_git(&clone_a, &["commit", "-q", "-m", "initial"]);
    common::sh_git(&clone_a, &["push", "-q", "origin", "main"]);

    let ws_path = dir.path().join("clone_b");
    common::sh_git(
        dir.path(),
        &[
            "clone",
            "-q",
            remote_path.to_str().unwrap(),
            ws_path.to_str().unwrap(),
        ],
    );
    common::sh_git(&ws_path, &["config", "user.email", "b@example.com"]);
    common::sh_git(&ws_path, &["config", "user.name", "b"]);

    let store = ConfigStore::new(dir.path().join("config.json"));
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
        _dir: dir,
    }
}

async fn post_json(front: &TestFront, path: &str) -> Value {
    common::client()
        .post(format!("http://{}{path}", front.addr))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
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

#[tokio::test]
async fn pull_reports_zero_commits_when_already_up_to_date() {
    let front = spawn_front_with_remote().await;
    let body = post_json(&front, "/workspaces/repo/pull").await;
    assert_eq!(body["status"], "ok");
    assert_eq!(body["commits"]["count"], 0);
}

/// リモートに新規コミットがある通常のpull。before/afterのupstream参照が
/// pull自体のfetchで動く素直なケース。
#[tokio::test]
async fn pull_reports_commit_count_and_messages_for_fast_forward() {
    let front = spawn_front_with_remote().await;

    // clone_aから新規コミットを2つpushする（front作成時に登録した
    // ws_path=clone_bはまだこれを知らない）。
    let dir_root = front.ws_path.parent().unwrap();
    let clone_a = dir_root.join("clone_a");
    std::fs::write(clone_a.join("b.txt"), "b\n").unwrap();
    common::sh_git(&clone_a, &["add", "-A"]);
    common::sh_git(&clone_a, &["commit", "-q", "-m", "second commit"]);
    std::fs::write(clone_a.join("c.txt"), "c\n").unwrap();
    common::sh_git(&clone_a, &["add", "-A"]);
    common::sh_git(&clone_a, &["commit", "-q", "-m", "third commit"]);
    common::sh_git(&clone_a, &["push", "-q", "origin", "main"]);

    let body = post_json(&front, "/workspaces/repo/pull").await;
    assert_eq!(body["status"], "ok");
    assert_eq!(body["commits"]["count"], 2);
    let messages = body["commits"]["messages"].as_array().unwrap();
    assert!(messages.contains(&json!("third commit")));
    assert!(messages.contains(&json!("second commit")));
}

/// auto_fetch_loop のバックグラウンドfetchがpull前にupstream参照(@{u})を
/// 先に最新化していると、before_upstream..after_upstreamでは差分0になり
/// 「Already up to date」と誤表示していた（修正前バグ）。before_hash起点で
/// 数えることでfetchタイミングに依らず正しく報告できることを検証する。
#[tokio::test]
async fn pull_reports_commits_even_when_upstream_was_already_fetched_in_background() {
    let front = spawn_front_with_remote().await;

    let dir_root = front.ws_path.parent().unwrap();
    let clone_a = dir_root.join("clone_a");
    std::fs::write(clone_a.join("b.txt"), "b\n").unwrap();
    common::sh_git(&clone_a, &["add", "-A"]);
    common::sh_git(&clone_a, &["commit", "-q", "-m", "second commit"]);
    common::sh_git(&clone_a, &["push", "-q", "origin", "main"]);

    // バックグラウンドfetchを模してpullを叩く前にfetchだけ済ませておく。
    common::sh_git(&front.ws_path, &["fetch", "--quiet"]);

    let body = post_json(&front, "/workspaces/repo/pull").await;
    assert_eq!(body["status"], "ok");
    assert_eq!(
        body["commits"]["count"], 1,
        "バックグラウンドfetch済みでも実際に取り込んだコミット数を報告すること"
    );
    let messages = body["commits"]["messages"].as_array().unwrap();
    assert!(messages.contains(&json!("second commit")));
}

/// Historyペインで「pull前にこれから取り込まれるコミット」を非アクティブ
/// 表示するためのGET /unpulled-log。pullを実行せずに、リモートにだけ
/// 積まれた新規コミットがHEAD..@{u}として報告されることを検証する。
#[tokio::test]
async fn unpulled_log_lists_commits_not_yet_pulled_without_pulling() {
    let front = spawn_front_with_remote().await;

    let dir_root = front.ws_path.parent().unwrap();
    let clone_a = dir_root.join("clone_a");
    std::fs::write(clone_a.join("b.txt"), "b\n").unwrap();
    common::sh_git(&clone_a, &["add", "-A"]);
    common::sh_git(&clone_a, &["commit", "-q", "-m", "second commit"]);
    std::fs::write(clone_a.join("c.txt"), "c\n").unwrap();
    common::sh_git(&clone_a, &["add", "-A"]);
    common::sh_git(&clone_a, &["commit", "-q", "-m", "third commit"]);
    common::sh_git(&clone_a, &["push", "-q", "origin", "main"]);

    // ワークスペース側（clone_b）はfetchのみ行い、pullはしない。
    common::sh_git(&front.ws_path, &["fetch", "--quiet"]);

    let body = get_json(&front, "/workspaces/repo/unpulled-log?limit=10&graph=true").await;
    assert_eq!(body["status"], "ok");
    let stdout = body["stdout"].as_str().unwrap();
    assert!(stdout.contains("second commit"));
    assert!(stdout.contains("third commit"));
    assert!(
        !stdout.contains("initial"),
        "既にpull済みの初期コミットはunpulled-logに含まれないこと"
    );

    // ローカルHEADはまだ動いていない（pullしていないため）。
    let head_body = get_json(&front, "/workspaces/repo/git-log?limit=10").await;
    let head_stdout = head_body["stdout"].as_str().unwrap();
    assert!(!head_stdout.contains("second commit"));
}
