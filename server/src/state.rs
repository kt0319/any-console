//! アプリ全体の共有状態。

use crate::agent_hooks::AgentHookState;
use crate::agent_watch::AgentWatchState;
use crate::auth::Auth;
use crate::config::ConfigStore;
use crate::dispatch::DispatchState;
use crate::git_info::GitInfoCache;
use crate::git_lock::WorkspaceLocks;
use crate::git_watch::GitWatchState;
use crate::pairing::PairingState;
use crate::paths::Paths;
use crate::preview::PreviewState;
use crate::push::PushState;
use crate::rate_limit::FixedWindowCounter;
use crate::screen_manifest::ManifestStore;
use crate::static_files::StaticCtx;
use crate::status_stream::StatusStreamState;
use crate::terminal_session::TerminalRegistry;

pub struct AppState {
    pub paths: Paths,
    pub config: ConfigStore,
    pub git_locks: WorkspaceLocks,
    pub gh_cache: crate::util::TtlCache<serde_json::Value>,
    pub git_info_cache: GitInfoCache,
    pub git_watch: GitWatchState,
    pub jobs_cache: crate::util::TtlCache<serde_json::Map<String, serde_json::Value>>,
    pub terminal_registry: TerminalRegistry,
    pub dispatch: DispatchState,
    pub agent_hooks: AgentHookState,
    pub agent_watch: AgentWatchState,
    pub status_stream: StatusStreamState,
    pub manifest_store: ManifestStore,
    pub preview: PreviewState,
    pub pairing: PairingState,
    pub push: PushState,
    /// ui/dist が存在する場合のみ Some（無ければフォールバックが 404 を返す）。
    pub static_ctx: Option<StaticCtx>,
    /// 認証コア（起動時にロードし、`RequireAuth` 等の全認証チェックが参照する）。
    pub auth: Auth,
    pub rate_counter: FixedWindowCounter,
    pub rate_limit: u32,
}

/// テスト用の AppState を tempdir 配下の隔離パスで組み立てる（各モジュールの
/// ユニットテストが共用する）。`tmux_prefix` は並行テストでの tmux セッション名
/// 衝突回避のため、`rate_limit` はレート制限に触れたくないテストのため引数で受ける。
#[cfg(test)]
pub fn test_app_state(dir: &std::path::Path, tmux_prefix: &str, rate_limit: u32) -> AppState {
    let data_dir = dir.join("data");
    AppState {
        paths: Paths {
            project_root: dir.to_path_buf(),
            data_dir: data_dir.clone(),
            config_file: dir.join("config.json"),
            frontend_dir: dir.join("dist"),
            icons_dir: data_dir.join("icons"),
            tmux_prefix: tmux_prefix.to_string(),
        },
        config: ConfigStore::new(dir.join("config.json")),
        git_locks: WorkspaceLocks::new(),
        gh_cache: crate::github::new_gh_cache(),
        git_info_cache: GitInfoCache::new(),
        git_watch: GitWatchState::new(),
        jobs_cache: crate::jobs_common::new_jobs_cache(),
        terminal_registry: TerminalRegistry::new(),
        dispatch: DispatchState::new(),
        agent_hooks: AgentHookState::new(),
        agent_watch: AgentWatchState::new(),
        status_stream: StatusStreamState::new(),
        manifest_store: ManifestStore::new(dir.join("agent_manifests"), dir),
        preview: PreviewState::new(),
        pairing: PairingState::new(),
        push: PushState::new(),
        static_ctx: None,
        auth: Auth::load(data_dir),
        rate_counter: FixedWindowCounter::new(),
        rate_limit,
    }
}

impl AppState {
    /// ターミナルセッションを取得する（レジストリ未登録なら tmux からハイドレート）。
    /// `terminal_registry.get_or_register` の定型呼び出し（config + tmux_prefix）を束ねる。
    pub async fn terminal_session(
        &self,
        session_id: &str,
    ) -> Result<
        std::sync::Arc<tokio::sync::Mutex<crate::terminal_session::TerminalSession>>,
        crate::errors::ApiError,
    > {
        self.terminal_registry
            .get_or_register(&self.config, &self.paths.tmux_prefix, session_id)
            .await
    }
}
