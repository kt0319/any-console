//! エージェント hooks によるセッション状態のイベント駆動更新（Python 側
//! `api/agent_hooks.py` + `api/routers/agent_hooks.py` の移植）。
//!
//! Claude Code 等のエージェントの hooks（Notification / Stop / PreToolUse ...）から
//! `POST /agent-hooks/events` を叩いてもらい、セッション状態
//! （working / idle / blocked）をイベント駆動で更新する。screen manifest
//! （ADR 30）より正確・即時なため、イベントが新しい間
//! （AGENT_HOOK_STATE_TTL_SEC）は hook の状態を最優先で採用し、期限切れ・
//! 未設定時は manifest → 画面差分へフォールバックする（ADR 33）。
//!
//! 認証はメインの Bearer トークンではなく hook 専用トークン（X-Hook-Token
//! ヘッダ、`tmux::get_hook_token` で発行・永続化）で行う。メインの Bearer
//! トークンをセッション内の全プロセスへ晒さないための分離（漏れても状態
//! イベントの偽装しかできない）。
//!
//! `agent_watch.rs` の `collect_agent_states` が読み手（`hook_state`）であり、
//! `/workspaces/statuses/ws` の Rust ネイティブ切替（Phase 4）により Python 側の
//! agent_watch ポーリングループは実接続者ゼロで恒久的に休眠するため、
//! `build_router` へ配線済み。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::constant_time_eq;
use crate::errors::{unauthorized, ApiError};
use crate::state::AppState;
use crate::util::JsonBody;

pub const AGENT_HOOK_STATE_TTL_SEC: u64 = 300;

/// hook イベント名 → セッション状態。未知のイベントは無視する（forward 互換）。
/// SubagentStop はメインエージェント継続中に発火するため状態を変えない。
fn event_state(event: &str) -> Option<&'static str> {
    match event {
        "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "PreCompact" => Some("working"),
        "Notification" => Some("blocked"),
        "Stop" => Some("idle"),
        _ => None,
    }
}

/// セッション終了系は状態を消す（以後は manifest / 画面差分に委ねる）。
fn is_clear_event(event: &str) -> bool {
    event == "SessionEnd"
}

#[derive(Default)]
pub struct AgentHookState {
    states: Mutex<HashMap<String, (String, Instant)>>,
}

impl AgentHookState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// tmux セッション名（プレフィックス付き）または素の session_id を受け付ける。
fn session_id_from(session: &str, tmux_prefix: &str) -> String {
    session
        .strip_prefix(tmux_prefix)
        .unwrap_or(session)
        .to_string()
}

/// hook イベントを状態へ反映する。既知イベントなら true。
pub fn record_event(state: &AppState, session: &str, event: &str) -> bool {
    let session_id = session_id_from(session.trim(), &state.paths.tmux_prefix);
    if session_id.is_empty() {
        return false;
    }
    let mut states = state
        .agent_hooks
        .states
        .lock()
        .expect("agent hook state lock poisoned");
    if is_clear_event(event) {
        states.remove(&session_id);
        return true;
    }
    let Some(new_state) = event_state(event) else {
        return false;
    };
    states.insert(session_id, (new_state.to_string(), Instant::now()));
    true
}

/// 新鮮な（TTL 内の）hook 由来状態を返す。無ければ None。
///
/// 期限切れエントリはここで除去する（サーバが hook を受け損ねたまま状態が
/// 固着しないよう、以後は manifest / 画面差分へフォールバックする）。
pub fn hook_state(state: &AppState, session_id: &str) -> Option<String> {
    let mut states = state
        .agent_hooks
        .states
        .lock()
        .expect("agent hook state lock poisoned");
    let (value, recorded_at) = states.get(session_id).cloned()?;
    if recorded_at.elapsed() > Duration::from_secs(AGENT_HOOK_STATE_TTL_SEC) {
        states.remove(session_id);
        return None;
    }
    Some(value)
}

/// セッション削除時の後始末（terminal router から呼ばれる）。
pub fn clear_session(state: &AppState, session_id: &str) {
    state
        .agent_hooks
        .states
        .lock()
        .expect("agent hook state lock poisoned")
        .remove(session_id);
}

pub fn verify_hook_token(state: &AppState, provided: &str) -> bool {
    if provided.is_empty() {
        return false;
    }
    constant_time_eq(
        provided,
        &crate::tmux::get_hook_token(&state.paths.data_dir),
    )
}

// ─── HTTP エンドポイント（`POST /agent-hooks/events`）──────────────────────

#[derive(Deserialize)]
pub struct HookEventBody {
    pub session: String,
    pub event: String,
}

fn check_len(field: &str, value: &str, min: usize, max: usize) -> Result<(), ApiError> {
    let len = value.chars().count();
    if len < min || len > max {
        return Err(ApiError::new(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            format!("{field} must be between {min} and {max} characters"),
        ));
    }
    Ok(())
}

pub async fn post_agent_hook_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<HookEventBody>,
) -> Result<Json<Value>, ApiError> {
    check_len("session", &body.session, 1, 200)?;
    check_len("event", &body.event, 1, 64)?;
    let token = headers
        .get("x-hook-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_hook_token(&state, token) {
        return Err(unauthorized("Invalid hook token"));
    }
    let recognized = record_event(&state, &body.session, &body.event);
    Ok(Json(json!({"status": "ok", "recognized": recognized})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigStore;
    use crate::dispatch::DispatchState;
    use crate::git_info::GitInfoCache;
    use crate::git_lock::WorkspaceLocks;
    use crate::github::GhCache;
    use crate::jobs_common::JobsCache;
    use crate::proxy::Proxy;
    use crate::rate_limit::FixedWindowCounter;
    use crate::terminal_session::TerminalRegistry;

    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState {
            paths: crate::paths::Paths {
                project_root: dir.path().to_path_buf(),
                data_dir: dir.path().join("data"),
                config_file: dir.path().join("config.json"),
                frontend_dir: dir.path().join("dist"),
                icons_dir: dir.path().join("icons"),
                tmux_prefix: "ac-".to_string(),
            },
            config: ConfigStore::new(dir.path().join("config.json")),
            git_locks: WorkspaceLocks::new(),
            gh_cache: GhCache::new(),
            git_info_cache: GitInfoCache::new(),
            git_watch: crate::git_watch::GitWatchState::new(),
            jobs_cache: JobsCache::new(),
            terminal_registry: TerminalRegistry::new(),
            dispatch: DispatchState::new(),
            agent_hooks: AgentHookState::new(),
            agent_watch: crate::agent_watch::AgentWatchState::new(),
            status_stream: crate::status_stream::StatusStreamState::new(),
            manifest_store: crate::screen_manifest::ManifestStore::new(
                dir.path().join("agent_manifests"),
                dir.path(),
            ),
            proxy: Proxy::new("http://127.0.0.1:1".to_string()),
            static_ctx: None,
            auth: crate::auth::Auth::load(dir.path().join("data"), false),
            rate_counter: FixedWindowCounter::new(),
            rate_limit: 1000,
        };
        (state, dir)
    }

    #[test]
    fn token_is_created_and_persisted() {
        let (state, _dir) = test_state();
        let token = crate::tmux::get_hook_token(&state.paths.data_dir);
        assert!(token.len() >= 32);
        assert_eq!(crate::tmux::get_hook_token(&state.paths.data_dir), token);
        let saved = std::fs::read_to_string(state.paths.data_dir.join("hook_token")).unwrap();
        assert_eq!(saved.trim(), token);
    }

    #[test]
    fn verify_accepts_correct_token_only() {
        let (state, _dir) = test_state();
        let token = crate::tmux::get_hook_token(&state.paths.data_dir);
        assert!(verify_hook_token(&state, &token));
        assert!(!verify_hook_token(&state, "wrong"));
        assert!(!verify_hook_token(&state, ""));
    }

    #[test]
    fn event_state_mapping() {
        let (state, _dir) = test_state();
        assert!(record_event(&state, "s1", "PreToolUse"));
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("working"));
        record_event(&state, "s1", "Notification");
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("blocked"));
        record_event(&state, "s1", "Stop");
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("idle"));
    }

    #[test]
    fn tmux_prefix_is_stripped() {
        let (state, _dir) = test_state();
        record_event(&state, "ac-s2", "Notification");
        assert_eq!(hook_state(&state, "s2").as_deref(), Some("blocked"));
    }

    #[test]
    fn unknown_event_is_ignored() {
        let (state, _dir) = test_state();
        assert!(!record_event(&state, "s1", "SomeFutureEvent"));
        assert!(hook_state(&state, "s1").is_none());
    }

    #[test]
    fn subagent_stop_does_not_change_state() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "PreToolUse");
        assert!(!record_event(&state, "s1", "SubagentStop"));
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("working"));
    }

    #[test]
    fn session_end_clears_state() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "Notification");
        assert!(record_event(&state, "s1", "SessionEnd"));
        assert!(hook_state(&state, "s1").is_none());
    }

    #[test]
    fn empty_session_is_rejected() {
        let (state, _dir) = test_state();
        assert!(!record_event(&state, "", "Stop"));
        assert!(!record_event(&state, "   ", "Stop"));
    }

    #[test]
    fn state_expires_after_ttl() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "Notification");
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("blocked"));
        // TTL 経過をシミュレートするため、記録済みタイムスタンプを直接巻き戻す。
        {
            let mut states = state.agent_hooks.states.lock().unwrap();
            let entry = states.get_mut("s1").unwrap();
            entry.1 = Instant::now() - Duration::from_secs(AGENT_HOOK_STATE_TTL_SEC + 1);
        }
        assert!(hook_state(&state, "s1").is_none());
        assert!(!state.agent_hooks.states.lock().unwrap().contains_key("s1"));
    }

    #[test]
    fn clear_session_removes_state() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "Notification");
        clear_session(&state, "s1");
        assert!(hook_state(&state, "s1").is_none());
    }
}
