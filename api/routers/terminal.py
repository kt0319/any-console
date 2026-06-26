import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from fastapi.websockets import WebSocketDisconnect
from pydantic import BaseModel

from ..activity import log_activity
from ..auth import verify_token, verify_ws_token
from ..common import (
    TMUX_CMD_TIMEOUT_SEC,
    TMUX_SESSION_PREFIX,
    WS_MSG_RESIZE,
    WS_PING_INTERVAL_SEC,
    resolve_workspace_path,
)
from ..errors import not_found, server_error, timeout_error
from ..terminal_session import (
    PTY_EXECUTOR,
    TERMINAL_SESSIONS,
    TerminalSession,
    _handle_resize,
    _kill_tmux_session,
    _register_tmux_session,
    attach_client_bridge,
    detach_client_bridge,
    get_terminal_session,
    register_bridge,
    sessions_lock,
    start_bridge_reader,
)
from ..tmux import (
    _run_tmux_cmd,
    create_tmux_session,
    get_tmux_created,
    get_window_width,
    is_grouped_session_name,
    send_keys_to_tmux,
    tmux_session_exists,
)

PENDING_TEXT_DELAY_SEC = 0.5

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/terminal/sessions")
async def list_terminal_sessions():
    result = _run_tmux_cmd("list-sessions", "-F", "#{session_name}")
    if not result or result.returncode != 0:
        return []

    sessions = []
    for line in result.stdout.strip().splitlines():
        name = line.strip()
        # 旧アーキテクチャの grouped session（acg-... / ac-...__c...）はタブにしない。
        # 現行は作らないが、移行直後に残っている分を後方互換で除外する。
        if is_grouped_session_name(name):
            continue
        if not name.startswith(TMUX_SESSION_PREFIX):
            continue
        session_id = name[len(TMUX_SESSION_PREFIX):]
        if not session_id:
            continue

        with sessions_lock:
            cached = TERMINAL_SESSIONS.get(session_id)

        if cached:
            meta_src = cached
        else:
            meta_src = TerminalSession.from_tmux(name)
        md = meta_src.metadata_dict()

        created_at = get_tmux_created(name)
        sessions.append({
            "session_id": session_id,
            "workspace": md["workspace"],
            "ws_url": f"/terminal/ws/{session_id}",
            "icon": md["icon"],
            "icon_color": md["icon_color"],
            "job_name": md["job_name"],
            "job_label": md["job_label"],
            "created_at": created_at,
            "detached": meta_src.detached,
        })

    sessions.sort(key=lambda s: s.get("created_at") or 0)
    return sessions


@router.get("/terminal/sessions/{session_id}/history")
async def get_terminal_history(session_id: str, cols: int | None = None, rows: int | None = None):
    session = get_terminal_session(session_id)
    # クライアントから cols/rows を受けたら tmux を先にリサイズしてから capture する。
    # こうしないと、古いサイズで wrap された pane 内容をクライアントが書き戻して画面が崩れる。
    if cols and rows and cols > 0 and rows > 0:
        if not session.bridges:
            # resize-window は window-size を manual に書き換えるため latest へ戻す。
            # 戻さないと以後のクライアント PTY リサイズにウィンドウが追従しなくなる（ADR 16）。
            _run_tmux_cmd(
                "resize-window", "-t", session.tmux_session_name, "-x", str(cols), "-y", str(rows),
                ";", "set-option", "-t", session.tmux_session_name, "window-size", "latest",
            )
        else:
            # 他のクライアントが接続中はウィンドウを動かすとそちらの表示を乱すため
            # resize できない。幅が一致していればそのまま capture できるが、不一致の
            # まま capture すると誤った幅で wrap された内容をクライアントが書き戻して
            # 全スクロールバックが崩れるため、復元自体をスキップする（可視領域は
            # 接続時の tmux 再描画で揃う）。
            width = get_window_width(session.tmux_session_name)
            if width is not None and width != cols:
                return {"content": ""}
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session.tmux_session_name, "-p", "-e", "-S", "-", "-E", "-"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise server_error("Failed to capture history")
        content = result.stdout.replace("\r\n", "\n").replace("\n", "\r\n")
        return {"content": content}
    except subprocess.TimeoutExpired as e:
        raise timeout_error("Timeout") from e
    except OSError as e:
        raise server_error(f"Failed to capture history: {e}") from None


@router.delete("/terminal/sessions/{session_id}")
async def delete_terminal_session(session_id: str):
    with sessions_lock:
        session = TERMINAL_SESSIONS.pop(session_id, None)
    if not session:
        raise not_found("Terminal session not found")
    _kill_tmux_session(session)
    logger.info("terminal session deleted session=%s", session_id)
    return {"status": "ok"}


class DetachedBody(BaseModel):
    detached: bool


@router.put("/terminal/sessions/{session_id}/detached")
async def set_terminal_detached(session_id: str, body: DetachedBody):
    """セッションの detached 状態を tmux 環境変数に永続化する。
    dispatch がターゲット候補から除外する判定に使う。"""
    with sessions_lock:
        session = TERMINAL_SESSIONS.get(session_id)
        if session:
            session.detached = bool(body.detached)
    if not session:
        raise not_found("Terminal session not found")
    session.save_detached()
    return {"status": "ok", "detached": session.detached}


_TAB_ORDER_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "sessions.json"


def _load_tab_order() -> list[str]:
    try:
        if not _TAB_ORDER_FILE.exists():
            return []
        data = json.loads(_TAB_ORDER_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    order = data.get("order") if isinstance(data, dict) else None
    if not isinstance(order, list):
        return []
    return [s for s in order if isinstance(s, str)]


def _save_tab_order(order: list[str]) -> None:
    _TAB_ORDER_FILE.parent.mkdir(parents=True, exist_ok=True)
    _TAB_ORDER_FILE.write_text(json.dumps({"order": order}))


class TabOrderPayload(BaseModel):
    order: list[str]


@router.get("/terminal/order")
async def get_tab_order():
    return {"order": _load_tab_order()}


@router.put("/terminal/order")
async def put_tab_order(payload: TabOrderPayload):
    try:
        _save_tab_order(payload.order)
    except OSError as e:
        raise server_error(f"Failed to save tab order: {e}") from None
    return {"order": payload.order}


ws_router = APIRouter()


async def _resolve_session_for_ws(session_id: str):
    with sessions_lock:
        session = TERMINAL_SESSIONS.get(session_id)
    if not session:
        tmux_name = TMUX_SESSION_PREFIX + session_id
        if tmux_session_exists(tmux_name):
            session = _register_tmux_session(session_id, tmux_name)
    return session


async def _ensure_tmux_session(websocket: WebSocket, session, session_id: str) -> bool:
    if tmux_session_exists(session.tmux_session_name):
        return True
    try:
        ws_resolved = resolve_workspace_path(session.workspace)
        workspace_path = str(ws_resolved) if ws_resolved else None
    except (HTTPException, ValueError, OSError):
        workspace_path = None
    try:
        create_tmux_session(workspace_path, session.tmux_session_name)
        session.save_metadata()
        logger.info("recreated tmux session=%s workspace=%s", session_id, session.workspace or "(none)")
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        logger.error("failed to recreate tmux session=%s: %s", session_id, e)
        with sessions_lock:
            TERMINAL_SESSIONS.pop(session_id, None)
        await websocket.close(code=1008, reason="Shell process has exited")
        return False


def _extract_ws_message_data(msg) -> bytes | None:
    data = msg.get("bytes")
    if data is None and msg.get("text") is not None:
        data = msg["text"].encode("utf-8")
    return data or None


def _update_cmd_buffer(buf: bytearray, data: bytes) -> str | None:
    """入力バイト列をバッファに反映し、Enter 時にコマンド文字列を返す。"""
    for b in data:
        if b == 0x0D:  # Enter
            cmd = buf.decode("utf-8", errors="replace").strip()
            buf.clear()
            return cmd if cmd else None
        elif b in (0x7F, 0x08):  # Backspace / BS
            if buf:
                buf.pop()
        elif b == 0x15:  # Ctrl-U (行消去)
            buf.clear()
        elif 0x20 <= b < 0x7F or b >= 0x80:  # 表示可能文字 + マルチバイト
            buf.append(b)
        # その他の制御文字は無視
    return None


async def _ws_message_loop(websocket: WebSocket, session, bridge) -> None:
    loop = asyncio.get_event_loop()
    cmd_buf: bytearray = bytearray()
    while True:
        try:
            msg = await asyncio.wait_for(websocket.receive(), timeout=WS_PING_INTERVAL_SEC)
        except asyncio.TimeoutError:
            await websocket.send_bytes(b"")
            continue

        if msg.get("type") == "websocket.disconnect":
            break

        data = _extract_ws_message_data(msg)
        if not data:
            continue

        if data[0:1] == WS_MSG_RESIZE:
            _handle_resize(bridge, data[1:])
        else:
            cmd = _update_cmd_buffer(cmd_buf, data)
            if cmd:
                log_activity(session.workspace, "terminal", cmd=cmd)
            if bridge.fd is not None:
                await loop.run_in_executor(PTY_EXECUTOR, os.write, bridge.fd, data)


async def _flush_pending_text(session, session_id: str) -> None:
    """attach 後 tmux の初期 redraw + resize を待ってから pending text を送る。"""
    await asyncio.sleep(PENDING_TEXT_DELAY_SEC)
    text = session.pending_text
    if not text:
        return
    session.pending_text = None
    if not send_keys_to_tmux(session.tmux_session_name, text, enter=session.pending_enter):
        logger.warning("pending text send-keys failed session=%s", session_id)


async def _cleanup_ws_client(websocket: WebSocket, session) -> None:
    detach_client_bridge(session, websocket)
    try:
        await websocket.close()
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass


@ws_router.websocket("/terminal/ws/{session_id}")
async def terminal_ws(websocket: WebSocket, session_id: str, token: str = "", cols: int = 0, rows: int = 0):
    auth_token = token
    ws_client_host = (websocket.client.host or "") if websocket.client else ""
    if not verify_ws_token(auth_token, ws_client_host, websocket.headers, websocket.cookies):
        await websocket.close(code=1008, reason="Unauthorized")
        return

    session = await _resolve_session_for_ws(session_id)

    await websocket.accept()

    if not session:
        await websocket.close(code=1008, reason="Session not found")
        return

    if not await _ensure_tmux_session(websocket, session, session_id):
        return

    # この接続専用の PTY でベースセッションへ独立アタッチする。
    # クライアントごとに PTY（tmux クライアント）を分けることで、サイズの取り合いや
    # 再接続オーバーラップによる表示崩れを構造的に避ける。
    try:
        bridge = attach_client_bridge(session, cols, rows)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.error("tmux attach failed session=%s: %s", session_id, e)
        await websocket.close(code=1011, reason="tmux attach failed")
        return

    register_bridge(session, websocket, bridge)
    start_bridge_reader(session_id, websocket, bridge)

    if session.pending_text:
        asyncio.create_task(_flush_pending_text(session, session_id))

    try:
        await _ws_message_loop(websocket, session, bridge)
    except (WebSocketDisconnect, OSError, asyncio.CancelledError):
        pass

    await _cleanup_ws_client(websocket, session)
