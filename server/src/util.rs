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

/// macOS 上で動作しているか（launchd / pbcopy 等の OS 分岐に使う）。
pub const IS_MACOS: bool = cfg!(target_os = "macos");

/// バックグラウンドタスクが起動済みかつ未終了かを判定する
/// （git_watch / agent_watch / preview のタスク管理で共用）。
pub fn task_running(task: &Option<tokio::task::JoinHandle<()>>) -> bool {
    task.as_ref().is_some_and(|h| !h.is_finished())
}

/// アップロード共通の上限サイズ（/upload-image・ワークスペースのファイル
/// アップロードで同値。文言 `MSG_UPLOAD_TOO_LARGE` とセットで使う）。
pub const MAX_UPLOAD_SIZE: usize = 10 * 1024 * 1024;
pub const MSG_UPLOAD_TOO_LARGE: &str = "File too large (max 10MB)";

/// 現在時刻の UNIX epoch 秒（Python `time.time()` の整数部相当）。
pub fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 文字数（バイトではなく char 単位）で切り詰める。
pub fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// UTC の現在時刻を (年, 月, 日, 時, 分, 秒) で返す。フォーマットは呼び出し側
/// （activity.rs のログ日付・upload_image.rs のファイル名等）が持つ。
pub fn utc_now_parts() -> (i64, u32, u32, u64, u64, u64) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    let (h, m, s) = ((secs % 86400) / 3600, (secs % 3600) / 60, secs % 60);
    // 1970-01-01 起点の civil date 変換（proleptic Gregorian）
    let (y, mo, d) = civil_from_days(days as i64);
    (y, mo, d, h, m, s)
}

/// Howard Hinnant の days->civil アルゴリズム。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
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

const B64STD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 標準 base64（パディング有り）。data URL 用（Python `base64.b64encode` 相当）。
pub fn base64_standard(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
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
        out.push(B64STD[idx[0] as usize] as char);
        out.push(B64STD[idx[1] as usize] as char);
        out.push(if chunk.len() > 1 {
            B64STD[idx[2] as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64STD[idx[3] as usize] as char
        } else {
            '='
        });
    }
    out
}

/// `secrets.token_hex(n)` 相当: n バイトの乱数を hex 文字列で返す。
pub fn token_hex(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    getrandom::fill(&mut buf).expect("os rng");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// base64url（パディング無し）エンコード（VAPID 鍵・JWT 等、`push.rs` が使う）。
/// `Python `base64.urlsafe_b64encode(...).rstrip(b"=")` と同一の出力形式。
pub fn base64url_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

/// base64url デコード。パディング有り無しどちらの入力も受け付ける（ブラウザの
/// `PushSubscription` は実装によりパディングを付けて送ってくることがあるため）。
pub fn base64url_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s.trim_end_matches('='))
        .ok()
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

/// クエリパラメータ抽出子。パース失敗を 422 `{"detail": ...}` へ変換する
/// （FastAPI のクエリ型不一致 422 に対応）。
pub struct QueryParams<T>(pub T);

impl<S, T> axum::extract::FromRequestParts<S> for QueryParams<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        match axum::extract::Query::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Query(v)) => Ok(QueryParams(v)),
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
    fn now_epoch_is_recent() {
        // 2020-01-01 より後であること（0 フォールバックや単位間違いの検出）。
        assert!(now_epoch() > 1_577_836_800);
    }

    #[test]
    fn truncate_chars_counts_chars_not_bytes() {
        assert_eq!(truncate_chars("abcdef", 3), "abc");
        assert_eq!(truncate_chars("日本語のラベル", 3), "日本語");
        assert_eq!(truncate_chars("ab", 10), "ab");
    }

    #[test]
    fn civil_from_days_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1)); // うるう年
        assert_eq!(civil_from_days(20_666), (2026, 8, 1)); // 2026-08-01
        assert_eq!(civil_from_days(11_016), (2000, 2, 29)); // 400年例外のうるう日
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
