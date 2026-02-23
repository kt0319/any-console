import json
import logging
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import HTTPException

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORK_DIR = Path.home() / "work"
UPLOAD_DIR = Path("/tmp/pi-console-uploads")
TERMINAL_TIMEOUT_SEC = 1800
CONFIG_DIR = PROJECT_ROOT / "data"
OLD_CONFIG_DIR = Path.home() / ".config" / "pi-console"
OLD_WORKSPACE_CONFIG_DIR = Path(".pi-console")

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
COMMIT_HASH_PATTERN = re.compile(r"^[0-9a-f]{4,40}$")

BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=4)


def workspace_config_file(workspace_name: str) -> Path:
    return CONFIG_DIR / f"{workspace_name}.json"


def load_workspace_config(workspace_name: str) -> dict:
    config_file = workspace_config_file(workspace_name)
    if not config_file.is_file():
        return {}
    try:
        return json.loads(config_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_workspace_config(workspace_name: str, config: dict) -> None:
    config_file = workspace_config_file(workspace_name)
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config_file.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_json_file(path: Path, default=None):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def migrate_workspace_config(workspace_name: str, workspace_path: Path) -> None:
    new_file = workspace_config_file(workspace_name)
    if new_file.exists():
        return

    old_dir = CONFIG_DIR / workspace_name
    if not old_dir.is_dir():
        source_dirs = [
            CONFIG_DIR / "workspaces" / workspace_name,
            OLD_CONFIG_DIR / "workspaces" / workspace_name,
            workspace_path / OLD_WORKSPACE_CONFIG_DIR,
        ]
        for candidate in source_dirs:
            if candidate.is_dir():
                old_dir = candidate
                break
        else:
            return

    config = _read_json_file(old_dir / "config.json", {})
    jobs = _read_json_file(old_dir / "jobs.json", {})
    links = _read_json_file(old_dir / "links.json", [])

    merged = {}
    if config.get("icon"):
        merged["icon"] = config["icon"]
    if config.get("icon_color"):
        merged["icon_color"] = config["icon_color"]
    if jobs:
        merged["jobs"] = jobs
    if links:
        merged["links"] = links

    save_workspace_config(workspace_name, merged)
    logger.info("migrated workspace config workspace=%s from=%s to=%s", workspace_name, old_dir, new_file)


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
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        label = operation or " ".join(args[:2])
        raise HTTPException(status_code=504, detail=f"git {label} timed out")


def validate_commit_hash(commit_hash: str) -> str:
    if not COMMIT_HASH_PATTERN.match(commit_hash):
        raise HTTPException(status_code=400, detail=f"Invalid commit hash: {commit_hash}")
    return commit_hash


def git_info(directory: Path) -> dict:
    info = {
        "branch": None,
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
        with ThreadPoolExecutor(max_workers=4) as pool:
            f_branch = pool.submit(run_git, "rev-parse", "--abbrev-ref", "HEAD")
            f_commit = pool.submit(run_git, "log", "-1", "--format=%cI")
            f_message = pool.submit(run_git, "log", "-1", "--format=%s")
            f_remote = pool.submit(run_git, "remote", "get-url", "origin")
            f_status = pool.submit(run_git, "status", "--porcelain")
            f_diff = pool.submit(run_git, "diff", "--shortstat")
            f_staged = pool.submit(run_git, "diff", "--staged", "--shortstat")
            f_revlist = pool.submit(run_git, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")

        result = f_branch.result()
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()

        result = f_commit.result()
        if result.returncode == 0 and result.stdout.strip():
            info["last_commit"] = result.stdout.strip()

        result = f_message.result()
        if result.returncode == 0 and result.stdout.strip():
            info["last_commit_message"] = result.stdout.strip()

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

        result = f_revlist.result()
        if result.returncode == 0:
            parts = result.stdout.strip().split()
            if len(parts) == 2:
                info["ahead"] = int(parts[0])
                info["behind"] = int(parts[1])
    except (subprocess.TimeoutExpired, OSError):
        pass
    return info


def git_info_to_status_dict(directory: Path, name: str) -> dict:
    git_data = git_info(directory)
    return {
        "name": name,
        "branch": git_data["branch"],
        "last_commit": git_data["last_commit"],
        "last_commit_message": git_data["last_commit_message"],
        "github_url": git_data["github_url"],
        "clean": git_data["clean"],
        "ahead": git_data["ahead"],
        "behind": git_data["behind"],
        "insertions": git_data["insertions"],
        "deletions": git_data["deletions"],
        "changed_files": git_data["changed_files"],
    }


def get_git_branches(directory: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        if result.returncode == 0:
            return [b for b in result.stdout.strip().splitlines() if b]
    except (subprocess.TimeoutExpired, OSError):
        pass
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
    except (subprocess.TimeoutExpired, OSError):
        pass
    return []
