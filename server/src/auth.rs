//! 認証コア（Python 側 `api/auth.py` の `_authenticate` と同一の判定順・規則）。
//!
//! auth.json / devices.json / server_key の書き込み（トークンのローテーション・
//! デバイス登録等）は引き続き Python 側が担う（該当ルートは proxy 経由）。
//! ただしデバイス cookie 認証の `last_seen_at` 更新だけは、Rust ネイティブ
//! ルートを常用する trusted device が `/auth/check` を経由しなくても
//! stale にならないよう、migration_bridge 経由でスロットリング付きに
//! タッチする（`maybe_touch_device`）。

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

/// Python の `str(token) if token else ""` と同じ真偽判定で文字列化する。
///
/// JSON の `token` フィールドは本来文字列だが、手編集等で数値・真偽値になって
/// いても Python は truthy な値を `str()` で文字列化してそのまま有効なトークンと
/// して扱う（falsy な値だけが `""` になる）。ここを素朴に `as_str().unwrap_or("")`
/// にすると、truthy な非文字列値（例: `123`）が誤って `""` に落ち、
/// `Auth::authenticate` の `token.is_empty()` 分岐で認証そのものが無効化されて
/// しまう（全ルートが無認証で通ってしまう重大なリグレッション）。
fn coerce_truthy_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            if n.as_f64() == Some(0.0) {
                String::new()
            } else {
                n.to_string()
            }
        }
        Value::Bool(b) => {
            if *b {
                "True".to_string()
            } else {
                String::new()
            }
        }
        Value::Null => String::new(),
        Value::Array(a) if a.is_empty() => String::new(),
        Value::Object(o) if o.is_empty() => String::new(),
        other => other.to_string(),
    }
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

/// Python `devices.py` の `LAST_SEEN_THROTTLE_SEC` と同じ値。この間隔より
/// 短い間隔での `last_seen_at` 更新は行わない（頻繁な API/WS リクエストの
/// たびに devices.json への書き込みが走らないようにする）。
const LAST_SEEN_TOUCH_THROTTLE_SEC: u64 = 60;

pub struct Auth {
    data_dir: PathBuf,
    /// メイントークンのキャッシュ。auth.json の mtime が変わったら読み直す —
    /// 移行期間中はトークンのローテーション（Settings API = Python 側の書き込み）が
    /// 別プロセスで起きるため、起動時ロードのままだと Rust 側ルートが古いトークンで
    /// 固まる。空文字は認証無効化（auth.json 不在 or token 未設定）。
    cache: std::sync::Mutex<TokenCache>,
    trust_tailscale: bool,
    /// デバイス cookie 認証が成功するたびに Python 側 `devices.json` の
    /// `last_seen_at` を更新するブリッジ（`Proxy::touch_device`）を毎リクエスト
    /// 叩かないための、device_id ごとの直近タッチ時刻キャッシュ（プロセス内のみ、
    /// 永続化しない — Python 側の実際のスロットリングは devices.json の
    /// `last_seen_at` 自体で行われるため、こちらはネットワーク往復を間引く
    /// ためだけの近似でよい）。
    last_touch: std::sync::Mutex<HashMap<String, std::time::Instant>>,
}

impl Auth {
    pub fn load(data_dir: PathBuf, trust_tailscale: bool) -> Self {
        Self {
            data_dir,
            cache: std::sync::Mutex::new(TokenCache::default()),
            trust_tailscale,
            last_touch: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// device_id の `last_seen_at` を今タッチすべきか（前回タッチから
    /// `LAST_SEEN_TOUCH_THROTTLE_SEC` 秒以上経過しているか）を判定し、
    /// タッチする場合は直近タッチ時刻を更新する（呼び出し即座に一度だけ
    /// true を返す check-and-set — 同時リクエストが束になっても1回しか
    /// ブリッジを叩かない）。
    fn should_touch_device(&self, device_id: &str) -> bool {
        let mut last_touch = self.last_touch.lock().expect("last_touch lock poisoned");
        let now = std::time::Instant::now();
        let due = match last_touch.get(device_id) {
            Some(t) => now.duration_since(*t).as_secs() >= LAST_SEEN_TOUCH_THROTTLE_SEC,
            None => true,
        };
        if due {
            last_touch.insert(device_id.to_string(), now);
        }
        due
    }

    /// Tailscale ヘッダ信頼の opt-in 状態（起動時に確定 — Python 側のキャッシュと同じ
    /// く、変更の反映には再起動が必要）。
    pub fn trust_tailscale(&self) -> bool {
        self.trust_tailscale
    }

    /// 現在のメイントークン。auth.json の mtime を毎回 stat し、変化時のみ再読込する。
    ///
    /// 読み込み/パースに失敗した場合、一度でも正常なトークンをロード済みなら
    /// それを維持する（`load_json_file` の「失敗時は既定値」という素朴な扱いを
    /// そのまま使うと、稼働中に auth.json が一時的に壊れた/読めなくなっただけで
    /// 空トークン = 認証無効化に倒れ、全ルートが無認証で通ってしまう重大な
    /// リグレッションになる）。起動直後の初回ロード自体が失敗する場合のみ、
    /// Python 版と同じくファイル不在時と同様の「無効化」扱いにする。
    fn current_token(&self) -> String {
        let path = self.data_dir.join("auth.json");
        let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        let mut cache = self.cache.lock().expect("auth cache lock poisoned");
        if !cache.loaded || cache.mtime != mtime {
            let parsed = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok());
            match parsed {
                Some(auth) => {
                    cache.token = auth.get("token").map(coerce_truthy_str).unwrap_or_default();
                    cache.mtime = mtime;
                    cache.loaded = true;
                }
                None if cache.loaded => {
                    tracing::warn!("auth.json の再読込に失敗したため直前のトークンを維持します");
                }
                None => {
                    cache.token = String::new();
                    cache.mtime = mtime;
                    cache.loaded = true;
                }
            }
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

/// `Authorization` ヘッダの値から Bearer トークンを取り出す。FastAPI の
/// `HTTPBearer` はスキームを `scheme.lower() == "bearer"` で比較するため、
/// `bearer <token>` や `BEARER <token>` のような大小文字違いも受け付ける
/// （素朴に `strip_prefix("Bearer ")` だけだと、標準準拠のクライアントが
/// 別の大文字小文字で送ってきた場合に Rust 側だけ 401 になってしまう）。
pub fn extract_bearer_token(value: &str) -> &str {
    match value.split_once(' ') {
        Some((scheme, token)) if scheme.eq_ignore_ascii_case("bearer") => token,
        _ => "",
    }
}

/// デバイス cookie 認証が成功した際、Python 側 `devices.json` の
/// `last_seen_at` を更新するブリッジをスロットリング付きで叩く（Codex レビュー
/// 指摘: 常時 Rust ネイティブルートを使う trusted device は `/auth/check`
/// （Python proxy 経由）を再度叩かない限り `last_seen_at` が更新されず、
/// Settings > Auth で実際には使われているデバイスが stale に見えていた）。
fn maybe_touch_device(
    state: &crate::state::AppState,
    result: &AuthResult,
    cookies: &HashMap<String, String>,
) {
    if result.kind != AuthKind::Device {
        return;
    }
    let Some(device_id) = result.label.strip_prefix("device:") else {
        return;
    };
    if !state.auth.should_touch_device(device_id) {
        return;
    }
    let secret = cookies
        .get(COOKIE_DEVICE_SECRET)
        .cloned()
        .unwrap_or_default();
    state.proxy.touch_device(device_id.to_string(), secret);
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
            .map(extract_bearer_token)
            .unwrap_or("");
        let client_ip = parts
            .extensions
            .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
            .map(|ci| ci.0.ip().to_string())
            .unwrap_or_default();
        let cookies = parse_cookies(&parts.headers);
        let result = state
            .auth
            .authenticate(bearer, &client_ip, Some(&parts.headers), Some(&cookies))
            .ok_or_else(|| crate::errors::unauthorized("Invalid token"))?;
        maybe_touch_device(state, &result, &cookies);
        Ok(RequireAuth(result))
    }
}

/// WebSocket 接続用の認証チェック（Python `verify_ws_token` 相当）。
/// クエリパラメータの token・Tailscale ヘッダ・デバイス cookie のいずれかで
/// 認証できれば true（`terminal.rs`/`status_stream.rs` の WS ハンドシェイクで使う）。
pub fn verify_ws_token(
    state: &crate::state::AppState,
    token: &str,
    client_ip: &str,
    headers: &http::HeaderMap,
) -> bool {
    let cookies = parse_cookies(headers);
    let Some(result) = state
        .auth
        .authenticate(token, client_ip, Some(headers), Some(&cookies))
    else {
        return false;
    };
    maybe_touch_device(state, &result, &cookies);
    true
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
    fn numeric_token_is_coerced_not_treated_as_disabled() {
        // auth.json の token が数値（手編集・旧バージョン等）でも、Python の
        // `str(token) if token else ""` と同じく truthy な値は有効なトークンとして
        // 扱わなければならない。素朴な as_str().unwrap_or("") だと "" に落ちて
        // 認証全体が無効化されてしまう回帰があった。
        let dir = tempfile::tempdir().unwrap();
        save_json_file(&dir.path().join("auth.json"), &json!({"token": 123})).unwrap();
        let auth = Auth::load(dir.path().to_path_buf(), false);
        let r = auth.authenticate("123", "1.2.3.4", None, None).unwrap();
        assert_eq!(r.kind, AuthKind::Main);
        // 無関係な bearer や空文字では通らない（無認証化していないことの確認）。
        assert!(auth.authenticate("", "1.2.3.4", None, None).is_none());
        assert!(auth.authenticate("wrong", "1.2.3.4", None, None).is_none());
    }

    #[test]
    fn corrupt_reload_keeps_last_known_good_token() {
        // 一度でも正常なトークンをロード済みなら、稼働中に auth.json が壊れて
        // 読めなくなっても空トークン（= 認証無効化）へフォールバックしては
        // ならない。
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "good-token");
        assert!(auth
            .authenticate("good-token", "1.2.3.4", None, None)
            .is_some());

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.path().join("auth.json"), b"{not valid json").unwrap();
        let r = auth
            .authenticate("good-token", "1.2.3.4", None, None)
            .unwrap();
        assert_eq!(r.kind, AuthKind::Main);
        // 空 bearer では通らない（無認証化していないことの確認）。
        assert!(auth.authenticate("", "1.2.3.4", None, None).is_none());

        // ファイルが正しい内容に戻れば追従する。
        std::thread::sleep(std::time::Duration::from_millis(20));
        save_json_file(
            &dir.path().join("auth.json"),
            &json!({"token": "rotated-token"}),
        )
        .unwrap();
        assert!(auth
            .authenticate("good-token", "1.2.3.4", None, None)
            .is_none());
        assert!(auth
            .authenticate("rotated-token", "1.2.3.4", None, None)
            .is_some());
    }

    #[test]
    fn first_load_failure_falls_back_to_disabled_like_missing_file() {
        // 一度も正常ロードしていない状態（起動直後）での失敗は、Python 版と
        // 同じくファイル不在時と同じ「無効化」扱いにする（既存動作からの
        // 後退ではない）。
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("auth.json"), b"{not valid json").unwrap();
        let auth = Auth::load(dir.path().to_path_buf(), false);
        let r = auth.authenticate("", "1.2.3.4", None, None).unwrap();
        assert_eq!(r.kind, AuthKind::Disabled);
    }

    #[test]
    fn bearer_scheme_is_case_insensitive() {
        assert_eq!(extract_bearer_token("Bearer tkn"), "tkn");
        assert_eq!(extract_bearer_token("bearer tkn"), "tkn");
        assert_eq!(extract_bearer_token("BEARER tkn"), "tkn");
        assert_eq!(extract_bearer_token("BeArEr tkn"), "tkn");
        assert_eq!(extract_bearer_token("Basic tkn"), "");
        assert_eq!(extract_bearer_token("tkn"), "");
        assert_eq!(extract_bearer_token(""), "");
    }

    #[test]
    fn should_touch_device_throttles_repeat_calls() {
        let dir = tempfile::tempdir().unwrap();
        let auth = Auth::load(dir.path().to_path_buf(), false);
        assert!(
            auth.should_touch_device("dev_1"),
            "first call is always due"
        );
        assert!(
            !auth.should_touch_device("dev_1"),
            "immediate repeat should be throttled"
        );
        // 別デバイスは独立してスロットリングされる。
        assert!(auth.should_touch_device("dev_2"));
    }

    #[test]
    fn zero_token_is_falsy_and_disables_auth() {
        // Python 側は 0 のような falsy な数値は "" 扱いになる（token 未設定と同じ）。
        let dir = tempfile::tempdir().unwrap();
        save_json_file(&dir.path().join("auth.json"), &json!({"token": 0})).unwrap();
        let auth = Auth::load(dir.path().to_path_buf(), false);
        let r = auth.authenticate("", "1.2.3.4", None, None).unwrap();
        assert_eq!(r.kind, AuthKind::Disabled);
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
