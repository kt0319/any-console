//! 未知パスの最終フォールバック。
//!
//! ここへ到達するのは静的ファイルにも当たらない本当に存在しないパスのみ
//! （Python バックエンドへの転送は docs/RUST_MIGRATION.md の移行完了時に撤去済み）。

use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

/// フォールバックハンドラ: 静的ファイル → ネイティブ 404 の順で処理する。
pub async fn handle(
    State(state): State<Arc<AppState>>,
    ConnectInfo(_addr): ConnectInfo<std::net::SocketAddr>,
    req: Request,
) -> Response {
    // 静的ファイル（GET/HEAD のみ）
    if matches!(req.method().as_str(), "GET" | "HEAD") {
        if let Some(ctx) = &state.static_ctx {
            if let Some(resp) = ctx.try_serve(req.uri().path()) {
                return resp;
            }
        }
    }
    crate::errors::not_found("Not Found").into_response()
}
