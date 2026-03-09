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

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from fastapi.websockets import WebSocketDisconnect

from ..auth import verify_token
from ..common import (
    PTY_READ_BUFFER_SIZE,
    PTY_READER_WORKERS,
    TERMINAL_TIMEOUT_SEC,
    TMUX_CMD_TIMEOUT_SEC,
    TMUX_SESSION_PREFIX,
    TMUX_SOCKET_DIR,
    WORK_DIR,
)

logger = logging.getLogger(__name__)

TMUX_SOCKET_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TMUX_TMPDIR", str(TMUX_SOCKET_DIR))

WS_PING_INTERVAL_SEC = 25

router = APIRouter(dependencies=[Depends(verify_token)])


WS_CLOSE_REPLACED = 4001

class TerminalSession:
    __slots__ = (
        "workspace", "fd", "pid", "expires_at", "_read_lock",
        "icon", "icon_color", "job_name", "job_label", "active_ws",
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
        self._read_lock = threading.Lock()
        self.icon = icon
        self.icon_color = icon_color
        self.job_name = job_name
        self.job_label = job_label
        self.active_ws: WebSocket | None = None
        self.tmux_session_name = tmux_session_name


TERMINAL_SESSIONS: dict[str, TerminalSession] = {}
sessions_lock = threading.Lock()


def create_tmux_session(workspace_path: str | None, session_name: str) -> None:
    user_shell = os.environ.get("SHELL", "/bin/zsh")
    cwd = workspace_path if workspace_path and os.path.isdir(workspace_path) else os.environ.get("HOME", "/")
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    if workspace_path:
        env["WORKSPACE"] = workspace_path

    subprocess.run(
        ["tmux", "new-session", "-d", "-s", session_name, "-x", "80", "-y", "24", user_shell],
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


def attach_tmux_session(session_name: str) -> tuple[int, int]:
    env = {
        "TERM": "xterm-256color",
        "HOME": os.environ.get("HOME", "/"),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
        "TMUX_TMPDIR": str(TMUX_SOCKET_DIR),
    }
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvpe("tmux", ["tmux", "attach-session", "-t", session_name], env)
        except Exception:
            pass
        os._exit(1)
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
            work_dir = str(WORK_DIR)
            if pane_path.startswith(work_dir + "/"):
                relative = pane_path[len(work_dir) + 1:]
                workspace = relative.split("/")[0]
                if workspace:
                    return workspace
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


_TMUX_META_ENV_NAMES = ("PI_WORKSPACE", "PI_ICON", "PI_ICON_COLOR", "PI_JOB_NAME", "PI_JOB_LABEL")


def save_tmux_metadata(
    tmux_name: str,
    workspace: str | None,
    icon: str | None,
    icon_color: str | None,
    job_name: str | None,
    job_label: str | None,
) -> None:
    env_vars = {
        "PI_WORKSPACE": workspace,
        "PI_ICON": icon,
        "PI_ICON_COLOR": icon_color,
        "PI_JOB_NAME": job_name,
        "PI_JOB_LABEL": job_label,
    }
    for key, value in env_vars.items():
        if value:
            subprocess.run(
                ["tmux", "set-environment", "-t", tmux_name, key, value],
                timeout=TMUX_CMD_TIMEOUT_SEC,
                capture_output=True,
            )


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
        if key in _TMUX_META_ENV_NAMES:
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
    meta = _load_tmux_metadata(tmux_name)
    workspace = meta.get("PI_WORKSPACE") or _detect_workspace_from_tmux(tmux_name)
    session = TerminalSession(
        workspace=workspace,
        expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
        tmux_session_name=tmux_name,
        icon=meta.get("PI_ICON"),
        icon_color=meta.get("PI_ICON_COLOR"),
        job_name=meta.get("PI_JOB_NAME"),
        job_label=meta.get("PI_JOB_LABEL"),
    )
    with sessions_lock:
        TERMINAL_SESSIONS[session_id] = session
    logger.info("on-demand registered tmux session=%s workspace=%s", session_id, workspace or "(none)")
    return session


def get_terminal_session(session_id: str) -> TerminalSession:
    with sessions_lock:
        session = TERMINAL_SESSIONS.get(session_id)
        if session:
            if session.expires_at <= time.time():
                TERMINAL_SESSIONS.pop(session_id, None)
                _kill_tmux_session(session)
                raise HTTPException(status_code=410, detail="Terminal session expired")
            session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
            return session

    tmux_name = TMUX_SESSION_PREFIX + session_id
    if not _tmux_session_exists(tmux_name):
        raise HTTPException(status_code=404, detail="Terminal session not found")

    session = _register_tmux_session(session_id, tmux_name)
    return session


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
            workspace = cached.workspace
            icon = cached.icon
            icon_color = cached.icon_color
            job_name = cached.job_name
            job_label = cached.job_label
        else:
            meta = _load_tmux_metadata(name)
            workspace = meta.get("PI_WORKSPACE") or _detect_workspace_from_tmux(name)
            icon = meta.get("PI_ICON")
            icon_color = meta.get("PI_ICON_COLOR")
            job_name = meta.get("PI_JOB_NAME")
            job_label = meta.get("PI_JOB_LABEL")

        created_at = _get_tmux_created(name)
        sessions.append({
            "session_id": session_id,
            "workspace": workspace,
            "ws_url": f"/terminal/ws/{session_id}",
            "icon": icon,
            "icon_color": icon_color,
            "job_name": job_name,
            "job_label": job_label,
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
            raise HTTPException(status_code=500, detail="バッファ取得に失敗しました")
        return {"content": result.stdout}
    except subprocess.TimeoutExpired as e:
        raise HTTPException(status_code=504, detail="タイムアウト") from e


@router.delete("/terminal/sessions/{session_id}")
async def delete_terminal_session(session_id: str):
    with sessions_lock:
        session = TERMINAL_SESSIONS.pop(session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    _kill_tmux_session(session)
    logger.info("terminal session deleted session=%s", session_id)
    return {"status": "ok"}


PTY_NO_DATA = b"\x00"
PTY_EOF = b""

PTY_EXECUTOR = ThreadPoolExecutor(max_workers=PTY_READER_WORKERS, thread_name_prefix="pty-reader")

ws_router = APIRouter()


@ws_router.websocket("/terminal/ws/{session_id}")
async def terminal_ws(websocket: WebSocket, session_id: str):
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
        workspace_path = str(WORK_DIR / session.workspace) if session.workspace else None
        try:
            create_tmux_session(workspace_path, session.tmux_session_name)
            save_tmux_metadata(
                session.tmux_session_name,
                session.workspace, session.icon, session.icon_color,
                session.job_name, session.job_label,
            )
            logger.info("recreated tmux session=%s workspace=%s", session_id, session.workspace or "(none)")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            logger.error("failed to recreate tmux session=%s: %s", session_id, e)
            with sessions_lock:
                TERMINAL_SESSIONS.pop(session_id, None)
            await websocket.close(code=1008, reason="シェルプロセスが終了しました")
            return

    prev_ws = session.active_ws
    if prev_ws is not None:
        try:
            await prev_ws.close(code=WS_CLOSE_REPLACED)
        except Exception:
            pass

    _detach_pty_bridge(session)

    try:
        fd, pid = attach_tmux_session(session.tmux_session_name)
    except OSError as e:
        logger.error("tmux attach failed session=%s: %s", session_id, e)
        await websocket.close(code=1011, reason="tmux attach失敗")
        return

    session.fd = fd
    session.pid = pid
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
                    _handle_resize(session, data[1:])
                elif data[0:1] == b"\x01":
                    _handle_scroll(session, data[1:])
                elif data[0:1] == b"\x02":
                    _cancel_copy_mode(session)
                else:
                    if session.fd is not None:
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
    _detach_pty_bridge(session)
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
        return os.read(fd, PTY_READ_BUFFER_SIZE)
    except (OSError, ValueError):
        return PTY_EOF
    finally:
        lock.release()


def _handle_resize(session: TerminalSession, payload: bytes) -> None:
    try:
        size = json.loads(payload)
        cols = size.get("cols", 80)
        rows = size.get("rows", 24)
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


def _cancel_copy_mode(session: TerminalSession) -> None:
    try:
        result = subprocess.run(
            ["tmux", "send-keys", "-t", session.tmux_session_name, "-X", "cancel"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
        logger.info(
            "cancel_copy_mode target=%s rc=%d stderr=%s",
            session.tmux_session_name,
            result.returncode,
            result.stderr.decode().strip(),
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("cancel_copy_mode failed: %s", e)


def _handle_scroll(session: TerminalSession, payload: bytes) -> None:
    try:
        data = json.loads(payload)
        direction = data.get("d", "up")
        lines = max(1, min(data.get("n", 3), 50))
        cmd = "scroll-up" if direction == "up" else "scroll-down"
        target = session.tmux_session_name
        subprocess.run(
            ["tmux", "copy-mode", "-t", target],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
        subprocess.run(
            ["tmux", "send-keys", "-t", target, "-X", "-N", str(lines), cmd],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
    except (json.JSONDecodeError, OSError, subprocess.TimeoutExpired):
        pass
