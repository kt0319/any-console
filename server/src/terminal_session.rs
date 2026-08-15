//! ターミナルセッションのレジストリと per-client PTY ブリッジ
//! （Python 側 `api/terminal_session.py` の移植）。
//!
//! tmux ベースセッション（＝1シェル）ごとに `TerminalSession` を持ち、各 WebSocket
//! クライアントは `ClientBridge` としてベースセッションへ独立した tmux クライアント
//! （PTY 経由）でアタッチする。サイズは各クライアントの PTY winsize だけで決まり、
//! tmux の `window-size latest` ポリシーで直近アクティブなクライアントへ追従する。
//!
//! WebSocket/axum への依存は持たない（このモジュールは PTY 出力を汎用チャネルへ
//! 流すところまでを担い、実際の WS 送受信は router 側の責務にする）。

use std::collections::HashMap;
use std::sync::Arc;

use nix::unistd::Pid;
use tokio::sync::{mpsc, Mutex};

use crate::config::ConfigStore;
use crate::errors::{not_found, server_error, too_many_requests, ApiError};
use crate::git_utils::worktree_base_of;
use crate::tmux::{self, TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS};
use crate::util::sanitize_session_segment;

pub const MAX_TERMINAL_SESSIONS: usize = 20;

/// PTY から読み取ったデータを router 側（WS 送信）へ渡すためのイベント。
pub enum PtyEvent {
    Data(Vec<u8>),
    /// シェル終了などで PTY が EOF に達した（このブリッジのクライアントを閉じるべき）。
    Eof,
}

pub struct ClientBridge {
    pty: Arc<crate::pty::AsyncPty>,
    pid: Pid,
    pub applied_size: (u16, u16),
    reader_handle: tokio::task::JoinHandle<()>,
}

impl ClientBridge {
    pub fn as_raw_fd(&self) -> std::os::fd::RawFd {
        self.pty.as_raw_fd()
    }

    /// この接続専用 PTY へ書き込む（Python の `os.write(bridge.fd, data)` 相当）。
    pub fn write(&self, data: &[u8]) -> std::io::Result<usize> {
        let fd = self.pty.as_raw_fd();
        let n = unsafe { libc::write(fd, data.as_ptr() as *const libc::c_void, data.len()) };
        if n < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(n as usize)
        }
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        if cols == 0 || rows == 0 || self.applied_size == (cols, rows) {
            return;
        }
        self.applied_size = (cols, rows);
        crate::pty::resize(self.pty.as_raw_fd(), cols, rows);
    }
}

pub struct TerminalSession {
    pub workspace: Option<String>,
    /// workspace が worktree（"{base}:{branch}"形式）の時のベース名/ブランチ名。
    /// workspace から split_worktree_name で都度導出する（別途永続化はしない）。
    /// 直接代入せず set_workspace() 経由で更新すること。
    pub worktree_base: Option<String>,
    pub worktree_branch: Option<String>,
    pub icon: Option<String>,
    pub icon_color: Option<String>,
    pub job_name: Option<String>,
    pub job_label: Option<String>,
    /// UI から直接操作して開かれたセッションかどうか（tmux 環境変数は "1"/未設定）。
    pub interactive: bool,
    pub tmux_session_name: String,
    pub bridges: HashMap<u64, ClientBridge>,
    next_bridge_id: u64,
    /// detached セッションは dispatch のターゲット候補から除外する。
    pub detached: bool,
    /// pending text（TMUX_PENDING_TEXT）の flush 権を既にどれかの WS attach が
    /// クレーム済みかどうか。`claim_pending_text_flush` 経由でのみ変更する。
    pending_text_claimed: bool,
}

impl TerminalSession {
    fn new(tmux_session_name: String) -> Self {
        Self {
            workspace: None,
            worktree_base: None,
            worktree_branch: None,
            icon: None,
            icon_color: None,
            job_name: None,
            job_label: None,
            interactive: false,
            tmux_session_name,
            bridges: HashMap::new(),
            next_bridge_id: 0,
            detached: false,
            pending_text_claimed: false,
        }
    }

    /// workspace をセットし、同時に worktree_base/worktree_branch を
    /// split_worktree_name から再計算する（workspaceとの直接代入は避け、
    /// これを経由してズレを防ぐ）。
    pub fn set_workspace(&mut self, workspace: Option<String>) {
        let split = workspace
            .as_deref()
            .and_then(crate::git_utils::split_worktree_name);
        self.worktree_base = split.as_ref().map(|(b, _)| b.clone());
        self.worktree_branch = split.map(|(_, br)| br);
        self.workspace = workspace;
    }

    /// tmux セッションの環境変数（`TMUX_WORKSPACE` 等）から再構築する
    /// （Python `TerminalSession.from_tmux` 相当）。
    pub async fn from_tmux(config: &ConfigStore, tmux_name: &str) -> Self {
        let meta = tmux::load_tmux_metadata(tmux_name).await;
        let workspace = match meta.get("TMUX_WORKSPACE").filter(|s| !s.is_empty()) {
            Some(ws) => Some(ws.clone()),
            None => tmux::detect_workspace_from_tmux(config, tmux_name).await,
        };
        let mut sess = Self::new(tmux_name.to_string());
        sess.set_workspace(workspace);
        sess.icon = meta.get("TMUX_ICON").cloned();
        sess.icon_color = meta.get("TMUX_ICON_COLOR").cloned();
        sess.job_name = meta.get("TMUX_JOB_NAME").cloned();
        sess.job_label = meta.get("TMUX_JOB_LABEL").cloned();
        sess.interactive = meta.get("TMUX_INTERACTIVE").is_some_and(|v| !v.is_empty());
        sess.detached = meta.get("TMUX_DETACHED").is_some_and(|v| !v.is_empty());
        sess
    }

    pub async fn save_metadata(&self) {
        let mut pairs: Vec<(&str, &str)> = Vec::new();
        if let Some(v) = self.workspace.as_deref().filter(|s| !s.is_empty()) {
            pairs.push(("TMUX_WORKSPACE", v));
        }
        if let Some(v) = self.icon.as_deref().filter(|s| !s.is_empty()) {
            pairs.push(("TMUX_ICON", v));
        }
        if let Some(v) = self.icon_color.as_deref().filter(|s| !s.is_empty()) {
            pairs.push(("TMUX_ICON_COLOR", v));
        }
        if let Some(v) = self.job_name.as_deref().filter(|s| !s.is_empty()) {
            pairs.push(("TMUX_JOB_NAME", v));
        }
        if let Some(v) = self.job_label.as_deref().filter(|s| !s.is_empty()) {
            pairs.push(("TMUX_JOB_LABEL", v));
        }
        if self.interactive {
            pairs.push(("TMUX_INTERACTIVE", "1"));
        }
        if pairs.is_empty() {
            return;
        }
        if tmux::set_environment(&self.tmux_session_name, &pairs)
            .await
            .is_none()
        {
            tracing::error!("save metadata error session={}", self.tmux_session_name);
        }
    }

    pub async fn save_detached(&self) {
        let result = if self.detached {
            tmux::set_environment(&self.tmux_session_name, &[("TMUX_DETACHED", "1")]).await
        } else {
            tmux::unset_environment(&self.tmux_session_name, "TMUX_DETACHED").await
        };
        if result.is_none() {
            tracing::warn!("save_detached failed session={}", self.tmux_session_name);
        }
    }

    pub async fn save_workspace(&self) {
        let result = match self.workspace.as_deref().filter(|s| !s.is_empty()) {
            Some(ws) => {
                tmux::set_environment(&self.tmux_session_name, &[("TMUX_WORKSPACE", ws)]).await
            }
            None => tmux::unset_environment(&self.tmux_session_name, "TMUX_WORKSPACE").await,
        };
        if result.is_none() {
            tracing::warn!("save_workspace failed session={}", self.tmux_session_name);
        }
    }

    /// この接続専用の PTY でベースセッションへ独立アタッチし、読み取りループを
    /// 起動する（Python `attach_client_bridge` + `register_bridge` +
    /// `start_bridge_reader` 相当）。ブリッジ ID を返す。
    pub fn attach_client_bridge(
        &mut self,
        cols: u16,
        rows: u16,
        session_id: String,
        outgoing: mpsc::UnboundedSender<PtyEvent>,
    ) -> std::io::Result<u64> {
        let effective_cols = if cols > 0 {
            cols
        } else {
            TERMINAL_DEFAULT_COLS
        };
        let effective_rows = if rows > 0 {
            rows
        } else {
            TERMINAL_DEFAULT_ROWS
        };
        let child =
            tmux::attach_tmux_session(&self.tmux_session_name, effective_cols, effective_rows)?;
        let pty = Arc::new(crate::pty::AsyncPty::new(child.master)?);
        let reader_pty = pty.clone();
        let reader_handle = tokio::spawn(async move {
            let mut buf = [0u8; 16384];
            loop {
                match reader_pty.read(&mut buf).await {
                    Ok(0) => {
                        tracing::info!("PTY EOF detected, closing client session={session_id}");
                        let _ = outgoing.send(PtyEvent::Eof);
                        break;
                    }
                    Ok(n) => {
                        if outgoing.send(PtyEvent::Data(buf[..n].to_vec())).is_err() {
                            break; // 受信側（WS 送信ループ）が既に終了している
                        }
                    }
                    Err(e) => {
                        tracing::debug!("bridge reader ended session={session_id}: {e}");
                        break;
                    }
                }
            }
        });
        let id = self.next_bridge_id;
        self.next_bridge_id += 1;
        self.bridges.insert(
            id,
            ClientBridge {
                pty,
                pid: child.pid,
                applied_size: (effective_cols, effective_rows),
                reader_handle,
            },
        );
        Ok(id)
    }

    /// 1つのブリッジを完全に閉じる（reader 停止・PTY 解放。ベースセッションは残す）。
    pub fn close_client_bridge(&mut self, bridge_id: u64) {
        if let Some(bridge) = self.bridges.remove(&bridge_id) {
            bridge.reader_handle.abort();
            crate::pty::terminate(bridge.pid);
            // fd 自体は Arc<AsyncPty> の最後の drop（この bridge + 既に abort 済みの
            // reader task 側）で自動的に close される。
        }
    }

    /// 全クライアントブリッジを切断する（Python `_detach_pty_bridge` 相当）。
    pub fn close_all_bridges(&mut self) {
        let ids: Vec<u64> = self.bridges.keys().copied().collect();
        for id in ids {
            self.close_client_bridge(id);
        }
    }

    /// pending text（TMUX_PENDING_TEXT）の flush 権を1回だけクレームする
    /// （Codex レビュー指摘: 新規作成直後のセッションへ複数 WS クライアントが
    /// ほぼ同時に attach すると、tmux 環境変数の存在確認と削除が別コマンドで
    /// 非atomicなため両方が flush してしまい二重送信になる）。呼び出し元は
    /// `session_arc` の Mutex を保持したままこれを呼ぶことで、プロセス内では
    /// 最初の1回だけ `Some(tmux_session_name)` を受け取れる。
    pub fn claim_pending_text_flush(&mut self) -> Option<String> {
        if self.pending_text_claimed {
            None
        } else {
            self.pending_text_claimed = true;
            Some(self.tmux_session_name.clone())
        }
    }
}

/// ターミナルセッションのレジストリ（Python `TERMINAL_SESSIONS` + `sessions_lock` 相当）。
#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, Arc<Mutex<TerminalSession>>>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn len(&self) -> usize {
        self.sessions.lock().await.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.sessions.lock().await.is_empty()
    }

    pub async fn get(&self, session_id: &str) -> Option<Arc<Mutex<TerminalSession>>> {
        self.sessions.lock().await.get(session_id).cloned()
    }

    pub async fn remove(&self, session_id: &str) -> Option<Arc<Mutex<TerminalSession>>> {
        self.sessions.lock().await.remove(session_id)
    }

    pub async fn insert(
        &self,
        session_id: String,
        session: TerminalSession,
    ) -> Arc<Mutex<TerminalSession>> {
        let arc = Arc::new(Mutex::new(session));
        self.sessions.lock().await.insert(session_id, arc.clone());
        arc
    }

    /// 全セッションのスナップショット（`/terminal/sessions` 一覧などで使う）。
    pub async fn snapshot(&self) -> HashMap<String, Arc<Mutex<TerminalSession>>> {
        self.sessions.lock().await.clone()
    }

    /// tmux セッションを作成しレジストリへ登録する（Python `create_registered_session`）。
    ///
    /// `workspace` が指定されていれば session_id は `{sanitize(worktree_base)}-{短いID}`、
    /// 無指定なら短い ID のみになる。
    #[allow(clippy::too_many_arguments)]
    pub async fn create_registered_session(
        &self,
        data_dir: &std::path::Path,
        config: &ConfigStore,
        project_root: &std::path::Path,
        tmux_prefix: &str,
        workspace_path: Option<&str>,
        workspace: Option<String>,
        icon: Option<String>,
        icon_color: Option<String>,
        job_name: Option<String>,
        job_label: Option<String>,
        interactive: bool,
    ) -> Result<(String, Arc<Mutex<TerminalSession>>), ApiError> {
        if self.len().await >= MAX_TERMINAL_SESSIONS {
            return Err(too_many_requests(format!(
                "Maximum number of terminal sessions reached ({MAX_TERMINAL_SESSIONS})"
            )));
        }
        let short_id = crate::util::token_urlsafe(6);
        let session_id = match workspace.as_deref() {
            Some(ws) => format!(
                "{}-{short_id}",
                sanitize_session_segment(&worktree_base_of(ws))
            ),
            None => short_id,
        };
        let tmux_name = format!("{tmux_prefix}{session_id}");
        tmux::create_tmux_session(data_dir, config, project_root, workspace_path, &tmux_name)
            .await
            .map_err(|e| server_error(format!("Failed to create terminal: {e}")))?;

        let mut session = TerminalSession::new(tmux_name);
        session.set_workspace(workspace);
        session.icon = icon;
        session.icon_color = icon_color;
        session.job_name = job_name;
        session.job_label = job_label;
        session.interactive = interactive;
        session.save_metadata().await;

        let arc = self.insert(session_id.clone(), session).await;
        Ok((session_id, arc))
    }

    /// tmux 名プレフィックスを外した ID からセッションを解決する（レジストリに
    /// 無ければ tmux の実在確認 → メタデータ復元で on-demand 登録する。Python
    /// `get_terminal_session` 相当）。
    ///
    /// 存在確認・復元・登録までを `sessions` の同じロック区間で行う
    /// （Codex レビュー指摘: 以前は `get` → `insert` が別ロックに分かれており、
    /// Rust 再起動直後に同じ未登録セッションへ2クライアントが同時に attach すると
    /// 両方とも「未登録」を観測して別々の `TerminalSession` を作ってしまい、
    /// 一方だけがレジストリに残る一方で pending_text_claimed 等の per-session
    /// 状態が2つのインスタンスに分裂し、pending text の二重送信につながる）。
    pub async fn get_or_register(
        &self,
        config: &ConfigStore,
        tmux_prefix: &str,
        session_id: &str,
    ) -> Result<Arc<Mutex<TerminalSession>>, ApiError> {
        let mut sessions = self.sessions.lock().await;
        if let Some(existing) = sessions.get(session_id) {
            return Ok(existing.clone());
        }
        let tmux_name = format!("{tmux_prefix}{session_id}");
        if !crate::subprocess::tmux_session_exists(&tmux_name).await {
            return Err(not_found("Terminal session not found"));
        }
        let session = TerminalSession::from_tmux(config, &tmux_name).await;
        tracing::info!(
            "on-demand registered tmux session={session_id} workspace={}",
            session.workspace.as_deref().unwrap_or("(none)")
        );
        let arc = Arc::new(Mutex::new(session));
        sessions.insert(session_id.to_string(), arc.clone());
        Ok(arc)
    }

    /// セッションを完全に削除する（全ブリッジ切断 + tmux kill-session。Python
    /// `_kill_tmux_session` 相当）。
    pub async fn kill(&self, session_arc: &Arc<Mutex<TerminalSession>>) {
        let tmux_name = {
            let mut session = session_arc.lock().await;
            session.close_all_bridges();
            session.tmux_session_name.clone()
        };
        crate::subprocess::kill_tmux_by_name(&tmux_name).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_attach_write_and_kill_roundtrip() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let registry = TerminalRegistry::new();
        let prefix = format!("ac-test-{}-", crate::util::token_hex(3));

        let (session_id, session_arc) = registry
            .create_registered_session(
                dir.path(),
                &config,
                dir.path(),
                &prefix,
                None,
                Some("myws".to_string()),
                None,
                None,
                None,
                None,
                true,
            )
            .await
            .expect("session should be created");
        assert!(session_id.starts_with("myws-"));
        assert_eq!(registry.len().await, 1);

        let (tx, mut rx) = mpsc::unbounded_channel();
        let bridge_id = {
            let mut session = session_arc.lock().await;
            assert!(tmux::wait_pane_ready(&session.tmux_session_name, 2.0).await);
            session
                .attach_client_bridge(80, 24, session_id.clone(), tx)
                .expect("attach should succeed")
        };

        {
            let session = session_arc.lock().await;
            let bridge = session.bridges.get(&bridge_id).unwrap();
            bridge.write(b"echo hello-bridge\n").unwrap();
        }

        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Some(PtyEvent::Data(bytes))) => {
                    collected.extend_from_slice(&bytes);
                    if String::from_utf8_lossy(&collected).contains("hello-bridge") {
                        break;
                    }
                }
                Ok(Some(PtyEvent::Eof)) => break,
                _ => continue,
            }
        }
        assert!(
            String::from_utf8_lossy(&collected).contains("hello-bridge"),
            "output was: {:?}",
            String::from_utf8_lossy(&collected)
        );

        // 別ワークスペースからも同名レジストリで on-demand 解決できる
        let looked_up = registry
            .get_or_register(&config, &prefix, &session_id)
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&looked_up, &session_arc));

        registry.kill(&session_arc).await;
        registry.remove(&session_id).await;
        assert!(!crate::subprocess::tmux_session_exists(&format!("{prefix}{session_id}")).await);
    }

    #[tokio::test]
    async fn max_sessions_limit_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let registry = TerminalRegistry::new();
        for i in 0..MAX_TERMINAL_SESSIONS {
            registry
                .insert(format!("s{i}"), TerminalSession::new(format!("tmux-s{i}")))
                .await;
        }
        let result = registry
            .create_registered_session(
                dir.path(),
                &config,
                dir.path(),
                "ac-",
                None,
                None,
                None,
                None,
                None,
                None,
                false,
            )
            .await;
        match result {
            Err(e) => assert_eq!(e.status, axum::http::StatusCode::TOO_MANY_REQUESTS),
            Ok(_) => panic!("expected too_many_requests error"),
        }
    }

    /// Rust 再起動直後（レジストリが空）に、tmux には実在するが未登録の
    /// セッションへ複数クライアントがほぼ同時に attach しても、`get_or_register`
    /// が返す `Arc` は全呼び出しで同一インスタンスであること（Codex レビュー
    /// 指摘: 検証前は get→insert が別ロックで、両方が「未登録」を観測して
    /// 別々の `TerminalSession` を作ってしまい、pending_text_claimed 等の
    /// per-session 状態が分裂していた）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn get_or_register_cold_hydration_is_atomic_under_concurrency() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let prefix = format!("ac-test-{}-", crate::util::token_hex(3));
        let session_id = "cold-race";
        let tmux_name = format!("{prefix}{session_id}");
        crate::subprocess::run_subprocess_safe(
            &["tmux", "new-session", "-d", "-s", &tmux_name],
            5.0,
            None,
        )
        .await;

        // 空のレジストリ（= 再起動直後に相当）に対し、同じ未登録セッションへ
        // 並行に get_or_register する。
        let registry = Arc::new(TerminalRegistry::new());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let registry = registry.clone();
            let config = config.clone();
            let prefix = prefix.clone();
            handles.push(tokio::spawn(async move {
                registry
                    .get_or_register(&config, &prefix, "cold-race")
                    .await
                    .unwrap()
            }));
        }
        let mut arcs = Vec::new();
        for h in handles {
            arcs.push(h.await.unwrap());
        }
        let first_ptr = Arc::as_ptr(&arcs[0]);
        assert!(
            arcs.iter().all(|a| Arc::as_ptr(a) == first_ptr),
            "全呼び出しが同一の TerminalSession インスタンスを返すはず"
        );
        assert_eq!(registry.len().await, 1);

        crate::subprocess::kill_tmux_by_name(&tmux_name).await;
    }

    #[tokio::test]
    async fn get_or_register_missing_session_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        let registry = TerminalRegistry::new();
        let result = registry
            .get_or_register(&config, "ac-test-missing-", "nope")
            .await;
        match result {
            Err(e) => assert_eq!(e.status, axum::http::StatusCode::NOT_FOUND),
            Ok(_) => panic!("expected not_found error"),
        }
    }

    /// 新規作成直後のセッションへ複数 WS クライアントがほぼ同時に attach しても、
    /// pending text の flush 権を得られるのは1回だけであること（Codex レビュー
    /// 指摘: 検証前は tmux 環境変数の存在確認＋削除が非atomicで、両方の attach が
    /// flush_pending_text を起動して二重送信していた）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn claim_pending_text_flush_only_succeeds_once_under_concurrency() {
        let session_arc = Arc::new(Mutex::new(TerminalSession::new("tmux-race".to_string())));
        let mut handles = Vec::new();
        for _ in 0..20 {
            let session_arc = session_arc.clone();
            handles.push(tokio::spawn(async move {
                session_arc.lock().await.claim_pending_text_flush()
            }));
        }
        let mut claimed = 0;
        for h in handles {
            if h.await.unwrap().is_some() {
                claimed += 1;
            }
        }
        assert_eq!(claimed, 1, "flush 権を得られるのはちょうど1回だけ");
        // 2回目以降の呼び出しはずっと None（一度きりのクレーム）。
        assert!(session_arc
            .lock()
            .await
            .claim_pending_text_flush()
            .is_none());
    }
}
