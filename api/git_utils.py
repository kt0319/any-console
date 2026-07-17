import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from .common import (
    GIT_QUICK_TIMEOUT_SEC,
    GIT_STANDARD_TIMEOUT_SEC,
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


def run_git_raw(
    args: list[str],
    cwd: str | Path,
    timeout: float = GIT_QUICK_TIMEOUT_SEC,
    text: bool = True,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        capture_output=True,
        text=text,
        encoding="utf-8" if text else None,
        errors="replace" if text else None,
        timeout=timeout,
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


def git_branch(directory: Path) -> str | None:
    out = _run_git_query(["rev-parse", "--abbrev-ref", "HEAD"], directory)
    if out is None:
        return None
    return out.strip() or None


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


def git_worktree_list(directory: Path) -> list[dict[str, Any]]:
    out = _run_git_query(["worktree", "list", "--porcelain"], directory)
    if out is None:
        logger.warning("git_worktree_list failed dir=%s", directory)
        return []
    return parse_worktree_porcelain(out)


_WORKTREE_NAME_RE = re.compile(r'^(.+?)\s+\[(.+)\]$')


def worktree_display_name(base: str, branch: str) -> str:
    """動的worktreeの表示名 '{base} [{branch}]' を組み立てる（split_worktree_name の逆）。"""
    return f"{base} [{branch}]"


def split_worktree_name(name: str) -> "tuple[str, str] | None":
    """worktree 表示名 '{base} [{branch}]' を (base, branch) に分解する。非該当は None。"""
    m = _WORKTREE_NAME_RE.match(name)
    return (m.group(1), m.group(2)) if m else None


def worktree_base_of(name: str) -> str:
    """worktree 表示名ならベース名を、そうでなければ名前をそのまま返す。"""
    parts = split_worktree_name(name)
    return parts[0] if parts else name


def list_git_workspace_paths() -> "list[tuple[str, Path]]":
    """登録済みワークスペースのうち実在する git リポジトリを (表示名, パス) で列挙する。

    /workspaces/statuses の対象集合と git_watch の監視対象はこの列挙を共有する。
    """
    from .config import list_workspace_entries
    result = []
    for ws_id, entry in list_workspace_entries().items():
        p = Path(entry.get("path", "")).expanduser()
        if p.is_dir() and git_is_repo(p):
            result.append((entry.get("name") or ws_id, p))
    return result


def find_dynamic_worktree_path(name: str) -> "Path | None":
    """'{base} [{branch}]' 形式の動的worktree名からパスを返す。configに登録されていないworktree用。"""
    parts = split_worktree_name(name)
    if not parts:
        return None
    base_name, branch = parts
    from .config import list_workspace_entries
    for entry in list_workspace_entries().values():
        if entry.get("name") != base_name:
            continue
        base_path = Path(entry.get("path", "")).expanduser()
        if not base_path.is_dir():
            continue
        for wt in git_worktree_list(base_path)[1:]:  # インデックス0はmain
            if wt.get("branch") == branch:
                p = Path(wt["path"])
                if p.is_dir():
                    return p
    return None


def git_fetch_remote_branches(directory: Path, env: dict[str, str] | None = None) -> list[str]:
    """`git fetch --prune` でリモート追跡refを更新してから、リモートブランチ名一覧を返す。"""
    try:
        run_git_raw(["fetch", "--prune"], directory, timeout=GIT_STANDARD_TIMEOUT_SEC, env=env)
        # refname:short はgitのバージョンによってシンボリックな `origin/HEAD` を
        # "origin" に短縮することがあるため、常に安定なロング形式で判定する。
        result = run_git_raw(["for-each-ref", "--format=%(refname)", "refs/remotes"], directory)
        if result.returncode == 0:
            branches = []
            for ref in result.stdout.strip().splitlines():
                ref = ref.strip()
                prefix = "refs/remotes/"
                if not ref.startswith(prefix):
                    continue
                b = ref[len(prefix):]
                if not b or b.split("/", 1)[-1] == "HEAD":
                    continue
                if "/" in b:
                    b = b.split("/", 1)[1]
                if b not in branches:
                    branches.append(b)
            return branches
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("git_fetch_remote_branches failed dir=%s: %s", directory, e)
    return []
