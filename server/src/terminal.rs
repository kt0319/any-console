//! ターミナルセッションの HTTP エンドポイントと WebSocket。`terminal_session.rs`（レジストリ）・
//! `tmux.rs`・`pty.rs` の上に構築する。全ハンドラは `build_router`（lib.rs）で
//! 配線済み。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Multipart, Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::future::join_all;
use futures_util::SinkExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::agent_watch;
use crate::auth::RequireAuth;
use crate::errors::{not_found, server_error, timeout_error, ApiError};
use crate::git_helpers::resolve_and_validate_workspace_path;
use crate::git_utils::resolve_workspace_path;
use crate::json_store::{load_json_file, save_json_file};
use crate::screen_manifest;
use crate::state::AppState;
use crate::terminal_session::{PtyEvent, TerminalSession};
use crate::tmux;
use crate::util::{JsonBody, QueryParams};

mod files;
mod pending_text;
mod ws;

pub use files::delete_terminal_session_file;
pub use files::download_terminal_session_file;
pub use files::download_terminal_session_open_path;
pub use files::get_terminal_session_cwd;
pub use files::get_terminal_session_file_content;
pub use files::list_terminal_session_files;
pub use files::open_terminal_session_path;
pub use files::rename_terminal_session_file;
pub use files::upload_terminal_session_file;
pub(crate) use pending_text::deliver_pending_text_to_agent;
pub use ws::terminal_ws;

const PENDING_TEXT_DELAY_SEC: f64 = 0.5;
/// pending text flush 前に、job（既知のAIエージェントと識別できた場合のみ）が
/// 画面上でidleになるまで待つ上限（`wait_agent_idle_if_known`参照）。
const AGENT_READY_TIMEOUT_SEC: f64 = 8.0;
const AGENT_READY_POLL_INTERVAL_SEC: f64 = 0.2;
/// direct dispatch の入力送信が、他の attach の flush 権（保留テキスト設定前の空振りなら
/// 手放される）を待つ上限。`PENDING_TEXT_DELAY_SEC` 後に結論が出るので余裕を持たせる。
const PENDING_CLAIM_WAIT_SEC: f64 = 3.0;
/// direct dispatch で、job の起動後にエージェントのプロセスが現れるのを待つ上限。
const AGENT_START_TIMEOUT_SEC: f64 = 15.0;
const WS_PING_INTERVAL_SEC: u64 = 15;
const WS_MSG_RESIZE: u8 = 0x00;
const WS_CLOSE_SESSION_EXITED: u16 = 4001;

// ─── GET /terminal/sessions ──────────────────────────────────────────────────

async fn session_list_entry(
    state: &Arc<AppState>,
    session_id: &str,
    full_tmux_name: &str,
    pane_meta: &std::collections::HashMap<String, tmux::PaneMeta>,
) -> Value {
    let (
        workspace,
        worktree_base,
        worktree_branch,
        icon,
        icon_color,
        job_name,
        job_label,
        interactive,
        detached,
    ) = match state.terminal_registry.get(session_id).await {
        Some(arc) => {
            let s = arc.lock().await;
            (
                s.workspace.clone(),
                s.worktree_base.clone(),
                s.worktree_branch.clone(),
                s.icon.clone(),
                s.icon_color.clone(),
                s.job_name.clone(),
                s.job_label.clone(),
                s.interactive,
                s.detached,
            )
        }
        None => {
            let s = TerminalSession::from_tmux(&state.config, full_tmux_name).await;
            (
                s.workspace,
                s.worktree_base,
                s.worktree_branch,
                s.icon,
                s.icon_color,
                s.job_name,
                s.job_label,
                s.interactive,
                s.detached,
            )
        }
    };
    let created_at = tmux::get_tmux_created(full_tmux_name).await;
    // pane_pid はSystem Info > Server ProcessesでJobのプロセス行を判別するために使う
    // （tmuxペインの実行中コマンドのpid。`ps aux`のpidと突き合わせる）。
    let pid = pane_meta.get(full_tmux_name).map(|m| m.2);
    json!({
        "session_id": session_id,
        "workspace": workspace,
        "worktree_base": worktree_base,
        "worktree_branch": worktree_branch,
        "ws_url": format!("/terminal/ws/{session_id}"),
        "icon": icon,
        "icon_color": icon_color,
        "job_name": job_name,
        "job_label": job_label,
        "created_at": created_at,
        "detached": detached,
        "interactive": interactive,
        "pid": pid,
    })
}

pub async fn list_terminal_sessions(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    let Some(ids) = crate::tmux::list_session_ids(&state.paths.tmux_prefix).await else {
        return Err(server_error("Failed to list tmux sessions"));
    };
    // セッションごとの tmux 問い合わせ（レジストリ未登録なら show-environment、
    // 加えて毎回 display-message）を逐次 await すると、セッション数に比例して
    // 応答が遅くなる（特にサーバ再起動直後は全セッションが未登録経路を通り
    // 2倍になる）。tmux サーバ自体は複数クライアントからの同時問い合わせを
    // 捌けるため、並行に投げて join_all でまとめて待つ。
    let entries: Vec<(String, String)> = ids
        .into_iter()
        .map(|id| {
            let name = state.paths.tmux_session_name(&id);
            (id, name)
        })
        .collect();
    let pane_meta = tmux::list_pane_meta().await;
    let mut sessions: Vec<Value> = join_all(
        entries
            .iter()
            .map(|(session_id, name)| session_list_entry(&state, session_id, name, &pane_meta)),
    )
    .await;
    sessions.sort_by_key(|s| s["created_at"].as_i64().unwrap_or(0));
    Ok(Json(Value::Array(sessions)))
}

// ─── GET /terminal/sessions/{id}/history ────────────────────────────────────

#[derive(Deserialize)]
pub struct HistoryQuery {
    cols: Option<u16>,
    rows: Option<u16>,
}

/// 注意: GET だが冪等ではない — `cols`/`rows` 指定時は履歴取得前に
/// `tmux resize-window` / `set-option window-size` で tmux 側の状態を変更する。
pub async fn get_terminal_history(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let session_arc = state.terminal_session(&session_id).await?;
    let full_name = { session_arc.lock().await.tmux_session_name.clone() };

    if let (Some(cols), Some(rows)) = (query.cols, query.rows) {
        if cols > 0 && rows > 0 {
            let has_bridges = { !session_arc.lock().await.bridges.is_empty() };
            if !has_bridges {
                // resize-window は window-size を manual に書き換えるため latest へ戻す
                // （戻さないと以後のクライアント PTY リサイズにウィンドウが追従しなくなる）。
                crate::subprocess::run_tmux_cmd(&[
                    "resize-window",
                    "-t",
                    &full_name,
                    "-x",
                    &cols.to_string(),
                    "-y",
                    &rows.to_string(),
                    ";",
                    "set-option",
                    "-t",
                    &full_name,
                    "window-size",
                    "latest",
                ])
                .await;
            } else {
                // 他クライアント接続中はウィンドウを動かせない。幅不一致なら
                // 誤った wrap でスクロールバックが崩れるため復元自体をスキップする。
                let width = tmux::get_window_width(&full_name).await;
                if width.is_some_and(|w| w != cols as i64) {
                    return Ok(Json(json!({"content": ""})));
                }
            }
        }
    }

    match crate::subprocess::run_subprocess_safe(
        &[
            "tmux",
            "capture-pane",
            "-t",
            &full_name,
            "-p",
            "-e",
            "-S",
            "-",
            "-E",
            "-",
        ],
        crate::subprocess::TMUX_CMD_TIMEOUT_SEC,
        None,
    )
    .await
    {
        Some(r) if r.success() => {
            let content = r.stdout.replace("\r\n", "\n").replace('\n', "\r\n");
            Ok(Json(json!({ "content": content })))
        }
        Some(_) => Err(server_error("Failed to capture history")),
        None => Err(timeout_error("Timeout")),
    }
}

// ─── DELETE /terminal/sessions/{id} ─────────────────────────────────────────

pub async fn delete_terminal_session(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    // tmux には実在するがレジストリ未登録（Rust 再起動直後等）なセッションも
    // 先にハイドレートしてから削除する。そうしないと `remove` が None を返して
    // 404 になり、tmux セッションは実際にはキルされないまま残り続ける
    // （Codex レビュー指摘）。
    state.terminal_session(&session_id).await?;
    let Some(session_arc) = state.terminal_registry.remove(&session_id).await else {
        return Err(not_found("Terminal session not found"));
    };
    state.terminal_registry.kill(&session_arc).await;
    crate::agent_hooks::clear_session(&state, &session_id);
    crate::session_watch::notify_session_removed(&state, &session_id);
    tracing::info!("terminal session deleted session={session_id}");
    Ok(Json(json!({"status": "ok"})))
}

// ─── PUT /terminal/sessions/{id}/workspace, /detached ───────────────────────

#[derive(Deserialize)]
pub struct WorkspaceBody {
    workspace: String,
}

pub async fn set_terminal_session_workspace(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<WorkspaceBody>,
) -> Result<Json<Value>, ApiError> {
    let session_arc = state.terminal_session(&session_id).await?;
    {
        let mut s = session_arc.lock().await;
        s.set_workspace(Some(body.workspace.clone()));
        s.save_workspace().await;
    }
    tracing::info!(
        "terminal session workspace set session={session_id} workspace={}",
        body.workspace
    );
    crate::session_watch::notify_session_workspace_bound(&state, &session_id, &body.workspace);
    Ok(Json(json!({"status": "ok", "workspace": body.workspace})))
}

#[derive(Deserialize)]
pub struct DetachedBody {
    detached: bool,
}

pub async fn set_terminal_detached(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<DetachedBody>,
) -> Result<Json<Value>, ApiError> {
    let session_arc = state.terminal_session(&session_id).await?;
    let detached = {
        let mut s = session_arc.lock().await;
        s.detached = body.detached;
        s.save_detached().await;
        s.detached
    };
    Ok(Json(json!({"status": "ok", "detached": detached})))
}

// ─── /terminal/order ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct TabOrderPayload {
    order: Vec<String>,
}

fn tab_order_file(state: &AppState) -> PathBuf {
    state.paths.data_dir.join("sessions.json")
}

pub async fn get_tab_order(State(state): State<Arc<AppState>>, _auth: RequireAuth) -> Json<Value> {
    let data = load_json_file(&tab_order_file(&state), json!({}), None);
    let order: Vec<String> = data
        .get("order")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Json(json!({ "order": order }))
}

pub async fn put_tab_order(
    State(state): State<Arc<AppState>>,
    _auth: RequireAuth,
    JsonBody(payload): JsonBody<TabOrderPayload>,
) -> Result<Json<Value>, ApiError> {
    save_json_file(&tab_order_file(&state), &json!({"order": payload.order}))
        .map_err(|e| server_error(format!("Failed to save tab order: {e}")))?;
    Ok(Json(json!({ "order": payload.order })))
}

// ─── WebSocket ────────────────────────────────────────────────────────────
