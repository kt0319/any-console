"""git worktree の作成・一覧・削除エンドポイント。

worktree を作成すると、その作業ツリーを新しいワークスペースとして登録し、
通常のワークスペースと同様に切り替え（ターミナル起動）できるようにする。
"""

import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LONG_TIMEOUT_SEC,
    resolve_workspace_path,
)
from ..config import (
    list_workspace_entries,
    load_workspace_config,
)
from ..errors import bad_request, conflict, not_found
from ..git_lock import workspace_write_lock
from ..git_utils import (
    git_branches,
    git_is_repo,
    git_worktree_list,
    invalidate_git_info,
    run_git_command,
)
from ..validators import validate_branch_name

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

_UNSAFE_NAME_CHARS = re.compile(r"[^a-zA-Z0-9_.-]+")


def _sanitize_segment(value: str) -> str:
    """ワークスペース名/ディレクトリ名に使える文字へ正規化する。"""
    cleaned = _UNSAFE_NAME_CHARS.sub("-", value).strip("-._")
    return cleaned or "wt"


def _registered_paths() -> dict[str, str]:
    """resolve 済みパス -> 表示名 の対応表。"""
    result: dict[str, str] = {}
    for entry in list_workspace_entries().values():
        p = entry.get("path", "")
        if not p:
            continue
        try:
            result[str(Path(p).resolve())] = entry.get("name", "")
        except OSError:
            result[p] = entry.get("name", "")
    return result


def _main_worktree_path(worktrees: list[dict]) -> Path | None:
    """メイン作業ツリー（一覧の先頭・非 detached/bare 優先）のパス。"""
    if not worktrees:
        return None
    return Path(worktrees[0]["path"])


def _ensure_git_repo(name: str) -> Path:
    ws_path = resolve_workspace_path(name)
    if not git_is_repo(ws_path):
        raise bad_request(f"Workspace '{name}' is not a git repository")
    return ws_path


@router.get("/workspaces/{name}/worktrees")
def list_worktrees(name: str):
    ws_path = _ensure_git_repo(name)
    worktrees = git_worktree_list(ws_path)
    registered = _registered_paths()
    main_path = _main_worktree_path(worktrees)
    items = []
    for wt in worktrees:
        try:
            resolved = str(Path(wt["path"]).resolve())
        except OSError:
            resolved = wt["path"]
        is_main = main_path is not None and Path(wt["path"]) == main_path
        items.append({
            "path": wt["path"],
            "branch": wt.get("branch"),
            "head": wt.get("head"),
            "detached": wt.get("detached", False),
            "bare": wt.get("bare", False),
            "locked": wt.get("locked", False),
            "is_main": is_main,
            "workspace": registered.get(resolved),
        })
    return {"worktrees": items}


class CreateWorktreeRequest(BaseModel):
    branch: str
    base: str | None = None


@router.post("/workspaces/{name}/worktrees")
def create_worktree(name: str, body: CreateWorktreeRequest):
    branch = validate_branch_name(body.branch)
    base = validate_branch_name(body.base) if body.base else None

    with workspace_write_lock(name):
        ws_path = _ensure_git_repo(name)
        worktrees = git_worktree_list(ws_path)
        main_path = _main_worktree_path(worktrees) or ws_path
        repo_name = main_path.name

        # メイン作業ツリーの兄弟に "<repo>.worktrees/<safe-branch>" を作る。
        wt_root = main_path.parent / f"{repo_name}.worktrees"
        target = wt_root / _sanitize_segment(branch)
        if target.exists():
            raise conflict(f"Worktree path already exists: {target}")

        existing_branches = git_branches(ws_path)
        if branch in existing_branches:
            args = ["worktree", "add", str(target), branch]
        else:
            args = ["worktree", "add", str(target), "-b", branch]
            if base:
                args.append(base)

        result = run_git_command(args, cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="worktree add")
        invalidate_git_info(name)
        if result["exit_code"] != 0:
            raise bad_request(result["stderr"].strip() or "Failed to create worktree")

        base_config = load_workspace_config(name)
        base_display = base_config.get("name") or name
        display_name = f"{base_display} [{branch}]"
        logger.info("worktree created repo=%s branch=%s path=%s", name, branch, target)

    return {
        "status": "ok",
        "workspace": {"name": display_name, "path": str(target), "branch": branch},
    }


class DeleteWorktreeRequest(BaseModel):
    path: str
    force: bool = False


@router.delete("/workspaces/{name}/worktrees")
def delete_worktree(name: str, body: DeleteWorktreeRequest):
    with workspace_write_lock(name):
        ws_path = _ensure_git_repo(name)
        worktrees = git_worktree_list(ws_path)
        main_path = _main_worktree_path(worktrees)

        target = Path(body.path)
        try:
            target_resolved = target.resolve()
        except OSError:
            target_resolved = target

        # 対象がこのリポジトリの worktree であることを検証（任意パス削除を防ぐ）。
        known = {Path(wt["path"]).resolve() if Path(wt["path"]).exists() else Path(wt["path"])
                 for wt in worktrees}
        if target_resolved not in known and target not in known:
            raise not_found("Worktree not found for this repository")
        if main_path is not None and target_resolved == main_path.resolve():
            raise bad_request("Cannot remove the main worktree")

        args = ["worktree", "remove", str(body.path)]
        if body.force:
            args.append("--force")
        result = run_git_command(args, cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="worktree remove")
        invalidate_git_info(name)
        if result["exit_code"] != 0:
            raise bad_request(result["stderr"].strip() or "Failed to remove worktree")
        logger.info("worktree removed repo=%s path=%s", name, body.path)

    return {"status": "ok"}
