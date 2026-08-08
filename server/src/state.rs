//! アプリ全体の共有状態。

use crate::auth::Auth;
use crate::paths::Paths;
use crate::proxy::Proxy;
use crate::rate_limit::FixedWindowCounter;
use crate::static_files::StaticCtx;

pub struct AppState {
    pub paths: Paths,
    pub proxy: Proxy,
    /// ui/dist が存在する場合のみ Some（無ければ全て proxy へ）。
    pub static_ctx: Option<StaticCtx>,
    /// Phase 0 では認証必須ルートを Rust 側で持たないが、以降のフェーズが使う
    /// 認証コアをここで保持・起動時ロードする。
    pub auth: Auth,
    pub rate_counter: FixedWindowCounter,
    pub rate_limit: u32,
}
