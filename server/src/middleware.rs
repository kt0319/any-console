//! HTTP ミドルウェア群（Python 側 security_headers.py / rate_limiter.py /
//! client_log.py の各 Middleware に対応）。
//!
//! 適用順は Python (`main.py` の add_middleware 逆順) と同じ:
//! SecurityHeaders が最外殻 → RateLimit → ClientLog → ハンドラ。

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header::HeaderName, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::rate_limit::{should_skip_rate_limit, RATE_WINDOW_SEC};
use crate::state::AppState;

/// セキュリティ応答ヘッダを全レスポンスに付与する。
/// /preview/ 配下はユーザーのアプリを丸ごとプロキシする経路のため対象外
/// （プロキシ先アプリ自身のヘッダ・フレーム利用を壊さない）。
pub async fn security_headers(req: Request, next: Next) -> Response {
    let skip = req.uri().path().starts_with("/preview/");
    let mut resp = next.run(req).await;
    if !skip {
        const HEADERS: &[(&str, &str)] = &[
            ("x-frame-options", "DENY"),
            ("x-content-type-options", "nosniff"),
            ("referrer-policy", "no-referrer"),
        ];
        for (name, value) in HEADERS {
            let name = HeaderName::from_static(name);
            // setdefault 相当: 既に付いているヘッダ（proxy 応答由来）は上書きしない
            if !resp.headers().contains_key(&name) {
                resp.headers_mut()
                    .insert(name, HeaderValue::from_static(value));
            }
        }
    }
    resp
}

/// 固定窓レートリミット。超過時は 429 `{"detail": "Too many requests"}`。
pub async fn rate_limit(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    if should_skip_rate_limit(req.uri().path()) {
        return next.run(req).await;
    }
    let key = format!("api:{}", addr.ip());
    if !state
        .rate_counter
        .try_acquire(&key, state.rate_limit, Duration::from_secs(RATE_WINDOW_SEC))
    {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"detail": "Too many requests"})),
        )
            .into_response();
    }
    next.run(req).await
}

/// 変更系リクエスト（POST/PUT/DELETE/PATCH）のアクセスログ。/auth/check は除外。
pub async fn client_log(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let is_mutation = matches!(method.as_str(), "POST" | "PUT" | "DELETE" | "PATCH");
    let resp = next.run(req).await;
    if is_mutation && path != "/auth/check" {
        tracing::info!(
            "client={} method={} path={} status={}",
            addr.ip(),
            method,
            path,
            resp.status().as_u16()
        );
    }
    resp
}
