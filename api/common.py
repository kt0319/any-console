import contextlib
import json
import logging
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, overload

from .errors import bad_request

PROJECT_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path("/tmp/any-console-uploads")


def resolve_data_paths(env_value: str | None) -> tuple[Path, Path]:
    """(DATA_DIR, CONFIG_FILE) を決める。

    ANY_CONSOLE_DATA_DIR が設定されていれば data/ も config.json もその配下に置く
    （E2E 等の使い捨てサーバが実運用の data/・config.json を汚さないための隔離モード）。
    未設定なら従来どおり PROJECT_ROOT 直下。
    """
    # strip は空値の検出のみに使い、パスには生の値を使う
    # （前後に空白を含む正当なディレクトリ名を別パスへ化けさせないため）
    if env_value and env_value.strip():
        data_dir = Path(env_value).expanduser().resolve()
        return data_dir, data_dir / "config.json"
    return PROJECT_ROOT / "data", PROJECT_ROOT / "config.json"


_DATA_DIR_ENV = os.environ.get("ANY_CONSOLE_DATA_DIR")
DATA_DIR, CONFIG_FILE = resolve_data_paths(_DATA_DIR_ENV)
GLOBAL_CONFIG_KEY = "__global__"

# dispatch の承認待ちキュー専用ファイル。config.json とは意味が違う
# （ユーザー設定ではなく一時的な運用状態）ため分離する。
# 既定はレガシー位置（PROJECT_ROOT 直下）のまま、ANY_CONSOLE_DATA_DIR 指定時は
# 隔離ディレクトリ配下に置く（使い捨てサーバが実運用のキューに触れないため）。
DISPATCH_QUEUE_FILE = (
    DATA_DIR / "dispatch_queue.json"
    if _DATA_DIR_ENV and _DATA_DIR_ENV.strip()
    else PROJECT_ROOT / "dispatch_queue.json"
)

# dispatch の承認/却下済み直近履歴（Rerun用）。DISPATCH_QUEUE_FILEと同じ
# 隔離ルールに従う。
DISPATCH_RECENT_FILE = (
    DATA_DIR / "dispatch_recent.json"
    if _DATA_DIR_ENV and _DATA_DIR_ENV.strip()
    else PROJECT_ROOT / "dispatch_recent.json"
)

# 現在のコードが理解する config スキーマのバージョン。
# 破壊的なスキーマ変更を入れる際にインクリメントし、_CONFIG_MIGRATIONS に
# 旧版 -> 新版の変換を登録する（api/config.py 参照）。
# config 自体は __global__.config_version に保存され、読み込み時に
# このバージョンまで自動マイグレーションされる。
CONFIG_SCHEMA_VERSION = 3

GIT_QUICK_TIMEOUT_SEC = 5
GIT_SHORT_TIMEOUT_SEC = 10
GIT_STANDARD_TIMEOUT_SEC = 30
GIT_LONG_TIMEOUT_SEC = 60
GITHUB_CLI_TIMEOUT_SEC = 8
SYSTEM_CMD_TIMEOUT_SEC = 5
BACKGROUND_FETCH_TIMEOUT_SEC = 15
GIT_LOG_MAX_ENTRIES = 10000

MAX_UPLOAD_SIZE = 10 * 1024 * 1024
# フォルダzipダウンロードの上限（圧縮前の合計サイズ）。上限なしだと
# node_modules・ビルド成果物込みのディレクトリ指定で巨大な一時ファイル生成に
# ワーカーを長時間占有してしまう（Raspberry Pi等の小型機前提のため控えめに）。
MAX_ZIP_DOWNLOAD_SIZE = 200 * 1024 * 1024
WORKSPACE_JOBS_CACHE_TTL_SEC = 60
GIT_INFO_CACHE_TTL_SEC = 5

# git ステータスのリアルタイム配信（api/git_watch.py）
GIT_WATCH_DEBOUNCE_MS = 300  # FS イベントのバッチング最大待ち時間
GIT_WATCH_STEP_MS = 50  # FS イベントのポーリング刻み
GIT_WATCH_RETRY_SEC = 5  # 監視エラー後の再試行までの待ち
GIT_AUTO_FETCH_INTERVAL_SEC = 180  # 購読者がいる間の自動 fetch 間隔（behind 判定の更新用）

# エージェント状態のリアルタイム配信（api/agent_watch.py）
AGENT_WATCH_POLL_INTERVAL_SEC = 2  # 可視ペインのポーリング間隔
# notify_phrase 検出後、この秒数アクティビティ（画面の変化）が無ければ通知する。
# 検出後すぐに画面が動いた（ユーザーが反応した）場合は通知を送らない。
PHRASE_NOTIFY_IDLE_GRACE_SEC = 20
PTY_READ_BUFFER_SIZE = 16384
PTY_READER_WORKERS = 8
MAX_TERMINAL_SESSIONS = 20

def resolve_tmux_prefix(env_value: str | None) -> str:
    """tmux セッション名のプレフィックスを決める（未設定は "ac-"）。

    E2E の使い捨てサーバ（playwright.config.js 参照）がランごとにユニークな値を
    渡すことで、並行ラン・実運用とセッション名前空間を分離する。
    """
    # strip は空値の検出のみ（値自体は生のまま使い、data dir の規則と揃える）
    if env_value and env_value.strip():
        return env_value
    return "ac-"


TMUX_SESSION_PREFIX = resolve_tmux_prefix(os.environ.get("ANY_CONSOLE_TMUX_PREFIX"))
TMUX_CMD_TIMEOUT_SEC = 5
TMUX_PANE_READY_TIMEOUT_SEC = 2.0
TMUX_PANE_POLL_INTERVAL_SEC = 0.05
# tmux 環境変数名 → TerminalSession 属性名。永続化する属性を増やす場合は
# ここへの追加だけで書き込み(save_metadata)・読み込み許可リスト(TMUX_META_ENV_NAMES)
# の両方に反映される（片方だけ更新して読み戻せなくなる不具合を防ぐ）。
TMUX_ATTR_MAP = {
    "TMUX_WORKSPACE": "workspace",
    "TMUX_ICON": "icon",
    "TMUX_ICON_COLOR": "icon_color",
    "TMUX_JOB_NAME": "job_name",
    "TMUX_JOB_LABEL": "job_label",
    "TMUX_INTERACTIVE": "interactive",
}
# TMUX_DETACHED は save_detached/load 側で個別管理される（TMUX_ATTR_MAP対象外）ため別枠で追加。
TMUX_META_ENV_NAMES = (*TMUX_ATTR_MAP, "TMUX_DETACHED")

# WS が idle でもこの間隔で空フレームを送り、クライアントの生存監視に
# 一定周期のハートビートを供給する（フロントの WS_STALE_THRESHOLD_MS はこの約2回分）。
WS_PING_INTERVAL_SEC = 15

BRANCH_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_./-]+$")
# commit を指す ref（省略形〜フルのコミットハッシュ、または stash エントリ）を受理する。
COMMIT_REF_PATTERN = re.compile(r"^[0-9a-f]{4,40}$|^stash@\{\d+\}$")
WORKSPACE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+$")
# workspace / group 共通の永続ID用プレフィックス。歴史的経緯で "ws_" を共用しており、
# 保存済み config 内のIDと互換を保つため変更しない。
ENTITY_ID_PREFIX = "ws_"


def generate_entity_id() -> str:
    """workspace や group など、config に保存する永続エンティティのIDを生成する。"""
    return ENTITY_ID_PREFIX + secrets.token_hex(6)


MAX_LABEL_LENGTH = 200
MAX_COMMAND_LENGTH = 10000
MAX_ICON_VALUE_LENGTH = 200_000

TERMINAL_DEFAULT_COLS = 80
TERMINAL_DEFAULT_ROWS = 24
TERMINAL_TERM_TYPE = "xterm-256color"

WS_MSG_RESIZE = b"\x00"

MAX_DIFF_SIZE = 10 * 1024 * 1024
MAX_FILE_SIZE = 512 * 1024
MAX_IMAGE_PREVIEW_SIZE = 5 * 1024 * 1024
GIT_LOG_MAX_SKIP = 10000
HIDDEN_DIRS = {".git"}
BINARY_EXTENSIONS = {
    ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"}

STASH_REF_PATTERN = re.compile(r"^stash@\{\d+\}$")
ICON_PATTERN = re.compile(
    r"^(mdi-[a-zA-Z0-9-]+|favicon:[a-zA-Z0-9._-]+|data:image/.+|icon:[a-f0-9]{16}\.(png|jpg|gif|webp|svg))$",
)
ICON_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{3,6}$")

BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=8)
# git fetch 系のバックグラウンド処理専用プール。BACKGROUND_EXECUTOR と分離し、
# ネットワーク越しの fetch がリクエスト処理（_workspace_summary 等）の
# スレッドを奪って応答を遅らせないようにする。
BACKGROUND_FETCH_EXECUTOR = ThreadPoolExecutor(max_workers=4)

_subprocess_logger = logging.getLogger(__name__)


def run_subprocess_safe(
    cmd: list[str],
    *,
    timeout: float,
    cwd: str | None = None,
    env: dict | None = None,
    text: bool = True,
    log_label: str | None = None,
) -> subprocess.CompletedProcess | None:
    """Run subprocess with standard error suppression.

    Returns None on TimeoutExpired / FileNotFoundError / OSError;
    callers handle the None case themselves. The completed process is
    returned regardless of returncode so callers can inspect stderr.
    """
    label = log_label or (cmd[0] if cmd else "cmd")
    try:
        return subprocess.run(
            cmd,
            capture_output=True, text=text, timeout=timeout,
            cwd=cwd, env=env,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        _subprocess_logger.debug("subprocess failed %s: %s", label, e)
        return None

def run_tailscale_json(args: list[str]) -> dict | None:
    """`tailscale <args> --json` を実行しパース結果を返す。

    未インストール・tailscaled未起動・非0終了・JSON不正のいずれでも None。
    """
    result = run_subprocess_safe(["tailscale", *args], timeout=SYSTEM_CMD_TIMEOUT_SEC)
    if result is None or result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


class TTLCache:
    def __init__(self, ttl_sec: float):
        self._ttl = ttl_sec
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Any:
        with self._lock:
            if key in self._store:
                ts, val = self._store[key]
                if time.monotonic() - ts < self._ttl:
                    return val
                del self._store[key]
        return None

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = (time.monotonic(), value)

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._store.clear()

    def get_or_set(self, key: str, loader: Any) -> Any:
        val = self.get(key)
        if val is not None:
            return val
        data = loader()
        self.set(key, data)
        return data


_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")

_SESSION_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9_-]")


def sanitize_log_value(value: str) -> str:
    return _CONTROL_CHAR_RE.sub(lambda m: f"\\x{ord(m.group()):02x}", value)


def sanitize_session_segment(name: str) -> str:
    """セッションIDの構成要素として安全な文字列へ変換する（英数と _ - 以外を _ に）。"""
    return _SESSION_SEGMENT_RE.sub("_", name)


def safe_resolve_str(path: str | Path) -> str:
    """パスを解決した絶対パス文字列を返す。解決に失敗したら元の文字列で代替する。"""
    try:
        return str(Path(path).resolve())
    except OSError:
        return str(path)


def collapse_user_path(p: Path) -> str:
    """ホームディレクトリ配下のパスを ~/... 形式の文字列に変換する。"""
    try:
        return "~/" + str(p.relative_to(Path.home()))
    except ValueError:
        return str(p)


def expand_workspace_path(s: str) -> Path:
    """config.json に保存されたパス文字列を Path に変換する（~ を展開する）。"""
    return Path(s).expanduser()


def count_file_lines(file_path: Path) -> int:
    try:
        with open(file_path, "rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def load_json_file(
    path: Path,
    default: Any,
    *,
    validate: Callable[[Any], bool] | None = None,
    log_label: str | None = None,
) -> Any:
    """data/ 配下の JSON ファイルを読む。欠如・破損・検証失敗時は default を返す。"""
    try:
        if not path.exists():
            return default
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        if log_label:
            logging.getLogger(__name__).warning("%s unreadable; using default", log_label)
        return default
    if validate is not None and not validate(data):
        return default
    return data


def save_json_file(path: Path, data: Any) -> None:
    """data/ 配下の JSON ファイルへ書き込む（親ディレクトリを自動作成）。

    devices.json のように「リクエストごとに書き、並行して読まれる」ファイルがあるため、
    tmp ファイルへ書いてから os.replace でアトミックに差し替える
    （直接 write_text すると並行リーダーが書き込み途中の JSON を読んで
    認証失敗などの誤動作を起こす）。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # tmp 名は書き込みごとにユニークにする（固定名だと並行ライター同士で
    # rename が競合して FileNotFoundError になる）
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(data, ensure_ascii=False, indent=2))
        os.replace(tmp_name, path)
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(tmp_name)
        raise


@overload
def resolve_workspace_path(workspace: str) -> Path: ...
@overload
def resolve_workspace_path(workspace: None) -> None: ...
@overload
def resolve_workspace_path(workspace: str | None) -> Path | None: ...
def resolve_workspace_path(workspace: str | None) -> Path | None:
    if not workspace:
        return None
    from .config import load_workspace_config
    config = load_workspace_config(workspace)
    ws_path_str = config.get("path", "")
    if ws_path_str:
        ws_path = Path(ws_path_str).expanduser()
        if not ws_path.is_dir():
            raise bad_request(f"Workspace not found: {workspace}")
        return ws_path
    # configに無い場合は動的worktree（"{base} [{branch}]" 形式）として検索する
    from .git_utils import find_dynamic_worktree_path
    dynamic = find_dynamic_worktree_path(workspace)
    if dynamic:
        return dynamic
    raise bad_request(f"Workspace not configured: {workspace}")
