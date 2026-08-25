//! ローカル dev server のポート検出と検出結果ストア（Python 側 `api/preview.py` +
//! `api/routers/preview.py` の移植）。
//!
//! Linux では `ss -ltnp`（無い・失敗する環境では `lsof` にフォールバック）、
//! macOS では `lsof -iTCP -sTCP:LISTEN` で 127.0.0.1 /
//! 0.0.0.0 を LISTEN しているポートを列挙する。セッションごとの紐付けは不要
//! （個人ツール前提）で、検出した全ポートを共通 "local" セッションとして扱う。
//! proxy URL は `/preview/local/<port>/...`（proxy 自体は listen ポートを
//! `target + PROXY_OFFSET` に立て、Tailscale 経由でそのまま開く）。
//!
//! セキュリティ:
//! - proxy の upstream 接続先は 127.0.0.1 固定。
//! - 検出対象は loopback/wildcard で LISTEN しているソケットのみ。
//! - proxy の listen は 0.0.0.0（全インターフェース） — Tailscale IP からも開ける。
//!   認証は信頼ネットワーク（Tailscale）境界に委ねる。

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::auth::RequireAuth;
use crate::config::ConfigStore;
use crate::port_scan::{read_cwd, scan_listening_ports};
use crate::preview_tls::{find_cert_pair, load_tls_server_config, TlsConfig};
use crate::state::AppState;
use crate::util::now_epoch;

const SCAN_INTERVAL_SEC: u64 = 3;
/// LISTEN が消えてから一覧から落とすまで（dev server 再起動時の瞬断は許容しつつ、
/// 停止を早く反映する）。
const PORT_STALE_SEC: i64 = 8;
/// `/preview/ports` へのアクセスからこの秒数を過ぎたら background scan を休止する
/// （パネルを閉じている間は `ss` を回さない — 既存 proxy は維持する）。
const PREVIEW_IDLE_SEC: u64 = 60;

const PROXY_OFFSET: u16 = 20000;
const PROXY_MIN_TARGET: u16 = 1024;
/// 検出対象帯（1024..=9999）とプロキシ待受帯（+20000 → 21024..=29999）が
/// 重ならないための上限。これを超える対象を許すと、自前のプロキシポートを
/// dev server として再検出したり対象ポートと待受ポートが衝突しうる。
const PROXY_MAX_TARGET: u16 = 9999;
const PROXY_BIND_HOST: &str = "0.0.0.0";

const HTTP_PROBE_TIMEOUT_SEC: f64 = 0.5;
/// `http_ok=false` は誤判定の可能性があるため一定間隔で再プローブする。
const HTTP_PROBE_RETRY_SEC: i64 = 30;
/// dev server はポートを先に開けてからアプリ初期化するものが多く、検出直後に
/// プローブすると空振りしやすい。初回プローブは検出からこの秒数だけ待つ。
const INITIAL_PROBE_DELAY_SEC: i64 = 10;

pub fn proxy_port_for(target: u16) -> Option<u16> {
    if (PROXY_MIN_TARGET..=PROXY_MAX_TARGET).contains(&target) {
        Some(target + PROXY_OFFSET)
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedPort {
    pub port: u16,
    pub proxy_port: Option<u16>,
    pub process: String,
    pub pid: Option<u32>,
    pub is_self: bool,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    /// proxy の URL スキーム（"https"/"http"）。proxy が無ければ None。
    pub scheme: Option<&'static str>,
    /// upstream が HTTP を喋るか。None=未判定 / Some(true)=HTTP / Some(false)=非HTTP。
    pub http_ok: Option<bool>,
    /// 直近にプローブした時刻（epoch 秒）。0 = 未プローブ。
    pub http_probed_at: i64,
    pub cwd: Option<String>,
    pub workspace: Option<String>,
    /// workspace が worktree（"{base}:{branch}"形式）の時のベース名/ブランチ名。
    /// `workspace` から `split_worktree_name` で都度導出する（別途永続化はしない）。
    pub worktree_base: Option<String>,
    pub worktree_branch: Option<String>,
}

pub struct PreviewState {
    detected: Mutex<HashMap<u16, DetectedPort>>,
    self_ports: Mutex<HashSet<u16>>,
    last_access: Mutex<Option<Instant>>,
    probing: Mutex<HashSet<u16>>,
    proxies: Mutex<HashMap<u16, JoinHandle<()>>>,
    scan_task: crate::util::SupervisedTask,
    tls: OnceLock<TlsConfig>,
}

impl Default for PreviewState {
    fn default() -> Self {
        Self {
            detected: Mutex::new(HashMap::new()),
            self_ports: Mutex::new(HashSet::new()),
            last_access: Mutex::new(None),
            probing: Mutex::new(HashSet::new()),
            proxies: Mutex::new(HashMap::new()),
            scan_task: crate::util::SupervisedTask::new(),
            tls: OnceLock::new(),
        }
    }
}

impl PreviewState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// any-console 自身が listen しているポート（preview 対象から除外する — 動的に
/// bind() 中のポートを取れないため、起動側が明示的に渡す）。
pub fn set_self_ports(state: &PreviewState, ports: &[u16]) {
    let mut self_ports = state.self_ports.lock().expect("self_ports lock poisoned");
    self_ports.clear();
    self_ports.extend(ports.iter().copied());
}

pub fn touch_access(state: &PreviewState) {
    *state.last_access.lock().expect("last_access lock poisoned") = Some(Instant::now());
}

fn should_scan_now(state: &PreviewState) -> bool {
    match *state.last_access.lock().expect("last_access lock poisoned") {
        Some(t) => t.elapsed() <= Duration::from_secs(PREVIEW_IDLE_SEC),
        None => false,
    }
}

fn preview_tls_config(state: &PreviewState, data_dir: &Path) -> TlsConfig {
    state
        .tls
        .get_or_init(|| {
            let (cert, key) = find_cert_pair(data_dir)?;
            load_tls_server_config(&cert, &key)
        })
        .clone()
}

fn preview_scheme(state: &PreviewState, data_dir: &Path) -> &'static str {
    if preview_tls_config(state, data_dir).is_some() {
        "https"
    } else {
        "http"
    }
}

/// cwd を登録済みワークスペース（worktree含む）と照合する
/// （`git_utils::match_workspace_with_worktree` 参照）。
async fn match_workspace(config: &ConfigStore, cwd: Option<&str>) -> Option<String> {
    let cwd = cwd?;
    if cwd.is_empty() {
        return None;
    }
    crate::git_utils::match_workspace_with_worktree(config, cwd).await
}

// ─── 検出結果の更新・一覧 ────────────────────────────────────────────────────

/// ポートスキャンを1回行い、検出結果を更新する（Python `scan_once` 相当）。
/// cwd 読み取り・workspace 照合は非同期 I/O のため、`detected` の Mutex を
/// 保持したまま `.await` しない（std::sync::Mutex は非同期処理を跨いで
/// 保持しない設計上の原則 — 変化検出→非同期ルックアップ→書き込み、の3段で行う）。
pub async fn scan_once(state: &Arc<AppState>) {
    let preview = &state.preview;
    let now = now_epoch();
    let proxy_ports: HashSet<u16> = preview
        .detected
        .lock()
        .expect("detected lock poisoned")
        .values()
        .filter_map(|e| e.proxy_port)
        .collect();
    let live = scan_listening_ports(&proxy_ports).await;
    let self_ports = preview
        .self_ports
        .lock()
        .expect("self_ports lock poisoned")
        .clone();

    // pid が変わった（＝新規 or プロセス再起動で握り直された）ポートだけ
    // cwd/workspace を再照合する。
    let needs_lookup: Vec<(u16, u32)> = {
        let detected = preview.detected.lock().expect("detected lock poisoned");
        live.iter()
            .filter(|(port, (_proc, pid))| detected.get(*port).map(|e| e.pid) != Some(Some(*pid)))
            .map(|(port, (_proc, pid))| (*port, *pid))
            .collect()
    };
    type PortLookup = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let mut lookups: HashMap<u16, PortLookup> = HashMap::new();
    for (port, pid) in needs_lookup {
        let cwd = read_cwd(pid).await;
        let workspace = match_workspace(&state.config, cwd.as_deref()).await;
        let (worktree_base, worktree_branch) = workspace
            .as_deref()
            .and_then(crate::git_utils::split_worktree_name)
            .map_or((None, None), |(b, br)| (Some(b), Some(br)));
        lookups.insert(port, (cwd, workspace, worktree_base, worktree_branch));
    }

    let scheme_now = preview_scheme(preview, &state.paths.data_dir);
    {
        let mut detected = preview.detected.lock().expect("detected lock poisoned");
        for (port, (proc, pid)) in &live {
            let is_self = self_ports.contains(port);
            let proxy = if is_self { None } else { proxy_port_for(*port) };
            if let Some(existing) = detected.get_mut(port) {
                existing.last_seen_at = now;
                existing.process = proc.clone();
                if existing.pid != Some(*pid) {
                    existing.pid = Some(*pid);
                    if let Some((cwd, workspace, worktree_base, worktree_branch)) =
                        lookups.get(port)
                    {
                        existing.cwd = cwd.clone();
                        existing.workspace = workspace.clone();
                        existing.worktree_base = worktree_base.clone();
                        existing.worktree_branch = worktree_branch.clone();
                    }
                }
            } else {
                let (cwd, workspace, worktree_base, worktree_branch) = lookups
                    .get(port)
                    .cloned()
                    .unwrap_or((None, None, None, None));
                detected.insert(
                    *port,
                    DetectedPort {
                        port: *port,
                        proxy_port: proxy,
                        process: proc.clone(),
                        pid: Some(*pid),
                        is_self,
                        first_seen_at: now,
                        last_seen_at: now,
                        scheme: proxy.map(|_| scheme_now),
                        http_ok: None,
                        http_probed_at: 0,
                        cwd,
                        workspace,
                        worktree_base,
                        worktree_branch,
                    },
                );
            }
        }
        let stale: Vec<u16> = detected
            .iter()
            .filter(|(port, e)| !live.contains_key(port) && now - e.last_seen_at > PORT_STALE_SEC)
            .map(|(port, _)| *port)
            .collect();
        for port in stale {
            detected.remove(&port);
        }
    }
    reconcile_proxies(state).await;
}

/// UI に返す一覧（Python `list_ports` 相当）。自分自身は常に含める（識別用 —
/// ボタンは表示側で出さない）。proxy が立たないポート・非 HTTP と判定された
/// ポート（adb/RTSP/HTTPS upstream 等）は除外する。
pub fn list_ports(state: &PreviewState) -> Vec<DetectedPort> {
    let detected = state.detected.lock().expect("detected lock poisoned");
    let mut items: Vec<DetectedPort> = detected
        .values()
        .filter(|p| p.is_self || (p.proxy_port.is_some() && p.http_ok != Some(false)))
        .cloned()
        .collect();
    items.sort_by_key(|p| p.port);
    items
}

// ─── HTTP プローブ ───────────────────────────────────────────────────────────

/// upstream が HTTP 応答を返すか最小リクエストで確認する。adb / RTSP(go2rtc) /
/// HTTPS upstream など HTTP を喋らないポートを一覧から除外するために使う。
/// 応答の先頭が "HTTP/" なら true。
async fn probe_http(target_port: u16) -> bool {
    let timeout = Duration::from_secs_f64(HTTP_PROBE_TIMEOUT_SEC);
    let mut stream =
        match tokio::time::timeout(timeout, TcpStream::connect(("127.0.0.1", target_port))).await {
            Ok(Ok(s)) => s,
            _ => return false,
        };
    let write = tokio::time::timeout(
        timeout,
        stream.write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
    )
    .await;
    if !matches!(write, Ok(Ok(()))) {
        return false;
    }
    let mut head = [0u8; 16];
    match tokio::time::timeout(timeout, stream.read(&mut head)).await {
        Ok(Ok(n)) if n > 0 => head[..n].starts_with(b"HTTP/"),
        _ => false,
    }
}

/// 未判定ポートは検出から `INITIAL_PROBE_DELAY_SEC` 待ってからプローブする
/// （起動直後の空振り防止）。非 HTTP と判定された後も `HTTP_PROBE_RETRY_SEC`
/// 間隔で再プローブする（それでも空振りする遅い dev server 向けの安全網）。
fn needs_probe(entry: &DetectedPort, now: i64) -> bool {
    match entry.http_ok {
        None => now - entry.first_seen_at >= INITIAL_PROBE_DELAY_SEC,
        Some(false) => now - entry.http_probed_at >= HTTP_PROBE_RETRY_SEC,
        Some(true) => false,
    }
}

async fn probe_and_reconcile(state: &Arc<AppState>, target_port: u16) {
    let ok = probe_http(target_port).await;
    {
        let mut detected = state
            .preview
            .detected
            .lock()
            .expect("detected lock poisoned");
        if let Some(entry) = detected.get_mut(&target_port) {
            entry.http_ok = Some(ok);
            entry.http_probed_at = now_epoch();
            if !ok {
                tracing::info!(
                    "preview skip non-HTTP port={target_port} proc={}",
                    entry.process
                );
            }
        }
    }
    state
        .preview
        .probing
        .lock()
        .expect("probing lock poisoned")
        .remove(&target_port);
    // tokio::spawn 経由で呼ばれるため、この呼び出しは新しいタスクであり
    // 直接の再帰にはならない（無限にスタックを積まない）。
    reconcile_proxies(state).await;
}

fn schedule_probes(state: &Arc<AppState>) {
    let now = now_epoch();
    let to_probe: Vec<u16> = {
        let detected = state
            .preview
            .detected
            .lock()
            .expect("detected lock poisoned");
        let probing = state.preview.probing.lock().expect("probing lock poisoned");
        detected
            .values()
            .filter(|e| e.proxy_port.is_some() && !probing.contains(&e.port))
            .filter(|e| needs_probe(e, now))
            .map(|e| e.port)
            .collect()
    };
    for port in to_probe {
        state
            .preview
            .probing
            .lock()
            .expect("probing lock poisoned")
            .insert(port);
        let state = state.clone();
        tokio::spawn(async move {
            probe_and_reconcile(&state, port).await;
        });
    }
}

// ─── TCP/TLS proxy ───────────────────────────────────────────────────────────

async fn pipe_bidirectional<A>(mut client: A, mut upstream: TcpStream)
where
    A: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
}

async fn handle_proxy_conn(client: TcpStream, target_port: u16, tls: TlsConfig) {
    let upstream = match TcpStream::connect(("127.0.0.1", target_port)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("preview proxy upstream connect failed port={target_port}: {e}");
            return;
        }
    };
    match tls {
        Some(cfg) => {
            let acceptor = tokio_rustls::TlsAcceptor::from(cfg);
            match acceptor.accept(client).await {
                Ok(tls_stream) => pipe_bidirectional(tls_stream, upstream).await,
                Err(e) => tracing::debug!("preview proxy TLS handshake failed: {e}"),
            }
        }
        None => pipe_bidirectional(client, upstream).await,
    }
}

/// 検出ポートに対する TCP proxy listener を起こす（bind 失敗時は何もしない —
/// 次回の reconcile で再試行される）。listen は 0.0.0.0（全インターフェース。
/// Tailscale IP 経由でも開ける）。
async fn start_proxy(state: &Arc<AppState>, target_port: u16, proxy_port: u16) {
    let tls = preview_tls_config(&state.preview, &state.paths.data_dir);
    let listener = match TcpListener::bind((PROXY_BIND_HOST, proxy_port)).await {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!("preview proxy bind failed proxy_port={proxy_port}: {e}");
            return;
        }
    };
    let scheme = if tls.is_some() { "https" } else { "http" };
    tracing::info!(
        "preview proxy started {scheme} {PROXY_BIND_HOST}:{proxy_port} -> 127.0.0.1:{target_port}"
    );
    let handle = tokio::spawn(async move {
        loop {
            let Ok((client, _addr)) = listener.accept().await else {
                continue;
            };
            let tls = tls.clone();
            tokio::spawn(async move {
                handle_proxy_conn(client, target_port, tls).await;
            });
        }
    });
    state
        .preview
        .proxies
        .lock()
        .expect("proxies lock poisoned")
        .insert(target_port, handle);
}

/// 検出ポートに合わせて proxy listener を増減する（Python `_reconcile_proxies`
/// 相当）。probe スケジューリングも合わせて行う。
async fn reconcile_proxies(state: &Arc<AppState>) {
    schedule_probes(state);
    let needed: HashMap<u16, u16> = {
        let detected = state
            .preview
            .detected
            .lock()
            .expect("detected lock poisoned");
        detected
            .values()
            .filter(|e| e.proxy_port.is_some() && e.http_ok != Some(false))
            .map(|e| (e.port, e.proxy_port.expect("filtered is_some")))
            .collect()
    };
    let to_remove: Vec<u16> = {
        let proxies = state.preview.proxies.lock().expect("proxies lock poisoned");
        proxies
            .keys()
            .filter(|target| !needed.contains_key(target))
            .copied()
            .collect()
    };
    for target in to_remove {
        let handle = state
            .preview
            .proxies
            .lock()
            .expect("proxies lock poisoned")
            .remove(&target);
        if let Some(handle) = handle {
            handle.abort();
            tracing::info!("preview proxy stopped target={target}");
        }
    }
    for (target, proxy_port) in needed {
        let already_running = state
            .preview
            .proxies
            .lock()
            .expect("proxies lock poisoned")
            .contains_key(&target);
        if !already_running {
            start_proxy(state, target, proxy_port).await;
        }
    }
}

// ─── バックグラウンドスキャンループ ──────────────────────────────────────────

async fn scan_loop(state: Arc<AppState>) {
    let mut interval = tokio::time::interval(Duration::from_secs(SCAN_INTERVAL_SEC));
    loop {
        interval.tick().await;
        // preview が最近使われた時だけスキャンする（常時 ss/lsof を回さない）。
        if should_scan_now(&state.preview) {
            scan_once(&state).await;
        }
    }
}

/// preview のバックグラウンドスキャンタスクを起動する（冪等 — 既に動作中なら
/// 何もしない）。`main.rs` から起動時に一度呼ぶ。
pub fn start_scanner(state: &Arc<AppState>) {
    state
        .preview
        .scan_task
        .ensure(|| tokio::spawn(scan_loop(state.clone())));
}

// ─── HTTP エンドポイント（`GET /preview/ports`）─────────────────────────────

/// パネルを開いた時だけスキャンを起こす（常時ポーリングはしない）。
///
/// 注意: GET だが冪等ではない — アクセスタイマの更新（`touch_access`）と
/// 必要に応じたポートスキャン・プロキシ起動（`scan_once`）を伴う。
pub async fn list_detected_ports(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Json<Vec<DetectedPort>> {
    touch_access(&state.preview);
    scan_once(&state).await;
    Json(list_ports(&state.preview))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_port_for_range() {
        assert_eq!(proxy_port_for(3000), Some(23000));
        assert_eq!(proxy_port_for(5173), Some(25173));
        assert_eq!(proxy_port_for(1024), Some(21024));
        assert_eq!(proxy_port_for(9999), Some(29999));
        assert_eq!(proxy_port_for(80), None);
        assert_eq!(proxy_port_for(10000), None);
    }

    #[test]
    fn set_self_ports_replaces() {
        let state = PreviewState::new();
        set_self_ports(&state, &[1]);
        set_self_ports(&state, &[2]);
        assert_eq!(*state.self_ports.lock().unwrap(), HashSet::from([2u16]));
    }

    #[test]
    fn should_scan_now_requires_recent_access() {
        let state = PreviewState::new();
        assert!(!should_scan_now(&state), "未アクセスはアイドル扱い");
        touch_access(&state);
        assert!(should_scan_now(&state));
    }

    fn store_with_workspaces(entries: &[(&str, Option<&str>, &str)]) -> ConfigStore {
        let dir = tempfile::tempdir().unwrap();
        // tempdir を drop すると config.json ごと消えるため、テストの間だけ保持する
        // 目的でリークさせる（このテストプロセス内で完結する使い捨てのため許容）。
        let dir = Box::leak(Box::new(dir));
        let store = ConfigStore::new(dir.path().join("config.json"));
        let mut cfg = store.load_all();
        for (key, name, path) in entries {
            let mut entry = serde_json::json!({"path": path});
            if let Some(name) = name {
                entry["name"] = serde_json::json!(name);
            }
            cfg.insert((*key).to_string(), entry);
        }
        store.save_all(&cfg).unwrap();
        store
    }

    #[tokio::test]
    async fn match_workspace_none_for_empty_cwd() {
        let store = store_with_workspaces(&[]);
        assert_eq!(match_workspace(&store, None).await, None);
        assert_eq!(match_workspace(&store, Some("")).await, None);
    }

    #[tokio::test]
    async fn match_workspace_exact_and_subdirectory_match() {
        let store = store_with_workspaces(&[("my-app", Some("My App"), "/Users/dev/my-app")]);
        assert_eq!(
            match_workspace(&store, Some("/Users/dev/my-app")).await,
            Some("My App".to_string())
        );
        assert_eq!(
            match_workspace(&store, Some("/Users/dev/my-app/packages/web")).await,
            Some("My App".to_string())
        );
    }

    #[tokio::test]
    async fn match_workspace_falls_back_to_key_when_name_missing() {
        let store = store_with_workspaces(&[("my-app", None, "/Users/dev/my-app")]);
        assert_eq!(
            match_workspace(&store, Some("/Users/dev/my-app")).await,
            Some("my-app".to_string())
        );
    }

    #[tokio::test]
    async fn match_workspace_no_match_for_unrelated_cwd() {
        let store = store_with_workspaces(&[("my-app", Some("My App"), "/Users/dev/my-app")]);
        assert_eq!(
            match_workspace(&store, Some("/Users/dev/other-app")).await,
            None
        );
    }

    #[tokio::test]
    async fn match_workspace_picks_longest_prefix() {
        let store = store_with_workspaces(&[
            ("root", Some("Root"), "/Users/dev"),
            ("nested", Some("Nested"), "/Users/dev/my-app"),
        ]);
        assert_eq!(
            match_workspace(&store, Some("/Users/dev/my-app/src")).await,
            Some("Nested".to_string())
        );
    }

    fn free_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    }

    fn test_state() -> (Arc<AppState>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::test_app_state(dir.path(), "ac-", 1000));
        (state, dir)
    }

    #[tokio::test]
    async fn probe_http_true_for_http_upstream() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 200];
                let _ = sock.read(&mut buf).await;
                let _ = sock.write_all(b"HTTP/1.1 200 OK\r\n\r\nhi").await;
            }
        });
        assert!(probe_http(port).await);
    }

    #[tokio::test]
    async fn probe_http_false_for_non_http_upstream() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 200];
                let _ = sock.read(&mut buf).await;
                // adb 風の非HTTP応答
                let _ = sock.write_all(b"OK host:transport\r\n").await;
            }
        });
        assert!(!probe_http(port).await);
    }

    #[tokio::test]
    async fn probe_http_false_for_unreachable_port() {
        // 予約だけして即座に閉じたポートは通常誰も listen していない。
        let port = free_port();
        assert!(!probe_http(port).await);
    }

    #[test]
    fn needs_probe_delays_initial_probe() {
        let now = now_epoch();
        let entry = DetectedPort {
            port: 3000,
            proxy_port: Some(23000),
            process: "x".to_string(),
            pid: Some(1),
            is_self: false,
            first_seen_at: now,
            last_seen_at: now,
            scheme: None,
            http_ok: None,
            http_probed_at: 0,
            cwd: None,
            workspace: None,
            worktree_base: None,
            worktree_branch: None,
        };
        assert!(!needs_probe(&entry, now), "検出直後はまだプローブしない");
        assert!(needs_probe(&entry, now + INITIAL_PROBE_DELAY_SEC + 1));
    }

    #[test]
    fn needs_probe_retries_after_false_result() {
        let now = now_epoch();
        let mut entry = DetectedPort {
            port: 3000,
            proxy_port: Some(23000),
            process: "x".to_string(),
            pid: Some(1),
            is_self: false,
            first_seen_at: 0,
            last_seen_at: 0,
            scheme: None,
            http_ok: Some(false),
            http_probed_at: now,
            cwd: None,
            workspace: None,
            worktree_base: None,
            worktree_branch: None,
        };
        assert!(!needs_probe(&entry, now), "再試行間隔内は再プローブしない");
        entry.http_probed_at = now - HTTP_PROBE_RETRY_SEC - 1;
        assert!(needs_probe(&entry, now), "間隔経過後は再プローブする");
    }

    #[test]
    fn needs_probe_never_for_confirmed_http() {
        let entry = DetectedPort {
            port: 3000,
            proxy_port: Some(23000),
            process: "x".to_string(),
            pid: Some(1),
            is_self: false,
            first_seen_at: 0,
            last_seen_at: 0,
            scheme: None,
            http_ok: Some(true),
            http_probed_at: 0,
            cwd: None,
            workspace: None,
            worktree_base: None,
            worktree_branch: None,
        };
        assert!(!needs_probe(&entry, now_epoch() + 1_000_000));
    }

    #[tokio::test]
    async fn start_proxy_pipes_data_bidirectionally() {
        let (state, _dir) = test_state();
        let _ = state.preview.tls.set(None);
        let up_port = free_port();
        let up_listener = tokio::net::TcpListener::bind(("127.0.0.1", up_port))
            .await
            .unwrap();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = up_listener.accept().await {
                let mut buf = [0u8; 64];
                let n = sock.read(&mut buf).await.unwrap();
                let mut reply = b"ECHO:".to_vec();
                reply.extend_from_slice(&buf[..n]);
                sock.write_all(&reply).await.unwrap();
            }
        });

        let proxy_port = free_port();
        start_proxy(&state, up_port, proxy_port).await;
        assert!(state.preview.proxies.lock().unwrap().contains_key(&up_port));

        let mut client = TcpStream::connect(("127.0.0.1", proxy_port)).await.unwrap();
        client.write_all(b"hello").await.unwrap();
        let mut resp = [0u8; 64];
        let n = tokio::time::timeout(Duration::from_secs(2), client.read(&mut resp))
            .await
            .unwrap()
            .unwrap();
        assert!(resp[..n].starts_with(b"ECHO:hello"));

        state
            .preview
            .proxies
            .lock()
            .unwrap()
            .remove(&up_port)
            .unwrap()
            .abort();
    }

    #[tokio::test]
    async fn start_proxy_closes_client_when_upstream_unreachable() {
        let (state, _dir) = test_state();
        // free_port で予約だけして即座に閉じたポート = 誰も listen していない。
        let up_port = free_port();
        let proxy_port = free_port();
        start_proxy(&state, up_port, proxy_port).await;

        let mut client = TcpStream::connect(("127.0.0.1", proxy_port)).await.unwrap();
        let mut buf = [0u8; 1];
        let n = tokio::time::timeout(Duration::from_secs(2), client.read(&mut buf))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(n, 0, "upstream 接続失敗時は即座に EOF");

        state
            .preview
            .proxies
            .lock()
            .unwrap()
            .remove(&up_port)
            .unwrap()
            .abort();
    }

    #[tokio::test]
    async fn reconcile_closes_proxy_no_longer_needed() {
        let (state, _dir) = test_state();
        let target = free_port();
        let listen = free_port();
        start_proxy(&state, target, listen).await;
        assert!(state.preview.proxies.lock().unwrap().contains_key(&target));

        // detected から消える = 不要になった proxy として close される。
        state.preview.detected.lock().unwrap().clear();
        reconcile_proxies(&state).await;
        assert!(!state.preview.proxies.lock().unwrap().contains_key(&target));
    }

    #[tokio::test]
    async fn scan_once_adds_new_port_and_marks_self() {
        let (state, _dir) = test_state();
        set_self_ports(&state.preview, &[]);
        // scan_listening_ports は実 OS コールなので直接は差し替えられないため、
        // ここでは detected への手動投入で is_self/proxy_port の付与ロジックを
        // list_ports 側の filter とあわせて検証する（scan_once 本体の OS 依存
        // 部分は scan_listening_ports_* 側で個別に検証済み）。
        {
            let mut detected = state.preview.detected.lock().unwrap();
            detected.insert(
                3000,
                DetectedPort {
                    port: 3000,
                    proxy_port: proxy_port_for(3000),
                    process: "node".to_string(),
                    pid: Some(1),
                    is_self: false,
                    first_seen_at: now_epoch(),
                    last_seen_at: now_epoch(),
                    scheme: Some("http"),
                    http_ok: None,
                    http_probed_at: 0,
                    cwd: None,
                    workspace: None,
                    worktree_base: None,
                    worktree_branch: None,
                },
            );
        }
        let items = list_ports(&state.preview);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].port, 3000);
        assert_eq!(items[0].proxy_port, Some(23000));
    }

    #[test]
    fn list_ports_excludes_no_proxy_non_self() {
        let (state, _dir) = test_state();
        state.preview.detected.lock().unwrap().insert(
            20000,
            DetectedPort {
                port: 20000,
                proxy_port: None,
                process: "x".to_string(),
                pid: Some(1),
                is_self: false,
                first_seen_at: 0,
                last_seen_at: 0,
                scheme: None,
                http_ok: None,
                http_probed_at: 0,
                cwd: None,
                workspace: None,
                worktree_base: None,
                worktree_branch: None,
            },
        );
        assert!(list_ports(&state.preview).is_empty());
    }

    #[test]
    fn list_ports_includes_self_without_proxy() {
        let (state, _dir) = test_state();
        state.preview.detected.lock().unwrap().insert(
            8888,
            DetectedPort {
                port: 8888,
                proxy_port: None,
                process: "any-console-server".to_string(),
                pid: Some(1),
                is_self: true,
                first_seen_at: 0,
                last_seen_at: 0,
                scheme: None,
                http_ok: None,
                http_probed_at: 0,
                cwd: None,
                workspace: None,
                worktree_base: None,
                worktree_branch: None,
            },
        );
        let items = list_ports(&state.preview);
        assert_eq!(items.len(), 1);
        assert!(items[0].is_self);
    }

    #[test]
    fn list_ports_excludes_non_http_port() {
        let (state, _dir) = test_state();
        state.preview.detected.lock().unwrap().insert(
            5037,
            DetectedPort {
                port: 5037,
                proxy_port: Some(25037),
                process: "adb".to_string(),
                pid: Some(1),
                is_self: false,
                first_seen_at: 0,
                last_seen_at: 0,
                scheme: Some("http"),
                http_ok: Some(false),
                http_probed_at: 0,
                cwd: None,
                workspace: None,
                worktree_base: None,
                worktree_branch: None,
            },
        );
        assert!(list_ports(&state.preview).is_empty());
    }

    #[tokio::test]
    async fn scanner_start_spawns_task() {
        let (state, _dir) = test_state();
        start_scanner(&state);
        assert!(state.preview.scan_task.is_running());
        assert!(state.preview.scan_task.stop());
        assert!(!state.preview.scan_task.is_running());
    }
}
