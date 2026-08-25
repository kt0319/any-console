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
//! WS エンドポイント（`status_stream_ws`）は `build_router`（lib.rs）で
//! `/workspaces/statuses/ws` に配線済み。producer は git_watch の FS 監視ループ・
//! agent_watch のポーリングループ・session_watch・dispatch の各配信。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
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
    /// 接続ごとに「どのデバイスが今どのセッションを見ているか」を保持する
    /// （push通知の「その端末で開いているセッションには送らない」抑制判定用）。
    /// 1デバイスが複数タブ/接続を持つことがあるため、接続単位（conn_id）で
    /// 管理し、判定時は同じdevice_idの全接続を横断して探す。
    viewing: Mutex<HashMap<u64, (String, Option<String>)>>,
    next_conn_id: AtomicU64,
}

impl StatusStreamState {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            tx,
            viewing: Mutex::new(HashMap::new()),
            next_conn_id: AtomicU64::new(1),
        }
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

    /// 新しいWS接続を「閲覧状態」レジストリへ登録し、この接続専用のIDを返す
    /// （device_idが無い＝デバイス認証以外の接続は追跡しない）。
    pub fn register_viewer(&self, device_id: Option<String>) -> Option<u64> {
        let device_id = device_id?;
        let conn_id = self.next_conn_id.fetch_add(1, Ordering::Relaxed);
        self.viewing
            .lock()
            .expect("status stream viewing lock poisoned")
            .insert(conn_id, (device_id, None));
        Some(conn_id)
    }

    /// 接続が今見ているセッションを更新する（`None`はタブが非表示/非フォーカス
    /// になったことを表す）。
    pub fn update_viewing(&self, conn_id: u64, session_id: Option<String>) {
        if let Some(entry) = self
            .viewing
            .lock()
            .expect("status stream viewing lock poisoned")
            .get_mut(&conn_id)
        {
            entry.1 = session_id;
        }
    }

    /// 接続切断時にレジストリから取り除く。
    pub fn unregister_viewer(&self, conn_id: u64) {
        self.viewing
            .lock()
            .expect("status stream viewing lock poisoned")
            .remove(&conn_id);
    }

    /// 指定デバイスの接続（複数タブありうる）のいずれかが、今まさに
    /// `session_id` を見ているか。
    pub fn is_device_viewing(&self, device_id: &str, session_id: &str) -> bool {
        self.viewing
            .lock()
            .expect("status stream viewing lock poisoned")
            .values()
            .any(|(d, s)| d == device_id && s.as_deref() == Some(session_id))
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
    QueryParams(query): QueryParams<WsQuery>,
    headers: http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(auth) = crate::auth::verify_ws_token(&state, &query.token, &headers) else {
        return (http::StatusCode::FORBIDDEN, "Unauthorized").into_response();
    };
    let device_id = auth.device_id().map(str::to_string);
    ws.on_upgrade(move |socket| async move {
        handle_status_stream_ws(state, socket, device_id).await;
    })
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    /// 今アクティブなタブ/フォーカス中のセッションが変わった通知。
    /// `session_id: null` はどのセッションも見ていない（バックグラウンド化・
    /// タブ全閉じ等）ことを表す。push通知の「その端末で今そのセッションを
    /// 見ているなら送らない」抑制判定に使う（`StatusStreamState::is_device_viewing`）。
    Viewing { session_id: Option<String> },
}

async fn handle_status_stream_ws(
    state: Arc<AppState>,
    mut socket: WebSocket,
    device_id: Option<String>,
) {
    let mut rx = state.status_stream.tx.subscribe();
    let conn_id = state.status_stream.register_viewer(device_id.clone());
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

    stream_until_disconnect(&state, &mut socket, &mut rx, conn_id, device_id.as_deref()).await;

    // 単一のクリーンアップ出口: 途中の送信失敗を含むすべての切断経路がここを通る。
    // 購読者数の判定（`StatusStreamState::subscriber_count`）に反映されるよう、
    // タスク停止判定の前に受信側を明示的に破棄する。
    drop(rx);
    if let Some(id) = conn_id {
        state.status_stream.unregister_viewer(id);
    }
    crate::git_watch::maybe_stop_tasks(&state);
    crate::agent_watch::maybe_stop_tasks(&state);
    let _ = socket.close().await;
    tracing::info!("status stream disconnected");
}

/// 接続1本ぶんの送受信ループ。戻った時点で切断が確定しており、後始末
/// （受信側破棄・viewer 解除・タスク停止判定）は呼び出し元が一括で行う。
async fn stream_until_disconnect(
    state: &Arc<AppState>,
    socket: &mut WebSocket,
    rx: &mut broadcast::Receiver<Value>,
    conn_id: Option<u64>,
    device_id: Option<&str>,
) {
    // Python `agent_watch.subscribe` と同じく、既知の agent 状態スナップショットを
    // この接続にだけ即時送信する（再接続時にポーリング1周期分の空白が生まれない
    // ようにする — 全購読者への broadcast ではなく、この socket への直送）。
    if let Some(snapshot) = crate::agent_watch::initial_snapshot(state).await {
        if socket
            .send(Message::Text(snapshot.to_string().into()))
            .await
            .is_err()
        {
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
                // デバイス cookie 認証の接続は revoke 済みデバイスへの配信を
                // 続けないよう ping ごとに存続を確認する（terminal.rs の WS と
                // 同方式 — WS はハンドシェイク時のみ認証されるため）。
                if let Some(id) = device_id {
                    if crate::devices::get_device(&state.paths.data_dir, id).is_none() {
                        break;
                    }
                }
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
                match msg {
                    Message::Close(_) => break,
                    Message::Text(text) => {
                        if let (Some(id), Ok(ClientMessage::Viewing { session_id })) =
                            (conn_id, serde_json::from_str::<ClientMessage>(&text))
                        {
                            state.status_stream.update_viewing(id, session_id);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
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

    // ─── viewing レジストリ（push抑制判定） ──────────────────────────────

    #[test]
    fn register_viewer_without_device_id_returns_none() {
        let state = StatusStreamState::new();
        assert_eq!(state.register_viewer(None), None);
    }

    #[test]
    fn update_viewing_reflects_in_is_device_viewing() {
        let state = StatusStreamState::new();
        let conn_id = state.register_viewer(Some("dev_1".to_string())).unwrap();
        assert!(!state.is_device_viewing("dev_1", "s1"));

        state.update_viewing(conn_id, Some("s1".to_string()));
        assert!(state.is_device_viewing("dev_1", "s1"));
        assert!(!state.is_device_viewing("dev_1", "s2"));
        assert!(!state.is_device_viewing("dev_2", "s1"));
    }

    #[test]
    fn update_viewing_to_none_clears_it() {
        let state = StatusStreamState::new();
        let conn_id = state.register_viewer(Some("dev_1".to_string())).unwrap();
        state.update_viewing(conn_id, Some("s1".to_string()));
        assert!(state.is_device_viewing("dev_1", "s1"));

        state.update_viewing(conn_id, None);
        assert!(!state.is_device_viewing("dev_1", "s1"));
    }

    #[test]
    fn unregister_viewer_removes_entry() {
        let state = StatusStreamState::new();
        let conn_id = state.register_viewer(Some("dev_1".to_string())).unwrap();
        state.update_viewing(conn_id, Some("s1".to_string()));
        assert!(state.is_device_viewing("dev_1", "s1"));

        state.unregister_viewer(conn_id);
        assert!(!state.is_device_viewing("dev_1", "s1"));
    }

    #[test]
    fn same_device_multiple_tabs_any_matching_tab_counts() {
        let state = StatusStreamState::new();
        let tab1 = state.register_viewer(Some("dev_1".to_string())).unwrap();
        let tab2 = state.register_viewer(Some("dev_1".to_string())).unwrap();
        state.update_viewing(tab1, Some("s1".to_string()));
        state.update_viewing(tab2, Some("s2".to_string()));

        assert!(state.is_device_viewing("dev_1", "s1"));
        assert!(state.is_device_viewing("dev_1", "s2"));
        assert!(!state.is_device_viewing("dev_1", "s3"));

        // 片方のタブがs1を閉じても、もう片方(tab2)はs2を見続けているので
        // dev_1全体としてのs2閲覧は変わらない。
        state.unregister_viewer(tab1);
        assert!(!state.is_device_viewing("dev_1", "s1"));
        assert!(state.is_device_viewing("dev_1", "s2"));
    }
}
