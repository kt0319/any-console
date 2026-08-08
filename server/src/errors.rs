//! API エラー応答。エラーフィールドは `detail` を使用する（Backend API ルール、
//! Python 側 `api/errors.py` と同一のワイヤフォーマット）。

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub detail: String,
}

impl ApiError {
    pub fn new(status: StatusCode, detail: impl Into<String>) -> Self {
        Self {
            status,
            detail: detail.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.detail }))).into_response()
    }
}

macro_rules! error_ctor {
    ($name:ident, $status:expr) => {
        #[allow(dead_code)]
        pub fn $name(detail: impl Into<String>) -> ApiError {
            ApiError::new($status, detail)
        }
    };
}

error_ctor!(bad_request, StatusCode::BAD_REQUEST);
error_ctor!(unauthorized, StatusCode::UNAUTHORIZED);
error_ctor!(forbidden, StatusCode::FORBIDDEN);
error_ctor!(not_found, StatusCode::NOT_FOUND);
error_ctor!(conflict, StatusCode::CONFLICT);
error_ctor!(gone, StatusCode::GONE);
error_ctor!(too_large, StatusCode::PAYLOAD_TOO_LARGE);
error_ctor!(too_many_requests, StatusCode::TOO_MANY_REQUESTS);
error_ctor!(server_error, StatusCode::INTERNAL_SERVER_ERROR);
error_ctor!(service_unavailable, StatusCode::SERVICE_UNAVAILABLE);
error_ctor!(timeout_error, StatusCode::GATEWAY_TIMEOUT);

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn error_body_uses_detail_field() {
        let resp = bad_request("Workspace name is required").into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(resp.into_body(), 1024).await.unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["detail"], "Workspace name is required");
        assert!(parsed.get("message").is_none());
    }
}
