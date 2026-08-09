//! 認証コア（Python 側 `api/auth.py` の `_authenticate` と同一の判定順・規則）。
//!
//! Phase 0 では auth.json / devices.json / server_key を **読み取り専用** で扱う。
//! トークンのローテーション・デバイス登録・last_seen 更新などの書き込みは
//! Python 側が引き続き担う（該当ルートは proxy 経由）。デバイス認証の
//! last_seen_at タッチも行わない — 認証済みルートは Phase 0 では全て Python へ
//! proxy されるため、実利用上の欠落はない。

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;

use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::json_store::load_json_file;

pub const COOKIE_DEVICE_ID: &str = "any_console_device";
pub const COOKIE_DEVICE_SECRET: &str = "any_console_secret";
pub const TAILSCALE_HEADER_USER: &str = "tailscale-user-login";

/// どの経路で認証されたか（`api/auth.py` の `AuthResult.kind` に対応）。
/// 文字列プレフィックスの推測に頼らないための構造化。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthKind {
    Disabled,
    Main,
    Tailscale,
    Device,
}

#[derive(Debug, Clone)]
pub struct AuthResult {
    pub kind: AuthKind,
    pub label: String,
}

/// タイミング攻撃耐性のある文字列比較（Python `hmac.compare_digest` 相当）。
pub(crate) fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

/// Tailscale ヘッダを信頼してよい接続元か（loopback または CGNAT 100.64.0.0/10）。
///
/// 192.168.x や public IP は Tailscale 経由ではない経路なので、これらの接続元から
/// 送られたヘッダは偽装の可能性があり信頼してはならない。
pub fn is_trusted_proxy_source(client_host: &str) -> bool {
    if client_host.is_empty() {
        return false;
    }
    if matches!(client_host, "127.0.0.1" | "::1" | "localhost") {
        return true;
    }
    match client_host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            let o = v4.octets();
            if v4.is_loopback() {
                return true;
            }
            // 100.64.0.0/10: 第1オクテット 100、第2オクテット 64..=127
            o[0] == 100 && (64..=127).contains(&o[1])
        }
        Ok(IpAddr::V6(v6)) => v6.is_loopback(),
        Err(_) => false,
    }
}

#[derive(Debug, Default)]
struct TokenCache {
    token: String,
    mtime: Option<std::time::SystemTime>,
    loaded: bool,
}

pub struct Auth {
    data_dir: PathBuf,
    /// メイントークンのキャッシュ。auth.json の mtime が変わったら読み直す —
    /// 移行期間中はトークンのローテーション（Settings API = Python 側の書き込み）が
    /// 別プロセスで起きるため、起動時ロードのままだと Rust 側ルートが古いトークンで
    /// 固まる。空文字は認証無効化（auth.json 不在 or token 未設定）。
    cache: std::sync::Mutex<TokenCache>,
    trust_tailscale: bool,
}

impl Auth {
    pub fn load(data_dir: PathBuf, trust_tailscale: bool) -> Self {
        Self {
            data_dir,
            cache: std::sync::Mutex::new(TokenCache::default()),
            trust_tailscale,
        }
    }

    /// Tailscale ヘッダ信頼の opt-in 状態（起動時に確定 — Python 側のキャッシュと同じ
    /// く、変更の反映には再起動が必要）。
    pub fn trust_tailscale(&self) -> bool {
        self.trust_tailscale
    }

    /// 現在のメイントークン。auth.json の mtime を毎回 stat し、変化時のみ再読込する。
    fn current_token(&self) -> String {
        let path = self.data_dir.join("auth.json");
        let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        let mut cache = self.cache.lock().expect("auth cache lock poisoned");
        if !cache.loaded || cache.mtime != mtime {
            let auth = load_json_file(&path, json!({}), None);
            cache.token = auth
                .get("token")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            cache.mtime = mtime;
            cache.loaded = true;
        }
        cache.token.clone()
    }

    /// HMAC-SHA256(data/server_key, secret) の hex（`api/devices.py` `_hash_secret`）。
    /// server_key が無ければ None（鍵の生成は Python 側の責務 — 鍵が無い環境では
    /// 登録済みデバイスも存在しえないため、デバイス認証は単に失敗してよい）。
    fn hash_secret(&self, raw_secret: &str) -> Option<String> {
        let key = std::fs::read(self.data_dir.join("server_key")).ok()?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).ok()?;
        mac.update(raw_secret.as_bytes());
        let out = mac.finalize().into_bytes();
        Some(out.iter().map(|b| format!("{b:02x}")).collect())
    }

    /// device_id + raw_secret が登録済みデバイスと一致するか（読み取り専用検証）。
    fn verify_device(&self, device_id: &str, raw_secret: &str) -> Option<String> {
        if device_id.is_empty() || raw_secret.is_empty() {
            return None;
        }
        let expected = self.hash_secret(raw_secret)?;
        let data = load_json_file(
            &self.data_dir.join("devices.json"),
            json!({"devices": []}),
            Some(&|v: &Value| v.get("devices").is_some()),
        );
        for dev in data.get("devices")?.as_array()? {
            if dev.get("id").and_then(Value::as_str) != Some(device_id) {
                continue;
            }
            let stored = dev.get("secret_hash").and_then(Value::as_str).unwrap_or("");
            if constant_time_eq(stored, &expected) {
                return Some(device_id.to_string());
            }
        }
        None
    }

    /// 認証判定のコア（HTTP / WS 共通）。判定順は Python `_authenticate` と同一:
    /// 無効化 → Tailscale ヘッダ → デバイス cookie → Bearer token。
    pub fn authenticate(
        &self,
        bearer: &str,
        client_host: &str,
        headers: Option<&http::HeaderMap>,
        cookies: Option<&HashMap<String, String>>,
    ) -> Option<AuthResult> {
        let token = self.current_token();
        if token.is_empty() {
            return Some(AuthResult {
                kind: AuthKind::Disabled,
                label: String::new(),
            });
        }
        if let Some(headers) = headers {
            if self.trust_tailscale && is_trusted_proxy_source(client_host) {
                let user = headers
                    .get(TAILSCALE_HEADER_USER)
                    .and_then(|v| v.to_str().ok())
                    .map(str::trim)
                    .unwrap_or("");
                if !user.is_empty() {
                    return Some(AuthResult {
                        kind: AuthKind::Tailscale,
                        label: format!("tailscale:{user}"),
                    });
                }
            }
        }
        if let Some(cookies) = cookies {
            let id = cookies
                .get(COOKIE_DEVICE_ID)
                .map(String::as_str)
                .unwrap_or("");
            let secret = cookies
                .get(COOKIE_DEVICE_SECRET)
                .map(String::as_str)
                .unwrap_or("");
            if let Some(dev_id) = self.verify_device(id, secret) {
                return Some(AuthResult {
                    kind: AuthKind::Device,
                    label: format!("device:{dev_id}"),
                });
            }
        }
        if constant_time_eq(bearer, &token) {
            return Some(AuthResult {
                kind: AuthKind::Main,
                label: bearer.to_string(),
            });
        }
        None
    }
}

/// 認証必須ルート用の axum 抽出子（Python の `Depends(verify_token)` に対応）。
/// 失敗時は 401 `{"detail": "Invalid token"}`。
pub struct RequireAuth(#[allow(dead_code)] pub AuthResult);

impl axum::extract::FromRequestParts<std::sync::Arc<crate::state::AppState>> for RequireAuth {
    type Rejection = crate::errors::ApiError;

    async fn from_request_parts(
        parts: &mut http::request::Parts,
        state: &std::sync::Arc<crate::state::AppState>,
    ) -> Result<Self, Self::Rejection> {
        let bearer = parts
            .headers
            .get(http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        let client_ip = parts
            .extensions
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
            .map(|ci| ci.0.ip().to_string())
            .unwrap_or_default();
        let cookies = parse_cookies(&parts.headers);
        state
            .auth
            .authenticate(bearer, &client_ip, Some(&parts.headers), Some(&cookies))
            .map(RequireAuth)
            .ok_or_else(|| crate::errors::unauthorized("Invalid token"))
    }
}

/// Cookie ヘッダ文字列を key→value にパースする（値の `=` を許容）。
pub fn parse_cookies(headers: &http::HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for value in headers.get_all(http::header::COOKIE) {
        let Ok(s) = value.to_str() else { continue };
        for pair in s.split(';') {
            if let Some((k, v)) = pair.trim().split_once('=') {
                out.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json_store::save_json_file;

    type HmacSha256 = Hmac<Sha256>;

    fn setup(dir: &tempfile::TempDir, token: &str) -> Auth {
        save_json_file(&dir.path().join("auth.json"), &json!({"token": token})).unwrap();
        Auth::load(dir.path().to_path_buf(), false)
    }

    #[test]
    fn no_token_means_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let auth = Auth::load(dir.path().to_path_buf(), false);
        let r = auth.authenticate("", "1.2.3.4", None, None).unwrap();
        assert_eq!(r.kind, AuthKind::Disabled);
    }

    #[test]
    fn main_token_matches_constant_time() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "secret-token");
        let r = auth
            .authenticate("secret-token", "1.2.3.4", None, None)
            .unwrap();
        assert_eq!(r.kind, AuthKind::Main);
        assert!(auth.authenticate("wrong", "1.2.3.4", None, None).is_none());
        assert!(auth.authenticate("", "1.2.3.4", None, None).is_none());
    }

    #[test]
    fn token_rotation_is_picked_up_without_reload() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "old-token");
        assert!(auth
            .authenticate("old-token", "1.2.3.4", None, None)
            .is_some());
        // 別プロセス（Python の Settings API）によるローテーションを模す
        std::thread::sleep(std::time::Duration::from_millis(20));
        save_json_file(
            &dir.path().join("auth.json"),
            &json!({"token": "new-token"}),
        )
        .unwrap();
        assert!(auth
            .authenticate("old-token", "1.2.3.4", None, None)
            .is_none());
        assert!(auth
            .authenticate("new-token", "1.2.3.4", None, None)
            .is_some());
    }

    #[test]
    fn tailscale_header_requires_optin_and_trusted_source() {
        let dir = tempfile::tempdir().unwrap();
        save_json_file(&dir.path().join("auth.json"), &json!({"token": "t"})).unwrap();
        let mut headers = http::HeaderMap::new();
        headers.insert(TAILSCALE_HEADER_USER, "alice@example.com".parse().unwrap());

        // opt-in 無し → ヘッダは無視され認証失敗
        let auth = Auth::load(dir.path().to_path_buf(), false);
        assert!(auth
            .authenticate("", "127.0.0.1", Some(&headers), None)
            .is_none());

        // opt-in 有り + loopback → tailscale 認証
        let auth = Auth::load(dir.path().to_path_buf(), true);
        let r = auth
            .authenticate("", "127.0.0.1", Some(&headers), None)
            .unwrap();
        assert_eq!(r.kind, AuthKind::Tailscale);
        assert_eq!(r.label, "tailscale:alice@example.com");

        // opt-in 有りでも信頼できない接続元 → 失敗
        assert!(auth
            .authenticate("", "192.168.1.5", Some(&headers), None)
            .is_none());
        // CGNAT 帯は信頼
        assert!(auth
            .authenticate("", "100.100.1.2", Some(&headers), None)
            .is_some());
    }

    #[test]
    fn trusted_source_ranges() {
        assert!(is_trusted_proxy_source("127.0.0.1"));
        assert!(is_trusted_proxy_source("::1"));
        assert!(is_trusted_proxy_source("localhost"));
        assert!(is_trusted_proxy_source("100.64.0.1"));
        assert!(is_trusted_proxy_source("100.127.255.254"));
        assert!(!is_trusted_proxy_source("100.128.0.1"));
        assert!(!is_trusted_proxy_source("100.63.255.255"));
        assert!(!is_trusted_proxy_source("192.168.1.1"));
        assert!(!is_trusted_proxy_source(""));
        assert!(!is_trusted_proxy_source("not-an-ip"));
    }

    #[test]
    fn device_cookie_auth_matches_python_hash() {
        let dir = tempfile::tempdir().unwrap();
        // Python 側の _load_or_create_server_key / _hash_secret を再現
        let key: Vec<u8> = (0u8..32).collect();
        std::fs::write(dir.path().join("server_key"), &key).unwrap();
        let raw_secret = "device-raw-secret";
        let mut mac = HmacSha256::new_from_slice(&key).unwrap();
        mac.update(raw_secret.as_bytes());
        let hash: String = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        save_json_file(
            &dir.path().join("devices.json"),
            &json!({"devices": [{"id": "dev_1", "secret_hash": hash, "last_seen_at": 0}]}),
        )
        .unwrap();
        let auth = setup(&dir, "main-token");

        let mut cookies = HashMap::new();
        cookies.insert(COOKIE_DEVICE_ID.to_string(), "dev_1".to_string());
        cookies.insert(COOKIE_DEVICE_SECRET.to_string(), raw_secret.to_string());
        let r = auth
            .authenticate("", "1.2.3.4", None, Some(&cookies))
            .unwrap();
        assert_eq!(r.kind, AuthKind::Device);
        assert_eq!(r.label, "device:dev_1");

        cookies.insert(COOKIE_DEVICE_SECRET.to_string(), "wrong".to_string());
        assert!(auth
            .authenticate("", "1.2.3.4", None, Some(&cookies))
            .is_none());
    }

    #[test]
    fn parse_cookies_basic() {
        let mut headers = http::HeaderMap::new();
        headers.insert(
            http::header::COOKIE,
            "any_console_device=dev_1; any_console_secret=a=b"
                .parse()
                .unwrap(),
        );
        let c = parse_cookies(&headers);
        assert_eq!(c["any_console_device"], "dev_1");
        assert_eq!(c["any_console_secret"], "a=b");
    }
}
