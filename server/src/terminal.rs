//! ターミナルセッションの HTTP エンドポイントと WebSocket（Python 側
//! `api/routers/terminal.py` の移植）。`terminal_session.rs`（レジストリ）・
//! `tmux.rs`・`pty.rs` の上に構築する。全ハンドラは `build_router`（lib.rs）で
//! 配線済み。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::future::join_all;
use futures_util::SinkExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::auth::RequireAuth;
use crate::errors::{not_found, server_error, timeout_error, ApiError};
use crate::git_helpers::resolve_and_validate_workspace_path;
use crate::git_utils::resolve_workspace_path;
use crate::json_store::{load_json_file, save_json_file};
use crate::state::AppState;
use crate::terminal_session::{PtyEvent, TerminalSession};
use crate::tmux;
use crate::util::{JsonBody, QueryParams};

const PENDING_TEXT_DELAY_SEC: f64 = 0.5;
const WS_PING_INTERVAL_SEC: u64 = 15;
const WS_MSG_RESIZE: u8 = 0x00;
const WS_CLOSE_SESSION_EXITED: u16 = 4001;

// ─── GET /terminal/sessions ──────────────────────────────────────────────────

async fn session_list_entry(
    state: &Arc<AppState>,
    session_id: &str,
    full_tmux_name: &str,
) -> Value {
    let (workspace, worktree_base, worktree_branch, icon, icon_color, job_name, job_label, interactive, detached) =
        match state.terminal_registry.get(session_id).await {
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
    let mut sessions: Vec<Value> = join_all(
        entries
            .iter()
            .map(|(session_id, name)| session_list_entry(&state, session_id, name)),
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

// ─── GET /terminal/sessions/{id}/cwd ─────────────────────────────────────────

pub async fn get_terminal_session_cwd(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    state.terminal_session(&session_id).await?;
    let name = state.paths.tmux_session_name(&session_id);
    let cwd = tmux::get_session_cwd(&name)
        .await
        .ok_or_else(|| not_found("CWD unavailable"))?;
    Ok(Json(json!({ "cwd": cwd })))
}

async fn resolve_terminal_session_file(
    state: &Arc<AppState>,
    session_id: &str,
    path: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
    state.terminal_session(session_id).await?;
    let name = state.paths.tmux_session_name(session_id);
    let cwd = tmux::get_session_cwd(&name)
        .await
        .ok_or_else(|| not_found("CWD unavailable"))?;
    let root = PathBuf::from(&cwd)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&cwd));
    let (target, rel) = resolve_and_validate_workspace_path(&root, path)?;
    Ok((root, target, rel))
}

#[derive(Deserialize)]
pub struct PathQuery {
    #[serde(default)]
    path: String,
}

pub async fn list_terminal_session_files(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<PathQuery>,
) -> Result<Json<Value>, ApiError> {
    let (root, target, rel) =
        resolve_terminal_session_file(&state, &session_id, &query.path).await?;
    crate::git_files::list_dir_response(&root, &target, &rel)
        .await
        .map(Json)
}

#[derive(Deserialize)]
pub struct FileContentQuery {
    path: String,
}

pub async fn get_terminal_session_file_content(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<FileContentQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_, target, rel) = resolve_terminal_session_file(&state, &session_id, &query.path).await?;
    let rel_path = rel.to_string_lossy().into_owned();
    crate::git_files::file_content_or_error(&rel_path, &target, &rel).map(Json)
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

#[derive(Deserialize)]
pub struct WsQuery {
    #[serde(default)]
    token: String,
    #[serde(default)]
    cols: u16,
    #[serde(default)]
    rows: u16,
}

pub async fn terminal_ws(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    QueryParams(query): QueryParams<WsQuery>,
    headers: http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if crate::auth::verify_ws_token(&state, &query.token, &addr.ip().to_string(), &headers)
        .is_none()
    {
        return (http::StatusCode::FORBIDDEN, "Unauthorized").into_response();
    }
    ws.on_upgrade(move |socket| async move {
        handle_terminal_ws(state, session_id, query.cols, query.rows, socket).await;
    })
}

async fn close_ws(socket: &mut WebSocket, code: u16, reason: &str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.to_string().into(),
        })))
        .await;
}

/// tmux セッションが（何らかの理由で）消えていた場合に再作成する
/// （Python `_ensure_tmux_session` 相当）。
async fn ensure_tmux_session(
    state: &Arc<AppState>,
    session_arc: &Arc<tokio::sync::Mutex<TerminalSession>>,
    session_id: &str,
) -> bool {
    let full_name = { session_arc.lock().await.tmux_session_name.clone() };
    if crate::subprocess::tmux_session_exists(&full_name).await {
        return true;
    }
    let workspace = { session_arc.lock().await.workspace.clone() };
    let workspace_path = match workspace.as_deref() {
        Some(ws) => resolve_workspace_path(&state.config, ws)
            .await
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        None => None,
    };
    match tmux::create_tmux_session(
        &state.paths.data_dir,
        &state.config,
        &state.paths.project_root,
        workspace_path.as_deref(),
        &full_name,
    )
    .await
    {
        Ok(()) => {
            {
                session_arc.lock().await.save_metadata().await;
            }
            tracing::info!(
                "recreated tmux session={session_id} workspace={}",
                workspace.as_deref().unwrap_or("(none)")
            );
            true
        }
        Err(e) => {
            tracing::error!("failed to recreate tmux session={session_id}: {e}");
            state.terminal_registry.remove(session_id).await;
            false
        }
    }
}

/// 入力バイト列をコマンドバッファへ反映し、Enter 時にコマンド文字列を返す
/// （Python `_update_cmd_buffer` 相当。activity ログ用）。
fn update_cmd_buffer(buf: &mut Vec<u8>, data: &[u8]) -> Option<String> {
    for &b in data {
        match b {
            0x0D => {
                let cmd = String::from_utf8_lossy(buf).trim().to_string();
                buf.clear();
                return if cmd.is_empty() { None } else { Some(cmd) };
            }
            0x7F | 0x08 => {
                buf.pop();
            }
            0x15 => buf.clear(),
            b if (0x20..0x7F).contains(&b) || b >= 0x80 => buf.push(b),
            _ => {}
        }
    }
    None
}

async fn handle_terminal_ws(
    state: Arc<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
    mut socket: WebSocket,
) {
    let session_arc = match state.terminal_session(&session_id).await {
        Ok(arc) => arc,
        Err(_) => {
            close_ws(&mut socket, 1008, "Session not found").await;
            return;
        }
    };

    if !ensure_tmux_session(&state, &session_arc, &session_id).await {
        return;
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<PtyEvent>();
    let bridge_id = {
        let mut session = session_arc.lock().await;
        match session.attach_client_bridge(cols, rows, session_id.clone(), tx) {
            Ok(id) => id,
            Err(e) => {
                tracing::error!("tmux attach failed session={session_id}: {e}");
                close_ws(&mut socket, 1011, "tmux attach failed").await;
                return;
            }
        }
    };

    // pending text（dispatch が新規作成セッションへ送る予約テキスト。tmux 環境変数
    // TMUX_PENDING_TEXT/TMUX_PENDING_ENTER 経由 — 詳細は dispatch.rs 側の説明を参照）
    // を attach 後の tmux 初期 redraw を待ってから flush する。
    //
    // flush 権のクレームは session_arc の Mutex 内で1回だけ行う（詳細は
    // `TerminalSession::claim_pending_text_flush` のコメント参照）。
    let flush_target: Option<String> = {
        let mut session = session_arc.lock().await;
        session.claim_pending_text_flush()
    };
    if let Some(full_name) = flush_target {
        let session_id_for_flush = session_id.clone();
        tokio::spawn(async move {
            flush_pending_text(&full_name, &session_id_for_flush).await;
        });
    }

    let mut ping_interval = tokio::time::interval(Duration::from_secs(WS_PING_INTERVAL_SEC));
    ping_interval.tick().await; // 初回 tick は即座に完了するため消費しておく
    let mut cmd_buf: Vec<u8> = Vec::new();
    let mut pty_eof = false;

    loop {
        tokio::select! {
            pty_event = rx.recv() => {
                match pty_event {
                    Some(PtyEvent::Data(bytes)) => {
                        if socket.send(Message::Binary(bytes.into())).await.is_err() {
                            break;
                        }
                    }
                    Some(PtyEvent::Eof) | None => {
                        pty_eof = true;
                        break;
                    }
                }
            }
            _ = ping_interval.tick() => {
                if socket.send(Message::Binary(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                let Some(Ok(msg)) = msg else { break };
                let data: Option<Vec<u8>> = match msg {
                    Message::Binary(b) => Some(b.to_vec()),
                    Message::Text(t) => Some(t.as_bytes().to_vec()),
                    Message::Close(_) => break,
                    _ => None,
                };
                let Some(data) = data else { continue };
                if data.is_empty() {
                    continue;
                }
                if data[0] == WS_MSG_RESIZE {
                    handle_resize(&session_arc, bridge_id, &data[1..]).await;
                } else {
                    let workspace = { session_arc.lock().await.workspace.clone() };
                    if let Some(cmd) = update_cmd_buffer(&mut cmd_buf, &data) {
                        crate::activity::log_activity(
                            &state.paths.data_dir,
                            workspace.as_deref(),
                            "terminal",
                            [("cmd".to_string(), json!(cmd))].into_iter().collect(),
                        );
                    }
                    let write_result = {
                        let session = session_arc.lock().await;
                        session.bridges.get(&bridge_id).map(|b| b.write(&data))
                    };
                    if let Some(Err(e)) = write_result {
                        tracing::debug!("pty write failed session={session_id}: {e}");
                    }
                }
            }
        }
    }

    {
        let mut session = session_arc.lock().await;
        session.close_client_bridge(bridge_id);
    }
    if pty_eof {
        tracing::info!("PTY EOF detected, closing client session={session_id}");
        close_ws(&mut socket, WS_CLOSE_SESSION_EXITED, "session exited").await;
    } else {
        let _ = socket.close().await;
    }
}

async fn handle_resize(
    session_arc: &Arc<tokio::sync::Mutex<TerminalSession>>,
    bridge_id: u64,
    payload: &[u8],
) {
    let Ok(size) = serde_json::from_slice::<Value>(payload) else {
        return;
    };
    let cols = size.get("cols").and_then(Value::as_u64).unwrap_or(80) as u16;
    let rows = size.get("rows").and_then(Value::as_u64).unwrap_or(24) as u16;
    let mut session = session_arc.lock().await;
    if let Some(bridge) = session.bridges.get_mut(&bridge_id) {
        bridge.resize(cols, rows);
    }
}

/// dispatch が新規セッションに予約したテキストを attach 後の初期 redraw を
/// 待ってから送る（Python `_flush_pending_text` 相当。永続先が tmux 環境変数
/// なのでプロセスをまたいでも安全 — 詳細は dispatch.rs のコメント参照）。
async fn flush_pending_text(full_tmux_name: &str, session_id: &str) {
    tokio::time::sleep(Duration::from_secs_f64(PENDING_TEXT_DELAY_SEC)).await;
    let meta = tmux::load_tmux_metadata(full_tmux_name).await;
    let Some(encoded) = meta.get("TMUX_PENDING_TEXT").filter(|s| !s.is_empty()) else {
        return;
    };
    // dispatch.rs 側の set_pending_text が hex エンコードして保存している
    // （複数行 text が1行の tmux 環境変数値として壊れずに運べるようにするため）。
    let text = tmux::decode_pending_text(encoded);
    let enter = meta.get("TMUX_PENDING_ENTER").map(String::as_str) != Some("0");
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_TEXT").await;
    tmux::unset_environment(full_tmux_name, "TMUX_PENDING_ENTER").await;
    if !text.is_empty() && !tmux::send_keys_to_tmux(full_tmux_name, &text, enter).await {
        tracing::warn!("pending text send-keys failed session={session_id}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_buffer_extracts_command_on_enter() {
        let mut buf = Vec::new();
        assert_eq!(update_cmd_buffer(&mut buf, b"echo hi"), None);
        assert_eq!(
            update_cmd_buffer(&mut buf, b"\r"),
            Some("echo hi".to_string())
        );
        assert!(buf.is_empty());
    }

    #[test]
    fn cmd_buffer_handles_backspace_and_ctrl_u() {
        let mut buf = Vec::new();
        update_cmd_buffer(&mut buf, b"echo bad");
        update_cmd_buffer(&mut buf, &[0x7F, 0x7F, 0x7F]); // "bad" を消す
        assert_eq!(String::from_utf8_lossy(&buf), "echo ");
        update_cmd_buffer(&mut buf, &[0x15]); // Ctrl-U で全消去
        assert!(buf.is_empty());
    }

    #[test]
    fn cmd_buffer_empty_command_is_none() {
        let mut buf = Vec::new();
        assert_eq!(update_cmd_buffer(&mut buf, b"   "), None);
        assert_eq!(update_cmd_buffer(&mut buf, b"\r"), None);
    }

    #[tokio::test]
    async fn flush_pending_text_sends_and_clears_env() {
        if crate::tmux::skip_if_no_tmux() {
            return;
        }
        let name = format!("ac-test-pending-{}", crate::util::token_hex(4));
        crate::subprocess::run_subprocess_safe(
            &["tmux", "new-session", "-d", "-s", &name],
            5.0,
            None,
        )
        .await;
        let encoded = tmux::encode_pending_text("echo pending-flush");
        tmux::set_environment(
            &name,
            &[("TMUX_PENDING_TEXT", &encoded), ("TMUX_PENDING_ENTER", "1")],
        )
        .await;
        assert!(tmux::wait_pane_ready(&name, 2.0).await);

        flush_pending_text(&name, "test-session").await;

        let meta = tmux::load_tmux_metadata(&name).await;
        assert!(!meta.contains_key("TMUX_PENDING_TEXT"));

        // send-keys 自体は完了済みだが、シェルが Enter を処理し出力するまで
        // 数十ms 掛かることがあるため短時間ポーリングする。
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let mut found = false;
        while tokio::time::Instant::now() < deadline {
            let content = crate::subprocess::run_subprocess_safe(
                &["tmux", "capture-pane", "-t", &name, "-p"],
                5.0,
                None,
            )
            .await
            .unwrap();
            if content.stdout.contains("pending-flush") {
                found = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(found, "pending text was not sent to the pane");

        crate::subprocess::kill_tmux_by_name(&name).await;
    }
}
