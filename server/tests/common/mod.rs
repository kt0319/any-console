//! 統合テスト共通ヘルパー（各 `test_*.rs` から `mod common;` で読み込む）。
//!
//! `AppState` の組み立ては全統合テストでほぼ同一のリテラルがコピーされていた
//! ため、ここへ一本化する。`AppState` にフィールドが増えた時の修正箇所を
//! 1箇所にするのが目的。テストごとに異なる値だけ `StateOptions` で上書きする。
#![allow(dead_code)] // 各テストクレートは必要なヘルパーだけを使う

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use any_console_server::auth::Auth;
use any_console_server::config::ConfigStore;
use any_console_server::paths::Paths;
use any_console_server::rate_limit::FixedWindowCounter;
use any_console_server::state::AppState;
use any_console_server::static_files::StaticCtx;

/// `test_app_state` のテスト別上書き。既定値は大半のテストが使う構成。
pub struct StateOptions {
    pub tmux_prefix: String,
    pub rate_limit: u32,
    pub static_ctx: Option<StaticCtx>,
    /// None なら `{dir}/dist`
    pub frontend_dir: Option<PathBuf>,
    /// None なら `{dir}/data/icons`
    pub icons_dir: Option<PathBuf>,
    /// None なら `{dir}/config.json` の素の ConfigStore（事前にワークスペース等を
    /// 書き込んだ store を使うテストは Some で渡す）
    pub config: Option<ConfigStore>,
}

impl Default for StateOptions {
    fn default() -> Self {
        Self {
            tmux_prefix: "ac-".to_string(),
            rate_limit: 10_000,
            static_ctx: None,
            frontend_dir: None,
            icons_dir: None,
            config: None,
        }
    }
}

/// tempdir 直下を project_root、`{dir}/data` を data_dir とした `AppState` を
/// 組み立てる。auth.json 等のファイルは呼び出し側が事前に書き込んでおく。
pub fn test_app_state(dir: &Path, opts: StateOptions) -> Arc<AppState> {
    let data_dir = dir.join("data");
    let config_file = dir.join("config.json");
    Arc::new(AppState {
        paths: Paths {
            project_root: dir.to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: config_file.clone(),
            frontend_dir: opts.frontend_dir.unwrap_or_else(|| dir.join("dist")),
            icons_dir: opts.icons_dir.unwrap_or_else(|| data_dir.join("icons")),
            tmux_prefix: opts.tmux_prefix,
        },
        config: opts.config.unwrap_or_else(|| ConfigStore::new(config_file)),
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
            dir.join("agent_manifests"),
            dir,
        ),
        preview: any_console_server::preview::PreviewState::new(),
        pairing: any_console_server::pairing::PairingState::new(),
        push: any_console_server::push::PushState::new(),
        static_ctx: opts.static_ctx,
        auth: Auth::load(data_dir, false),
        rate_counter: FixedWindowCounter::new(),
        rate_limit: opts.rate_limit,
        tls_active: false,
    })
}

/// 実 tmux を使うテスト同士がセッション名で衝突しないためのユニークプレフィックス。
pub fn unique_tmux_prefix() -> String {
    format!("ac-test-{}-", any_console_server::util::token_hex(3))
}

/// Router を空きポートで起動してアドレスを返す。
pub async fn serve(router: axum::Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

/// プロキシ環境変数の影響を受けないテスト用 HTTP クライアント。
pub fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

/// tmux が使えない環境（CI コンテナ等）でスキップするための共通ガード。
pub fn skip_if_no_tmux() -> bool {
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
}
