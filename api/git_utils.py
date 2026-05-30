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


def run_git_raw(args, cwd, timeout=GIT_QUICK_TIMEOUT_SEC, text=True, env=None):
    return subprocess.run(
        ["git", *args],
        capture_output=True, text=text, timeout=timeout,
        cwd=str(cwd), env=env,
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
        result = run_git_raw(args, cwd, timeout=timeout, text=text, env=env)
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


def _apply_head_commit(info: dict, commit_out: str | None, message_out: str | None) -> None:
    if commit_out and (s := commit_out.strip()):
        info["last_commit"] = s
    if message_out and (s := message_out.strip()):
        info["last_commit_message"] = s


def _apply_github_url(info: dict, remote_out: str | None) -> None:
    if remote_out and (github_url := _parse_github_url(remote_out.strip())):
        info["github_url"] = github_url


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


_GIT_INFO_QUERIES: dict[str, tuple[str, ...]] = {
    "branch": ("rev-parse", "--abbrev-ref", "HEAD"),
    "commit": ("log", "-1", "--format=%cI"),
    "message": ("log", "-1", "--format=%s"),
    "remote": ("remote", "get-url", "origin"),
    "status": ("--no-optional-locks", "status", "--porcelain", "--untracked-files=all"),
    "diff": ("--no-optional-locks", "diff", "--shortstat"),
    "staged": ("--no-optional-locks", "diff", "--staged", "--shortstat"),
    "upstream": ("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"),
    "remote_branches": ("branch", "-r", "--format=%(refname:short)"),
    "revlist": ("rev-list", "--left-right", "--count", "HEAD...@{upstream}"),
}


def _populate_git_info(info: dict, directory: Path, run_git) -> None:
    futures = {key: _GIT_INFO_EXECUTOR.submit(run_git, *args) for key, args in _GIT_INFO_QUERIES.items()}
    out = {key: _stdout_if_ok(f) for key, f in futures.items()}

    _apply_branch_and_remote(info, out["branch"], out["remote_branches"])
    _apply_head_commit(info, out["commit"], out["message"])
    _apply_upstream(info, out["upstream"])
    _apply_github_url(info, out["remote"])

    if out["status"] is not None:
        info["clean"] = len(out["status"].strip()) == 0
    if not info["clean"]:
        _apply_diff_stats(info, (out["diff"] or "", out["staged"] or ""), out["status"], directory)

    _apply_ahead_behind(info, out["revlist"], run_git)


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


def _apply_worktree_attr(current: dict[str, Any], line: str) -> None:
    if line.startswith("HEAD "):
        current["head"] = line[len("HEAD "):]
    elif line.startswith("branch "):
        current["branch"] = line[len("branch "):].removeprefix("refs/heads/")
    elif line == "detached":
        current["detached"] = True
    elif line == "bare":
        current["bare"] = True
    elif line.startswith("locked"):
        current["locked"] = True


def parse_worktree_porcelain(output: str) -> list[dict[str, Any]]:
    """`git worktree list --porcelain` の出力をパースする純粋関数。

    各 worktree はブロック（空行区切り）で、先頭が `worktree <path>`。
    `branch refs/heads/<name>` / `detached` / `bare` / `locked` を解釈する。
    """
    worktrees: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for line in output.splitlines():
        if not line.strip():
            if current is not None:
                worktrees.append(current)
                current = None
        elif line.startswith("worktree "):
            if current is not None:
                worktrees.append(current)
            current = {"path": line[len("worktree "):], "branch": None,
                       "head": None, "bare": False, "detached": False, "locked": False}
        elif current is not None:
            _apply_worktree_attr(current, line)
    if current is not None:
        worktrees.append(current)
    return worktrees


def linked_worktree_main_path(directory: Path) -> Path | None:
    """directory が linked worktree なら、メイン作業ツリーのパスを返す。

    linked worktree では `--git-dir`（<main>/.git/worktrees/<id>）と
    `--git-common-dir`（<main>/.git）が異なる。メイン作業ツリーは common-dir の親。
    メイン作業ツリーや非リポジトリでは None。
    """
    out = _run_git_query(["rev-parse", "--git-dir", "--git-common-dir"], directory)
    if not out:
        return None
    lines: list[str] = [s.strip() for s in out.strip().splitlines() if s.strip()]
    if len(lines) < 2:
        return None
    git_dir = (directory / lines[0]).resolve()
    common_dir = (directory / lines[1]).resolve()
    if git_dir == common_dir:
        return None
    if common_dir.name == ".git":
        return common_dir.parent
    return None


def git_worktree_list(directory: Path) -> list[dict[str, Any]]:
    out = _run_git_query(["worktree", "list", "--porcelain"], directory)
    if out is None:
        logger.warning("git_worktree_list failed dir=%s", directory)
        return []
    return parse_worktree_porcelain(out)


_WORKTREE_NAME_RE = re.compile(r'^(.+?)\s+\[(.+)\]$')


def worktree_display_name(base: str, branch: str) -> str:
    """動的worktreeの表示名 '{base} [{branch}]' を組み立てる（_WORKTREE_NAME_RE の逆）。"""
    return f"{base} [{branch}]"


def find_dynamic_worktree_path(name: str) -> "Path | None":
    """'{base} [{branch}]' 形式の動的worktree名からパスを返す。configに登録されていないworktree用。"""
    m = _WORKTREE_NAME_RE.match(name)
    if not m:
        return None
    base_name, branch = m.group(1), m.group(2)
    from .config import list_workspace_entries
    for entry in list_workspace_entries().values():
        if entry.get("name") != base_name:
            continue
        base_path = Path(entry.get("path", ""))
        if not base_path.is_dir():
            continue
        for wt in git_worktree_list(base_path)[1:]:  # インデックス0はmain
            if wt.get("branch") == branch:
                p = Path(wt["path"])
                if p.is_dir():
                    return p
    return None


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
