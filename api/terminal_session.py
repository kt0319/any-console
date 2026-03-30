import asyncio
import fcntl
import json
import logging
import os
import select
import signal
import struct
import subprocess
import termios
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import WebSocket

from .common import (
    PTY_READ_BUFFER_SIZE,
    PTY_READER_WORKERS,
    TERMINAL_DEFAULT_COLS,
    TERMINAL_DEFAULT_ROWS,
    TERMINAL_TIMEOUT_SEC,
    TMUX_CMD_TIMEOUT_SEC,
    TMUX_SESSION_PREFIX,
)
from .errors import not_found
from .tmux import (
    detect_workspace_from_tmux,
    kill_tmux_by_name,
    load_tmux_metadata,
    tmux_session_exists,
)

logger = logging.getLogger(__name__)


_TMUX_ATTR_MAP = {
    "TMUX_WORKSPACE": "workspace",
    "TMUX_ICON": "icon",
    "TMUX_ICON_COLOR": "icon_color",
    "TMUX_JOB_NAME": "job_name",
    "TMUX_JOB_LABEL": "job_label",
}


class TerminalSession:
    __slots__ = (
        "workspace", "fd", "pid", "expires_at",
        "icon", "icon_color", "job_name", "job_label",
        "clients", "_reader_task",
        "tmux_session_name",
    )

    def __init__(self, workspace: str | None, expires_at: float,
                 tmux_session_name: str,
                 fd: int | None = None, pid: int | None = None,
                 icon: str | None = None, icon_color: str | None = None,
                 job_name: str | None = None, job_label: str | None = None):
        self.workspace = workspace
        self.fd = fd
        self.pid = pid
        self.expires_at = expires_at
        self.icon = icon
        self.icon_color = icon_color
        self.job_name = job_name
        self.job_label = job_label
        self.clients: set[WebSocket] = set()
        self._reader_task: asyncio.Task | None = None
        self.tmux_session_name = tmux_session_name

    def save_metadata(self) -> None:
        for env_key, attr in _TMUX_ATTR_MAP.items():
            value = getattr(self, attr, None)
            if value:
                subprocess.run(
                    ["tmux", "set-environment", "-t", self.tmux_session_name, env_key, value],
                    timeout=TMUX_CMD_TIMEOUT_SEC,
                    capture_output=True,
                )

    @classmethod
    def from_tmux(cls, tmux_name: str) -> "TerminalSession":
        meta = load_tmux_metadata(tmux_name)
        workspace = meta.get("TMUX_WORKSPACE") or detect_workspace_from_tmux(tmux_name)
        return cls(
            workspace=workspace,
            expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
            tmux_session_name=tmux_name,
            icon=meta.get("TMUX_ICON"),
            icon_color=meta.get("TMUX_ICON_COLOR"),
            job_name=meta.get("TMUX_JOB_NAME"),
            job_label=meta.get("TMUX_JOB_LABEL"),
        )

    def metadata_dict(self) -> dict:
        return {
            "workspace": self.workspace,
            "icon": self.icon,
            "icon_color": self.icon_color,
            "job_name": self.job_name,
            "job_label": self.job_label,
        }


TERMINAL_SESSIONS: dict[str, TerminalSession] = {}
sessions_lock = threading.Lock()


def _detach_pty_bridge(session: TerminalSession) -> None:
    if session.fd is not None:
        try:
            os.close(session.fd)
        except OSError as e:
            logger.debug("close fd=%d failed: %s", session.fd, e)
    if session.pid is not None:
        try:
            os.kill(session.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError) as e:
            logger.debug("SIGTERM pid=%d failed: %s", session.pid, e)
            return
        try:
            pid, _ = os.waitpid(session.pid, os.WNOHANG)
            if pid == 0:
                time.sleep(0.1)
                os.kill(session.pid, signal.SIGKILL)
                os.waitpid(session.pid, os.WNOHANG)
        except (ChildProcessError, ProcessLookupError, PermissionError, OSError) as e:
            logger.debug("cleanup pid=%d failed: %s", session.pid, e)
    session.fd = None
    session.pid = None


def _kill_tmux_session(session: TerminalSession) -> None:
    _detach_pty_bridge(session)
    kill_tmux_by_name(session.tmux_session_name)


def cleanup_terminal_sessions() -> None:
    now = time.time()
    with sessions_lock:
        expired = [sid for sid, s in TERMINAL_SESSIONS.items() if s.expires_at <= now]
        removed_sessions = []
        for sid in expired:
            session = TERMINAL_SESSIONS.pop(sid, None)
            if session:
                removed_sessions.append((sid, session))
    for sid, session in removed_sessions:
        logger.info("terminal session expired session=%s (tmux kept alive)", sid)
        _detach_pty_bridge(session)


def _register_tmux_session(session_id: str, tmux_name: str) -> TerminalSession:
    session = TerminalSession.from_tmux(tmux_name)
    with sessions_lock:
        TERMINAL_SESSIONS[session_id] = session
    logger.info("on-demand registered tmux session=%s workspace=%s", session_id, session.workspace or "(none)")
    return session


def get_terminal_session(session_id: str) -> TerminalSession:
    with sessions_lock:
        session = TERMINAL_SESSIONS.get(session_id)
        if session:
            if session.expires_at <= time.time():
                TERMINAL_SESSIONS.pop(session_id, None)
                _detach_pty_bridge(session)
                logger.info("terminal session expired session=%s (tmux kept alive)", session_id)
            else:
                session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
                return session

    tmux_name = TMUX_SESSION_PREFIX + session_id
    if not tmux_session_exists(tmux_name):
        raise not_found("Terminal session not found")

    session = _register_tmux_session(session_id, tmux_name)
    return session


PTY_NO_DATA = b"\x00"
PTY_EOF = b""

PTY_EXECUTOR = ThreadPoolExecutor(max_workers=PTY_READER_WORKERS, thread_name_prefix="pty-reader")


def _read_pty(fd: int) -> bytes:
    try:
        r, _, _ = select.select([fd], [], [], 1.0)
        if not r:
            return PTY_NO_DATA
        return os.read(fd, PTY_READ_BUFFER_SIZE)
    except (OSError, ValueError):
        return PTY_EOF


async def _broadcast_to_clients(session: TerminalSession, data: bytes) -> None:
    stale = []
    for ws in list(session.clients):
        try:
            await ws.send_bytes(data)
        except Exception:
            stale.append(ws)
    for ws in stale:
        session.clients.discard(ws)


WS_CLOSE_SESSION_EXITED = 4001


async def _close_all_clients(session: TerminalSession, code: int, reason: str) -> None:
    for ws in list(session.clients):
        try:
            await ws.close(code=code, reason=reason)
        except Exception as e:
            logger.debug("close client failed: %s", e)
    session.clients.clear()


async def _session_reader(session: TerminalSession, session_id: str) -> None:
    loop = asyncio.get_event_loop()
    pty_eof = False
    try:
        while session.clients:
            if session.fd is None:
                break
            data = await loop.run_in_executor(PTY_EXECUTOR, _read_pty, session.fd)
            if data == PTY_EOF:
                pty_eof = True
                break
            if data == PTY_NO_DATA:
                continue
            await _broadcast_to_clients(session, data)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug("session reader ended session=%s: %s", session_id, e)
    finally:
        session._reader_task = None
        if pty_eof:
            logger.info("PTY EOF detected, closing clients session=%s", session_id)
            await _close_all_clients(session, WS_CLOSE_SESSION_EXITED, "session exited")
        if not session.clients:
            _detach_pty_bridge(session)


def _ensure_reader_task(session: TerminalSession, session_id: str) -> None:
    if session._reader_task is not None and not session._reader_task.done():
        return
    session._reader_task = asyncio.create_task(_session_reader(session, session_id))


def _handle_resize(session: TerminalSession, payload: bytes) -> None:
    try:
        size = json.loads(payload)
        cols = size.get("cols", TERMINAL_DEFAULT_COLS)
        rows = size.get("rows", TERMINAL_DEFAULT_ROWS)
        if session.fd is not None:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(session.fd, termios.TIOCSWINSZ, winsize)
        subprocess.run(
            ["tmux", "resize-window", "-t", session.tmux_session_name, "-x", str(cols), "-y", str(rows)],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
    except (json.JSONDecodeError, OSError, KeyError, subprocess.TimeoutExpired):
        pass
