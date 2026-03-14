import logging
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .common import (
    GIT_QUICK_TIMEOUT_SEC,
    GIT_STANDARD_TIMEOUT_SEC,
    TTLCache,
    resolve_workspace_path,
)
from .errors import timeout_error

logger = logging.getLogger(__name__)


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
        raise timeout_error(f"git {label} timed out") from None


def validate_commit_hash(commit_hash: str) -> str:
    from .validators import validate_commit_hash as _validate
    return _validate(commit_hash)


_git_info_cache = TTLCache(5)


def invalidate_git_info(workspace_name: str):
    ws_path = resolve_workspace_path(workspace_name)
    if ws_path:
        _git_info_cache.invalidate(str(ws_path))
    else:
        _git_info_cache.invalidate(workspace_name)


def git_branch(directory: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


def git_github_url(directory: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            if "github.com" in url:
                url = url.removesuffix(".git")
                if url.startswith("git@github.com:"):
                    url = "https://github.com/" + url[len("git@github.com:"):]
                return url
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


def git_is_repo(directory: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


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
            remote_ref = f"origin/{info['branch']}"
            remote_diff = run_git("rev-list", "--left-right", "--count", f"HEAD...{remote_ref}")
            if remote_diff.returncode == 0:
                parts = remote_diff.stdout.strip().split()
                if len(parts) == 2:
                    info["ahead"] = int(parts[0])
                    info["behind"] = int(parts[1])
        elif info["has_remote_branch"] is False:
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


def git_branches(directory: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            capture_output=True, text=True, timeout=GIT_QUICK_TIMEOUT_SEC,
            cwd=str(directory),
        )
        if result.returncode == 0:
            return [b for b in result.stdout.strip().splitlines() if b]
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("git_branches failed dir=%s: %s", directory, e)
    return []


def git_remote_branches(directory: Path) -> list[str]:
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
        logger.warning("git_remote_branches failed dir=%s: %s", directory, e)
    return []
