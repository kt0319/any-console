//! 未移行ルートを Python バックエンドへ透過 proxy する（HTTP + WebSocket）。
//!
//! ストラングラー移行の中核。Rust 側で処理しないリクエストはすべてここを通り、
//! ANY_CONSOLE_UPSTREAM（既定 http://127.0.0.1:8889）の Python FastAPI へ転送される。
//!
//! - 接続元 IP は X-Forwarded-For に積んで渡す。Python 側は
//!   `uvicorn --proxy-headers --forwarded-allow-ips 127.0.0.1` 相当の設定で
//!   これを復元するため、Tailscale 信頼判定・rate limit・activity ログの
//!   接続元判定が proxy 経由でも壊れない。
//! - WebSocket はハンドシェイクヘッダを引き継いで upstream と別接続を張り、
//!   フレームを双方向に中継する（terminal / status stream / preview HMR が通る）。

use std::net::IpAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message as AxumMsg, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, HeaderName, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame as TgCloseFrame;
use tokio_tungstenite::tungstenite::Message as TgMsg;

use crate::state::AppState;

/// proxy リクエストボディの上限。Python 側の最大アップロード 10MB より十分大きく、
/// かつ無制限バッファリングを避ける。
const MAX_PROXY_BODY: usize = 64 * 1024 * 1024;

/// ホップバイホップヘッダ（RFC 9110）。エンドツーエンドではないため転送しない。
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

fn is_hop_by_hop(name: &HeaderName) -> bool {
    HOP_BY_HOP.contains(&name.as_str())
}

pub struct Proxy {
    client: reqwest::Client,
    /// 例: "http://127.0.0.1:8889"（末尾スラッシュなし）
    upstream: String,
}

impl Proxy {
    pub fn new(upstream: String) -> Self {
        // loopback への転送に環境の HTTPS_PROXY 等を通してはならないため no_proxy。
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("reqwest client");
        Self {
            client,
            upstream: upstream.trim_end_matches('/').to_string(),
        }
    }

    fn upstream_url(&self, path_and_query: &str) -> String {
        format!("{}{}", self.upstream, path_and_query)
    }

    fn upstream_ws_url(&self, path_and_query: &str) -> String {
        let ws_base = self
            .upstream
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        format!("{ws_base}{path_and_query}")
    }

    /// Python 側に残る status stream へ即時反映を伝える移行期間ブリッジ
    /// （POST /internal/git-nudge — api/routers/migration_bridge.py）。
    /// fire-and-forget: 失敗しても git_watch の FS 監視が下支えするため、
    /// 呼び出し元の応答は遅らせない・失敗させない。
    /// ターミナルサブシステム（status stream ごと）の移行完了時に削除する。
    pub fn nudge_git(&self, workspace: Option<String>) {
        let client = self.client.clone();
        let url = self.upstream_url("/internal/git-nudge");
        tokio::spawn(async move {
            let body = match workspace {
                Some(w) => serde_json::json!({ "workspace": w }),
                None => serde_json::json!({}),
            };
            let result = client
                .post(&url)
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            if let Err(e) = result {
                tracing::debug!("git-nudge to upstream failed: {e}");
            }
        });
    }

    /// ターミナルセッションの作成・削除を Python 側 status stream（session_watch）
    /// へ即時反映する（migration_bridge — fire-and-forget）。event は
    /// "created"/"removed"。"removed" は Python 側 agent_hooks の状態も掃除する。
    pub fn notify_session_event(&self, event: &'static str, session_id: String) {
        let client = self.client.clone();
        let url = self.upstream_url("/internal/session-event");
        tokio::spawn(async move {
            let body = serde_json::json!({ "event": event, "session_id": session_id });
            let result = client
                .post(&url)
                .json(&body)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            if let Err(e) = result {
                tracing::debug!("session-event to upstream failed: {e}");
            }
        });
    }

    /// Web Push 通知の送信を Python 側（VAPID/pywebpush）へ委譲する
    /// （migration_bridge — fire-and-forget。呼び出し元の応答は遅らせない）。
    pub fn send_push(&self, title: String, body: String, url_path: String, notif_type: String) {
        let client = self.client.clone();
        let url = self.upstream_url("/internal/send-push");
        tokio::spawn(async move {
            let payload = serde_json::json!({
                "title": title, "body": body, "url": url_path, "notif_type": notif_type,
            });
            let result = client
                .post(&url)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await;
            if let Err(e) = result {
                tracing::debug!("send-push to upstream failed: {e}");
            }
        });
    }

    /// dispatch キューの全量スナップショットを Python 側 status stream（WS 購読者）
    /// へ中継する（migration_bridge — fire-and-forget。WS 自体は Python に残る）。
    pub fn broadcast_dispatch_queue(&self, payload: serde_json::Value) {
        let client = self.client.clone();
        let url = self.upstream_url("/internal/dispatch-queue");
        tokio::spawn(async move {
            let result = client
                .post(&url)
                .json(&payload)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            if let Err(e) = result {
                tracing::debug!("dispatch-queue relay to upstream failed: {e}");
            }
        });
    }

    /// dispatch scope の API トークン検証を Python 側（`auth.py` の
    /// `_verify_api_token` — auth.json の api_tokens 配列）へ委譲する。
    /// 戻り値は (ok, label)。ブリッジ自体の失敗は「無効」として扱う。
    pub async fn verify_dispatch_api_token(&self, token: &str) -> (bool, Option<String>) {
        let url = self.upstream_url("/internal/verify-dispatch-api-token");
        let body = serde_json::json!({ "token": token });
        let resp = match self
            .client
            .post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("verify-dispatch-api-token bridge failed: {e}");
                return (false, None);
            }
        };
        match resp.json::<serde_json::Value>().await {
            Ok(v) => {
                let ok = v["ok"].as_bool().unwrap_or(false);
                let label = v["label"].as_str().map(String::from);
                (ok, label)
            }
            Err(_) => (false, None),
        }
    }
}

fn path_and_query(req_uri: &axum::http::Uri) -> String {
    req_uri
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| req_uri.path().to_string())
}

/// X-Forwarded-For を追記する（既存値があれば右端へ追加 — uvicorn は信頼できない
/// 最右値を接続元として採用するため、外部クライアントが偽装ヘッダを付けていても
/// 実際の接続元がそれを上書きする）。
fn forwarded_for(headers: &HeaderMap, client_ip: IpAddr) -> String {
    match headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        Some(existing) if !existing.is_empty() => format!("{existing}, {client_ip}"),
        _ => client_ip.to_string(),
    }
}

/// WebSocket アップグレード要求か（Upgrade: websocket + GET）。
fn is_ws_upgrade(req: &Request) -> bool {
    req.method() == axum::http::Method::GET
        && req
            .headers()
            .get(axum::http::header::UPGRADE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
}

/// フォールバックハンドラ: 静的ファイル → WS proxy → HTTP proxy の順で処理する。
pub async fn fallback(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    req: Request,
) -> Response {
    if is_ws_upgrade(&req) {
        // axum 0.8 では Option<WebSocketUpgrade> 抽出子が使えないため手動抽出する。
        use axum::extract::FromRequestParts;
        let (mut parts, body) = req.into_parts();
        match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
            Ok(upgrade) => {
                let req = Request::from_parts(parts, body);
                return proxy_ws(state, upgrade, addr.ip(), req).await;
            }
            Err(rejection) => return rejection.into_response(),
        }
    }
    // 静的ファイル（GET/HEAD のみ）
    if matches!(req.method().as_str(), "GET" | "HEAD") {
        if let Some(ctx) = &state.static_ctx {
            if let Some(resp) = ctx.try_serve(req.uri().path()) {
                return resp;
            }
        }
    }
    proxy_http(state, addr.ip(), req).await
}

async fn proxy_http(state: Arc<AppState>, client_ip: IpAddr, req: Request) -> Response {
    let method = req.method().clone();
    let url = state.proxy.upstream_url(&path_and_query(req.uri()));
    let xff = forwarded_for(req.headers(), client_ip);

    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in req.headers() {
        if is_hop_by_hop(name)
            || name == "host"
            || name == "content-length"
            || name == "x-forwarded-for"
        {
            continue;
        }
        headers.append(name.clone(), value.clone());
    }
    if let Ok(v) = xff.parse() {
        headers.insert("x-forwarded-for", v);
    }

    let body = match axum::body::to_bytes(req.into_body(), MAX_PROXY_BODY).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                axum::Json(serde_json::json!({"detail": "Request body too large"})),
            )
                .into_response()
        }
    };

    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return StatusCode::METHOD_NOT_ALLOWED.into_response(),
    };
    let result = state
        .proxy
        .client
        .request(reqwest_method, &url)
        .headers(headers)
        .body(body)
        .send()
        .await;

    let upstream_resp = match result {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("proxy upstream error path={} err={}", url, e);
            return (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({"detail": "Backend unavailable"})),
            )
                .into_response();
        }
    };

    let status = upstream_resp.status();
    let mut builder = Response::builder().status(status.as_u16());
    if let Some(h) = builder.headers_mut() {
        for (name, value) in upstream_resp.headers() {
            if is_hop_by_hop(name) {
                continue;
            }
            h.append(name.clone(), value.clone());
        }
    }
    let stream = upstream_resp.bytes_stream();
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn proxy_ws(
    state: Arc<AppState>,
    upgrade: WebSocketUpgrade,
    client_ip: IpAddr,
    req: Request,
) -> Response {
    let url = state.proxy.upstream_ws_url(&path_and_query(req.uri()));
    let xff = forwarded_for(req.headers(), client_ip);

    // upstream ハンドシェイクへ引き継ぐヘッダ。WS ネゴシエーション用ヘッダは
    // tungstenite が自前で生成するため除外する。
    let mut carry = HeaderMap::new();
    for (name, value) in req.headers() {
        let n = name.as_str();
        if is_hop_by_hop(name)
            || n == "host"
            || n == "x-forwarded-for"
            || n.starts_with("sec-websocket-")
        {
            continue;
        }
        carry.append(name.clone(), value.clone());
    }
    if let Ok(v) = xff.parse() {
        carry.insert("x-forwarded-for", v);
    }

    // クライアントへ 101 を返す前に upstream と接続する。upstream がハンドシェイク
    // 段階で拒否した場合（認証エラー等）はそのステータスをそのまま HTTP で返す
    // （Python へ直接繋いだ場合と同じ挙動 — upgrade 成功後の即クローズにしない）。
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Error as TgError;
    let mut request = match url.clone().into_client_request() {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("ws proxy bad upstream url={} err={}", url, e);
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    for (name, value) in &carry {
        request.headers_mut().append(name.clone(), value.clone());
    }
    let upstream = match tokio_tungstenite::connect_async(request).await {
        Ok((ws, _resp)) => ws,
        Err(TgError::Http(resp)) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let body = resp.into_body().unwrap_or_default();
            return Response::builder()
                .status(status)
                .body(Body::from(body))
                .unwrap_or_else(|_| status.into_response());
        }
        Err(e) => {
            tracing::warn!("ws proxy upstream connect failed url={} err={}", url, e);
            return (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({"detail": "Backend unavailable"})),
            )
                .into_response();
        }
    };
    upgrade.on_upgrade(move |client_socket| bridge(client_socket, upstream))
}

/// クライアント（axum）と upstream（tungstenite）の間でフレームを双方向中継する。
/// どちらかが閉じたら反対側も閉じて終了する。
async fn bridge(
    client: WebSocket,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) {
    let (mut client_tx, mut client_rx) = client.split();
    let (mut up_tx, mut up_rx) = upstream.split();
    loop {
        tokio::select! {
            msg = client_rx.next() => {
                match msg {
                    Some(Ok(m)) => {
                        let closing = matches!(m, AxumMsg::Close(_));
                        if up_tx.send(axum_to_tungstenite(m)).await.is_err() || closing {
                            break;
                        }
                    }
                    _ => {
                        let _ = up_tx.send(TgMsg::Close(None)).await;
                        break;
                    }
                }
            }
            msg = up_rx.next() => {
                match msg {
                    Some(Ok(m)) => {
                        let Some(converted) = tungstenite_to_axum(m) else { continue };
                        let closing = matches!(converted, AxumMsg::Close(_));
                        if client_tx.send(converted).await.is_err() || closing {
                            break;
                        }
                    }
                    _ => {
                        let _ = client_tx.send(AxumMsg::Close(None)).await;
                        break;
                    }
                }
            }
        }
    }
}

fn axum_to_tungstenite(msg: AxumMsg) -> TgMsg {
    match msg {
        AxumMsg::Text(t) => TgMsg::Text(t.as_str().into()),
        AxumMsg::Binary(b) => TgMsg::Binary(b),
        AxumMsg::Ping(b) => TgMsg::Ping(b),
        AxumMsg::Pong(b) => TgMsg::Pong(b),
        AxumMsg::Close(frame) => TgMsg::Close(frame.map(|f| TgCloseFrame {
            code: CloseCode::from(f.code),
            reason: f.reason.as_str().into(),
        })),
    }
}

fn tungstenite_to_axum(msg: TgMsg) -> Option<AxumMsg> {
    match msg {
        TgMsg::Text(t) => Some(AxumMsg::Text(t.as_str().into())),
        TgMsg::Binary(b) => Some(AxumMsg::Binary(b)),
        TgMsg::Ping(b) => Some(AxumMsg::Ping(b)),
        TgMsg::Pong(b) => Some(AxumMsg::Pong(b)),
        TgMsg::Close(frame) => Some(AxumMsg::Close(frame.map(|f| CloseFrame {
            code: f.code.into(),
            reason: f.reason.as_str().into(),
        }))),
        // 生フレームは tungstenite の read では通常現れない
        TgMsg::Frame(_) => None,
    }
}
