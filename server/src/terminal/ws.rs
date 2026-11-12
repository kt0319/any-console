//! ターミナルの WebSocket（attach・入出力・リサイズ）。

use super::pending_text::flush_pending_text;
use super::*;

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
    QueryParams(query): QueryParams<WsQuery>,
    headers: http::HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(auth) = crate::auth::verify_ws_token(&state, &query.token, &headers) else {
        return (http::StatusCode::FORBIDDEN, "Unauthorized").into_response();
    };
    let device_id = auth.device_id().map(str::to_string);
    ws.on_upgrade(move |socket| async move {
        handle_terminal_ws(state, session_id, query.cols, query.rows, device_id, socket).await;
    })
}

async fn close_ws(socket: &mut WebSocket, code: u16, reason: &str) {
    // クライアント側で既に切断されていれば Err になるだけ
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

/// `CmdBuffer` が ESC 始まりのシーケンスを読み飛ばす間の状態。
/// WS のフレーム境界でシーケンスが分断されうるため、呼び出しをまたいで保持する。
#[derive(Clone, Copy, PartialEq, Eq)]
enum EscapeState {
    Ground,
    Esc,
    Csi,
    /// OSC / DCS など。BEL または ST（ESC \）まで続く。
    Str,
    Ss3,
}

/// 入力バイト列から activity ログ用のコマンド文字列を組み立てる。
/// マウス報告（`ESC [ < 35 ; x ; y M`）や端末の応答（DA・OSC 色問い合わせ）など、
/// ユーザーが打っていない ESC シーケンスは記録しない。
struct CmdBuffer {
    buf: Vec<u8>,
    escape: EscapeState,
}

impl CmdBuffer {
    fn new() -> Self {
        Self {
            buf: Vec::new(),
            escape: EscapeState::Ground,
        }
    }

    /// Enter 時にコマンド文字列を返す（Python `_update_cmd_buffer` 相当）。
    fn feed(&mut self, data: &[u8]) -> Option<String> {
        for &b in data {
            match self.escape {
                EscapeState::Esc => {
                    self.escape = match b {
                        b'[' => EscapeState::Csi,
                        b']' | b'P' | b'X' | b'^' | b'_' => EscapeState::Str,
                        b'O' => EscapeState::Ss3,
                        0x1B => EscapeState::Esc,
                        _ => EscapeState::Ground,
                    };
                    continue;
                }
                EscapeState::Csi => {
                    self.escape = match b {
                        0x40..=0x7E => EscapeState::Ground,
                        0x1B => EscapeState::Esc,
                        _ => EscapeState::Csi,
                    };
                    continue;
                }
                EscapeState::Str => {
                    self.escape = match b {
                        0x07 => EscapeState::Ground,
                        0x1B => EscapeState::Esc,
                        _ => EscapeState::Str,
                    };
                    continue;
                }
                EscapeState::Ss3 => {
                    self.escape = EscapeState::Ground;
                    continue;
                }
                EscapeState::Ground => {}
            }
            match b {
                0x1B => self.escape = EscapeState::Esc,
                0x0D => {
                    let cmd = String::from_utf8_lossy(&self.buf).trim().to_string();
                    self.buf.clear();
                    return if cmd.is_empty() { None } else { Some(cmd) };
                }
                0x7F | 0x08 => {
                    self.buf.pop();
                }
                0x15 => self.buf.clear(),
                b if (0x20..0x7F).contains(&b) || b >= 0x80 => self.buf.push(b),
                _ => {}
            }
        }
        None
    }
}

async fn handle_terminal_ws(
    state: Arc<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
    device_id: Option<String>,
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
        let state_for_flush = state.clone();
        let session_for_flush = session_arc.clone();
        tokio::spawn(async move {
            let had_pending_text =
                flush_pending_text(&state_for_flush, &full_name, &session_id_for_flush).await;
            if !had_pending_text {
                session_for_flush.lock().await.release_pending_text_flush();
            }
        });
    }

    let mut ping_interval = tokio::time::interval(Duration::from_secs(WS_PING_INTERVAL_SEC));
    ping_interval.tick().await; // 初回 tick は即座に完了するため消費しておく
    let mut cmd_buf = CmdBuffer::new();
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
                // デバイス cookie 認証の接続は、revoke 済みデバイスの WS（＝生きた
                // シェル）を維持し続けないよう ping ごとに存続を確認する（HTTP は
                // リクエスト毎に再認証されるが WS はハンドシェイク時のみのため）。
                if let Some(id) = device_id.as_deref() {
                    if crate::devices::get_device(&state.paths.data_dir, id).is_none() {
                        close_ws(&mut socket, 1008, "Device revoked").await;
                        break;
                    }
                }
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
                    if let Some(cmd) = cmd_buf.feed(&data) {
                        crate::activity::log_activity(
                            &state.paths.data_dir,
                            workspace.as_deref(),
                            "terminal",
                            [("cmd".to_string(), json!(cmd))].into_iter().collect(),
                        );
                    }
                    let pty = {
                        let session = session_arc.lock().await;
                        session.bridges.get(&bridge_id).map(|b| b.pty_handle())
                    };
                    if let Some(pty) = pty {
                        if let Err(e) = pty.write_all(&data).await {
                            tracing::debug!("pty write failed session={session_id}: {e}");
                        }
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
        // クライアント側で既に切断されていれば Err になるだけ
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_buffer_extracts_command_on_enter() {
        let mut cmd = CmdBuffer::new();
        assert_eq!(cmd.feed(b"echo hi"), None);
        assert_eq!(cmd.feed(b"\r"), Some("echo hi".to_string()));
        assert!(cmd.buf.is_empty());
    }

    #[test]
    fn cmd_buffer_handles_backspace_and_ctrl_u() {
        let mut cmd = CmdBuffer::new();
        cmd.feed(b"echo bad");
        cmd.feed(&[0x7F, 0x7F, 0x7F]); // "bad" を消す
        assert_eq!(String::from_utf8_lossy(&cmd.buf), "echo ");
        cmd.feed(&[0x15]); // Ctrl-U で全消去
        assert!(cmd.buf.is_empty());
    }

    #[test]
    fn cmd_buffer_empty_command_is_none() {
        let mut cmd = CmdBuffer::new();
        assert_eq!(cmd.feed(b"   "), None);
        assert_eq!(cmd.feed(b"\r"), None);
    }

    #[test]
    fn cmd_buffer_ignores_mouse_reports() {
        let mut cmd = CmdBuffer::new();
        cmd.feed(b"\x1b[<35;120;21M\x1b[<35;115;18M");
        cmd.feed(b"ls");
        cmd.feed(b"\x1b[<0;115;37M\x1b[<0;115;37m");
        assert_eq!(cmd.feed(b"\r"), Some("ls".to_string()));
    }

    #[test]
    fn cmd_buffer_ignores_terminal_replies() {
        let mut cmd = CmdBuffer::new();
        cmd.feed(b"\x1b[?1;2c\x1b[>0;276;0c\x1b[?2026;2$y");
        cmd.feed(b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\\x1b]11;rgb:0000/0000/0000\x07");
        cmd.feed(b"pwd");
        assert_eq!(cmd.feed(b"\r"), Some("pwd".to_string()));
    }

    #[test]
    fn cmd_buffer_ignores_sequence_split_across_frames() {
        let mut cmd = CmdBuffer::new();
        cmd.feed(b"\x1b[<35;12");
        cmd.feed(b"0;21Mls");
        assert_eq!(cmd.feed(b"\r"), Some("ls".to_string()));
    }

    #[test]
    fn cmd_buffer_ignores_cursor_keys_and_keeps_pasted_text() {
        let mut cmd = CmdBuffer::new();
        cmd.feed(b"\x1b[A\x1bOB\x1b[1;5C");
        cmd.feed(b"\x1b[200~echo pasted\x1b[201~");
        assert_eq!(cmd.feed(b"\r"), Some("echo pasted".to_string()));
    }
}
