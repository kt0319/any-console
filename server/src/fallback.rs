//! 未知パスの最終フォールバック。
//!
//! ストラングラー移行は完了し（docs/RUST_MIGRATION.md Phase 1〜5）、Python が
//! 提供していた全ルートが Rust ネイティブへ移行済みのため、ここへ到達するのは
//! 静的ファイルにも当たらない本当に存在しないパスのみである。以前はここから
//! Python バックエンドへ HTTP/WS 転送していたが、その役目は終えたため撤去した
//! （`migration_bridge.py` 側の内部ブリッジ呼び出しも同時に撤去済み）。

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
