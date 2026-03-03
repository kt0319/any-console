import collections
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

BRANCH_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_./-]+$")
COMMIT_HASH_PATTERN = re.compile(r"^[0-9a-f]{4,40}$|^stash@\{\d+\}$")

BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=4)

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


def log_operation(action: str, workspace: str = "", detail: str = "") -> None:
    from datetime import datetime, timezone

    OPERATION_LOG.add({
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "workspace": workspace,
        "detail": detail,
    })


def resolve_workspace_path(workspace: str | None) -> Path | None:
    if not workspace:
        return None
    ws_path = (WORK_DIR / workspace).resolve()
    if ws_path.parent != WORK_DIR.resolve():
        raise HTTPException(status_code=400, detail=f"Invalid workspace: {workspace}")
    if not ws_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace not found: {workspace}")
    return ws_path
