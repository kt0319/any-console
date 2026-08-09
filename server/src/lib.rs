//! any-console Rust バックエンド（Phase 0: ストラングラー proxy 骨格）。
//!
//! バイナリ（main.rs）と統合テストが共有するライブラリ部。モジュール構成は
//! Python 側 `api/` のファイル構成に対応させている（移植元の追跡を容易にするため）。

pub mod activity;
pub mod auth;
pub mod config;
pub mod config_migrations;
pub mod config_schema;
pub mod errors;
pub mod git_branches;
pub mod git_diff;
pub mod git_files;
pub mod git_helpers;
pub mod git_history;
pub mod git_info;
pub mod git_lock;
pub mod git_utils;
pub mod git_worktree;
pub mod github;
pub mod groups;
pub mod icons;
pub mod jobs;
pub mod jobs_common;
pub mod json_store;
pub mod middleware;
pub mod paths;
pub mod proxy;
pub mod rate_limit;
pub mod settings;
pub mod state;
pub mod static_files;
pub mod subprocess;
pub mod system;
pub mod util;
pub mod workspaces;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::state::AppState;

async fn index(State(state): State<Arc<AppState>>) -> Response {
    match &state.static_ctx {
        Some(ctx) => ctx.serve_index(),
        // dist 未ビルド時は Python のソースモード配信へ委ねる
        None => proxy_get(state, "/").await,
    }
}

async fn pair_page(State(state): State<Arc<AppState>>) -> Response {
    // QRペアリング画面は "/" と同じ SPA シェル（解釈はフロント側が行う）
    match &state.static_ctx {
        Some(ctx) => ctx.serve_index(),
        None => proxy_get(state, "/").await,
    }
}

async fn sw_js(State(state): State<Arc<AppState>>) -> Response {
    match &state.static_ctx {
        Some(ctx) => ctx.serve_sw(),
        None => proxy_get(state, "/sw.js").await,
    }
}

/// ハンドラ内から proxy へ委譲するための最小 GET リクエスト組み立て。
async fn proxy_get(state: Arc<AppState>, path: &str) -> Response {
    let req = axum::http::Request::builder()
        .method("GET")
        .uri(path)
        .body(axum::body::Body::empty())
        .expect("static proxy request");
    let addr: SocketAddr = "127.0.0.1:0".parse().expect("loopback addr");
    proxy::fallback(State(state), axum::extract::ConnectInfo(addr), req)
        .await
        .into_response()
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/pair/{pairing_id}", get(pair_page))
        .route("/sw.js", get(sw_js))
        // ─── Rust ネイティブ移行済みルート（Phase 1: system）───────────────
        .route("/system/info", get(system::info))
        .route("/system/processes", get(system::processes))
        .route("/system/process/kill", post(system::process_kill))
        .route("/system/tmux-info", get(system::tmux_info))
        .route("/system/tmux/kill", post(system::tmux_kill))
        .route("/system/tmux/adopt", post(system::tmux_adopt))
        .route("/system/update/check", get(system::update_check))
        .route("/system/update/apply", post(system::update_apply))
        .route("/client-errors", post(system::client_errors))
        // ─── Rust ネイティブ移行済みルート（Phase 1: settings / groups）────
        // GET/PUT /settings/auth と /recent-jobs は Python のまま（settings.rs 冒頭参照）
        .route("/settings/config-health", get(settings::config_health))
        .route("/settings/export", get(settings::export_settings))
        .route("/settings/import", post(settings::import_settings))
        .route(
            "/settings/editor",
            get(settings::get_editor).put(settings::put_editor),
        )
        .route(
            "/settings/notifications",
            get(settings::get_notifications).put(settings::put_notifications),
        )
        .route(
            "/settings/info-pills",
            get(settings::get_info_pills).put(settings::put_info_pills),
        )
        .route(
            "/settings/circle-keypad",
            get(settings::get_circle_keypad).put(settings::put_circle_keypad),
        )
        .route(
            "/settings/layout",
            get(settings::get_layout)
                .put(settings::put_layout)
                .delete(settings::delete_layout),
        )
        .route(
            "/snippets",
            get(settings::get_snippets).put(settings::put_snippets),
        )
        .route("/workspace-order", put(settings::put_workspace_order))
        .route(
            "/groups",
            get(groups::list_groups).post(groups::create_group),
        )
        .route(
            "/groups/{group_id}",
            put(groups::update_group).delete(groups::delete_group),
        )
        .route("/group-order", put(groups::update_group_order))
        // ─── Rust ネイティブ移行済みルート（Phase 2: git 履歴/差分/コミット/スタッシュ）
        .route("/workspaces/{name}/git-log", get(git_history::git_log))
        .route(
            "/workspaces/{name}/file-history",
            get(git_history::file_history),
        )
        .route(
            "/workspaces/{name}/commit-message",
            get(git_history::commit_message),
        )
        .route(
            "/workspaces/{name}/cherry-pick",
            post(git_history::cherry_pick),
        )
        .route("/workspaces/{name}/revert", post(git_history::revert))
        .route("/workspaces/{name}/merge", post(git_history::merge))
        .route("/workspaces/{name}/rebase", post(git_history::rebase))
        .route("/workspaces/{name}/reset", post(git_history::reset))
        .route("/workspaces/{name}/commit", post(git_history::commit))
        .route(
            "/workspaces/{name}/stash-list",
            get(git_history::stash_list),
        )
        .route(
            "/workspaces/{name}/stash-drop",
            post(git_history::stash_drop),
        )
        .route(
            "/workspaces/{name}/stash-pop-ref",
            post(git_history::stash_pop_ref),
        )
        .route("/workspaces/{name}/stash", post(git_history::stash))
        .route("/workspaces/{name}/stash-pop", post(git_history::stash_pop))
        .route("/workspaces/{name}/diff", get(git_diff::workspace_diff))
        .route(
            "/workspaces/{name}/diff/{commit_hash}",
            get(git_diff::commit_diff),
        )
        .route(
            "/workspaces/{name}/file-diff/{commit_hash}",
            get(git_diff::file_commit_diff),
        )
        .route("/workspaces/{name}/git/discard", post(git_diff::discard))
        // ─── Rust ネイティブ移行済みルート（Phase 2: ブランチ/ファイル/worktree/GitHub）
        .route(
            "/workspaces/{name}/branches",
            get(git_branches::list_branches),
        )
        .route(
            "/workspaces/{name}/branches/remote",
            get(git_branches::list_remote_branches),
        )
        .route(
            "/workspaces/{name}/delete-branch",
            post(git_branches::delete_branch),
        )
        .route(
            "/workspaces/{name}/create-branch",
            post(git_branches::create_branch),
        )
        .route(
            "/workspaces/{name}/checkout",
            post(git_branches::checkout_branch),
        )
        .route("/workspaces/{name}/pull", post(git_branches::pull))
        .route("/workspaces/{name}/push", post(git_branches::push))
        .route(
            "/workspaces/{name}/push-branch",
            post(git_branches::push_branch),
        )
        .route(
            "/workspaces/{name}/set-upstream",
            post(git_branches::set_upstream),
        )
        .route(
            "/workspaces/{name}/push-upstream",
            post(git_branches::push_upstream),
        )
        .route("/workspaces/{name}/fetch", post(git_branches::fetch))
        .route("/workspaces/{name}/files", get(git_files::list_files))
        .route(
            "/workspaces/{name}/file-content",
            get(git_files::file_content),
        )
        .route(
            "/workspaces/{name}/upload",
            post(git_files::upload).layer(axum::extract::DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        .route("/workspaces/{name}/rename", post(git_files::rename))
        .route(
            "/workspaces/{name}/delete-file",
            post(git_files::delete_file),
        )
        .route("/workspaces/{name}/download", get(git_files::download))
        .route(
            "/workspaces/{name}/worktrees",
            get(git_worktree::list_worktrees)
                .post(git_worktree::create_worktree)
                .delete(git_worktree::delete_worktree),
        )
        .route("/workspaces/{name}/github/issues", get(github::issues))
        .route("/workspaces/{name}/github/pulls", get(github::pulls))
        .route("/workspaces/{name}/github/runs", get(github::runs))
        // ─── Rust ネイティブ移行済みルート（Phase 3: ジョブ CRUD / recent-jobs）
        // ジョブ実行（/run・dispatch）はターミナル依存のため Python のまま（Phase 5）
        .route("/jobs/workspaces", get(jobs::list_all_workspace_jobs))
        .route(
            "/workspaces/{name}/jobs",
            get(jobs::list_workspace_jobs).post(jobs::create_workspace_job),
        )
        .route(
            "/workspaces/{name}/job-order",
            put(jobs::reorder_workspace_jobs),
        )
        .route(
            "/workspaces/{name}/jobs/{job_name}",
            put(jobs::update_workspace_job).delete(jobs::delete_workspace_job),
        )
        .route(
            "/common/jobs",
            get(jobs::list_common_jobs).post(jobs::create_common_job),
        )
        .route(
            "/common/jobs/{job_name}",
            put(jobs::update_common_job).delete(jobs::delete_common_job),
        )
        .route("/common/job-order", put(jobs::reorder_common_jobs))
        .route(
            "/recent-jobs",
            get(settings::get_recent_jobs).put(settings::put_recent_jobs),
        )
        // ─── Rust ネイティブ移行済みルート（Phase 4: ワークスペース一覧/登録/設定）
        // /workspaces/statuses/ws（status stream）は Python のまま（Phase 5）
        .route(
            "/workspaces",
            get(workspaces::list_workspaces).post(workspaces::add_workspace),
        )
        .route(
            "/workspaces/statuses",
            get(workspaces::list_workspace_statuses),
        )
        .route(
            "/workspaces/suggest",
            get(workspaces::suggest_workspace_dirs),
        )
        .route("/workspaces/{name}", delete(workspaces::delete_workspace))
        .route(
            "/workspaces/{name}/config",
            put(workspaces::update_workspace_config),
        )
        // ────────────────────────────────────────────────────────────────
        .fallback(proxy::fallback)
        // Python main.py の add_middleware 順（後着が外殻）を踏襲:
        // SecurityHeaders → RateLimit → ClientLog → ルート
        .layer(axum::middleware::from_fn(middleware::client_log))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit,
        ))
        .layer(axum::middleware::from_fn(middleware::security_headers))
        .with_state(state)
}
