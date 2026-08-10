//! 認証コア（Python 側 `api/auth.py` の `_authenticate` と同一の判定順・規則）。
//!
//! auth.json（メイントークン + api_tokens）の読み書きはこのファイルが担う。
//! devices.json への読み書きは `crate::devices`（`DevicesState` 経由で排他制御）
//! に委譲する。`/devices/*`・`/auth/check`・`/auth/logout`・
//! `/auth/pairing/*/claim`・`/api-tokens/*`・`/settings/auth` を Rust 側へ
//! 同時に配線した atomic cutover 以降、Rust がこれらのファイルの唯一の
//! ライターになった。

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use axum::extract::{ConnectInfo, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;

use crate::util::now_epoch;

pub const COOKIE_DEVICE_ID: &str = "any_console_device";
pub const COOKIE_DEVICE_SECRET: &str = "any_console_secret";
pub const TAILSCALE_HEADER_USER: &str = "tailscale-user-login";

/// スコープ付き API トークン（v1: "dispatch" のみ）。将来 GitHub Actions 等の外部
/// 連携から /dispatch を呼ぶ際、全 API を解錠するメイントークンをそのまま渡さない
/// ための用途限定トークン。
pub const API_TOKEN_SCOPE_DISPATCH: &str = "dispatch";
pub const API_TOKEN_MAX_NAME_LEN: usize = 80;
/// last_used 更新はリクエストのたびに auth.json を read-modify-write するため、
/// 高頻度呼び出し（CI連携等）でのディスク I/O・ロック保持時間を抑える目的で間引く。
const API_TOKEN_LAST_USED_THROTTLE_SEC: i64 = 60;

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

impl AuthResult {
    /// `AuthKind::Device` で認証された場合のみ device_id を返す（`label` は
    /// `"device:{id}"` 形式）。push通知の「その端末で今そのセッションを
    /// 見ているか」判定など、デバイス単位の状態と紐付けたい箇所で使う。
    pub fn device_id(&self) -> Option<&str> {
        if self.kind != AuthKind::Device {
            return None;
        }
        self.label.strip_prefix("device:")
    }
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

pub struct Auth {
    data_dir: PathBuf,
    /// メイントークンのキャッシュ。auth.json の mtime が変わったら読み直す —
    /// トークンのローテーションや CLI 等の別プロセスによる書き換えがあっても
    /// 古いトークンで固まらないようにする。空文字は認証無効化
    /// （auth.json 不在 or token 未設定）。
    cache: std::sync::Mutex<TokenCache>,
    trust_tailscale: bool,
    /// devices.json の排他制御（`devices.rs` の関数群と共有する）。
    devices: crate::devices::DevicesState,
    /// auth.json への書き込み（メイントークンのローテーション・api_tokens の
    /// create/revoke/last_used 更新）を直列化する（Python 版の `_auth_file_lock`
    /// と同じ設計 — 単一ファイルへの read-modify-write を保護する）。
    auth_file_lock: std::sync::Mutex<()>,
}

impl Auth {
    pub fn load(data_dir: PathBuf, trust_tailscale: bool) -> Self {
        Self {
            data_dir,
            cache: std::sync::Mutex::new(TokenCache::default()),
            trust_tailscale,
            devices: crate::devices::DevicesState::new(),
            auth_file_lock: std::sync::Mutex::new(()),
        }
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
    pub(crate) fn current_token(&self) -> String {
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

    /// このプロセスのデータディレクトリ（`devices.rs`/`pairing.rs`/API トークン
    /// ハンドラが `data_dir` を必要とするために公開する）。
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// devices.json の排他制御（`devices.rs` の関数群と共有する）。
    pub fn devices(&self) -> &crate::devices::DevicesState {
        &self.devices
    }

    /// 認証判定のコア（HTTP / WS 共通）。判定順は Python `_authenticate` と同一:
    /// 無効化 → Tailscale ヘッダ → デバイス cookie → Bearer token。
    ///
    /// デバイス cookie 認証は `devices::verify_and_touch_device` に委譲する
    /// （devices.json の read-modify-write を `DevicesState` の Mutex で
    /// 直列化する — Rust がこのファイルの唯一のライターになったため、
    /// Python 側ブリッジ経由のタッチはもう不要）。
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
            if let Some(dev) =
                crate::devices::verify_and_touch_device(&self.data_dir, &self.devices, id, secret)
            {
                let dev_id = dev.get("id").and_then(Value::as_str).unwrap_or_default();
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

    fn auth_file_path(&self) -> PathBuf {
        self.data_dir.join("auth.json")
    }

    /// auth.json 全体をロード（存在しない/壊れている場合は空オブジェクト）。
    /// `api_tokens` 等の他フィールドを保持したままトークンだけ更新するために、
    /// 呼び出し側は必ずこれをベースにマージして保存する。
    fn load_auth_file_raw(&self) -> Value {
        crate::json_store::load_json_file(
            &self.auth_file_path(),
            json!({}),
            Some(&|v: &Value| v.is_object()),
        )
    }

    fn save_auth_file_raw(&self, data: &Value) {
        if let Err(e) = crate::json_store::save_json_file(&self.auth_file_path(), data) {
            tracing::warn!("auth.json write failed: {e}");
        }
    }

    /// メイントークンをローテーションする（`api_tokens` 等の他フィールドは保持）。
    /// `current_token()` のキャッシュも即座に更新するので、直後のリクエストから
    /// 新トークンが有効になる（mtime の解像度待ちをしない）。
    pub fn update_token(&self, new_token: &str) {
        let _guard = self.auth_file_lock.lock().expect("auth_file lock poisoned");
        let mut data = self.load_auth_file_raw();
        data["token"] = json!(new_token);
        self.save_auth_file_raw(&data);
        let mtime = std::fs::metadata(self.auth_file_path())
            .and_then(|m| m.modified())
            .ok();
        let mut cache = self.cache.lock().expect("auth cache lock poisoned");
        cache.token = new_token.to_string();
        cache.mtime = mtime;
        cache.loaded = true;
    }

    fn load_api_tokens_unlocked(&self) -> Vec<Value> {
        self.load_auth_file_raw()
            .get("api_tokens")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }

    fn save_api_tokens_unlocked(&self, tokens: &[Value]) {
        let mut data = self.load_auth_file_raw();
        data["api_tokens"] = Value::Array(tokens.to_vec());
        self.save_auth_file_raw(&data);
    }

    /// 新規スコープ付き API トークンを発行する（`api/auth.py` `create_api_token`）。
    /// (secret_hash を除いたメタデータ, raw トークン) を返す。raw トークンは
    /// ここでしか取得できず、サーバには devices.json と同じ HMAC-SHA256 ハッシュ
    /// （data/server_key）のみを保存する。
    pub fn create_api_token(&self, name: &str, scope: &str) -> (Value, String) {
        let token_id = format!("tok_{}", crate::util::token_hex(8));
        let raw_token = crate::util::token_urlsafe(32);
        let hash = crate::devices::hash_secret(&self.data_dir, &self.devices, &raw_token);
        let now = now_epoch();
        let display_name = {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                "Unnamed token".to_string()
            } else {
                trimmed.chars().take(API_TOKEN_MAX_NAME_LEN).collect()
            }
        };
        let entry = json!({
            "id": token_id,
            "name": display_name,
            "scope": scope,
            "secret_hash": hash,
            "created_at": now,
            "last_used": Value::Null,
        });
        {
            let _guard = self.auth_file_lock.lock().expect("auth_file lock poisoned");
            let mut tokens = self.load_api_tokens_unlocked();
            tokens.push(entry.clone());
            self.save_api_tokens_unlocked(&tokens);
        }
        tracing::info!("api token created id={token_id} name={display_name} scope={scope}");
        (strip_api_token_secret(entry), raw_token)
    }

    /// secret_hash を除いた一覧を返す（UI 表示用）。
    pub fn list_api_tokens(&self) -> Vec<Value> {
        self.load_api_tokens_unlocked()
            .into_iter()
            .map(strip_api_token_secret)
            .collect()
    }

    pub fn get_api_token(&self, token_id: &str) -> Option<Value> {
        if token_id.is_empty() {
            return None;
        }
        self.load_api_tokens_unlocked()
            .into_iter()
            .find(|t| t.get("id").and_then(Value::as_str) == Some(token_id))
            .map(strip_api_token_secret)
    }

    pub fn revoke_api_token(&self, token_id: &str) -> bool {
        if token_id.is_empty() {
            return false;
        }
        let _guard = self.auth_file_lock.lock().expect("auth_file lock poisoned");
        let tokens = self.load_api_tokens_unlocked();
        let before = tokens.len();
        let filtered: Vec<Value> = tokens
            .into_iter()
            .filter(|t| t.get("id").and_then(Value::as_str) != Some(token_id))
            .collect();
        if filtered.len() == before {
            return false;
        }
        self.save_api_tokens_unlocked(&filtered);
        tracing::info!("api token revoked id={token_id}");
        true
    }

    /// raw_token がどれかの api_tokens エントリと一致すれば last_used を
    /// スロットリング付きで更新して返す（secret_hash を含む生の entry）。
    /// 一致しなければ None（`api/auth.py` `_verify_api_token`）。
    pub fn verify_api_token(&self, raw_token: &str) -> Option<Value> {
        if raw_token.is_empty() {
            return None;
        }
        let expected = crate::devices::hash_secret(&self.data_dir, &self.devices, raw_token);
        let _guard = self.auth_file_lock.lock().expect("auth_file lock poisoned");
        let mut tokens = self.load_api_tokens_unlocked();
        let idx = tokens.iter().position(|t| {
            let stored = t.get("secret_hash").and_then(Value::as_str).unwrap_or("");
            constant_time_eq(stored, &expected)
        })?;
        let now = now_epoch();
        let last_used = tokens[idx].get("last_used").and_then(Value::as_i64);
        if last_used.is_none_or(|t| now - t >= API_TOKEN_LAST_USED_THROTTLE_SEC) {
            if let Value::Object(ref mut entry) = tokens[idx] {
                entry.insert("last_used".to_string(), json!(now));
            }
            self.save_api_tokens_unlocked(&tokens);
        }
        Some(tokens[idx].clone())
    }
}

/// API レスポンスに `secret_hash` を漏らさないための共通フィルタ
/// （devices.rs の `strip_secret_hash` と同じ役割 — トークン用に別名で持つ）。
fn strip_api_token_secret(mut entry: Value) -> Value {
    if let Value::Object(ref mut map) = entry {
        map.remove("secret_hash");
    }
    entry
}

// ─── /api-tokens/*（`api/routers/api_tokens.py` の移植）───────────────────────
//
// すべてメイントークン認証（`RequireAuth`）のみを要求する。dispatch scope の
// API トークン自身でこれらのエンドポイントを呼ぶことはできない
// （`Auth::verify_api_token` は `POST /dispatch` にしか使わないため）。

#[derive(serde::Deserialize, Default)]
pub struct CreateApiTokenBody {
    #[serde(default)]
    pub name: String,
}

pub async fn create_api_token_route(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    _auth: RequireAuth,
    crate::util::JsonBody(body): crate::util::JsonBody<CreateApiTokenBody>,
) -> Json<Value> {
    let trimmed = body.name.trim();
    let name = if trimmed.is_empty() {
        "Unnamed token"
    } else {
        trimmed
    };
    let (mut meta, raw_token) = state.auth.create_api_token(name, API_TOKEN_SCOPE_DISPATCH);
    if let Value::Object(ref mut map) = meta {
        map.insert("token".to_string(), json!(raw_token));
    }
    Json(meta)
}

pub async fn list_api_tokens_route(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    _auth: RequireAuth,
) -> Json<Vec<Value>> {
    Json(state.auth.list_api_tokens())
}

pub async fn revoke_api_token_route(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    axum::extract::Path(token_id): axum::extract::Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, crate::errors::ApiError> {
    if !state.auth.revoke_api_token(&token_id) {
        return Err(crate::errors::not_found("API token not found"));
    }
    Ok(Json(json!({"ok": true})))
}

// ─── /settings/auth（`api/routers/settings.py` の該当部分の移植）─────────────

pub async fn get_auth_settings(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    _auth: RequireAuth,
) -> Json<Value> {
    Json(json!({"auth_required": !state.auth.current_token().is_empty()}))
}

#[derive(serde::Deserialize)]
pub struct AuthSettingsBody {
    pub enabled: bool,
    #[serde(default)]
    pub token: String,
}

const MAX_TOKEN_LENGTH: usize = 256;

pub async fn put_auth_settings(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    _auth: RequireAuth,
    crate::util::JsonBody(body): crate::util::JsonBody<AuthSettingsBody>,
) -> Result<Json<Value>, crate::errors::ApiError> {
    if body.token.chars().count() > MAX_TOKEN_LENGTH {
        return Err(crate::errors::ApiError::new(
            http::StatusCode::UNPROCESSABLE_ENTITY,
            format!("token must be at most {MAX_TOKEN_LENGTH} characters"),
        ));
    }
    let trimmed = body.token.trim();
    if body.enabled && trimmed.is_empty() {
        return Err(crate::errors::bad_request(
            "Token is required when authentication is enabled",
        ));
    }
    let new_token = if body.enabled { trimmed } else { "" };
    state.auth.update_token(new_token);
    Ok(Json(json!({"auth_required": !new_token.is_empty()})))
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
        Ok(RequireAuth(result))
    }
}

/// WebSocket 接続用の認証チェック（Python `verify_ws_token` 相当）。
/// クエリパラメータの token・Tailscale ヘッダ・デバイス cookie のいずれかで
/// 認証できれば `Some(AuthResult)`（`terminal.rs`/`status_stream.rs` の
/// WS ハンドシェイクで使う）。`status_stream.rs` は `AuthResult::device_id()`
/// で「どの端末からの接続か」を push 通知の抑制判定に使う。
pub fn verify_ws_token(
    state: &crate::state::AppState,
    token: &str,
    client_ip: &str,
    headers: &http::HeaderMap,
) -> Option<AuthResult> {
    let cookies = parse_cookies(headers);
    state
        .auth
        .authenticate(token, client_ip, Some(headers), Some(&cookies))
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

// ─── /auth/check・/auth/logout（`api/main.py` の同名ハンドラの移植）───────────

/// device cookie が無ければデバイスを登録して cookie を発行する
/// （`api/main.py` `_autoregister_device`）。cookie に既に有効な device が
/// あればそれを再利用する（`authenticate` の Tailscale 分岐は device cookie を
/// 見ないため、ここで別途チェックしないと Tailscale ログインのたびに新規
/// デバイスが増殖してしまう）。
fn autoregister_device(
    state: &crate::state::AppState,
    request_headers: &http::HeaderMap,
    cookies: &HashMap<String, String>,
    response_headers: &mut http::HeaderMap,
    source: &str,
) -> Option<Value> {
    let id = cookies
        .get(COOKIE_DEVICE_ID)
        .map(String::as_str)
        .unwrap_or("");
    let secret = cookies
        .get(COOKIE_DEVICE_SECRET)
        .map(String::as_str)
        .unwrap_or("");
    if let Some(existing) = crate::devices::verify_and_touch_device(
        &state.paths.data_dir,
        state.auth.devices(),
        id,
        secret,
    ) {
        return Some(crate::devices::strip_secret_hash(existing));
    }
    let ua = request_headers
        .get(http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let name = crate::devices::autoname_from_user_agent(ua);
    let (device_id, raw_secret) = crate::devices::find_or_register_device(
        &state.paths.data_dir,
        state.auth.devices(),
        &name,
        ua,
        source,
    );
    crate::devices::set_device_cookies(response_headers, request_headers, &device_id, &raw_secret);
    crate::devices::get_device(&state.paths.data_dir, &device_id)
}

/// `GET /auth/check`。フロントエンドの起動時セッション確認（トークン/デバイス
/// cookie/Tailscale ヘッダのいずれかで認証できればログイン状態とみなす）。
pub async fn auth_check(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    headers: http::HeaderMap,
) -> Result<Response, crate::errors::ApiError> {
    let bearer = headers
        .get(http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(extract_bearer_token)
        .unwrap_or("");
    let client_ip = addr.ip().to_string();
    let cookies = parse_cookies(&headers);
    let result = state
        .auth
        .authenticate(bearer, &client_ip, Some(&headers), Some(&cookies))
        .ok_or_else(|| crate::errors::unauthorized("Invalid token"))?;

    let mut extra_headers = http::HeaderMap::new();
    let (auth_method, tailscale_user, device) = match result.kind {
        AuthKind::Tailscale => {
            let user = result
                .label
                .strip_prefix("tailscale:")
                .unwrap_or("")
                .to_string();
            let device =
                autoregister_device(&state, &headers, &cookies, &mut extra_headers, "tailscale");
            ("tailscale", Some(user), device)
        }
        AuthKind::Device => {
            let device_id = result.device_id().unwrap_or("");
            let device = crate::devices::get_device(&state.paths.data_dir, device_id);
            ("device", None, device)
        }
        AuthKind::Main => ("token", None, None),
        AuthKind::Disabled => ("disabled", None, None),
    };

    let commit_date = crate::system::get_app_commit_date(&state.paths.project_root).await;
    let mut response = Json(json!({
        "status": "ok",
        "hostname": crate::system::hostname(),
        "commit_date": commit_date,
        "auth_method": auth_method,
        "tailscale_user": tailscale_user,
        "device": device,
    }))
    .into_response();
    response.headers_mut().extend(extra_headers);
    Ok(response)
}

/// `POST /auth/logout`。device cookie は HttpOnly なのでサーバ側でクリアする。
/// 現在の device は revoke して端末を確実にログアウトさせる（トークンを
/// 知っていれば再登録できる）。
pub async fn auth_logout(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
    headers: http::HeaderMap,
) -> Response {
    let cookies = parse_cookies(&headers);
    if let Some(device_id) = cookies.get(COOKIE_DEVICE_ID).filter(|id| !id.is_empty()) {
        crate::devices::revoke_device(&state.paths.data_dir, state.auth.devices(), device_id);
    }
    let mut response = Json(json!({"ok": true})).into_response();
    crate::devices::clear_device_cookies(response.headers_mut());
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json_store::save_json_file;
    use hmac::{Hmac, KeyInit, Mac};
    use serde_json::json;
    use sha2::Sha256;

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

    #[test]
    fn update_token_rotates_and_is_immediately_effective() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "old-token");
        assert!(auth
            .authenticate("old-token", "1.2.3.4", None, None)
            .is_some());
        auth.update_token("new-token");
        assert!(auth
            .authenticate("old-token", "1.2.3.4", None, None)
            .is_none());
        assert!(auth
            .authenticate("new-token", "1.2.3.4", None, None)
            .is_some());
    }

    #[test]
    fn update_token_preserves_other_auth_json_fields() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "old-token");
        auth.create_api_token("ci token", API_TOKEN_SCOPE_DISPATCH);
        auth.update_token("new-token");
        assert_eq!(
            auth.list_api_tokens().len(),
            1,
            "rotating token must not drop api_tokens"
        );
    }

    #[test]
    fn create_api_token_persists_and_verifies() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "main-token");
        let (meta, raw) = auth.create_api_token("CI", API_TOKEN_SCOPE_DISPATCH);
        assert!(meta.get("secret_hash").is_none());
        assert_eq!(meta["scope"], API_TOKEN_SCOPE_DISPATCH);
        let token_id = meta["id"].as_str().unwrap().to_string();
        assert!(token_id.starts_with("tok_"));

        let entry = auth.verify_api_token(&raw).expect("raw token verifies");
        assert_eq!(entry["id"], token_id);
        assert!(auth.verify_api_token("wrong").is_none());
        assert!(auth.verify_api_token("").is_none());
    }

    #[test]
    fn create_api_token_blank_name_and_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "main-token");
        let (meta, _) = auth.create_api_token("   ", API_TOKEN_SCOPE_DISPATCH);
        assert_eq!(meta["name"], "Unnamed token");

        let long_name = "n".repeat(API_TOKEN_MAX_NAME_LEN + 20);
        let (meta2, _) = auth.create_api_token(&long_name, API_TOKEN_SCOPE_DISPATCH);
        assert_eq!(
            meta2["name"].as_str().unwrap().len(),
            API_TOKEN_MAX_NAME_LEN
        );
    }

    #[test]
    fn list_and_get_api_tokens_strip_secret_hash() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "main-token");
        let (meta_a, _) = auth.create_api_token("a", API_TOKEN_SCOPE_DISPATCH);
        auth.create_api_token("b", API_TOKEN_SCOPE_DISPATCH);
        let all = auth.list_api_tokens();
        assert_eq!(all.len(), 2);
        for t in &all {
            assert!(t.get("secret_hash").is_none());
        }
        let id_a = meta_a["id"].as_str().unwrap();
        let fetched = auth.get_api_token(id_a).unwrap();
        assert!(fetched.get("secret_hash").is_none());
        assert_eq!(fetched["id"], id_a);
        assert!(auth.get_api_token("").is_none());
        assert!(auth.get_api_token("tok_missing").is_none());
    }

    #[test]
    fn revoke_api_token_removes_entry_and_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "main-token");
        let (meta, _) = auth.create_api_token("a", API_TOKEN_SCOPE_DISPATCH);
        let id = meta["id"].as_str().unwrap().to_string();
        assert!(auth.revoke_api_token(&id));
        assert!(auth.get_api_token(&id).is_none());
        assert!(!auth.revoke_api_token(&id));
        assert!(!auth.revoke_api_token(""));
    }

    #[test]
    fn verify_api_token_throttles_last_used_update() {
        let dir = tempfile::tempdir().unwrap();
        let auth = setup(&dir, "main-token");
        let (meta, raw) = auth.create_api_token("a", API_TOKEN_SCOPE_DISPATCH);
        assert_eq!(
            meta["last_used"],
            Value::Null,
            "unused token starts with no last_used"
        );

        let first = auth.verify_api_token(&raw).unwrap();
        assert!(first["last_used"].is_i64(), "first verify stamps last_used");
        let second = auth.verify_api_token(&raw).unwrap();
        // 直後の再検証は throttle 内なので last_used は変わらない。
        assert_eq!(first["last_used"], second["last_used"]);
    }
}
