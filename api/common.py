import collections
import contextvars
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import HTTPException

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_DIR = Path.home() / "work"
UPLOAD_DIR = Path("/tmp/pi-console-uploads")

TMUX_SOCKET_DIR = Path.home() / ".pi-console" / "tmux"
TERMINAL_TIMEOUT_SEC = 7200
CONFIG_FILE = PROJECT_ROOT / "config.json"
GLOBAL_CONFIG_KEY = "__global__"

GIT_QUICK_TIMEOUT_SEC = 5
GIT_SHORT_TIMEOUT_SEC = 10
GIT_STANDARD_TIMEOUT_SEC = 30
GIT_LONG_TIMEOUT_SEC = 60
GIT_CLONE_TIMEOUT_SEC = 300
GITHUB_CLI_TIMEOUT_SEC = 30
SYSTEM_CMD_TIMEOUT_SEC = 5
BACKGROUND_FETCH_TIMEOUT_SEC = 15
GIT_LOG_MAX_ENTRIES = 200

EXEC_TIMEOUT_SEC = 120
MAX_UPLOAD_SIZE = 10 * 1024 * 1024
GITHUB_REPOS_CACHE_TTL_SEC = 300
WORKSPACE_JOBS_CACHE_TTL_SEC = 60
GITHUB_CLI_REPO_LIMIT = 100
PTY_READ_BUFFER_SIZE = 16384
PTY_READER_WORKERS = 8
MAX_TERMINAL_SESSIONS = 20

TMUX_SESSION_PREFIX = "pi-"
TMUX_CMD_TIMEOUT_SEC = 5

BRANCH_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_./-]+$")
COMMIT_HASH_PATTERN = re.compile(r"^[0-9a-f]{4,40}$|^stash@\{\d+\}$")

BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=4)

_current_device: contextvars.ContextVar[str] = contextvars.ContextVar("_current_device", default="")

LOG_BUFFER_MAX = 500


class TTLCache:
    def __init__(self, ttl_sec: float):
        self._ttl = ttl_sec
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            if key in self._store:
                ts, val = self._store[key]
                if time.monotonic() - ts < self._ttl:
                    return val
                del self._store[key]
        return None

    def set(self, key: str, value):
        with self._lock:
            self._store[key] = (time.monotonic(), value)

    def invalidate(self, key: str):
        with self._lock:
            self._store.pop(key, None)

    def invalidate_all(self):
        with self._lock:
            self._store.clear()


class LogBuffer:
    def __init__(self, maxlen: int = LOG_BUFFER_MAX):
        self.entries = collections.deque(maxlen=maxlen)

    def add(self, entry: dict) -> None:
        self.entries.append(entry)

    def clear(self) -> None:
        self.entries.clear()


LOG_BUFFER = LogBuffer()
OPERATION_LOG = LogBuffer()

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")


def sanitize_log_value(value: str) -> str:
    return _CONTROL_CHAR_RE.sub(lambda m: f"\\x{ord(m.group()):02x}", value)


def log_operation(action: str, workspace: str = "", detail: str = "") -> None:
    from datetime import datetime, timezone

    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": sanitize_log_value(action),
        "workspace": sanitize_log_value(workspace),
        "detail": sanitize_log_value(detail),
    }
    device = _current_device.get()
    if device:
        entry["device"] = sanitize_log_value(device)
    OPERATION_LOG.add(entry)


def resolve_workspace_path(workspace: str | None) -> Path | None:
    if not workspace:
        return None
    ws_path = (WORK_DIR / workspace).resolve()
    if ws_path.parent != WORK_DIR.resolve():
        raise HTTPException(status_code=400, detail=f"Invalid workspace: {workspace}")
    if not ws_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace not found: {workspace}")
    return ws_path
