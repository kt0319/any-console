import logging
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Any

from .common import (
    GIT_INFO_CACHE_TTL_SEC,
    GIT_QUICK_TIMEOUT_SEC,
    GIT_STANDARD_TIMEOUT_SEC,
    TTLCache,
    count_file_lines,
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
        "detail": result.stderr,
    }


def run_git_raw(args, cwd, timeout=GIT_QUICK_TIMEOUT_SEC, text=True):
    return subprocess.run(
        ["git", *args],
        capture_output=True, text=text, timeout=timeout,
        cwd=str(cwd),
    )


def _run_git_query(args, cwd, timeout=GIT_QUICK_TIMEOUT_SEC):
    try:
        result = run_git_raw(args, cwd, timeout)
        if result.returncode == 0:
            return result.stdout
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


def run_git_command(
    args: list[str],
    cwd: Path,
    timeout: int = GIT_STANDARD_TIMEOUT_SEC,
    env: dict | None = None,
    operation: str = "",
    text: bool = True,
) -> dict:
    try:
        result = subprocess.run(
            ["git", *args],
            capture_output=True, text=text, timeout=timeout, cwd=str(cwd),
            env=env,
        )
        return command_result_dict(result)
    except subprocess.TimeoutExpired:
        label = operation or " ".join(args[:2])
        raise timeout_error(f"git {label} timed out") from None


_git_info_cache = TTLCache(GIT_INFO_CACHE_TTL_SEC)
_GIT_INFO_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="git-info")


def invalidate_git_info(workspace_name: str):
    ws_path = resolve_workspace_path(workspace_name)
    if ws_path:
        _git_info_cache.invalidate(str(ws_path))
    else:
        _git_info_cache.invalidate(workspace_name)


def git_branch(directory: Path) -> str | None:
    out = _run_git_query(["rev-parse", "--abbrev-ref", "HEAD"], directory)
    return out.strip() or None if out is not None else None


def _parse_github_url(remote_url: str) -> str | None:
    if "github.com" not in remote_url:
        return None
    url = remote_url.removesuffix(".git")
    if url.startswith("git@github.com:"):
        url = "https://github.com/" + url[len("git@github.com:"):]
    return url


def git_github_url(directory: Path) -> str | None:
    out = _run_git_query(["remote", "get-url", "origin"], directory)
    return _parse_github_url(out.strip()) if out is not None else None


def git_is_repo(directory: Path) -> bool:
    return _run_git_query(["rev-parse", "--is-inside-work-tree"], directory) is not None


_FUTURE_TIMEOUT_SEC = GIT_QUICK_TIMEOUT_SEC + 2


def _safe_result(future):
    try:
        return future.result(timeout=_FUTURE_TIMEOUT_SEC)
    except (FutureTimeoutError, subprocess.TimeoutExpired, OSError) as e:
        logger.debug("git future failed: %s", e)
        return None


def _stdout_if_ok(future) -> str | None:
    r = _safe_result(future)
    return r.stdout if (r and r.returncode == 0) else None


def _empty_git_info() -> dict[str, Any]:
    return {
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


def _apply_branch_and_remote(info: dict, branch_out: str | None, remote_branches_out: str | None) -> None:
    if branch_out:
        info["branch"] = branch_out.strip()
    if not info["branch"]:
        return
    if remote_branches_out:
        candidates = {b.strip() for b in remote_branches_out.splitlines() if b.strip()}
        info["has_remote_branch"] = f"origin/{info['branch']}" in candidates
    else:
        info["has_remote_branch"] = False


def _apply_upstream(info: dict, upstream_out: str | None) -> None:
    if upstream_out and upstream_out.strip():
        info["upstream"] = upstream_out.strip()
        info["has_upstream"] = True
    else:
        info["has_upstream"] = False


def _apply_diff_stats(
    info: dict,
    diff_outputs: tuple[str, ...],
    status_out: str | None,
    directory: Path,
) -> None:
    for diff_stat_output in diff_outputs:
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
    if status_out:
        for line in status_out.splitlines():
            if line.startswith("?? "):
                info["changed_files"] += 1
                info["insertions"] += count_file_lines(directory / line[3:])


def _parse_revlist_pair(out: str) -> tuple[int, int] | None:
    parts = out.strip().split()
    if len(parts) == 2:
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            return None
    return None


def _apply_ahead_behind(info: dict, revlist_out: str | None, run_git) -> None:
    if revlist_out and info["has_upstream"]:
        pair = _parse_revlist_pair(revlist_out)
        if pair:
            info["ahead"], info["behind"] = pair
        return
    if info["branch"] and info["has_remote_branch"] is True:
        remote_diff = run_git("rev-list", "--left-right", "--count", f"HEAD...origin/{info['branch']}")
        if remote_diff.returncode == 0:
            pair = _parse_revlist_pair(remote_diff.stdout)
            if pair:
                info["ahead"], info["behind"] = pair
        return
    if info["has_remote_branch"] is False:
        unpublished = run_git("rev-list", "--count", "HEAD", "--not", "--remotes=origin")
        if unpublished.returncode == 0:
            try:
                info["ahead"] = int(unpublished.stdout.strip() or "0")
            except ValueError:
                pass


def _populate_git_info(info: dict, directory: Path, run_git) -> None:
    pool = _GIT_INFO_EXECUTOR
    f_branch = pool.submit(run_git, "rev-parse", "--abbrev-ref", "HEAD")
    f_commit = pool.submit(run_git, "log", "-1", "--format=%cI")
    f_message = pool.submit(run_git, "log", "-1", "--format=%s")
    f_remote = pool.submit(run_git, "remote", "get-url", "origin")
    f_status = pool.submit(run_git, "--no-optional-locks", "status", "--porcelain", "--untracked-files=all")
    f_diff = pool.submit(run_git, "--no-optional-locks", "diff", "--shortstat")
    f_staged = pool.submit(run_git, "--no-optional-locks", "diff", "--staged", "--shortstat")
    f_upstream = pool.submit(run_git, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    f_remote_branches = pool.submit(run_git, "branch", "-r", "--format=%(refname:short)")
    f_revlist = pool.submit(run_git, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")

    _apply_branch_and_remote(info, _stdout_if_ok(f_branch), _stdout_if_ok(f_remote_branches))

    if (out := _stdout_if_ok(f_commit)) and out.strip():
        info["last_commit"] = out.strip()
    if (out := _stdout_if_ok(f_message)) and out.strip():
        info["last_commit_message"] = out.strip()

    _apply_upstream(info, _stdout_if_ok(f_upstream))

    if (out := _stdout_if_ok(f_remote)) and (github_url := _parse_github_url(out.strip())):
        info["github_url"] = github_url

    status_out = _stdout_if_ok(f_status)
    if status_out is not None:
        info["clean"] = len(status_out.strip()) == 0

    if not info["clean"]:
        _apply_diff_stats(
            info,
            (_stdout_if_ok(f_diff) or "", _stdout_if_ok(f_staged) or ""),
            status_out,
            directory,
        )

    _apply_ahead_behind(info, _stdout_if_ok(f_revlist), run_git)


def git_info(directory: Path) -> dict[str, Any]:
    cache_key = str(directory)
    cached: dict[str, Any] | None = _git_info_cache.get(cache_key)
    if cached is not None:
        return cached
    info: dict[str, Any] = _empty_git_info()

    def run_git(*args):
        return run_git_raw(list(args), directory)

    try:
        check = run_git("rev-parse", "--is-inside-work-tree")
        if check.returncode != 0:
            return info
        info["is_git_repo"] = True
        _populate_git_info(info, directory, run_git)
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("git_info failed dir=%s: %s", directory, e)
    _git_info_cache.set(cache_key, info)
    return info


def git_info_to_status_dict(directory: Path, name: str) -> dict:
    result = git_info(directory)
    result["name"] = name
    return result


def git_branches(directory: Path) -> list[str]:
    out = _run_git_query(["branch", "--format=%(refname:short)"], directory)
    if out is not None:
        return [b for b in out.strip().splitlines() if b]
    logger.warning("git_branches failed dir=%s", directory)
    return []


def git_remote_branches(directory: Path) -> list[str]:
    try:
        run_git_raw(["fetch", "--prune"], directory, timeout=GIT_STANDARD_TIMEOUT_SEC)
        result = run_git_raw(["branch", "-r", "--format=%(refname:short)"], directory)
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
