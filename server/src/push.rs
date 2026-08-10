//! Web Push 通知（Python 側 `api/push.py` + `api/routers/push.py` の移植）。
//!
//! VAPID（RFC 8292、ES256 JWT 署名）と本文暗号化（RFC 8291、`aes128gcm`
//! content-coding）を pure-Rust の RustCrypto ファミリ（`p256`/`aes-gcm`/`hkdf`）
//! だけで実装する。このプロジェクトは TLS/暗号を rustls・RustCrypto 系で統一して
//! おり（`tokio-rustls`・`hmac`・`sha2` 等）、OpenSSL（`openssl-sys`）や libcurl
//! （`isahc`/`curl-sys`）に依存する `web-push`/`ece` クレートは、クロスコンパイル
//! （Phase 6 で計画する Linux x86_64/aarch64・macOS arm64/x86_64 配布）の複雑化を
//! 避けるため意図的に採用しなかった。
//!
//! RFC 8291 の鍵導出（HKDF チェーン: PRK_key → IKM → PRK → CEK/NONCE）は、
//! Appendix A の worked example における中間値（ECDH 共有鍵・PRK_key・IKM・PRK・
//! CEK・NONCE）と完全一致することをユニットテストで検証済み
//! （`tests::rfc8291_key_derivation_matches_appendix_a_intermediate_values`）。
//!
//! 秘密鍵は 32 byte の生スカラー値、公開鍵は 65 byte の非圧縮 EC ポイントを、
//! それぞれ base64url（パディング無し）でファイルに保存する。この形式は
//! Python 版（`cryptography` ライブラリの `private_value`/`UncompressedPoint`
//! エンコーディング）と完全に同一のため、Python が既に作成済みの
//! `data/vapid_private.txt`/`vapid_public.txt` をそのまま読み込める
//! （鍵のローテーションが起きず、既存の購読ブラウザが再購読不要のまま移行できる）。

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::Aead;
use aes_gcm::{Aes128Gcm, KeyInit as AesKeyInit, Nonce};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use hkdf::Hkdf;
use p256::ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use p256::elliptic_curve::sec1::ToSec1Point;
use p256::{PublicKey, SecretKey};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::auth::RequireAuth;
use crate::errors::{service_unavailable, ApiError};
use crate::state::AppState;
use crate::util::{base64url_decode, base64url_encode, now_epoch, JsonBody};

/// VAPID JWT の有効期限（RFC 8292 は 24 時間以内を要求。pywebpush/py_vapid の
/// 既定値と同じ 12 時間にする）。
const VAPID_JWT_TTL_SEC: i64 = 12 * 60 * 60;
/// Push メッセージの TTL（プッシュサービス側の再送猶予、秒）。
const PUSH_MESSAGE_TTL_SEC: &str = "60";
/// `aes128gcm` content-coding のレコードサイズ（単一レコードのみ使うため、
/// メッセージ全体より大きければ何でもよい。RFC 8291 の例と同じ値）。
const RECORD_SIZE: u32 = 4096;
const DEFAULT_VAPID_SUB: &str = "https://localhost";

fn vapid_private_path(data_dir: &Path) -> PathBuf {
    data_dir.join("vapid_private.txt")
}
fn vapid_public_path(data_dir: &Path) -> PathBuf {
    data_dir.join("vapid_public.txt")
}
fn vapid_sub_path(data_dir: &Path) -> PathBuf {
    data_dir.join("vapid_sub.txt")
}
fn subscriptions_path(data_dir: &Path) -> PathBuf {
    data_dir.join("push_subscriptions.json")
}

struct VapidKeys {
    signing_key: SigningKey,
    public_key_b64: String,
}

/// P-256 のキーペアを新規生成する（32 byte 生乱数がスカラーとして不正な確率は
/// 無視できるほど小さいが、防御的にリトライする）。
fn generate_p256_keypair() -> (SecretKey, [u8; 32]) {
    loop {
        let mut raw = [0u8; 32];
        if getrandom::fill(&mut raw).is_err() {
            continue;
        }
        if let Ok(secret) = SecretKey::from_slice(&raw) {
            return (secret, raw);
        }
    }
}

fn encoded_public_key(secret: &SecretKey) -> Vec<u8> {
    secret.public_key().to_sec1_point(false).as_bytes().to_vec()
}

fn load_or_create_vapid_keys(data_dir: &Path) -> Option<VapidKeys> {
    std::fs::create_dir_all(data_dir).ok()?;
    let priv_path = vapid_private_path(data_dir);
    let pub_path = vapid_public_path(data_dir);
    if let (Ok(priv_text), Ok(pub_text)) = (
        std::fs::read_to_string(&priv_path),
        std::fs::read_to_string(&pub_path),
    ) {
        if let Some(raw) = base64url_decode(priv_text.trim()) {
            if let Ok(secret) = SecretKey::from_slice(&raw) {
                return Some(VapidKeys {
                    signing_key: SigningKey::from(&secret),
                    public_key_b64: pub_text.trim().to_string(),
                });
            }
        }
        tracing::warn!("vapid key files unreadable, regenerating");
    }
    let (secret, raw) = generate_p256_keypair();
    let public_key_b64 = base64url_encode(&encoded_public_key(&secret));
    let private_key_b64 = base64url_encode(&raw);
    std::fs::write(&priv_path, &private_key_b64).ok()?;
    std::fs::write(&pub_path, &public_key_b64).ok()?;
    tracing::info!("VAPID keys generated");
    Some(VapidKeys {
        signing_key: SigningKey::from(&secret),
        public_key_b64,
    })
}

fn load_vapid_sub(data_dir: &Path) -> String {
    std::fs::read_to_string(vapid_sub_path(data_dir))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_VAPID_SUB.to_string())
}

/// VAPID の `sub` claim（連絡先 URL）を更新してファイルに永続化する。
pub fn set_vapid_sub(data_dir: &Path, sub: &str) {
    if std::fs::create_dir_all(data_dir).is_err() {
        return;
    }
    if std::fs::write(vapid_sub_path(data_dir), sub).is_ok() {
        tracing::info!("VAPID sub updated: {sub}");
    }
}

pub struct PushState {
    subscriptions_lock: Mutex<()>,
    vapid: OnceLock<Option<VapidKeys>>,
    client: reqwest::Client,
}

impl Default for PushState {
    fn default() -> Self {
        Self {
            subscriptions_lock: Mutex::new(()),
            vapid: OnceLock::new(),
            // push サービス（fcm.googleapis.com 等）は外部インターネット上のため、
            // migration_bridge 用クライアント（proxy.rs、no_proxy 固定）とは違い、
            // 環境のプロキシ設定にはそのまま従わせる（既定の reqwest::Client）。
            client: reqwest::Client::new(),
        }
    }
}

impl PushState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn vapid_keys<'a>(push: &'a PushState, data_dir: &Path) -> Option<&'a VapidKeys> {
    push.vapid
        .get_or_init(|| load_or_create_vapid_keys(data_dir))
        .as_ref()
}

/// VAPID 公開鍵を返す（push が利用不可ならエラー）。
pub fn get_vapid_public_key(push: &PushState, data_dir: &Path) -> Option<String> {
    vapid_keys(push, data_dir).map(|k| k.public_key_b64.clone())
}

fn load_subscriptions(data_dir: &Path) -> Vec<Value> {
    crate::json_store::load_json_file(&subscriptions_path(data_dir), json!([]), None)
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn save_subscriptions(data_dir: &Path, subs: &[Value]) {
    if let Err(e) = crate::json_store::save_json_file(&subscriptions_path(data_dir), &json!(subs)) {
        tracing::warn!("push_subscriptions.json write failed: {e}");
    }
}

pub fn has_subscriptions(data_dir: &Path) -> bool {
    !load_subscriptions(data_dir).is_empty()
}

pub fn add_subscription(state: &std::sync::Arc<AppState>, sub: Value) {
    let endpoint = sub
        .get("endpoint")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    {
        let _guard = state
            .push
            .subscriptions_lock
            .lock()
            .expect("push lock poisoned");
        let mut subs = load_subscriptions(&state.paths.data_dir);
        subs.retain(|s| s.get("endpoint").and_then(Value::as_str) != Some(endpoint.as_str()));
        subs.push(sub);
        save_subscriptions(&state.paths.data_dir, &subs);
    }
    tracing::info!("push subscription added endpoint={endpoint}");
    crate::agent_watch::ensure_tasks(state);
}

pub fn remove_subscription(push: &PushState, data_dir: &Path, endpoint: &str) {
    let _guard = push.subscriptions_lock.lock().expect("push lock poisoned");
    let mut subs = load_subscriptions(data_dir);
    let before = subs.len();
    subs.retain(|s| s.get("endpoint").and_then(Value::as_str) != Some(endpoint));
    if subs.len() != before {
        save_subscriptions(data_dir, &subs);
        tracing::info!("push subscription removed endpoint={endpoint}");
    }
}

fn remove_subscriptions_by_endpoints(push: &PushState, data_dir: &Path, endpoints: &[String]) {
    if endpoints.is_empty() {
        return;
    }
    let _guard = push.subscriptions_lock.lock().expect("push lock poisoned");
    let mut subs = load_subscriptions(data_dir);
    subs.retain(|s| {
        let ep = s.get("endpoint").and_then(Value::as_str).unwrap_or("");
        !endpoints.iter().any(|e| e == ep)
    });
    save_subscriptions(data_dir, &subs);
}

// ─── VAPID JWT（RFC 8292） ───────────────────────────────────────────────────

fn vapid_jwt(signing_key: &SigningKey, aud: &str, sub: &str, now: i64) -> String {
    let header = json!({"typ": "JWT", "alg": "ES256"}).to_string();
    let claims = json!({"aud": aud, "exp": now + VAPID_JWT_TTL_SEC, "sub": sub}).to_string();
    let signing_input = format!(
        "{}.{}",
        base64url_encode(header.as_bytes()),
        base64url_encode(claims.as_bytes())
    );
    let signature: Signature = signing_key.sign(signing_input.as_bytes());
    format!(
        "{signing_input}.{}",
        base64url_encode(&signature.to_bytes())
    )
}

fn vapid_authorization_header(keys: &VapidKeys, aud: &str, sub: &str) -> String {
    let jwt = vapid_jwt(&keys.signing_key, aud, sub, now_epoch());
    format!("vapid t={jwt}, k={}", keys.public_key_b64)
}

// ─── 本文暗号化（RFC 8291 `aes128gcm`） ──────────────────────────────────────

/// 購読者の公開鍵（p256dh）・認証シークレット（auth）に対して、平文を RFC 8291
/// `aes128gcm` content-coding で暗号化する。呼び出しごとに新しい ephemeral な
/// アプリケーションサーバ鍵ペアと salt を生成する（VAPID 鍵とは無関係 — VAPID は
/// Authorization ヘッダの JWT 署名にのみ使う別の鍵）。
fn encrypt_aes128gcm(plaintext: &[u8], p256dh_b64: &str, auth_b64: &str) -> Option<Vec<u8>> {
    let ua_public_bytes = base64url_decode(p256dh_b64)?;
    if ua_public_bytes.len() != 65 {
        return None;
    }
    let auth_secret = base64url_decode(auth_b64)?;
    let ua_public = PublicKey::from_sec1_bytes(&ua_public_bytes).ok()?;

    let (as_secret, _) = generate_p256_keypair();
    let as_public_bytes = encoded_public_key(&as_secret);

    let shared = p256::ecdh::diffie_hellman(as_secret.to_nonzero_scalar(), ua_public.as_affine());
    let ecdh_secret = shared.raw_secret_bytes();

    // Step 1: PRK_key = HKDF-Extract(salt=auth_secret, ikm=ecdh_secret)
    let (_prk_key, hk1) = Hkdf::<Sha256>::extract(Some(&auth_secret), ecdh_secret.as_slice());
    let mut key_info = Vec::with_capacity(14 + 65 + 65);
    key_info.extend_from_slice(b"WebPush: info\0");
    key_info.extend_from_slice(&ua_public_bytes);
    key_info.extend_from_slice(&as_public_bytes);
    let mut ikm = [0u8; 32];
    hk1.expand(&key_info, &mut ikm).ok()?;

    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).ok()?;
    // Step 2: PRK = HKDF-Extract(salt=salt, ikm=IKM)
    let (_prk, hk2) = Hkdf::<Sha256>::extract(Some(&salt), &ikm);
    let mut cek = [0u8; 16];
    hk2.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .ok()?;
    let mut nonce_bytes = [0u8; 12];
    hk2.expand(b"Content-Encoding: nonce\0", &mut nonce_bytes)
        .ok()?;

    // 単一レコード（最後かつ唯一のレコード）: 平文 || 0x02 パディング区切り。
    let mut record = Vec::with_capacity(plaintext.len() + 1);
    record.extend_from_slice(plaintext);
    record.push(0x02);

    let cipher = Aes128Gcm::new_from_slice(&cek).ok()?;
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher.encrypt(&nonce, record.as_ref()).ok()?;

    // ヘッダ: salt(16) || rs(4, big-endian) || idlen(1) || keyid(as_public, 65)
    let mut out = Vec::with_capacity(16 + 4 + 1 + as_public_bytes.len() + ciphertext.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    out.push(as_public_bytes.len() as u8);
    out.extend_from_slice(&as_public_bytes);
    out.extend_from_slice(&ciphertext);
    Some(out)
}

// ─── 送信 ─────────────────────────────────────────────────────────────────

enum DeliveryOutcome {
    Delivered,
    /// 404/410（購読失効）・400（VAPID 鍵不一致）— 恒久的に無効。購読を削除する。
    PermanentlyInvalid,
    /// それ以外（ネットワークエラー・一時的な 5xx・ローカルでの暗号化失敗等）。
    /// ログのみで購読は保持する（Python 版の broad `except Exception` と同じ扱い）。
    Transient,
}

async fn deliver(
    client: &reqwest::Client,
    sub: &Value,
    keys: &VapidKeys,
    vapid_sub: &str,
    payload: &[u8],
) -> DeliveryOutcome {
    let endpoint = sub.get("endpoint").and_then(Value::as_str).unwrap_or("");
    let Ok(url) = url::Url::parse(endpoint) else {
        tracing::warn!("push error: invalid endpoint url");
        return DeliveryOutcome::Transient;
    };
    let p256dh = sub
        .get("keys")
        .and_then(|k| k.get("p256dh"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let auth = sub
        .get("keys")
        .and_then(|k| k.get("auth"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let Some(body) = encrypt_aes128gcm(payload, p256dh, auth) else {
        tracing::warn!("push error: failed to encrypt payload for endpoint={endpoint}");
        return DeliveryOutcome::Transient;
    };
    let aud = url.origin().ascii_serialization();
    let authorization = vapid_authorization_header(keys, &aud, vapid_sub);

    let result = client
        .post(endpoint)
        .header("Authorization", authorization)
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .header("TTL", PUSH_MESSAGE_TTL_SEC)
        .body(body)
        .send()
        .await;
    match result {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                DeliveryOutcome::Delivered
            } else if matches!(status.as_u16(), 400 | 404 | 410) {
                tracing::warn!("push failed endpoint={endpoint} status={status}");
                DeliveryOutcome::PermanentlyInvalid
            } else {
                tracing::warn!("push failed endpoint={endpoint} status={status}");
                DeliveryOutcome::Transient
            }
        }
        Err(e) => {
            tracing::warn!("push error endpoint={endpoint}: {e}");
            DeliveryOutcome::Transient
        }
    }
}

/// このsubscriptionへの送信を、閲覧中を理由にスキップすべきか。
/// `session_id`が無い（閲覧と無関係な通知）か、subscriptionにdevice_idが
/// 無い（デバイス認証を経ていない購読）場合は常にfalse（送信する）。
fn should_skip_for_viewing(
    sub: &Value,
    session_id: Option<&str>,
    status_stream: &crate::status_stream::StatusStreamState,
) -> bool {
    let Some(session_id) = session_id else {
        return false;
    };
    sub.get("device_id")
        .and_then(Value::as_str)
        .is_some_and(|device_id| status_stream.is_device_viewing(device_id, session_id))
}

/// 全サブスクリプションへ Push 通知を送信する（`api/push.py` `send_push_notification`）。
///
/// `session_id` を渡すと、そのセッションを今まさに見ている端末（購読時に
/// 記録した `device_id` と `StatusStreamState::is_device_viewing` で判定）
/// への送信だけをスキップする。dispatch通知等セッション閲覧と無関係な
/// 通知は `session_id: None` で呼び、全購読へ通常通り送る。
pub async fn send_push_notification(
    state: &std::sync::Arc<AppState>,
    title: &str,
    body: &str,
    url_path: &str,
    notif_type: &str,
    session_id: Option<&str>,
) {
    let Some(keys) = vapid_keys(&state.push, &state.paths.data_dir) else {
        return;
    };
    let subs = load_subscriptions(&state.paths.data_dir);
    if subs.is_empty() {
        return;
    }
    let vapid_sub = load_vapid_sub(&state.paths.data_dir);
    let payload =
        json!({"title": title, "body": body, "url": url_path, "type": notif_type}).to_string();

    let mut failed_endpoints = Vec::new();
    for sub in &subs {
        if should_skip_for_viewing(sub, session_id, &state.status_stream) {
            continue;
        }
        let outcome = deliver(
            &state.push.client,
            sub,
            keys,
            &vapid_sub,
            payload.as_bytes(),
        )
        .await;
        if let DeliveryOutcome::PermanentlyInvalid = outcome {
            if let Some(endpoint) = sub.get("endpoint").and_then(Value::as_str) {
                failed_endpoints.push(endpoint.to_string());
            }
        }
    }
    remove_subscriptions_by_endpoints(&state.push, &state.paths.data_dir, &failed_endpoints);
}

// ─── HTTP エンドポイント（`api/routers/push.py` の移植） ─────────────────────

pub async fn vapid_public_key_route(
    State(state): State<std::sync::Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    match get_vapid_public_key(&state.push, &state.paths.data_dir) {
        Some(key) => Ok(Json(json!({"publicKey": key}))),
        None => Err(service_unavailable(
            "Push notifications are not available on this server",
        )),
    }
}

/// Origin / Referer ヘッダからスキーム＋ホスト（ポート除く）を取り出す
/// （`api/routers/push.py` `_extract_sub` と同じ正規表現 `(https?://[^/:]+)` を
/// 手書きパースで再現 — ポート番号は意図的に含めない）。
fn extract_sub_origin(headers: &HeaderMap) -> Option<String> {
    let origin = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get(axum::http::header::REFERER)
                .and_then(|v| v.to_str().ok())
        })
        .unwrap_or("");
    let (scheme, rest) = if let Some(r) = origin.strip_prefix("https://") {
        ("https", r)
    } else {
        let r = origin.strip_prefix("http://")?;
        ("http", r)
    };
    let host_end = rest.find(['/', ':']).unwrap_or(rest.len());
    if host_end == 0 {
        return None;
    }
    Some(format!("{scheme}://{}", &rest[..host_end]))
}

#[derive(Deserialize)]
pub struct PushSubscriptionBody {
    pub endpoint: String,
    pub keys: Value,
}

pub async fn subscribe_route(
    State(state): State<std::sync::Arc<AppState>>,
    auth: RequireAuth,
    headers: HeaderMap,
    JsonBody(body): JsonBody<PushSubscriptionBody>,
) -> Json<Value> {
    if let Some(detected) = extract_sub_origin(&headers) {
        set_vapid_sub(&state.paths.data_dir, &detected);
        tracing::info!("push sub auto-detected: {detected}");
    }
    // device_id はデバイス認証（ペアリング）でのみ取れる。無ければ
    // 「その端末で見ているセッションには送らない」抑制の対象にならないだけで、
    // 購読・push送信自体は従来通り成立する。
    add_subscription(
        &state,
        json!({
            "endpoint": body.endpoint,
            "keys": body.keys,
            "device_id": auth.0.device_id(),
        }),
    );
    Json(json!({"status": "ok"}))
}

#[derive(Deserialize)]
pub struct UnsubscribeBody {
    pub endpoint: String,
}

pub async fn unsubscribe_route(
    State(state): State<std::sync::Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<UnsubscribeBody>,
) -> Json<Value> {
    remove_subscription(&state.push, &state.paths.data_dir, &body.endpoint);
    Json(json!({"status": "ok"}))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 8291 Appendix A の worked example（webpush-wg/webpush-encryption
    /// draft より; RFC 8291 として標準化された内容と同一）。
    const AUTH_SECRET_B64: &str = "BTBZMqHH6r4Tts7J_aSIgg";
    const UA_PRIVATE_B64: &str = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    const UA_PUBLIC_B64: &str =
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const AS_PRIVATE_B64: &str = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    const AS_PUBLIC_B64: &str =
        "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    const SALT_B64: &str = "DGv6ra1nlYgDCS1FRnbzlw";

    const EXPECTED_ECDH_SECRET_B64: &str = "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs";
    const EXPECTED_PRK_KEY_B64: &str = "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k";
    const EXPECTED_IKM_B64: &str = "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg";
    const EXPECTED_PRK_B64: &str = "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc";
    const EXPECTED_CEK_B64: &str = "oIhVW04MRdy2XN9CiKLxTg";
    const EXPECTED_NONCE_B64: &str = "4h_95klXJ5E_qnoN";

    /// RFC 8291 Appendix A の鍵導出チェーン（ECDH → PRK_key → IKM → PRK →
    /// CEK/NONCE）を、公開されている中間値と1ステップずつ突き合わせて検証する。
    /// （出典: webpush-wg/webpush-encryption リポジトリの draft 原文
    /// — RFC 8291 として標準化された内容と同一の worked example）
    #[test]
    fn rfc8291_key_derivation_matches_appendix_a_intermediate_values() {
        let as_private = base64url_decode(AS_PRIVATE_B64).unwrap();
        let as_secret = SecretKey::from_slice(&as_private).unwrap();
        let ua_public_bytes = base64url_decode(UA_PUBLIC_B64).unwrap();
        let ua_public = PublicKey::from_sec1_bytes(&ua_public_bytes).unwrap();
        let as_public_bytes = encoded_public_key(&as_secret);
        assert_eq!(base64url_encode(&as_public_bytes), AS_PUBLIC_B64);

        let shared =
            p256::ecdh::diffie_hellman(as_secret.to_nonzero_scalar(), ua_public.as_affine());
        let ecdh_secret = shared.raw_secret_bytes();
        assert_eq!(
            base64url_encode(ecdh_secret.as_slice()),
            EXPECTED_ECDH_SECRET_B64,
            "ECDH shared secret"
        );

        let auth_secret = base64url_decode(AUTH_SECRET_B64).unwrap();
        let (prk_key, hk1) = Hkdf::<Sha256>::extract(Some(&auth_secret), ecdh_secret.as_slice());
        assert_eq!(base64url_encode(&prk_key), EXPECTED_PRK_KEY_B64, "PRK_key");

        let mut key_info = Vec::new();
        key_info.extend_from_slice(b"WebPush: info\0");
        key_info.extend_from_slice(&ua_public_bytes);
        key_info.extend_from_slice(&as_public_bytes);
        let mut ikm = [0u8; 32];
        hk1.expand(&key_info, &mut ikm).unwrap();
        assert_eq!(base64url_encode(&ikm), EXPECTED_IKM_B64, "IKM");

        let salt = base64url_decode(SALT_B64).unwrap();
        let (prk, hk2) = Hkdf::<Sha256>::extract(Some(&salt), &ikm);
        assert_eq!(base64url_encode(&prk), EXPECTED_PRK_B64, "PRK");

        let mut cek = [0u8; 16];
        hk2.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
            .unwrap();
        assert_eq!(base64url_encode(&cek), EXPECTED_CEK_B64, "CEK");

        let mut nonce = [0u8; 12];
        hk2.expand(b"Content-Encoding: nonce\0", &mut nonce)
            .unwrap();
        assert_eq!(base64url_encode(&nonce), EXPECTED_NONCE_B64, "NONCE");
    }

    /// UA（購読者）側の視点で同じ鍵導出をやり直しても同じ IKM/PRK/CEK/NONCE に
    /// 到達することを確認する（ECDH の対称性: ECDH(as_priv, ua_pub) ==
    /// ECDH(ua_priv, as_pub)）。実際のブラウザ側 `pushManager` の復号もこの
    /// 対称性に依存しているため、実装がこれを壊していないことの追加保証になる。
    #[test]
    fn ecdh_is_symmetric_between_sender_and_receiver_views() {
        let as_private = base64url_decode(AS_PRIVATE_B64).unwrap();
        let as_secret = SecretKey::from_slice(&as_private).unwrap();
        let ua_public_bytes = base64url_decode(UA_PUBLIC_B64).unwrap();
        let ua_public = PublicKey::from_sec1_bytes(&ua_public_bytes).unwrap();
        let shared_as_view =
            p256::ecdh::diffie_hellman(as_secret.to_nonzero_scalar(), ua_public.as_affine());

        let ua_private = base64url_decode(UA_PRIVATE_B64).unwrap();
        let ua_secret = SecretKey::from_slice(&ua_private).unwrap();
        let as_public_bytes = base64url_decode(AS_PUBLIC_B64).unwrap();
        let as_public = PublicKey::from_sec1_bytes(&as_public_bytes).unwrap();
        let shared_ua_view =
            p256::ecdh::diffie_hellman(ua_secret.to_nonzero_scalar(), as_public.as_affine());

        assert_eq!(
            shared_as_view.raw_secret_bytes(),
            shared_ua_view.raw_secret_bytes()
        );
        assert_eq!(
            base64url_encode(shared_as_view.raw_secret_bytes().as_slice()),
            EXPECTED_ECDH_SECRET_B64
        );
    }

    /// 自前で書いた RFC 8291 デコーダ（テスト専用、実装コードとは独立に書き直した
    /// もの）で復号できることを、ランダムな鍵ペア・平文での round trip で確認する。
    /// 実装コードをそのままコピーした「自己満足テスト」にならないよう、デコード側は
    /// 別ロジックとして書く。
    fn decrypt_aes128gcm_for_test(
        encoded: &[u8],
        ua_private_b64: &str,
        auth_b64: &str,
    ) -> Option<Vec<u8>> {
        if encoded.len() < 21 {
            return None;
        }
        let salt = &encoded[0..16];
        let idlen = encoded[20] as usize;
        let keyid_start = 21;
        let keyid_end = keyid_start + idlen;
        let as_public_bytes = &encoded[keyid_start..keyid_end];
        let ciphertext = &encoded[keyid_end..];

        let ua_private = base64url_decode(ua_private_b64)?;
        let ua_secret = SecretKey::from_slice(&ua_private).ok()?;
        let auth_secret = base64url_decode(auth_b64)?;
        let as_public = PublicKey::from_sec1_bytes(as_public_bytes).ok()?;
        let ua_public_bytes = encoded_public_key(&ua_secret);

        let shared =
            p256::ecdh::diffie_hellman(ua_secret.to_nonzero_scalar(), as_public.as_affine());
        let (_prk_key, hk1) =
            Hkdf::<Sha256>::extract(Some(&auth_secret), shared.raw_secret_bytes().as_slice());
        let mut key_info = Vec::new();
        key_info.extend_from_slice(b"WebPush: info\0");
        key_info.extend_from_slice(&ua_public_bytes);
        key_info.extend_from_slice(as_public_bytes);
        let mut ikm = [0u8; 32];
        hk1.expand(&key_info, &mut ikm).ok()?;

        let (_prk, hk2) = Hkdf::<Sha256>::extract(Some(salt), &ikm);
        let mut cek = [0u8; 16];
        hk2.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
            .ok()?;
        let mut nonce_bytes = [0u8; 12];
        hk2.expand(b"Content-Encoding: nonce\0", &mut nonce_bytes)
            .ok()?;

        let cipher = Aes128Gcm::new_from_slice(&cek).ok()?;
        let nonce = Nonce::from(nonce_bytes);
        let mut record = cipher.decrypt(&nonce, ciphertext).ok()?;
        // パディング区切り 0x02（末尾かつ唯一のレコード）を取り除く。
        assert_eq!(record.pop(), Some(0x02));
        Some(record)
    }

    #[test]
    fn encrypt_then_independently_decrypt_round_trips_rfc8291_vector() {
        let plaintext = b"When I grow up, I want to be a watermelon";
        let encoded = encrypt_aes128gcm(plaintext, UA_PUBLIC_B64, AUTH_SECRET_B64).unwrap();
        let decoded =
            decrypt_aes128gcm_for_test(&encoded, UA_PRIVATE_B64, AUTH_SECRET_B64).unwrap();
        assert_eq!(decoded, plaintext);
    }

    #[test]
    fn encrypt_then_independently_decrypt_round_trips_fresh_keypair() {
        let (ua_secret, ua_raw) = generate_p256_keypair();
        let ua_public_b64 = base64url_encode(&encoded_public_key(&ua_secret));
        let ua_private_b64 = base64url_encode(&ua_raw);
        let mut auth_secret = [0u8; 16];
        getrandom::fill(&mut auth_secret).unwrap();
        let auth_b64 = base64url_encode(&auth_secret);

        let plaintext = br#"{"title":"hi","body":"there","url":"/","type":""}"#;
        let encoded = encrypt_aes128gcm(plaintext, &ua_public_b64, &auth_b64).unwrap();
        let decoded = decrypt_aes128gcm_for_test(&encoded, &ua_private_b64, &auth_b64).unwrap();
        assert_eq!(decoded, plaintext);

        // salt はメッセージごとにランダムなので、2回暗号化すると別の出力になる。
        let encoded2 = encrypt_aes128gcm(plaintext, &ua_public_b64, &auth_b64).unwrap();
        assert_ne!(encoded, encoded2);
    }

    #[test]
    fn encrypt_rejects_malformed_subscriber_key() {
        assert!(encrypt_aes128gcm(b"x", "not-base64!!", AUTH_SECRET_B64).is_none());
        assert!(encrypt_aes128gcm(b"x", UA_PUBLIC_B64, "not-base64!!").is_none());
        // 圧縮形式（33 byte）は拒否する（ブラウザは常に非圧縮 65 byte を送る）。
        let short = base64url_encode(&[0u8; 33]);
        assert!(encrypt_aes128gcm(b"x", &short, AUTH_SECRET_B64).is_none());
    }

    #[test]
    fn vapid_jwt_has_three_dot_separated_parts_and_valid_signature() {
        let (secret, _) = generate_p256_keypair();
        let signing_key = SigningKey::from(&secret);
        let jwt = vapid_jwt(
            &signing_key,
            "https://fcm.googleapis.com",
            "mailto:a@b.com",
            1_000,
        );
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);

        let header: Value = serde_json::from_slice(&base64url_decode(parts[0]).unwrap()).unwrap();
        assert_eq!(header["alg"], "ES256");
        assert_eq!(header["typ"], "JWT");
        let claims: Value = serde_json::from_slice(&base64url_decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["sub"], "mailto:a@b.com");
        assert_eq!(claims["exp"], 1_000 + VAPID_JWT_TTL_SEC);

        // 署名を検証する（p256 の VerifyingKey で独立検証）。
        use p256::ecdsa::signature::Verifier;
        let verifying_key = p256::ecdsa::VerifyingKey::from(&signing_key);
        let sig_bytes = base64url_decode(parts[2]).unwrap();
        let signature = Signature::from_slice(&sig_bytes).unwrap();
        let signing_input = format!("{}.{}", parts[0], parts[1]);
        assert!(verifying_key
            .verify(signing_input.as_bytes(), &signature)
            .is_ok());
    }

    #[test]
    fn extract_sub_origin_matches_python_regex_semantics() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            "https://example.com:8888".parse().unwrap(),
        );
        // ポートは含めない（Python 版の正規表現は `:` の手前で止まる）。
        assert_eq!(
            extract_sub_origin(&headers),
            Some("https://example.com".to_string())
        );

        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::REFERER,
            "http://example.com/foo/bar".parse().unwrap(),
        );
        assert_eq!(
            extract_sub_origin(&headers),
            Some("http://example.com".to_string())
        );

        let headers = HeaderMap::new();
        assert_eq!(extract_sub_origin(&headers), None);

        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            "ftp://example.com".parse().unwrap(),
        );
        assert_eq!(extract_sub_origin(&headers), None);
    }

    #[test]
    fn vapid_keys_persist_and_reload_identically() {
        let dir = tempfile::tempdir().unwrap();
        let push = PushState::new();
        let key1 = get_vapid_public_key(&push, dir.path()).unwrap();
        // 別プロセス（Python 側）が既に生成したファイルをそのまま読み直すのと同じ
        // シナリオ: 新しい PushState/OnceLock でも同じ鍵ファイルからは同じ公開鍵。
        let push2 = PushState::new();
        let key2 = get_vapid_public_key(&push2, dir.path()).unwrap();
        assert_eq!(key1, key2);
    }

    #[test]
    fn subscriptions_add_dedupes_by_endpoint_and_remove_works() {
        let dir = tempfile::tempdir().unwrap();
        let push = PushState::new();
        assert!(!has_subscriptions(dir.path()));

        {
            let _guard = push.subscriptions_lock.lock().unwrap();
            let mut subs = load_subscriptions(dir.path());
            subs.push(json!({"endpoint": "https://push.example/a", "keys": {}}));
            save_subscriptions(dir.path(), &subs);
        }
        assert!(has_subscriptions(dir.path()));

        // 同じ endpoint を上書き登録しても1件のまま。
        {
            let _guard = push.subscriptions_lock.lock().unwrap();
            let mut subs = load_subscriptions(dir.path());
            subs.retain(|s| {
                s.get("endpoint").and_then(Value::as_str) != Some("https://push.example/a")
            });
            subs.push(json!({"endpoint": "https://push.example/a", "keys": {"p256dh": "x"}}));
            save_subscriptions(dir.path(), &subs);
        }
        assert_eq!(load_subscriptions(dir.path()).len(), 1);

        remove_subscription(&push, dir.path(), "https://push.example/a");
        assert!(!has_subscriptions(dir.path()));
    }

    #[test]
    fn vapid_sub_defaults_then_persists() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_vapid_sub(dir.path()), DEFAULT_VAPID_SUB);
        set_vapid_sub(dir.path(), "https://example.com");
        assert_eq!(load_vapid_sub(dir.path()), "https://example.com");
    }

    // ─── should_skip_for_viewing（push抑制判定） ────────────────────────

    #[test]
    fn skips_when_session_id_absent() {
        let status_stream = crate::status_stream::StatusStreamState::new();
        let sub = json!({"endpoint": "https://push.example/a", "device_id": "dev_1"});
        assert!(!should_skip_for_viewing(&sub, None, &status_stream));
    }

    #[test]
    fn skips_when_subscription_has_no_device_id() {
        let status_stream = crate::status_stream::StatusStreamState::new();
        let sub = json!({"endpoint": "https://push.example/a"});
        assert!(!should_skip_for_viewing(&sub, Some("s1"), &status_stream));
    }

    #[test]
    fn skips_delivery_when_owning_device_is_viewing_the_session() {
        let status_stream = crate::status_stream::StatusStreamState::new();
        let conn_id = status_stream
            .register_viewer(Some("dev_1".to_string()))
            .unwrap();
        status_stream.update_viewing(conn_id, Some("s1".to_string()));

        let sub = json!({"endpoint": "https://push.example/a", "device_id": "dev_1"});
        assert!(should_skip_for_viewing(&sub, Some("s1"), &status_stream));
        // 別セッションや別デバイスへは通常通り送る。
        assert!(!should_skip_for_viewing(&sub, Some("s2"), &status_stream));
        let other_device_sub = json!({"endpoint": "https://push.example/b", "device_id": "dev_2"});
        assert!(!should_skip_for_viewing(
            &other_device_sub,
            Some("s1"),
            &status_stream
        ));
    }
}
