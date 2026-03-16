import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .errors import bad_request

PROJECT_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path("/tmp/any-console-uploads")


def default_workspace_dir() -> Path:
    return Path(os.environ.get("ANY_CONSOLE_WORKSPACE_ROOT", str(Path.home() / "work")))

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
GIT_INFO_CACHE_TTL_SEC = 5
GITHUB_CLI_REPO_LIMIT = 100
PTY_READ_BUFFER_SIZE = 16384
PTY_READER_WORKERS = 8
MAX_TERMINAL_SESSIONS = 20

TMUX_SESSION_PREFIX = "ac-"
TMUX_CMD_TIMEOUT_SEC = 5

BRANCH_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_./-]+$")
COMMIT_HASH_PATTERN = re.compile(r"^[0-9a-f]{4,40}$|^stash@\{\d+\}$")

MAX_LABEL_LENGTH = 200
MAX_COMMAND_LENGTH = 10000
MAX_ICON_VALUE_LENGTH = 200_000

TERMINAL_DEFAULT_COLS = 80
TERMINAL_DEFAULT_ROWS = 24
TERMINAL_TERM_TYPE = "xterm-256color"

WS_MSG_RESIZE = b"\x00"
WS_MSG_SCROLL = b"\x01"
WS_MSG_CANCEL_COPY_MODE = b"\x02"

STASH_REF_PATTERN = re.compile(r"^stash@\{\d+\}$")
ICON_PATTERN = re.compile(
    r"^(mdi-[a-zA-Z0-9-]+|favicon:[a-zA-Z0-9._-]+|data:image/.+|icon:[a-f0-9]{16}\.(png|jpg|gif|webp|svg))$",
)
ICON_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{3,6}$")

BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=4)

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


_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")


def sanitize_log_value(value: str) -> str:
    return _CONTROL_CHAR_RE.sub(lambda m: f"\\x{ord(m.group()):02x}", value)


def resolve_workspace_path(workspace: str | None) -> Path | None:
    if not workspace:
        return None
    from .config import load_workspace_config
    config = load_workspace_config(workspace)
    ws_path_str = config.get("path", "")
    if not ws_path_str:
        raise bad_request(f"Workspace not configured: {workspace}")
    ws_path = Path(ws_path_str)
    if not ws_path.is_dir():
        raise bad_request(f"Workspace not found: {workspace}")
    return ws_path
