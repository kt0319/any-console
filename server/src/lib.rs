//! any-console Rust バックエンド（Phase 0: ストラングラー proxy 骨格）。
//!
//! バイナリ（main.rs）と統合テストが共有するライブラリ部。モジュール構成は
//! Python 側 `api/` のファイル構成に対応させている（移植元の追跡を容易にするため）。

pub mod auth;
pub mod config;
pub mod config_migrations;
pub mod config_schema;
pub mod errors;
pub mod groups;
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

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
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
