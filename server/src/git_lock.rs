//! ワークスペース単位の git 書き込みロック（Python 側 `api/git_lock.py` の移植）。
//!
//! プロセス内の API 起点 git 操作同士を直列化する（旧 Python 実装の
//! `workspace_write_lock` と同じくプロセス内ロックのみ。dispatch の checkout
//! （`ensure_branch`）は元々このロックを取らない）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::errors::{server_error, ApiError};

const LOCK_TIMEOUT_SEC: f64 = 30.0;

#[derive(Default)]
pub struct WorkspaceLocks {
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl WorkspaceLocks {
    pub fn new() -> Self {
        Self::default()
    }

    fn get_lock(&self, name: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.locks.lock().expect("workspace locks poisoned");
        locks.entry(name.to_string()).or_default().clone()
    }

    /// ロックを取得する（30秒でタイムアウトし 500 を返す — Python と同一挙動）。
    pub async fn acquire(&self, name: &str) -> Result<tokio::sync::OwnedMutexGuard<()>, ApiError> {
        let lock = self.get_lock(name);
        tokio::time::timeout(Duration::from_secs_f64(LOCK_TIMEOUT_SEC), lock.lock_owned())
            .await
            .map_err(|_| server_error("Another git operation is in progress for this workspace"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serializes_same_workspace_but_not_others() {
        let locks = Arc::new(WorkspaceLocks::new());
        let g1 = locks.acquire("ws_a").await.unwrap();
        // 別ワークスペースは即座に取れる
        let _g2 = locks.acquire("ws_b").await.unwrap();
        // 同一ワークスペースは解放されるまで待つ
        let locks2 = locks.clone();
        let waiter = tokio::spawn(async move { locks2.acquire("ws_a").await.map(|_| ()) });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!waiter.is_finished());
        drop(g1);
        waiter.await.unwrap().unwrap();
    }
}
