//! any-console サーバのエントリポイント。
//!
//! 公開ポートで待ち受け、静的ファイル（ui/dist）・ミドルウェア
//! （security headers / rate limit / client log）・全 API ルートを処理する。
//!
//! 環境変数:
//! - ANY_CONSOLE_PROJECT_ROOT : リポジトリルート（既定: カレントディレクトリ）
//! - ANY_CONSOLE_DATA_DIR     : data/・config.json の隔離ディレクトリ（E2E 用）
//! - ANY_CONSOLE_RS_HOST/PORT : bind 先の上書き（既定: config.json の __global__）
//! - ANY_CONSOLE_RATE_LIMIT   : レートリミット上限の上書き

use std::net::SocketAddr;
use std::sync::Arc;

use any_console_server::auth::Auth;
use any_console_server::build_router;
use any_console_server::config::ConfigStore;
use any_console_server::paths::{project_root_from_env, Paths};
use any_console_server::rate_limit::{rate_limit_from_env, FixedWindowCounter};
use any_console_server::state::AppState;
use any_console_server::static_files::StaticCtx;

/// 同一ポートでの多重起動を拒否する。
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
    // `--version`・`config`/`workspaces`/`jobs`/`tailscale`/`auth` サブコマンドは
    // サーバを起動せずその場で処理して終了する（any-console スクリプトが
    // python3 の代わりにこのバイナリを呼ぶための軽量CLI。cli.rs 参照）。
    let args: Vec<String> = std::env::args().collect();
    if let Some(code) = any_console_server::cli::run_subcommand(&args[1..]).await {
        std::process::exit(code);
    }

    // rustls 0.23 は複数の crypto backend（ring/aws-lc-rs）がビルドに含まれうる
    // ため、プロセス起動時に明示的に選ばないと初回 TLS 利用時（preview proxy
    // または本サーバの HTTPS bind）で panic する。
    tokio_rustls::rustls::crypto::ring::default_provider()
        .install_default()
        .expect("failed to install rustls ring crypto provider");

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let root = project_root_from_env();
    let paths = Paths::from_env(root);
    let config = ConfigStore::new(paths.config_file.clone());

    let (host, port) = any_console_server::tmux::resolve_effective_bind(&config);

    let _lock = acquire_singleton_lock(port);

    let static_ctx = StaticCtx::detect(paths.frontend_dir.clone(), paths.icons_dir.clone());
    if static_ctx.is_none() {
        tracing::warn!(
            "ui/dist not found under {} — run `npm run build` first",
            paths.frontend_dir.display()
        );
    }
    let auth = Auth::load(paths.data_dir.clone(), config.trust_tailscale_auth());

    // TLS 証明書は AppState 構築前に読み込む — hook URL のスキーム等が
    // 「証明書ファイルの有無」ではなく「実際に TLS で listen するか」を参照
    // できるよう、読み込み結果を tls_active として AppState に持たせる
    // （証明書はあるが読み込みに失敗した場合は平文 bind へフォールバックする
    // ため、ファイルの有無だけを見ると実際のスキームと食い違う）。
    let tls_config = any_console_server::preview::find_cert_pair(&paths.project_root)
        .and_then(|(cert, key)| any_console_server::preview::load_tls_server_config(&cert, &key));

    let state = Arc::new(AppState {
        paths: paths.clone(),
        config,
        git_locks: any_console_server::git_lock::WorkspaceLocks::new(),
        gh_cache: any_console_server::github::GhCache::new(),
        git_info_cache: any_console_server::git_info::GitInfoCache::new(),
        git_watch: any_console_server::git_watch::GitWatchState::new(),
        jobs_cache: any_console_server::jobs_common::JobsCache::new(),
        terminal_registry: any_console_server::terminal_session::TerminalRegistry::new(),
        dispatch: any_console_server::dispatch::DispatchState::new(),
        agent_hooks: any_console_server::agent_hooks::AgentHookState::new(),
        agent_watch: any_console_server::agent_watch::AgentWatchState::new(),
        status_stream: any_console_server::status_stream::StatusStreamState::new(),
        manifest_store: any_console_server::screen_manifest::ManifestStore::new(
            paths.project_root.join("agent_manifests"),
            &paths.data_dir,
        ),
        preview: any_console_server::preview::PreviewState::new(),
        pairing: any_console_server::pairing::PairingState::new(),
        push: any_console_server::push::PushState::new(),
        static_ctx,
        auth,
        rate_counter: FixedWindowCounter::new(),
        rate_limit: rate_limit_from_env(),
        tls_active: tls_config.is_some(),
    });

    // 永続化済み dispatch キュー/履歴を読み込み、status stream 購読者へ
    // 起動直後の初期スナップショットを送る。
    any_console_server::dispatch::load_persisted_and_seed_bridge(&state).await;

    // dev server ポートプレビュー: 自分自身の listen ポートは対象から除外する
    // （除外しないと自分自身が dev server のように一覧へ出てしまう）。
    any_console_server::preview::set_self_ports(&state.preview, &[port]);
    any_console_server::preview::start_scanner(&state);

    // リモート screen manifest（herdr カタログ）の定期確認ループ。
    tokio::spawn(any_console_server::manifest_update::run_update_loop(
        state.clone(),
    ));

    let app = build_router(state);
    let addr = format!("{host}:{port}");

    match tls_config {
        Some(cfg) => {
            let socket_addr: SocketAddr = addr
                .parse()
                .unwrap_or_else(|e| panic!("bind address {addr} invalid: {e}"));
            tracing::info!("any-console-server listening on {addr} (TLS)");
            let handle = axum_server::Handle::new();
            let shutdown_handle = handle.clone();
            tokio::spawn(async move {
                let _ = tokio::signal::ctrl_c().await;
                shutdown_handle.graceful_shutdown(None);
            });
            axum_server::bind_rustls(
                socket_addr,
                axum_server::tls_rustls::RustlsConfig::from_config(cfg),
            )
            .handle(handle)
            .serve(app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .expect("server error");
        }
        None => {
            let listener = tokio::net::TcpListener::bind(&addr)
                .await
                .unwrap_or_else(|e| panic!("bind {addr} failed: {e}"));
            tracing::info!("any-console-server listening on {addr}");
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
    }
}
