import asyncio
import fcntl
import json
import logging
import os
import pty
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
    TERMINAL_TERM_TYPE,
    TERMINAL_TIMEOUT_SEC,
    TMUX_CMD_TIMEOUT_SEC,
    TMUX_META_ENV_NAMES,
    TMUX_SESSION_PREFIX,
)
from .errors import gone, not_found

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
        meta = _load_tmux_metadata(tmux_name)
        workspace = meta.get("TMUX_WORKSPACE") or _detect_workspace_from_tmux(tmux_name)
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


def _run_outside_cgroup(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    uid = os.getuid()
    env = kwargs.get("env") or os.environ.copy()
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{uid}/bus")
    kwargs_with_env = {**kwargs, "env": env}
    try:
        return subprocess.run(
            ["systemd-run", "--user", "--scope", "--quiet", *cmd],
            **kwargs_with_env,
        )
    except (subprocess.CalledProcessError, OSError):
        return subprocess.run(cmd, **kwargs)


def create_tmux_session(workspace_path: str | None, session_name: str) -> None:
    user_shell = os.environ.get("SHELL", "/bin/zsh")
    cwd = workspace_path if workspace_path and os.path.isdir(workspace_path) else os.environ.get("HOME", "/")
    env = os.environ.copy()
    env["TERM"] = TERMINAL_TERM_TYPE
    if workspace_path:
        env["WORKSPACE"] = workspace_path

    _run_outside_cgroup(
        [
            "tmux", "new-session", "-d", "-s", session_name,
            "-x", str(TERMINAL_DEFAULT_COLS), "-y", str(TERMINAL_DEFAULT_ROWS), user_shell,
        ],
        cwd=cwd,
        env=env,
        timeout=TMUX_CMD_TIMEOUT_SEC,
        check=True,
        capture_output=True,
    )
    for opt_args in (["status", "off"], ["mouse", "off"]):
        subprocess.run(
            ["tmux", "set-option", "-t", session_name, *opt_args],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )


def attach_tmux_session(session_name: str, cols: int = 0, rows: int = 0) -> tuple[int, int]:
    env = {
        "TERM": TERMINAL_TERM_TYPE,
        "HOME": os.environ.get("HOME", "/"),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
    }
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvpe("tmux", ["tmux", "attach-session", "-t", session_name], env)  # noqa: S606
        except Exception:  # noqa: S110
            pass
        os._exit(1)
    if cols > 0 and rows > 0:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    return fd, pid


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
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", session.tmux_session_name],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.debug("kill tmux session %s failed: %s", session.tmux_session_name, e)


def _tmux_session_exists(name: str) -> bool:
    try:
        result = subprocess.run(
            ["tmux", "has-session", "-t", name],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def _detect_workspace_from_tmux(tmux_name: str) -> str | None:
    try:
        result = subprocess.run(
            ["tmux", "display-message", "-t", tmux_name, "-p", "#{pane_current_path}"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            pane_path = result.stdout.strip()
            from .config import list_workspace_entries
            entries = list_workspace_entries()
            for name, config in entries.items():
                ws_path = config.get("path", "")
                if ws_path and (pane_path == ws_path or pane_path.startswith(ws_path + "/")):
                    return name
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None



def _load_tmux_metadata(tmux_name: str) -> dict:
    try:
        result = subprocess.run(
            ["tmux", "show-environment", "-t", tmux_name],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
    except (subprocess.TimeoutExpired, OSError):
        return {}
    if result.returncode != 0:
        return {}
    meta = {}
    for line in result.stdout.strip().splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key in TMUX_META_ENV_NAMES:
            meta[key] = value
    return meta


def _get_tmux_created(tmux_name: str) -> int | None:
    try:
        result = subprocess.run(
            ["tmux", "display-message", "-t", tmux_name, "-p", "#{session_created}"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except (subprocess.TimeoutExpired, OSError, ValueError):
        pass
    return None


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
        logger.info("terminal session removed session=%s reason=expired", sid)
        _kill_tmux_session(session)


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
                _kill_tmux_session(session)
                raise gone("Terminal session expired")
            session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
            return session

    tmux_name = TMUX_SESSION_PREFIX + session_id
    if not _tmux_session_exists(tmux_name):
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


