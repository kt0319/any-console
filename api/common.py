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
WORKSPACE_JOBS_DIR = Path(".pi-console/jobs")
WORKSPACE_LINKS_FILE = Path(".pi-console/links.json")

BACKGROUND_EXECUTOR = ThreadPoolExecutor(max_workers=4)


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
            capture_output=True, text=True, timeout=5, cwd=str(directory),
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
            for out in (f_diff.result().stdout, f_staged.result().stdout):
                if not out:
                    continue
                m_files = re.search(r"(\d+) file", out)
                m_ins = re.search(r"(\d+) insertion", out)
                m_del = re.search(r"(\d+) deletion", out)
                if m_files:
                    info["changed_files"] += int(m_files.group(1))
                if m_ins:
                    info["insertions"] += int(m_ins.group(1))
                if m_del:
                    info["deletions"] += int(m_del.group(1))

        result = f_revlist.result()
        if result.returncode == 0:
            parts = result.stdout.strip().split()
            if len(parts) == 2:
                info["ahead"] = int(parts[0])
                info["behind"] = int(parts[1])
    except (subprocess.TimeoutExpired, OSError):
        pass
    return info


def get_git_branches(directory: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
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
            capture_output=True, text=True, timeout=30, cwd=str(directory),
        )
        result = subprocess.run(
            ["git", "branch", "-r", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
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
