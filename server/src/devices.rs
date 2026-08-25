//! Trusted Device 認証用の保存・検証ロジックと `/devices/*` エンドポイント
//! （Python 側 `api/devices.py` + `api/routers/devices.py` の移植）。
//!
//! 新規登録時はメイントークンで本人確認し、デバイスごとに固有のシークレットを
//! 発行する。クライアントは secret を HttpOnly cookie で保持し、以降の認証に使う。
//!
//! **atomic cutover**: `/devices/*`・`/auth/check`・`/auth/logout`・
//! `/auth/pairing/*/claim` を Rust 側へ同時に配線する（devices.json への
//! 書き込みが Python/Rust の両方から起きる split-brain を避けるため —
//! terminal/dispatch の移行時と同じ設計判断）。以後 Rust がこのファイルの
//! 唯一のライターになるため、排他はプロセス内 `Mutex` で足りる
//! （Python 版の `_devices_lock`/`_server_key_lock` と同じ設計 — Python 側の
//! 対応コードは Phase 6 まで削除しないが、二度と呼ばれなくなる）。
//!
//! セキュリティ:
//! - raw secret はクライアント側 cookie にしか存在しない。サーバには
//!   HMAC-SHA256 ハッシュのみ保存する。
//! - HMAC のキー（`data/server_key`）は初回書き込み時に生成し、0o600 で保護する。
//! - デバイス単位で revoke 可能。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::Json;
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::auth::{constant_time_eq, RequireAuth, COOKIE_DEVICE_ID, COOKIE_DEVICE_SECRET};
use crate::errors::{bad_request, not_found, ApiError};
use crate::json_store::load_json_file;
use crate::state::AppState;
use crate::util::{now_epoch, truncate_chars, JsonBody};

pub const MAX_NAME_LEN: usize = 80;
pub const MAX_UA_LEN: usize = 200;
/// last_seen_at 更新は cookie 認証を通るほぼ全リクエストで devices.json を
/// read-modify-write するため、高頻度アクセス時のディスク I/O・ロック保持
/// 時間を抑える目的で間引く。
pub const LAST_SEEN_THROTTLE_SEC: i64 = 60;
const COOKIE_MAX_AGE_SEC: i64 = 365 * 24 * 60 * 60;

pub struct DevicesState {
    /// devices.json の read-modify-write 全体を直列化する。
    devices_lock: Mutex<()>,
    /// HMAC 用サーバ鍵のプロセス内キャッシュ。初回解決（読み込み or 生成）を
    /// 直列化しつつ、以後は認証ホットパスでのディスク再読込を避ける。
    /// 書き込みに失敗しても同じ鍵を使い続けることで、リクエストごとに別鍵が
    /// 再生成されて全クッキー・全 API トークンが無効化される事態を防ぐ。
    server_key: OnceLock<Vec<u8>>,
}

impl Default for DevicesState {
    fn default() -> Self {
        Self {
            devices_lock: Mutex::new(()),
            server_key: OnceLock::new(),
        }
    }
}

impl DevicesState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn load_or_create_server_key<'a>(data_dir: &Path, state: &'a DevicesState) -> &'a [u8] {
    state.server_key.get_or_init(|| {
        let path = data_dir.join("server_key");
        if let Ok(existing) = std::fs::read(&path) {
            if !existing.is_empty() {
                return existing;
            }
        }
        let mut key = vec![0u8; 32];
        getrandom::fill(&mut key).expect("os rng");
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::error!("server_key dir create failed: {e}");
            }
        }
        if let Err(e) = std::fs::write(&path, &key) {
            // 永続化に失敗してもプロセス生存中はメモリ上の鍵で自己一貫させる
            //（次回起動で全デバイス再認証にはなるが、稼働中の全断は避ける）。
            tracing::error!("server_key write failed ({}): {e}", path.display());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // 書き込み失敗時はファイルが無いだけなので、権限設定の失敗は無視してよい
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        key
    })
}

/// HMAC-SHA256(data/server_key, secret) の hex（`api/devices.py` `_hash_secret`）。
/// `api_tokens`（`server/src/auth.rs`）も同じ鍵・同じハッシュ方式を共有する。
pub fn hash_secret(data_dir: &Path, state: &DevicesState, raw_secret: &str) -> String {
    let key = load_or_create_server_key(data_dir, state);
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(raw_secret.as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// API レスポンスに `secret_hash` を漏らさないための共通フィルタ。
pub fn strip_secret_hash(mut entry: Value) -> Value {
    if let Value::Object(ref mut map) = entry {
        map.remove("secret_hash");
    }
    entry
}

fn devices_path(data_dir: &Path) -> PathBuf {
    data_dir.join("devices.json")
}

fn load_unlocked(data_dir: &Path) -> Value {
    load_json_file(
        &devices_path(data_dir),
        json!({"devices": []}),
        Some(&|v: &Value| v.get("devices").is_some()),
    )
}

fn devices_array(data: &Value) -> Vec<Value> {
    data.get("devices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn save_unlocked(data_dir: &Path, data: &Value) {
    crate::json_store::save_or_warn(&devices_path(data_dir), data, "devices.json");
}

/// User-Agent から `Chrome on macOS` のような簡潔な名前を生成する
/// （`api/devices.py` `autoname_from_user_agent`）。
pub fn autoname_from_user_agent(user_agent: &str) -> String {
    let ua = user_agent.trim();
    if ua.is_empty() {
        return "Unknown device".to_string();
    }
    // iPhone/iPad は UA に "Mac OS X" を含むので Mac 判定より先に評価する（順序重要）。
    let os_name = [
        ("iPhone", "iOS"),
        ("iPad", "iPadOS"),
        ("Android", "Android"),
        ("Mac OS X", "macOS"),
        ("Macintosh", "macOS"),
        ("Windows NT", "Windows"),
        ("CrOS", "ChromeOS"),
        ("Linux", "Linux"),
    ]
    .iter()
    .find(|(needle, _)| ua.contains(needle))
    .map(|(_, name)| *name)
    .unwrap_or("Unknown OS");

    // Edge は Chrome を、Chrome は Safari を含むため順序が重要。
    let mut browser = [
        ("Edg/", "Edge"),
        ("OPR/", "Opera"),
        ("Firefox/", "Firefox"),
        ("Chrome/", "Chrome"),
        ("Safari/", "Safari"),
    ]
    .iter()
    .find(|(needle, _)| ua.contains(needle))
    .map(|(_, name)| name.to_string())
    .unwrap_or_default();

    if browser.is_empty() && matches!(os_name, "iOS" | "iPadOS") && ua.contains("Mobile/") {
        browser = "Safari".to_string();
    }
    if browser.is_empty() && os_name == "Android" {
        browser = "Android Browser".to_string();
    }
    if browser.is_empty() {
        browser = "Browser".to_string();
    }
    format!("{browser} on {os_name}")
}

fn register_locked(
    data_dir: &Path,
    state: &DevicesState,
    name: &str,
    user_agent: &str,
    source: &str,
) -> (String, String) {
    let device_id = format!("dev_{}", crate::util::token_hex(8));
    let raw_secret = crate::util::token_urlsafe(32);
    let now = now_epoch();
    let hash = hash_secret(data_dir, state, &raw_secret);
    let mut data = load_unlocked(data_dir);
    let mut devices = devices_array(&data);
    let display_name = if name.trim().is_empty() {
        "Unnamed device".to_string()
    } else {
        truncate_chars(name, MAX_NAME_LEN)
    };
    devices.push(json!({
        "id": device_id,
        "name": display_name,
        "secret_hash": hash,
        "user_agent": truncate_chars(user_agent, MAX_UA_LEN),
        "source": source,
        "created_at": now,
        "last_seen_at": now,
    }));
    data["devices"] = Value::Array(devices);
    save_unlocked(data_dir, &data);
    tracing::info!("device registered id={device_id} name={display_name} source={source}");
    (device_id, raw_secret)
}

/// 新デバイスを登録し (device_id, raw_secret) を返す。raw_secret はサーバに
/// 保存せず、戻り値経由でのみクライアントに渡す。`source` は登録経路
/// （"token" / "tailscale" / "pairing"）— UI 表示と運用判断用。
pub fn register_device(
    data_dir: &Path,
    state: &DevicesState,
    name: &str,
    user_agent: &str,
    source: &str,
) -> (String, String) {
    let _guard = state.devices_lock.lock().expect("devices lock poisoned");
    register_locked(data_dir, state, name, user_agent, source)
}

/// device_id + raw_secret が登録済みデバイスと一致すれば dict を返す
/// （secret_hash を含む生の entry）。一致した場合は last_seen_at を
/// スロットリング付きで更新する（Python `verify_and_touch_device`）。
pub fn verify_and_touch_device(
    data_dir: &Path,
    state: &DevicesState,
    device_id: &str,
    raw_secret: &str,
) -> Option<Value> {
    if device_id.is_empty() || raw_secret.is_empty() {
        return None;
    }
    let expected = hash_secret(data_dir, state, raw_secret);
    let _guard = state.devices_lock.lock().expect("devices lock poisoned");
    let mut data = load_unlocked(data_dir);
    let mut devices = devices_array(&data);
    let idx = devices
        .iter()
        .position(|d| d.get("id").and_then(Value::as_str) == Some(device_id))?;
    let stored = devices[idx]
        .get("secret_hash")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !constant_time_eq(stored, &expected) {
        return None;
    }
    let now = now_epoch();
    let last_seen_at = devices[idx].get("last_seen_at").and_then(Value::as_i64);
    if last_seen_at.is_none_or(|t| now - t >= LAST_SEEN_THROTTLE_SEC) {
        if let Value::Object(ref mut entry) = devices[idx] {
            entry.insert("last_seen_at".to_string(), json!(now));
        }
        data["devices"] = Value::Array(devices.clone());
        save_unlocked(data_dir, &data);
    }
    Some(devices[idx].clone())
}

pub fn revoke_device(data_dir: &Path, state: &DevicesState, device_id: &str) -> bool {
    if device_id.is_empty() {
        return false;
    }
    let _guard = state.devices_lock.lock().expect("devices lock poisoned");
    let mut data = load_unlocked(data_dir);
    let devices = devices_array(&data);
    let before = devices.len();
    let filtered: Vec<Value> = devices
        .into_iter()
        .filter(|d| d.get("id").and_then(Value::as_str) != Some(device_id))
        .collect();
    if filtered.len() == before {
        return false;
    }
    data["devices"] = Value::Array(filtered);
    save_unlocked(data_dir, &data);
    tracing::info!("device revoked id={device_id}");
    true
}

/// `secret_hash` を除いた一覧を返す（UI 表示用）。
pub fn list_devices(data_dir: &Path) -> Vec<Value> {
    devices_array(&load_unlocked(data_dir))
        .into_iter()
        .map(strip_secret_hash)
        .collect()
}

pub fn get_device(data_dir: &Path, device_id: &str) -> Option<Value> {
    if device_id.is_empty() {
        return None;
    }
    devices_array(&load_unlocked(data_dir))
        .into_iter()
        .find(|d| d.get("id").and_then(Value::as_str) == Some(device_id))
        .map(strip_secret_hash)
}

// ─── cookie ヘルパー ─────────────────────────────────────────────────────────

/// 本番運用では Tailscale Serve が TLS を終端して plain HTTP でこのプロセスへ
/// 転送するため（README の HTTPS セットアップ参照）、Python 版が
/// `request.url.scheme` で判定していたのと同じく、アプリ自身が直接 TLS を
/// 終端しない限り常に non-secure 扱いになる（Python 版も本番では
/// `--proxy-headers` を使わないため同じ挙動）。
fn cookie_is_secure(_headers: &HeaderMap) -> bool {
    false
}

fn set_cookie_header(name: &str, value: &str, max_age_sec: i64, secure: bool) -> HeaderValue {
    let mut cookie =
        format!("{name}={value}; Max-Age={max_age_sec}; Path=/; HttpOnly; SameSite=Strict");
    if secure {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).unwrap_or_else(|_| HeaderValue::from_static(""))
}

pub fn set_device_cookies(
    headers: &mut HeaderMap,
    request_headers: &HeaderMap,
    device_id: &str,
    raw_secret: &str,
) {
    let secure = cookie_is_secure(request_headers);
    headers.append(
        header::SET_COOKIE,
        set_cookie_header(COOKIE_DEVICE_ID, device_id, COOKIE_MAX_AGE_SEC, secure),
    );
    headers.append(
        header::SET_COOKIE,
        set_cookie_header(COOKIE_DEVICE_SECRET, raw_secret, COOKIE_MAX_AGE_SEC, secure),
    );
}

pub fn clear_device_cookies(headers: &mut HeaderMap) {
    headers.append(
        header::SET_COOKIE,
        set_cookie_header(COOKIE_DEVICE_ID, "", 0, false),
    );
    headers.append(
        header::SET_COOKIE,
        set_cookie_header(COOKIE_DEVICE_SECRET, "", 0, false),
    );
}

// ─── HTTP エンドポイント ─────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
pub struct RegisterBody {
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub name: String,
}

/// `POST /devices/register`。登録には現行メイントークンが必須（共有トークンを
/// 知っている人だけが新端末登録可能）。raw secret は Set-Cookie のみで返す。
pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<RegisterBody>,
) -> Result<Response, ApiError> {
    let main_token = state.auth.current_token();
    if main_token.is_empty() {
        return Ok(Json(json!({
            "ok": true, "device_id": Value::Null, "name": Value::Null, "auth_required": false,
        }))
        .into_response());
    }
    if body.token.is_empty() || !constant_time_eq(&body.token, &main_token) {
        return Err(crate::errors::unauthorized("Invalid token"));
    }
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let name = {
        let trimmed = body.name.trim();
        if trimmed.is_empty() {
            autoname_from_user_agent(ua)
        } else {
            trimmed.to_string()
        }
    };
    let name = if name.trim().is_empty() {
        "Unknown device".to_string()
    } else {
        name
    };
    let (device_id, raw_secret) = register_device(
        &state.paths.data_dir,
        state.auth.devices(),
        &name,
        ua,
        "token",
    );
    let mut response = Json(json!({
        "ok": true, "device_id": device_id, "name": name, "auth_required": true,
    }))
    .into_response();
    set_device_cookies(response.headers_mut(), &headers, &device_id, &raw_secret);
    Ok(response)
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    _auth: RequireAuth,
) -> Json<Vec<Value>> {
    let current_id = crate::auth::parse_cookies(&headers)
        .get(COOKIE_DEVICE_ID)
        .cloned()
        .unwrap_or_default();
    let mut devices = list_devices(&state.paths.data_dir);
    for d in &mut devices {
        if let Value::Object(ref mut map) = d {
            let is_current = map.get("id").and_then(Value::as_str) == Some(current_id.as_str())
                && !current_id.is_empty();
            map.insert("current".to_string(), json!(is_current));
        }
    }
    Json(devices)
}

pub async fn revoke(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
    headers: HeaderMap,
    _auth: RequireAuth,
) -> Result<Response, ApiError> {
    if get_device(&state.paths.data_dir, &device_id).is_none() {
        return Err(not_found("Device not found"));
    }
    if !revoke_device(&state.paths.data_dir, state.auth.devices(), &device_id) {
        return Err(bad_request("Failed to revoke device"));
    }
    let mut response = Json(json!({"ok": true})).into_response();
    let current_id = crate::auth::parse_cookies(&headers)
        .get(COOKIE_DEVICE_ID)
        .cloned()
        .unwrap_or_default();
    if current_id == device_id {
        clear_device_cookies(response.headers_mut());
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autoname_covers_common_user_agents() {
        assert_eq!(
            autoname_from_user_agent(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
            "Safari on iOS"
        );
        assert_eq!(
            autoname_from_user_agent(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Chrome on macOS"
        );
        assert_eq!(
            autoname_from_user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
            ),
            "Edge on Windows"
        );
        assert_eq!(
            autoname_from_user_agent(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Chrome on Linux"
        );
        assert_eq!(
            autoname_from_user_agent(
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            ),
            "Chrome on Android"
        );
        assert_eq!(autoname_from_user_agent(""), "Unknown device");
        assert_eq!(autoname_from_user_agent("   "), "Unknown device");
        assert_eq!(
            autoname_from_user_agent("some-weird-agent"),
            "Browser on Unknown OS"
        );
    }

    #[test]
    fn hash_secret_matches_python_hmac_scheme() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let key: Vec<u8> = (0u8..32).collect();
        std::fs::write(dir.path().join("server_key"), &key).unwrap();
        let hash = hash_secret(dir.path(), &state, "raw-secret");

        let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
        mac.update(b"raw-secret");
        let expected: String = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(hash, expected);
    }

    #[test]
    fn hash_secret_creates_server_key_with_owner_only_perms() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        assert!(!dir.path().join("server_key").exists());
        let h1 = hash_secret(dir.path(), &state, "s1");
        let key_path = dir.path().join("server_key");
        assert!(key_path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&key_path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        // 同じキーが再利用されるので同じ secret から同じ hash が出る。
        let h2 = hash_secret(dir.path(), &state, "s1");
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_secret_uses_in_process_cache_after_first_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let h1 = hash_secret(dir.path(), &state, "s1");
        // ファイルが消えても（= 再書き込みできない状況でも）プロセス内
        // キャッシュの鍵で同じ hash が出続けること。
        std::fs::remove_file(dir.path().join("server_key")).unwrap();
        let h2 = hash_secret(dir.path(), &state, "s1");
        assert_eq!(h1, h2);
        assert!(!dir.path().join("server_key").exists());
    }

    #[test]
    fn strip_secret_hash_removes_field_only() {
        let entry = json!({"id": "dev_1", "secret_hash": "abc", "name": "x"});
        let stripped = strip_secret_hash(entry);
        assert!(stripped.get("secret_hash").is_none());
        assert_eq!(stripped["id"], "dev_1");
        assert_eq!(stripped["name"], "x");
    }

    #[test]
    fn register_device_persists_and_hash_verifies() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let (device_id, raw_secret) =
            register_device(dir.path(), &state, "My Phone", "some-ua", "token");
        assert!(device_id.starts_with("dev_"));
        assert!(!raw_secret.is_empty());

        let stored = get_device(dir.path(), &device_id).expect("device saved");
        assert_eq!(stored["name"], "My Phone");
        assert_eq!(stored["source"], "token");
        assert!(
            stored.get("secret_hash").is_none(),
            "get_device strips hash"
        );

        let dev = verify_and_touch_device(dir.path(), &state, &device_id, &raw_secret)
            .expect("secret verifies");
        assert_eq!(dev["id"], device_id);
    }

    #[test]
    fn register_device_truncates_overlong_name_and_ua() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let long_name = "n".repeat(MAX_NAME_LEN + 50);
        let long_ua = "u".repeat(MAX_UA_LEN + 50);
        let (device_id, _) = register_device(dir.path(), &state, &long_name, &long_ua, "token");
        let stored = get_device(dir.path(), &device_id).unwrap();
        assert_eq!(stored["name"].as_str().unwrap().len(), MAX_NAME_LEN);
        assert_eq!(stored["user_agent"].as_str().unwrap().len(), MAX_UA_LEN);
    }

    #[test]
    fn register_device_blank_name_becomes_unnamed() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let (device_id, _) = register_device(dir.path(), &state, "   ", "ua", "token");
        let stored = get_device(dir.path(), &device_id).unwrap();
        assert_eq!(stored["name"], "Unnamed device");
    }

    #[test]
    fn verify_and_touch_device_rejects_wrong_secret_or_missing_id() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let (device_id, raw_secret) = register_device(dir.path(), &state, "n", "ua", "token");
        assert!(verify_and_touch_device(dir.path(), &state, &device_id, "wrong").is_none());
        assert!(verify_and_touch_device(dir.path(), &state, "dev_missing", &raw_secret).is_none());
        assert!(verify_and_touch_device(dir.path(), &state, "", "").is_none());
    }

    #[test]
    fn verify_and_touch_device_throttles_last_seen_update() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let (device_id, raw_secret) = register_device(dir.path(), &state, "n", "ua", "token");

        // 直後の再検証では last_seen_at は変わらない（スロットル内）。
        let before = get_device(dir.path(), &device_id).unwrap()["last_seen_at"]
            .as_i64()
            .unwrap();
        verify_and_touch_device(dir.path(), &state, &device_id, &raw_secret).unwrap();
        let after = get_device(dir.path(), &device_id).unwrap()["last_seen_at"]
            .as_i64()
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn revoke_device_removes_entry_and_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        let (device_id, _) = register_device(dir.path(), &state, "n", "ua", "token");
        assert!(revoke_device(dir.path(), &state, &device_id));
        assert!(get_device(dir.path(), &device_id).is_none());
        assert!(!revoke_device(dir.path(), &state, &device_id));
        assert!(!revoke_device(dir.path(), &state, ""));
    }

    #[test]
    fn list_and_get_devices_strip_secret_hash() {
        let dir = tempfile::tempdir().unwrap();
        let state = DevicesState::new();
        register_device(dir.path(), &state, "a", "ua", "token");
        register_device(dir.path(), &state, "b", "ua", "token");
        let all = list_devices(dir.path());
        assert_eq!(all.len(), 2);
        for d in &all {
            assert!(d.get("secret_hash").is_none());
        }
        assert!(get_device(dir.path(), "").is_none());
    }

    #[test]
    fn set_and_clear_device_cookies_produce_expected_headers() {
        let mut headers = HeaderMap::new();
        let request_headers = HeaderMap::new();
        set_device_cookies(&mut headers, &request_headers, "dev_1", "raw-secret");
        let cookies: Vec<&str> = headers
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap())
            .collect();
        assert_eq!(cookies.len(), 2);
        assert!(cookies[0].starts_with(
            "any_console_device=dev_1; Max-Age=31536000; Path=/; HttpOnly; SameSite=Strict"
        ));
        assert!(!cookies[0].contains("Secure"));
        assert!(cookies[1].starts_with("any_console_secret=raw-secret;"));

        let mut clear_headers = HeaderMap::new();
        clear_device_cookies(&mut clear_headers);
        let cleared: Vec<&str> = clear_headers
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap())
            .collect();
        assert_eq!(cleared.len(), 2);
        assert!(cleared[0].contains("Max-Age=0"));
        assert!(cleared[1].contains("Max-Age=0"));
    }
}
