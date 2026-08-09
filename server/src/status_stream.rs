//! ワークスペース git ステータス／エージェント状態のリアルタイム配信 WebSocket の
//! 共有基盤（Python 側 `api/ws_broadcast.py` + `api/routers/status_stream.py` の
//! 移植のうち、購読者管理の基盤部分）。
//!
//! Python 版は git_watch / agent_watch / session_watch / dispatch の各モジュールが
//! それぞれ独自の購読者 set（`set[WebSocket]`）を持ち、`call_soon_threadsafe` で
//! イベントループへスケジュールしてから `broadcast_to()` で fan-out する設計だった
//! （同期ハンドラの threadpool から呼ばれるため）。
//!
//! Rust 版は `AppState` に保持する単一の `tokio::sync::broadcast` channel に
//! 全プロデューサが直接 `send()` するだけでよい: マルチスレッドからの送信は
//! `broadcast::Sender` がもとよりスレッドセーフであり、購読者数も
//! `Sender::receiver_count()` で直接わかるため、モジュールごとの購読者 set 管理も
//! 個別のスレッドセーフスケジューリングの仕組みも不要になった
//! （購読者ゼロの間は監視・ポーリングタスクを止めるという設計思想はそのまま維持する
//! — `receiver_count() == 0` を停止条件に使う）。
//!
//! WS エンドポイント自体（`status_stream_ws`）はこのファイルで実装済みだが、
//! まだ `build_router` には配線していない — git_watch の FS 監視ループ・
//! agent_watch のポーリングループ・dispatch の直接配信化が揃うまでは、配信元
//! （producer）が無いため接続しても何も届かない（Python 側の同エンドポイントが
//! 引き続き実トラフィックを処理する）。全 producer が揃った時点で一括配線する。

use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::{IntoResponse, Response};
use futures_util::SinkExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::state::AppState;
use crate::util::QueryParams;

/// Python `WS_PING_INTERVAL_SEC`（`api/common.py`）と同じ間隔。
const WS_PING_INTERVAL_SEC: u64 = 15;

/// 既定のバッファ容量。broadcast channel は受信が遅い購読者がこの件数分
/// 遅れると古いメッセージから `Lagged` エラーで欠落させる（tokio の設計）。
/// 状態配信は「欠けても次回配信 or 再接続時のスナップショットで復帰する」性質の
/// データなので、欠落そのものは許容する（Python 版にも配信保証は無い）。
const BROADCAST_CAPACITY: usize = 256;

pub struct StatusStreamState {
    pub tx: broadcast::Sender<Value>,
}

impl StatusStreamState {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        Self { tx }
    }

    /// 現在の購読者数（`tx.subscribe()` で受信側を作った WS 接続の数）。
    /// git_watch / agent_watch のポーリング・監視タスクの起動/停止条件に使う。
    pub fn subscriber_count(&self) -> usize {
        self.tx.receiver_count()
    }

    /// 購読者へ payload を配信する。購読者が一人もいなければ黙って無視する
    /// （Python の `if not _subscribers: return` 相当 — broadcast channel は
    /// 受信者ゼロで `send()` が `Err` を返すだけなので、それを握りつぶす）。
    pub fn broadcast(&self, payload: Value) {
        let _ = self.tx.send(payload);
    }
}

impl Default for StatusStreamState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(default)]
    token: String,
}

/// `GET /workspaces/statuses/ws`（Python 側 `routers/status_stream.py` の
/// `workspace_statuses_ws` 相当）。認証確認後にアップグレードし、以後は
/// `StatusStreamState` への配信をそのままクライアントへ中継する。
pub async fn status_stream_ws(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    QueryParams(query): QueryParams<WsQuery>,
    headers: http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !crate::auth::verify_ws_token(&state, &query.token, &addr.ip().to_string(), &headers) {
        return (http::StatusCode::FORBIDDEN, "Unauthorized").into_response();
    }
    ws.on_upgrade(move |socket| async move {
        handle_status_stream_ws(state, socket).await;
    })
}

async fn handle_status_stream_ws(state: Arc<AppState>, mut socket: WebSocket) {
    let mut rx = state.status_stream.tx.subscribe();
    tracing::info!("status stream connected");
    // Python 版は git_watch/agent_watch/dispatch/session_watch それぞれの
    // subscribe() を個別に呼ぶが、Rust 版は購読者集合が `StatusStreamState`
    // 一本化されているため、producer 側の常駐タスク起動はここでの
    // `ensure_tasks` 呼び出しだけで済む。
    crate::git_watch::ensure_tasks(&state);
    crate::agent_watch::ensure_tasks(&state);
    // Python `dispatch.subscribe` と同じく、現在の dispatch キュー全量を
    // 全購読者へ再送する（この接続はここより前に `tx.subscribe()` 済みなので、
    // 以後の `rx.recv()` ループで自然に受け取る — 冪等な全量スナップショットの
    // ため、既存購読者への再送も無害）。
    crate::dispatch::broadcast_current_queue(&state).await;
    // Python `agent_watch.subscribe` と同じく、既知の agent 状態スナップショットを
    // この接続にだけ即時送信する（再接続時にポーリング1周期分の空白が生まれない
    // ようにする — 全購読者への broadcast ではなく、この socket への直送）。
    if let Some(snapshot) = crate::agent_watch::initial_snapshot(&state).await {
        if socket
            .send(Message::Text(snapshot.to_string().into()))
            .await
            .is_err()
        {
            drop(rx);
            crate::git_watch::maybe_stop_tasks(&state);
            crate::agent_watch::maybe_stop_tasks(&state);
            return;
        }
    }

    let mut ping_interval = tokio::time::interval(Duration::from_secs(WS_PING_INTERVAL_SEC));
    ping_interval.tick().await; // 初回 tick は即座に完了するため消費しておく

    loop {
        tokio::select! {
            broadcast_msg = rx.recv() => {
                match broadcast_msg {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    // 受信が遅く buffer 分（`BROADCAST_CAPACITY`）取りこぼした。
                    // Python 版にも配信保証は無く、次回配信 or クライアント側の
                    // 再接続時全量同期（`useStatusStream.js`）で復帰する設計のため、
                    // 切断はせずそのまま継続する。
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("status stream lagged, skipped {n} messages");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = ping_interval.tick() => {
                if socket
                    .send(Message::Text(json!({"type": "ping"}).to_string().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            msg = socket.recv() => {
                let Some(Ok(msg)) = msg else { break };
                if matches!(msg, Message::Close(_)) {
                    break;
                }
            }
        }
    }
    // 購読者数の判定（`StatusStreamState::subscriber_count`）に反映されるよう、
    // タスク停止判定の前に受信側を明示的に破棄する。
    drop(rx);
    crate::git_watch::maybe_stop_tasks(&state);
    crate::agent_watch::maybe_stop_tasks(&state);
    let _ = socket.close().await;
    tracing::info!("status stream disconnected");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn broadcast_with_no_subscribers_is_a_noop() {
        let state = StatusStreamState::new();
        assert_eq!(state.subscriber_count(), 0);
        // 購読者が居なくても panic せず、単に配信されないだけ。
        state.broadcast(json!({"type": "ping"}));
    }

    #[tokio::test]
    async fn subscriber_receives_broadcast_payload() {
        let state = StatusStreamState::new();
        let mut rx = state.tx.subscribe();
        assert_eq!(state.subscriber_count(), 1);

        state.broadcast(json!({"type": "session_created", "session_id": "s1"}));
        let received = rx.recv().await.unwrap();
        assert_eq!(
            received,
            json!({"type": "session_created", "session_id": "s1"})
        );
    }

    #[tokio::test]
    async fn multiple_subscribers_all_receive() {
        let state = StatusStreamState::new();
        let mut rx1 = state.tx.subscribe();
        let mut rx2 = state.tx.subscribe();
        assert_eq!(state.subscriber_count(), 2);

        state.broadcast(json!({"type": "ping"}));
        assert_eq!(rx1.recv().await.unwrap(), json!({"type": "ping"}));
        assert_eq!(rx2.recv().await.unwrap(), json!({"type": "ping"}));
    }

    #[tokio::test]
    async fn dropped_subscriber_decrements_count() {
        let state = StatusStreamState::new();
        let rx = state.tx.subscribe();
        assert_eq!(state.subscriber_count(), 1);
        drop(rx);
        assert_eq!(state.subscriber_count(), 0);
    }
}
