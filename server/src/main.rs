//! any-console Rust フロントサーバのエントリポイント。
//!
//! 公開ポートで待ち受け、静的ファイル（ui/dist）とミドルウェア
//! （security headers / rate limit / client log）を Rust 側で処理し、
//! それ以外の全ルートを Python バックエンド（ANY_CONSOLE_UPSTREAM）へ
//! HTTP / WebSocket 透過 proxy する。
//!
//! 環境変数:
//! - ANY_CONSOLE_PROJECT_ROOT : リポジトリルート（既定: カレントディレクトリ）
//! - ANY_CONSOLE_DATA_DIR     : data/・config.json の隔離ディレクトリ（E2E 用）
//! - ANY_CONSOLE_UPSTREAM     : Python バックエンド URL（既定 http://127.0.0.1:8889)
//! - ANY_CONSOLE_RS_HOST/PORT : bind 先の上書き（既定: config.json の __global__）
//! - ANY_CONSOLE_RATE_LIMIT   : レートリミット上限の上書き

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::config::ConfigStore;
use any_console_server::paths::Paths;
use any_console_server::proxy::Proxy;
use any_console_server::rate_limit::{rate_limit_from_env, FixedWindowCounter};
use any_console_server::state::AppState;
use any_console_server::static_files::StaticCtx;

const DEFAULT_UPSTREAM: &str = "http://127.0.0.1:8889";

fn project_root() -> PathBuf {
    match std::env::var("ANY_CONSOLE_PROJECT_ROOT") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => std::env::current_dir().expect("cwd unavailable"),
    }
}

/// 同一ポートでの多重起動を拒否する（Python `_acquire_singleton_lock` と同趣旨。
/// ロックファイル名は Python 側と分けており、移行期間中の Python プロセス
/// （別ポートで稼働）とは競合しない）。
fn acquire_singleton_lock(port: u16) -> Option<std::fs::File> {
    let lock_path = std::env::temp_dir().join(format!("any-console-rs-{port}.lock"));
    let file = match std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&lock_path)
    {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("singleton lock open failed ({e}); continuing");
            return None;
        }
    };
    match file.try_lock() {
        Ok(()) => Some(file),
        Err(std::fs::TryLockError::WouldBlock) => {
            tracing::error!("another any-console-server is already running on port {port}");
            std::process::exit(1);
        }
        Err(std::fs::TryLockError::Error(e)) => {
            tracing::warn!("singleton lock failed ({e}); continuing");
            None
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let root = project_root();
    let paths = Paths::from_env(root);
    let config = ConfigStore::new(paths.config_file.clone());

    let (cfg_host, cfg_port) = config.resolve_bind();
    let host = std::env::var("ANY_CONSOLE_RS_HOST")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or(cfg_host);
    let port = std::env::var("ANY_CONSOLE_RS_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(cfg_port);
    let upstream = std::env::var("ANY_CONSOLE_UPSTREAM")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_UPSTREAM.to_string());

    let _lock = acquire_singleton_lock(port);

    let static_ctx = StaticCtx::detect(paths.frontend_dir.clone(), paths.icons_dir.clone());
    if static_ctx.is_none() {
        tracing::warn!(
            "ui/dist not found under {} — serving all static files via proxy",
            paths.frontend_dir.display()
        );
    }
    let auth = Auth::load(paths.data_dir.clone(), config.trust_tailscale_auth());

    let state = Arc::new(AppState {
        paths: paths.clone(),
        config,
        git_locks: any_console_server::git_lock::WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: any_console_server::terminal_session::TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            paths.project_root.join("api/agent_manifests"),
            &paths.data_dir,
        ),
        proxy: Proxy::new(upstream.clone()),
        static_ctx,
        auth,
        rate_counter: FixedWindowCounter::new(),
        rate_limit: rate_limit_from_env(),
    });

    // 永続化済み dispatch キュー/履歴を読み込み、Python 側 status stream へ
    // 起動直後の初期スナップショットを送る（Python の
    // `_load_persisted_pending`/`_load_persisted_recent` 相当）。
    any_console_server::dispatch::load_persisted_and_seed_bridge(&state).await;
    // Python 側が（Rust を再起動せずに）再起動しても dispatch キューの
    // ブリッジが空白のままにならないよう、一定間隔で再送し続ける常駐タスク。
    tokio::spawn(any_console_server::dispatch::run_bridge_reconciliation_loop(state.clone()));

    let app = build_router(state);

    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("bind {addr} failed: {e}"));
    tracing::info!("any-console-server listening on {addr} (upstream: {upstream})");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .expect("server error");
}
