"""ワークスペースの git ステータス収集（git_info）パイプライン。

複数の git クエリを並列実行し、branch / upstream / ahead-behind / diff 統計などを
1つの dict に集約する。結果は短時間 TTL でキャッシュする。

低レベルの git 実行ヘルパー（run_git_raw / _parse_github_url）は git_utils に置き、
本モジュールはそれらを import する一方向依存とする（循環 import を避ける）。
"""

import logging
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Any

from .common import (
    GIT_INFO_CACHE_TTL_SEC,
    GIT_QUICK_TIMEOUT_SEC,
    TTLCache,
    count_file_lines,
    resolve_workspace_path,
)
from .git_utils import _parse_github_url, run_git_raw

logger = logging.getLogger(__name__)

_git_info_cache = TTLCache(GIT_INFO_CACHE_TTL_SEC)
_GIT_INFO_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="git-info")


def invalidate_git_info(workspace_name: str):
    ws_path = resolve_workspace_path(workspace_name)
    if ws_path:
        _git_info_cache.invalidate(str(ws_path))
    else:
        _git_info_cache.invalidate(workspace_name)
    # API 経由の git 操作はここを必ず通るので、ステータスストリーム購読者へ
    # FS イベントを待たずに即時 push する（git_watch → git_info の一方向依存を
    # 保つため遅延 import）。
    from .git_watch import nudge_workspace
    nudge_workspace(workspace_name)


def refresh_git_info(directory: Path, name: str) -> dict[str, Any]:
    """watchfiles 起点の更新。diff/staged/status の3本だけ再計算してキャッシュを部分更新する。

    branch / last_commit / ahead-behind などはファイル保存では変わらないため
    キャッシュを流用し、応答を高速化する。キャッシュが無い場合はフル再計算。
    """
    cache_key = str(directory)
    cached: dict[str, Any] | None = _git_info_cache.get(cache_key)
    if cached is None:
        # 初回またはキャッシュ切れ: フル再計算
        _git_info_cache.invalidate(cache_key)
        return git_info_to_status_dict(directory, name)

    def run_git(*args):
        return run_git_raw(list(args), directory)

    _DIFF_QUERIES = {
        "status": ("--no-optional-locks", "status", "--porcelain", "--untracked-files=all"),
        "diff":   ("--no-optional-locks", "diff", "--shortstat"),
        "staged": ("--no-optional-locks", "diff", "--staged", "--shortstat"),
    }
    try:
        futures = {key: _GIT_INFO_EXECUTOR.submit(run_git, *args) for key, args in _DIFF_QUERIES.items()}
        out = {key: _stdout_if_ok(f) for key, f in futures.items()}
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("refresh_git_info diff queries failed dir=%s: %s", directory, e)
        return git_info_to_status_dict(directory, name)

    updated = dict(cached)
    updated["name"] = name
    if out["status"] is not None:
        updated["clean"] = len(out["status"].strip()) == 0
    # clean になった場合は diff 統計をリセット
    if updated["clean"]:
        updated["insertions"] = 0
        updated["deletions"] = 0
        updated["changed_files"] = 0
    else:
        _apply_diff_stats(updated, (out["diff"] or "", out["staged"] or ""), out["status"], directory)
    _git_info_cache.set(cache_key, {k: v for k, v in updated.items() if k != "name"})
    return updated


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
    # 未コミット（unborn HEAD）では rev-parse が失敗するため symbolic-ref で補完する。
    "symbolic_branch": ("symbolic-ref", "--short", "HEAD"),
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

    _apply_branch_and_remote(info, out["branch"] or out["symbolic_branch"], out["remote_branches"])
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
