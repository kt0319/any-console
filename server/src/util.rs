//! 小物ユーティリティ（Python 側 `api/common.py` の文字列系ヘルパー等に対応）。

use axum::extract::{FromRequest, Request};
use serde::de::DeserializeOwned;

use crate::errors::ApiError;

/// 制御文字を `\xNN` 形式へエスケープする（`sanitize_log_value`）。
pub fn sanitize_log_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        let code = c as u32;
        if code <= 0x1f || code == 0x7f {
            out.push_str(&format!("\\x{code:02x}"));
        } else {
            out.push(c);
        }
    }
    out
}

/// セッションIDの構成要素として安全な文字列へ変換する（英数と _ - 以外を _ に）。
pub fn sanitize_session_segment(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// `secrets.token_urlsafe(n)` 相当: n バイトの乱数を base64url（パディング無し）で返す。
pub fn token_urlsafe(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    getrandom::fill(&mut buf).expect("os rng");
    let mut out = String::with_capacity(n_bytes.div_ceil(3) * 4);
    for chunk in buf.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let idx = [
            b[0] >> 2,
            ((b[0] & 0x03) << 4) | (b[1] >> 4),
            ((b[1] & 0x0f) << 2) | (b[2] >> 6),
            b[2] & 0x3f,
        ];
        let emit = match chunk.len() {
            1 => 2,
            2 => 3,
            _ => 4,
        };
        for &i in idx.iter().take(emit) {
            out.push(B64URL[i as usize] as char);
        }
    }
    out
}

/// JSON ボディ抽出子。パース失敗を 422 `{"detail": ...}` へ変換する
/// （axum 既定の plain text 応答だと `detail` エラー形式の契約から外れるため）。
pub struct JsonBody<T>(pub T);

impl<S, T> FromRequest<S> for JsonBody<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(v)) => Ok(JsonBody(v)),
            Err(rejection) => Err(ApiError::new(
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                rejection.body_text(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_log_value_escapes_control_chars() {
        assert_eq!(sanitize_log_value("ab\x1b[31mc\x7f"), "ab\\x1b[31mc\\x7f");
        assert_eq!(sanitize_log_value("plain 日本語"), "plain 日本語");
    }

    #[test]
    fn sanitize_session_segment_replaces_unsafe() {
        assert_eq!(sanitize_session_segment("my session/1"), "my_session_1");
        assert_eq!(sanitize_session_segment("ok_name-2"), "ok_name-2");
    }

    #[test]
    fn token_urlsafe_length_and_charset() {
        // Python: 6 bytes -> 8 chars, 32 bytes -> 43 chars
        assert_eq!(token_urlsafe(6).len(), 8);
        assert_eq!(token_urlsafe(32).len(), 43);
        let t = token_urlsafe(48);
        assert!(t
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(token_urlsafe(16), token_urlsafe(16));
    }
}
