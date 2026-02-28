import collections
import json
import logging
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .config_schema import normalize_loaded_config, validate_config_entry

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_DIR = Path.home() / "work"
UPLOAD_DIR = Path("/tmp/pi-console-uploads")
TERMINAL_TIMEOUT_SEC = 7200
CONFIG_FILE = PROJECT_ROOT / "config.json"
GLOBAL_CONFIG_KEY = "__global__"

_config_lock = threading.Lock()

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


def _read_config_unlocked() -> dict:
    if CONFIG_FILE.is_file():
        try:
            raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raise
        except OSError as e:
            logger.warning("config read failed path=%s: %s", CONFIG_FILE, e)
            return {}
        normalized, errors = normalize_loaded_config(raw, GLOBAL_CONFIG_KEY)
        for name, error in errors:
            logger.warning("config validation failed key=%s: %s", name, error)
        return normalized
    return {}


def _write_config_unlocked(config: dict) -> None:
    normalized, errors = normalize_loaded_config(config, GLOBAL_CONFIG_KEY)
    if errors:
        name, error = errors[0]
        raise ValueError(f"Invalid config entry '{name}': {error}")
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = CONFIG_FILE.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(CONFIG_FILE)



def load_all_config() -> dict:
    with _config_lock:
        return _read_config_unlocked()


def save_all_config(config: dict) -> None:
    with _config_lock:
        _write_config_unlocked(config)


def load_workspace_config(workspace_name: str) -> dict:
    with _config_lock:
        return _read_config_unlocked().get(workspace_name, {})


def save_workspace_config(workspace_name: str, config: dict) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        all_config[workspace_name] = validate_config_entry(workspace_name, config, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)


def load_workspace_config_section(workspace_name: str, key: str, default=None):
    with _config_lock:
        ws_config = _read_config_unlocked().get(workspace_name, {})
        return ws_config.get(key, default if default is not None else {})


def save_workspace_config_section(workspace_name: str, key: str, data) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        ws_config = all_config.get(workspace_name, {})
        ws_config[key] = data
        all_config[workspace_name] = validate_config_entry(workspace_name, ws_config, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)


def load_global_config_section(key: str, default=None):
    with _config_lock:
        global_config = _read_config_unlocked().get(GLOBAL_CONFIG_KEY, {})
        return global_config.get(key, default if default is not None else {})


def save_global_config_section(key: str, data) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        global_config = all_config.get(GLOBAL_CONFIG_KEY, {})
        global_config[key] = data
        all_config[GLOBAL_CONFIG_KEY] = validate_config_entry(GLOBAL_CONFIG_KEY, global_config, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)



def resolve_workspace_path(workspace: str | None) -> Path | None:
    if not workspace:
        return None
    ws_path = (WORK_DIR / workspace).resolve()
    if ws_path.parent != WORK_DIR.resolve():
        raise HTTPException(status_code=400, detail=f"Invalid workspace: {workspace}")
    if not ws_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace not found: {workspace}")
    return ws_path


def ssh_env() -> dict[str, str]:
    if os.environ.get("SSH_AUTH_SOCK"):
        return dict(os.environ)
    candidates = [
        Path(f"/run/user/{os.getuid()}/gnupg/S.gpg-agent.ssh"),
        Path(f"/run/user/{os.getuid()}/ssh-agent.socket"),
    ]
    for sock in candidates:
        if sock.exists():
            env = dict(os.environ)
            env["SSH_AUTH_SOCK"] = str(sock)
            return env
    return dict(os.environ)


def command_result_dict(result: subprocess.CompletedProcess) -> dict:
    return {
        "status": "ok" if result.returncode == 0 else "error",
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def run_git_command(
    args: list[str],
    cwd: Path,
    timeout: int = GIT_STANDARD_TIMEOUT_SEC,
    env: dict | None = None,
    operation: str = "",
) -> dict:
    try:
        result = subprocess.run(
            ["git", *args],
            capture_output=True, text=True, timeout=timeout, cwd=str(cwd),
            env=env,
        )
        return command_result_dict(result)
    except subprocess.TimeoutExpired:
        label = operation or " ".join(args[:2])
        raise HTTPException(status_code=504, detail=f"git {label} timed out")


def validate_commit_hash(commit_hash: str) -> str:
    if not COMMIT_HASH_PATTERN.match(commit_hash):
        raise HTTPException(status_code=400, detail=f"Invalid commit hash: {commit_hash}")
    return commit_hash


_git_info_cache = TTLCache(5)


def invalidate_git_info(workspace_name: str):
    cache_key = str(WORK_DIR / workspace_name)
    _git_info_cache.invalidate(cache_key)


def git_info(directory: Path) -> dict:
    cache_key = str(directory)
    cached = _git_info_cache.get(cache_key)
    if cached is not None:
        return cached
    info = {
        "is_git_repo": False,
        "branch": None,
        "upstream": None,
        "has_upstream": None,
        "has_remote_branch": None,
        "last_commit": None,
        "last_commit_message": None,
        "github_url": None,
        "clean": None,
        "ahead": 0,
        "behind": 0,
        "insertions": 0,
        "deletions": 0,
        "changed_files": 0,
    }

    def run_git(*args):
        return subprocess.run(
            ["git", *args],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )

    try:
        check = run_git("rev-parse", "--is-inside-work-tree")
        if check.returncode != 0:
            return info
        info["is_git_repo"] = True
        with ThreadPoolExecutor(max_workers=4) as pool:
            f_branch = pool.submit(run_git, "rev-parse", "--abbrev-ref", "HEAD")
            f_commit = pool.submit(run_git, "log", "-1", "--format=%cI")
            f_message = pool.submit(run_git, "log", "-1", "--format=%s")
            f_remote = pool.submit(run_git, "remote", "get-url", "origin")
            f_status = pool.submit(run_git, "status", "--porcelain")
            f_diff = pool.submit(run_git, "diff", "--shortstat")
            f_staged = pool.submit(run_git, "diff", "--staged", "--shortstat")
            f_upstream = pool.submit(run_git, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
            f_remote_branches = pool.submit(run_git, "branch", "-r", "--format=%(refname:short)")
            f_revlist = pool.submit(run_git, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")

        result = f_branch.result()
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()

        result = f_remote_branches.result()
        if result.returncode == 0 and info["branch"]:
            branch = info["branch"]
            candidates = {b.strip() for b in result.stdout.splitlines() if b.strip()}
            info["has_remote_branch"] = f"origin/{branch}" in candidates
        elif info["branch"]:
            info["has_remote_branch"] = False

        result = f_commit.result()
        if result.returncode == 0 and result.stdout.strip():
            info["last_commit"] = result.stdout.strip()

        result = f_message.result()
        if result.returncode == 0 and result.stdout.strip():
            info["last_commit_message"] = result.stdout.strip()

        result = f_upstream.result()
        if result.returncode == 0 and result.stdout.strip():
            info["upstream"] = result.stdout.strip()
            info["has_upstream"] = True
        else:
            info["has_upstream"] = False

        result = f_remote.result()
        if result.returncode == 0:
            url = result.stdout.strip()
            if "github.com" in url:
                url = url.removesuffix(".git")
                if url.startswith("git@github.com:"):
                    url = "https://github.com/" + url[len("git@github.com:"):]
                info["github_url"] = url

        result = f_status.result()
        if result.returncode == 0:
            info["clean"] = len(result.stdout.strip()) == 0

        if not info["clean"]:
            for diff_stat_output in (f_diff.result().stdout, f_staged.result().stdout):
                if not diff_stat_output:
                    continue
                files_match = re.search(r"(\d+) file", diff_stat_output)
                insertions_match = re.search(r"(\d+) insertion", diff_stat_output)
                deletions_match = re.search(r"(\d+) deletion", diff_stat_output)
                if files_match:
                    info["changed_files"] += int(files_match.group(1))
                if insertions_match:
                    info["insertions"] += int(insertions_match.group(1))
                if deletions_match:
                    info["deletions"] += int(deletions_match.group(1))

            status_output = f_status.result().stdout if f_status else ""
            if status_output:
                untracked = sum(1 for line in status_output.splitlines() if line.startswith("?? "))
                info["changed_files"] += untracked

        result = f_revlist.result()
        if result.returncode == 0 and info["has_upstream"]:
            parts = result.stdout.strip().split()
            if len(parts) == 2:
                info["ahead"] = int(parts[0])
                info["behind"] = int(parts[1])
        elif info["branch"] and info["has_remote_branch"] is True:
            # Upstream未設定でも同名リモートブランチがあれば差分件数を出す
            remote_ref = f"origin/{info['branch']}"
            remote_diff = run_git("rev-list", "--left-right", "--count", f"HEAD...{remote_ref}")
            if remote_diff.returncode == 0:
                parts = remote_diff.stdout.strip().split()
                if len(parts) == 2:
                    info["ahead"] = int(parts[0])
                    info["behind"] = int(parts[1])
        elif info["has_remote_branch"] is False:
            # 初回push向け: origin上のどのブランチにも含まれないローカルコミット数
            unpublished = run_git("rev-list", "--count", "HEAD", "--not", "--remotes=origin")
            if unpublished.returncode == 0:
                try:
                    info["ahead"] = int(unpublished.stdout.strip() or "0")
                except ValueError:
                    pass
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("git_info failed dir=%s: %s", directory, e)
    _git_info_cache.set(cache_key, info)
    return info


def git_info_to_status_dict(directory: Path, name: str) -> dict:
    result = git_info(directory)
    result["name"] = name
    return result


def get_git_branches(directory: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        if result.returncode == 0:
            return [b for b in result.stdout.strip().splitlines() if b]
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("get_git_branches failed dir=%s: %s", directory, e)
    return []


def get_git_remote_branches(directory: Path) -> list[str]:
    try:
        subprocess.run(
            ["git", "fetch", "--prune"],
            capture_output=True, text=True, timeout=GIT_STANDARD_TIMEOUT_SEC,
            cwd=str(directory),
        )
        result = subprocess.run(
            ["git", "branch", "-r", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        if result.returncode == 0:
            branches = []
            for b in result.stdout.strip().splitlines():
                b = b.strip()
                if not b or b.endswith("/HEAD"):
                    continue
                if "/" in b:
                    b = b.split("/", 1)[1]
                if b not in branches:
                    branches.append(b)
            return branches
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("get_git_remote_branches failed dir=%s: %s", directory, e)
    return []
