//! QR コードデバイスペアリング（Python 側 `api/routers/pairing.py` の移植）。
//!
//! 既に認証済みの端末から、新しいデバイスを QR コードスキャンだけでログインさせる
//! ためのエンドポイント群（`docs/DECISIONS.md` ADR28 参照）。
//!
//! - POST /auth/pairing/start
//!   認証済みセッションのみ。短命・使い切りのペアリング ID とトークンを発行する。
//! - GET /auth/pairing/{id}/status
//!   新デバイス・発行元の両方から未認証でポーリング可能。
//! - POST /auth/pairing/{id}/claim
//!   pairingToken を検証し、成功したら既存のデバイス cookie 発行ロジック
//!   （`crate::devices`）を再利用してログインを完了する。
//!
//! セキュリティ:
//! - ペアリングエントリはプロセス内メモリのみに保持する。ディスクへは書かない。
//! - token は 24 バイトの url-safe ランダム値（推測不可能な入力）。claim はトークン
//!   検証・デバイス登録・cookie 発行・claimed への更新までを丸ごとロック保持下で行う
//!   （個人ツールの利用規模ではデバイス登録にかかる時間は無視できるため、途中経過を
//!   表す中間状態を持たずに済む）。
//! - id・token どちらも総当たりされないよう、専用のレートリミッタで start/status/claim
//!   合算・IP ごとに絞る（アプリ全体の rate limit に加えた二次防御）。
//! - claim 成功後のエントリ（tombstone）は `expires_at` を `CLAIMED_OBSERVATION_SEC`
//!   分だけ先に延長し、発行元のポーリング遅延で「claimed を見損ねて expired 扱いに
//!   なる」ことを防ぐ（token 自体は既に破棄済みなので延命してもリプレイのリスクは無い）。
//! - claim のたびに必ず新規デバイスとして登録する（`find_or_register_device` は使わない
//!   — 同一 UA の 2 台を続けてペアリングした場合に、再利用ロジックが後発デバイスの
//!   ために先発デバイスの secret を回転させ、先発デバイスを無言でログアウトさせて
//!   しまうため）。
//! - QR に埋め込む URL は、Tailscale の MagicDNS 名が引ければ「ホスト名 + リクエストが
//!   実際に使ったポート」で組み立てる。bind 自体が loopback 専用の場合は使わない。
//!   MagicDNS 名が引けず、かつ発行元が loopback アドレスで開いている場合は、QR の
//!   宛先が「スキャンした端末自身の localhost」になってしまうため明確なエラーで拒否する。

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{ConnectInfo, Path as AxumPath, State};
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{constant_time_eq, AuthKind, RequireAuth};
use crate::errors::{bad_request, gone, too_many_requests, unauthorized, ApiError};
use crate::rate_limit::FixedWindowCounter;
use crate::state::AppState;
use crate::util::{now_epoch, JsonBody};

pub const PAIRING_TTL_SEC: i64 = 90;
/// claim 成功の観測猶予。claim 成功時に `expires_at` をこの秒数だけ先に延長する。
const CLAIMED_OBSERVATION_SEC: i64 = 30;
/// start/status/claim 合算で IP ごとに絞る（token の推測不可能性が主防御、これは
/// 連打・スクリプトによる荒らしを抑える二次防御）。
const PAIRING_RATE_LIMIT: u32 = 120;
const RATE_WINDOW: Duration = Duration::from_secs(60);

struct PairingEntry {
    /// claim 成功後は None にして tombstone 化する（トークンは破棄済み）。
    token: Option<String>,
    expires_at: i64,
    claimed: bool,
}

fn is_expired(entry: &PairingEntry, now: i64) -> bool {
    entry.expires_at <= now
}

pub struct PairingState {
    pairings: Mutex<HashMap<String, PairingEntry>>,
    rate_counter: FixedWindowCounter,
}

impl Default for PairingState {
    fn default() -> Self {
        Self {
            pairings: Mutex::new(HashMap::new()),
            rate_counter: FixedWindowCounter::new(),
        }
    }
}

impl PairingState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn check_rate_limit(state: &PairingState, client_ip: &str) -> Result<(), ApiError> {
    let key = format!("pairing:{client_ip}");
    if state
        .rate_counter
        .try_acquire(&key, PAIRING_RATE_LIMIT, RATE_WINDOW)
    {
        Ok(())
    } else {
        Err(too_many_requests("Too many requests"))
    }
}

fn sweep_expired_locked(pairings: &mut HashMap<String, PairingEntry>, now: i64) {
    pairings.retain(|_, entry| !is_expired(entry, now));
}

/// host が loopback（localhost / 127.x / ::1）かを判定する純関数
/// （`api/common.py` `is_loopback_host`）。
fn is_loopback_host(host: &str) -> bool {
    if host.is_empty() {
        return false;
    }
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// `Host` ヘッダから (hostname, port) を取り出す。IPv6 リテラル（`[::1]:8888`）にも
/// 対応する。ポートが無ければ None（呼び出し側がスキーム既定値を補う）。
fn parse_host_header(headers: &HeaderMap) -> (String, Option<u16>) {
    let raw = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if let Some(rest) = raw.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let host = rest[..end].to_string();
            let port = rest[end + 1..]
                .strip_prefix(':')
                .and_then(|p| p.parse::<u16>().ok());
            return (host, port);
        }
        return (raw.to_string(), None);
    }
    match raw.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            (h.to_string(), p.parse::<u16>().ok())
        }
        _ => (raw.to_string(), None),
    }
}

/// リクエストが実際に使ったポートを返す。`Host` ヘッダに明示的なポートが無ければ
/// スキームの標準ポートを補う（`api/routers/pairing.py` `_effective_port`）。
///
/// この Rust サーバ自身は TLS を終端しない（本番は Tailscale Serve が外部で TLS を
/// 終端し plain HTTP でこのプロセスへ転送する — `devices.rs` の cookie Secure 判定
/// と同じ前提）ため、スキームは常に "http" として既定ポート 80 を補う。
fn effective_port(headers: &HeaderMap) -> Option<u16> {
    parse_host_header(headers).1.or(Some(80))
}

fn bind_is_loopback_only(state: &AppState) -> bool {
    let (host, _port) = state.config.resolve_bind();
    is_loopback_host(&host)
}

/// この端末の Tailscale MagicDNS ホスト名を返す（`api/auth.py` `_resolve_tailscale_name`）。
async fn resolve_tailscale_name() -> Option<String> {
    let data = crate::subprocess::run_tailscale_json(&["status", "--json"]).await?;
    let dns_name = data.get("Self")?.get("DNSName")?.as_str()?;
    let trimmed = dns_name.trim_end_matches('.');
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn magicdns_pairing_url(
    hostname: &str,
    port: u16,
    pairing_id: &str,
    pairing_token: &str,
) -> String {
    format!("http://{hostname}:{port}/pair/{pairing_id}?t={pairing_token}")
}

/// MagicDNS 名が引けない（または bind が loopback 専用）場合のフォールバック。
/// 発行元自身が loopback アドレスで開いている場合は、QR の宛先が「スキャンした
/// 端末自身の localhost」になってしまうため明確なエラーで拒否する。
fn fallback_pairing_url(
    headers: &HeaderMap,
    pairing_id: &str,
    pairing_token: &str,
) -> Result<String, ApiError> {
    let (request_host, _) = parse_host_header(headers);
    if is_loopback_host(&request_host) {
        return Err(bad_request(
            "Cannot build a link reachable from another device while viewing \
             any-console via localhost. Open it via its LAN or Tailscale address instead.",
        ));
    }
    let netloc = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    Ok(format!(
        "http://{netloc}/pair/{pairing_id}?t={pairing_token}"
    ))
}

async fn build_pairing_url(
    state: &AppState,
    headers: &HeaderMap,
    pairing_id: &str,
    pairing_token: &str,
) -> Result<String, ApiError> {
    let hostname = resolve_tailscale_name().await;
    let port = effective_port(headers);
    if let (Some(hostname), Some(port)) = (&hostname, port) {
        if !bind_is_loopback_only(state) {
            return Ok(magicdns_pairing_url(
                hostname,
                port,
                pairing_id,
                pairing_token,
            ));
        }
    }
    fallback_pairing_url(headers, pairing_id, pairing_token)
}

// ─── HTTP エンドポイント ─────────────────────────────────────────────────────

pub async fn start_pairing(
    State(state): State<std::sync::Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    auth: RequireAuth,
) -> Result<Response, ApiError> {
    // Python 版と同じく `Depends(verify_token)`（= `RequireAuth`）は認証無効化時にも
    // 通過するため、ペアリングという操作自体が無意味な「認証無効化」状態は個別に弾く。
    if auth.0.kind == AuthKind::Disabled {
        return Err(bad_request("Authentication is disabled"));
    }
    let client_ip = addr.ip().to_string();
    check_rate_limit(&state.pairing, &client_ip)?;

    let now = now_epoch();
    let pairing_id = format!("pr_{}", crate::util::token_hex(8));
    let pairing_token = crate::util::token_urlsafe(24);
    {
        let mut pairings = state
            .pairing
            .pairings
            .lock()
            .expect("pairing lock poisoned");
        sweep_expired_locked(&mut pairings, now);
    }
    // build_pairing_url は tailscale サブプロセスを呼ぶため遅い環境では数秒かかりうる。
    // expires_at をこの呼び出しより前に確定させると、レスポンスに乗せる
    // expires_in_sec（常に PAIRING_TTL_SEC 固定）より先にバックエンドの寿命が
    // 進んでしまうため、URL 確定後の時刻を起点にする。
    let url = build_pairing_url(&state, &headers, &pairing_id, &pairing_token).await?;
    let expires_at = now_epoch() + PAIRING_TTL_SEC;
    {
        let mut pairings = state
            .pairing
            .pairings
            .lock()
            .expect("pairing lock poisoned");
        pairings.insert(
            pairing_id.clone(),
            PairingEntry {
                token: Some(pairing_token),
                expires_at,
                claimed: false,
            },
        );
    }
    tracing::info!("pairing started id={pairing_id} client={client_ip}");
    Ok(Json(json!({
        "id": pairing_id,
        "url": url,
        "expires_in_sec": PAIRING_TTL_SEC,
    }))
    .into_response())
}

pub async fn pairing_status(
    State(state): State<std::sync::Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    AxumPath(pairing_id): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    check_rate_limit(&state.pairing, &addr.ip().to_string())?;
    let now = now_epoch();
    let mut pairings = state
        .pairing
        .pairings
        .lock()
        .expect("pairing lock poisoned");
    let Some(entry) = pairings.get(&pairing_id) else {
        return Ok(Json(json!({"status": "not_found"})));
    };
    if is_expired(entry, now) {
        let was_claimed = entry.claimed;
        pairings.remove(&pairing_id);
        return Ok(Json(
            json!({"status": if was_claimed { "not_found" } else { "expired" }}),
        ));
    }
    if entry.claimed {
        return Ok(Json(json!({"status": "claimed"})));
    }
    Ok(Json(json!({
        "status": "pending",
        "expires_in_sec": (entry.expires_at - now).max(0),
    })))
}

#[derive(Deserialize, Default)]
pub struct ClaimBody {
    #[serde(default)]
    pub token: String,
}

pub async fn claim_pairing(
    State(state): State<std::sync::Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    AxumPath(pairing_id): AxumPath<String>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<ClaimBody>,
) -> Result<Response, ApiError> {
    let client_ip = addr.ip().to_string();
    check_rate_limit(&state.pairing, &client_ip)?;
    let now = now_epoch();

    // トークン検証からデバイス登録・cookie 発行・claimed への更新まで、丸ごと
    // ロック保持下で行う（同じ token での同時 claim は後発がロック待ちの後
    // 「既に claimed」を見て自然に弾かれる）。
    let (device_id, name, raw_secret) = {
        let mut pairings = state
            .pairing
            .pairings
            .lock()
            .expect("pairing lock poisoned");
        let Some(entry) = pairings.get_mut(&pairing_id) else {
            return Err(gone("Pairing request not found or already used"));
        };
        if is_expired(entry, now) {
            pairings.remove(&pairing_id);
            return Err(gone("Pairing request expired or already used"));
        }
        if entry.claimed {
            return Err(gone("Pairing request expired or already used"));
        }
        let expected = entry.token.as_deref().unwrap_or("");
        if body.token.is_empty() || !constant_time_eq(&body.token, expected) {
            return Err(unauthorized("Invalid pairing token"));
        }

        let ua = headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let name = crate::devices::autoname_from_user_agent(ua);
        // find_or_register_device ではなく必ず新規登録する（同一 UA の 2 台を続けて
        // ペアリングした場合、再利用ロジックが先発デバイスの secret を回転させ、
        // 無言でログアウトさせてしまうため）。
        let (device_id, raw_secret) = crate::devices::register_device(
            &state.paths.data_dir,
            state.auth.devices(),
            &name,
            ua,
            "pairing",
        );

        // claimed 後も tombstone としてエントリを残し、expires_at を観測猶予分
        // 延長する（token 自体は既に破棄済みなので延命してもリプレイのリスクは無い）。
        entry.claimed = true;
        entry.token = None;
        entry.expires_at = now + CLAIMED_OBSERVATION_SEC;
        (device_id, name, raw_secret)
    };
    tracing::info!("pairing claimed id={pairing_id} device={device_id} client={client_ip}");

    let mut response = Json(json!({
        "ok": true, "device_id": device_id, "name": name, "auth_required": true,
    }))
    .into_response();
    crate::devices::set_device_cookies(response.headers_mut(), &headers, &device_id, &raw_secret);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_loopback_host_matches_python() {
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("LOCALHOST"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("::1"));
        assert!(!is_loopback_host("100.64.0.1"));
        assert!(!is_loopback_host("example.com"));
        assert!(!is_loopback_host(""));
    }

    #[test]
    fn parse_host_header_extracts_hostname_and_port() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "myhost.example:8888".parse().unwrap());
        assert_eq!(
            parse_host_header(&headers),
            ("myhost.example".to_string(), Some(8888))
        );

        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "myhost.example".parse().unwrap());
        assert_eq!(
            parse_host_header(&headers),
            ("myhost.example".to_string(), None)
        );

        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "[::1]:8888".parse().unwrap());
        assert_eq!(parse_host_header(&headers), ("::1".to_string(), Some(8888)));

        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "[::1]".parse().unwrap());
        assert_eq!(parse_host_header(&headers), ("::1".to_string(), None));
    }

    #[test]
    fn magicdns_url_has_expected_shape() {
        assert_eq!(
            magicdns_pairing_url("host.tail1234.ts.net", 8888, "pr_1", "tok_1"),
            "http://host.tail1234.ts.net:8888/pair/pr_1?t=tok_1"
        );
    }

    #[test]
    fn fallback_url_uses_netloc_when_not_loopback() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "100.64.1.2:8888".parse().unwrap());
        let url = fallback_pairing_url(&headers, "pr_1", "tok_1").unwrap();
        assert_eq!(url, "http://100.64.1.2:8888/pair/pr_1?t=tok_1");
    }

    #[test]
    fn fallback_url_rejects_loopback_host() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "localhost:8888".parse().unwrap());
        let err = fallback_pairing_url(&headers, "pr_1", "tok_1").unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn effective_port_defaults_to_80_without_explicit_port() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "example.com".parse().unwrap());
        assert_eq!(effective_port(&headers), Some(80));

        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "example.com:9000".parse().unwrap());
        assert_eq!(effective_port(&headers), Some(9000));
    }

    #[test]
    fn sweep_expired_removes_only_expired() {
        let mut pairings = HashMap::new();
        pairings.insert(
            "a".to_string(),
            PairingEntry {
                token: Some("t".to_string()),
                expires_at: 10,
                claimed: false,
            },
        );
        pairings.insert(
            "b".to_string(),
            PairingEntry {
                token: Some("t".to_string()),
                expires_at: 100,
                claimed: false,
            },
        );
        sweep_expired_locked(&mut pairings, 50);
        assert!(!pairings.contains_key("a"));
        assert!(pairings.contains_key("b"));
    }

    #[test]
    fn check_rate_limit_blocks_after_threshold() {
        let state = PairingState::new();
        for _ in 0..PAIRING_RATE_LIMIT {
            assert!(check_rate_limit(&state, "1.2.3.4").is_ok());
        }
        assert!(check_rate_limit(&state, "1.2.3.4").is_err());
        // 別 IP は独立してカウントされる。
        assert!(check_rate_limit(&state, "5.6.7.8").is_ok());
    }
}
