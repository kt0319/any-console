//! アプリ全体の共有状態。

use crate::agent_hooks::AgentHookState;
use crate::agent_watch::AgentWatchState;
use crate::auth::Auth;
use crate::config::ConfigStore;
use crate::dispatch::DispatchState;
use crate::git_info::GitInfoCache;
use crate::git_lock::WorkspaceLocks;
use crate::git_watch::GitWatchState;
use crate::github::GhCache;
use crate::jobs_common::JobsCache;
use crate::pairing::PairingState;
use crate::paths::Paths;
use crate::preview::PreviewState;
use crate::proxy::Proxy;
use crate::rate_limit::FixedWindowCounter;
use crate::screen_manifest::ManifestStore;
use crate::static_files::StaticCtx;
use crate::status_stream::StatusStreamState;
use crate::terminal_session::TerminalRegistry;

pub struct AppState {
    pub paths: Paths,
    pub config: ConfigStore,
    pub git_locks: WorkspaceLocks,
    pub gh_cache: GhCache,
    pub git_info_cache: GitInfoCache,
    pub git_watch: GitWatchState,
    pub jobs_cache: JobsCache,
    pub terminal_registry: TerminalRegistry,
    pub dispatch: DispatchState,
    pub agent_hooks: AgentHookState,
    pub agent_watch: AgentWatchState,
    pub status_stream: StatusStreamState,
    pub manifest_store: ManifestStore,
    pub preview: PreviewState,
    pub pairing: PairingState,
    pub proxy: Proxy,
    /// ui/dist が存在する場合のみ Some（無ければ全て proxy へ）。
    pub static_ctx: Option<StaticCtx>,
    /// Phase 0 では認証必須ルートを Rust 側で持たないが、以降のフェーズが使う
    /// 認証コアをここで保持・起動時ロードする。
    pub auth: Auth,
    pub rate_counter: FixedWindowCounter,
    pub rate_limit: u32,
}
