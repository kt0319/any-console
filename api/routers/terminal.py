import asyncio
import fcntl
import logging
import os
import struct
import subprocess
import termios
import time

from fastapi import APIRouter, Depends, WebSocket
from fastapi.websockets import WebSocketDisconnect

from ..auth import verify_token
from ..common import (
    TERMINAL_TIMEOUT_SEC,
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
    _detach_pty_bridge,
    _ensure_reader_task,
    _get_tmux_created,
    _handle_resize,
    _kill_tmux_session,
    _register_tmux_session,
    _tmux_session_exists,
    attach_tmux_session,
    create_tmux_session,
    get_terminal_session,
    sessions_lock,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/terminal/sessions")
async def list_terminal_sessions():
    try:
        result = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []

    if result.returncode != 0:
        return []

    sessions = []
    for line in result.stdout.strip().splitlines():
        name = line.strip()
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

        created_at = _get_tmux_created(name)
        sessions.append({
            "session_id": session_id,
            "workspace": md["workspace"],
            "ws_url": f"/terminal/ws/{session_id}",
            "icon": md["icon"],
            "icon_color": md["icon_color"],
            "job_name": md["job_name"],
            "job_label": md["job_label"],
            "created_at": created_at,
        })

    sessions.sort(key=lambda s: s.get("created_at") or 0)
    return sessions


@router.get("/terminal/sessions/{session_id}/buffer")
async def get_terminal_buffer(session_id: str):
    session = get_terminal_session(session_id)
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", session.tmux_session_name, "-p", "-e", "-S", "-", "-E", "-"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise server_error("バッファ取得に失敗しました")
        return {"content": result.stdout}
    except subprocess.TimeoutExpired as e:
        raise timeout_error("タイムアウト") from e


@router.delete("/terminal/sessions/{session_id}")
async def delete_terminal_session(session_id: str):
    with sessions_lock:
        session = TERMINAL_SESSIONS.pop(session_id, None)
    if not session:
        raise not_found("Terminal session not found")
    _kill_tmux_session(session)
    logger.info("terminal session deleted session=%s", session_id)
    return {"status": "ok"}


ws_router = APIRouter()


@ws_router.websocket("/terminal/ws/{session_id}")
async def terminal_ws(websocket: WebSocket, session_id: str, cols: int = 0, rows: int = 0):
    with sessions_lock:
        session = TERMINAL_SESSIONS.get(session_id)

    if not session:
        tmux_name = TMUX_SESSION_PREFIX + session_id
        if _tmux_session_exists(tmux_name):
            session = _register_tmux_session(session_id, tmux_name)

    await websocket.accept()

    if not session:
        await websocket.close(code=1008, reason="セッションが存在しません")
        return

    if session.expires_at <= time.time():
        with sessions_lock:
            TERMINAL_SESSIONS.pop(session_id, None)
        await websocket.close(code=1008, reason="セッションがタイムアウトしました")
        return

    if not _tmux_session_exists(session.tmux_session_name):
        try:
            ws_resolved = resolve_workspace_path(session.workspace)
            workspace_path = str(ws_resolved) if ws_resolved else None
        except Exception:
            workspace_path = None
        try:
            create_tmux_session(workspace_path, session.tmux_session_name)
            session.save_metadata()
            logger.info("recreated tmux session=%s workspace=%s", session_id, session.workspace or "(none)")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            logger.error("failed to recreate tmux session=%s: %s", session_id, e)
            with sessions_lock:
                TERMINAL_SESSIONS.pop(session_id, None)
            await websocket.close(code=1008, reason="シェルプロセスが終了しました")
            return

    need_pty_bridge = session.fd is None or session.pid is None

    if cols > 0 and rows > 0:
        try:
            subprocess.run(
                ["tmux", "resize-window", "-t", session.tmux_session_name, "-x", str(cols), "-y", str(rows)],
                timeout=TMUX_CMD_TIMEOUT_SEC,
                capture_output=True,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

    if need_pty_bridge:
        _detach_pty_bridge(session)
        try:
            fd, pid = attach_tmux_session(session.tmux_session_name, cols, rows)
        except OSError as e:
            logger.error("tmux attach failed session=%s: %s", session_id, e)
            await websocket.close(code=1011, reason="tmux attach失敗")
            return
        session.fd = fd
        session.pid = pid
    elif cols > 0 and rows > 0 and session.fd is not None:
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(session.fd, termios.TIOCSWINSZ, winsize)
        except OSError:
            pass

    session.clients.add(websocket)
    session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC

    _ensure_reader_task(session, session_id)

    loop = asyncio.get_event_loop()

    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive(), timeout=WS_PING_INTERVAL_SEC)
            except asyncio.TimeoutError:
                await websocket.send_bytes(b"")
                session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
                continue

            msg_type = msg.get("type")
            if msg_type == "websocket.disconnect":
                break

            session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC

            data = msg.get("bytes")
            if data is None and msg.get("text") is not None:
                data = msg["text"].encode("utf-8")
            if not data:
                continue

            if data[0:1] == WS_MSG_RESIZE:
                _handle_resize(session, data[1:])
            else:
                if session.fd is not None:
                    await loop.run_in_executor(PTY_EXECUTOR, os.write, session.fd, data)
    except (WebSocketDisconnect, OSError, asyncio.CancelledError):
        pass

    # cleanup
    session.clients.discard(websocket)

    if not session.clients:
        if session._reader_task and not session._reader_task.done():
            session._reader_task.cancel()
        _detach_pty_bridge(session)

    try:
        await websocket.close()
    except Exception:
        pass
