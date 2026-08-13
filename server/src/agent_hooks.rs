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
//! ヘッダ、`tmux::get_or_create_hook_token` で発行・永続化）で行う。メインの Bearer
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
///
/// `Notification` は許可確認（"needs your permission"）だけでなく、Stop後
/// 一定時間ユーザーが応答しないだけの汎用リマインダー（"waiting for your
/// input"）でも発火する。後者を blocked（許可待ちの琥珀色点滅）にすると、
/// 実際には何も起きていないのに許可待ち中に見えてしまうため、通知本文に
/// "permission" が含まれる場合のみ blocked を採用し、それ以外は状態を
/// 変えない（idle のまま）。
fn event_state(event: &str, detail: &str) -> Option<&'static str> {
    match event {
        "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "PreCompact" => Some("working"),
        "Notification" => detail
            .to_lowercase()
            .contains("permission")
            .then_some("blocked"),
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

/// hook イベントを状態へ反映する。状態を変えたら true（既知イベントでも
/// Notificationがpermission系でなければ何もせず false を返す）。
pub fn record_event(state: &AppState, session: &str, event: &str, detail: &str) -> bool {
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
    let Some(new_state) = event_state(event, detail) else {
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
        &crate::tmux::get_or_create_hook_token(&state.paths.data_dir),
    )
}

// ─── HTTP エンドポイント（`POST /agent-hooks/events`）──────────────────────

#[derive(Deserialize)]
pub struct HookEventBody {
    pub session: String,
    pub event: String,
    #[serde(default)]
    pub detail: String,
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
    let recognized = record_event(&state, &body.session, &body.event, &body.detail);
    Ok(Json(json!({"status": "ok", "recognized": recognized})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = crate::state::test_app_state(dir.path(), "ac-", 1000);
        (state, dir)
    }

    #[test]
    fn token_is_created_and_persisted() {
        let (state, _dir) = test_state();
        let token = crate::tmux::get_or_create_hook_token(&state.paths.data_dir);
        assert!(token.len() >= 32);
        assert_eq!(
            crate::tmux::get_or_create_hook_token(&state.paths.data_dir),
            token
        );
        let saved = std::fs::read_to_string(state.paths.data_dir.join("hook_token")).unwrap();
        assert_eq!(saved.trim(), token);
    }

    #[test]
    fn verify_accepts_correct_token_only() {
        let (state, _dir) = test_state();
        let token = crate::tmux::get_or_create_hook_token(&state.paths.data_dir);
        assert!(verify_hook_token(&state, &token));
        assert!(!verify_hook_token(&state, "wrong"));
        assert!(!verify_hook_token(&state, ""));
    }

    #[test]
    fn event_state_mapping() {
        let (state, _dir) = test_state();
        assert!(record_event(&state, "s1", "PreToolUse", ""));
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("working"));
        record_event(&state, "s1", "Notification", "Claude needs your permission");
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("blocked"));
        record_event(&state, "s1", "Stop", "");
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("idle"));
    }

    #[test]
    fn notification_without_permission_wording_does_not_block() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "Stop", "");
        assert!(!record_event(
            &state,
            "s1",
            "Notification",
            "Claude is waiting for your input"
        ));
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("idle"));
    }

    #[test]
    fn tmux_prefix_is_stripped() {
        let (state, _dir) = test_state();
        record_event(&state, "ac-s2", "Notification", "needs your permission");
        assert_eq!(hook_state(&state, "s2").as_deref(), Some("blocked"));
    }

    #[test]
    fn unknown_event_is_ignored() {
        let (state, _dir) = test_state();
        assert!(!record_event(&state, "s1", "SomeFutureEvent", ""));
        assert!(hook_state(&state, "s1").is_none());
    }

    #[test]
    fn subagent_stop_does_not_change_state() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "PreToolUse", "");
        assert!(!record_event(&state, "s1", "SubagentStop", ""));
        assert_eq!(hook_state(&state, "s1").as_deref(), Some("working"));
    }

    #[test]
    fn session_end_clears_state() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "Notification", "needs your permission");
        assert!(record_event(&state, "s1", "SessionEnd", ""));
        assert!(hook_state(&state, "s1").is_none());
    }

    #[test]
    fn empty_session_is_rejected() {
        let (state, _dir) = test_state();
        assert!(!record_event(&state, "", "Stop", ""));
        assert!(!record_event(&state, "   ", "Stop", ""));
    }

    #[test]
    fn state_expires_after_ttl() {
        let (state, _dir) = test_state();
        record_event(&state, "s1", "Notification", "needs your permission");
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
        record_event(&state, "s1", "Notification", "needs your permission");
        clear_session(&state, "s1");
        assert!(hook_state(&state, "s1").is_none());
    }
}
