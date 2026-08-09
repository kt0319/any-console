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
//! まだ実際の `/workspaces/statuses/ws` エンドポイントへは配線していない —
//! git_watch の FS 監視ループ・agent_watch のポーリングループ・dispatch の直接
//! 配信化が揃うまでは、ここに send しても購読者は存在しない（Python 側の同エンドポイントが
//! 引き続き実トラフィックを処理する）。

use tokio::sync::broadcast;

use serde_json::Value;

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
