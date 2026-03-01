import asyncio
import fcntl
import json
import logging
import os
import pty
import select
import signal
import struct
import termios
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from fastapi.websockets import WebSocketDisconnect

from ..auth import verify_token
from ..common import TERMINAL_TIMEOUT_SEC

logger = logging.getLogger(__name__)

WS_PING_INTERVAL_SEC = 25

router = APIRouter(dependencies=[Depends(verify_token)])


WS_CLOSE_REPLACED = 4001

class TerminalSession:
    __slots__ = ("workspace", "fd", "pid", "expires_at", "_read_lock", "icon", "icon_color", "job_name", "job_label", "active_ws")

    def __init__(self, workspace: str | None, fd: int, pid: int, expires_at: float,
                 icon: str | None = None, icon_color: str | None = None,
                 job_name: str | None = None, job_label: str | None = None):
        self.workspace = workspace
        self.fd = fd
        self.pid = pid
        self.expires_at = expires_at
        self._read_lock = threading.Lock()
        self.icon = icon
        self.icon_color = icon_color
        self.job_name = job_name
        self.job_label = job_label
        self.active_ws: WebSocket | None = None


TERMINAL_SESSIONS: dict[str, TerminalSession] = {}


def create_pty_session(workspace_path: str | None) -> tuple[int, int]:
    user_shell = os.environ.get("SHELL", "/bin/zsh")
    env = {
        "TERM": "xterm-256color",
        "HOME": os.environ.get("HOME", "/"),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "SHELL": user_shell,
    }
    if workspace_path:
        env["WORKSPACE"] = workspace_path

    cwd = workspace_path if workspace_path and os.path.isdir(workspace_path) else os.environ.get("HOME", "/")

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe(user_shell, [user_shell, "-l"], env)
    return fd, pid


def _kill_pty_session(session: TerminalSession) -> None:
    try:
        os.close(session.fd)
    except OSError:
        pass
    try:
        os.kill(session.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        return
    try:
        pid, _ = os.waitpid(session.pid, os.WNOHANG)
        if pid == 0:
            time.sleep(0.1)
            os.kill(session.pid, signal.SIGKILL)
            os.waitpid(session.pid, os.WNOHANG)
    except (ChildProcessError, ProcessLookupError, PermissionError, OSError):
        pass


def cleanup_terminal_sessions() -> None:
    now = time.time()
    expired = [sid for sid, s in TERMINAL_SESSIONS.items() if s.expires_at <= now]
    for sid in expired:
        session = TERMINAL_SESSIONS.pop(sid, None)
        if session:
            logger.info("terminal session expired session=%s", sid)
            _kill_pty_session(session)


def get_terminal_session(session_id: str) -> TerminalSession:
    cleanup_terminal_sessions()
    session = TERMINAL_SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    if session.expires_at <= time.time():
        TERMINAL_SESSIONS.pop(session_id, None)
        _kill_pty_session(session)
        raise HTTPException(status_code=410, detail="Terminal session expired")
    session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
    return session


@router.get("/terminal/sessions")
async def list_terminal_sessions():
    cleanup_terminal_sessions()
    now = time.time()
    return [
        {
            "session_id": sid,
            "workspace": s.workspace,
            "ws_url": f"/terminal/ws/{sid}",
            "expires_in": int(s.expires_at - now),
            "icon": s.icon,
            "icon_color": s.icon_color,
            "job_name": s.job_name,
            "job_label": s.job_label,
        }
        for sid, s in TERMINAL_SESSIONS.items()
    ]


@router.delete("/terminal/sessions/{session_id}")
async def delete_terminal_session(session_id: str):
    session = TERMINAL_SESSIONS.pop(session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    _kill_pty_session(session)
    logger.info("terminal session deleted session=%s", session_id)
    return {"status": "ok"}


PTY_NO_DATA = b"\x00"
PTY_EOF = b""

PTY_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="pty-reader")

# WS認証はsession_id(192bitトークン)で担保
ws_router = APIRouter()


def _is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


@ws_router.websocket("/terminal/ws/{session_id}")
async def terminal_ws(websocket: WebSocket, session_id: str):
    session = TERMINAL_SESSIONS.get(session_id)
    await websocket.accept()

    if not session or session.expires_at <= time.time():
        await websocket.close(code=1008)
        return

    if not _is_process_alive(session.pid):
        TERMINAL_SESSIONS.pop(session_id, None)
        await websocket.close(code=1008)
        return

    prev_ws = session.active_ws
    if prev_ws is not None:
        try:
            await prev_ws.close(code=WS_CLOSE_REPLACED)
        except Exception:
            pass
    session.active_ws = websocket

    session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
    stop_event = threading.Event()
    loop = asyncio.get_event_loop()

    async def pty_to_ws():
        try:
            while not stop_event.is_set():
                data = await loop.run_in_executor(
                    PTY_EXECUTOR, _read_pty, session.fd, session._read_lock, stop_event
                )
                if data == PTY_EOF:
                    break
                if data == PTY_NO_DATA:
                    continue
                await websocket.send_bytes(data)
        except (WebSocketDisconnect, OSError, asyncio.CancelledError):
            pass

    async def ws_to_pty():
        try:
            while True:
                msg = await websocket.receive()
                msg_type = msg.get("type")
                if msg_type == "websocket.disconnect":
                    break
                data = msg.get("bytes")
                if data is None and msg.get("text") is not None:
                    data = msg["text"].encode("utf-8")
                if not data:
                    continue
                if data[0:1] == b"\x00":
                    _handle_resize(session.fd, data[1:])
                else:
                    await loop.run_in_executor(PTY_EXECUTOR, os.write, session.fd, data)
        except (WebSocketDisconnect, OSError, asyncio.CancelledError):
            pass

    async def ping_loop():
        try:
            while True:
                await asyncio.sleep(WS_PING_INTERVAL_SEC)
                await websocket.send_bytes(b"")
                s = TERMINAL_SESSIONS.get(session_id)
                if s:
                    s.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
        except (WebSocketDisconnect, OSError, asyncio.CancelledError):
            pass

    done, pending = await asyncio.wait(
        [
            asyncio.create_task(pty_to_ws()),
            asyncio.create_task(ws_to_pty()),
            asyncio.create_task(ping_loop()),
        ],
        return_when=asyncio.FIRST_COMPLETED,
    )
    stop_event.set()
    for task in pending:
        task.cancel()
    if session.active_ws is websocket:
        session.active_ws = None
    try:
        await websocket.close()
    except Exception:
        pass


def _read_pty(fd: int, lock: threading.Lock, stop: threading.Event) -> bytes:
    if not lock.acquire(timeout=2.0):
        return PTY_NO_DATA
    try:
        if stop.is_set():
            return PTY_EOF
        r, _, _ = select.select([fd], [], [], 1.0)
        if not r:
            return PTY_NO_DATA
        if stop.is_set():
            return PTY_EOF
        return os.read(fd, 16384)
    except (OSError, ValueError):
        return PTY_EOF
    finally:
        lock.release()


def _handle_resize(fd: int, payload: bytes) -> None:
    try:
        size = json.loads(payload)
        cols = size.get("cols", 80)
        rows = size.get("rows", 24)
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except (json.JSONDecodeError, OSError, KeyError):
        pass
