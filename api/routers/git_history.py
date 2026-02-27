import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LOG_MAX_ENTRIES,
    GIT_LONG_TIMEOUT_SEC,
    resolve_workspace_path,
    run_git_command,
    validate_commit_hash,
    invalidate_git_info,
)
from .git_shared import GIT_LOG_MAX_SKIP, STASH_REF_PATTERN

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


class CommitRequest(BaseModel):
    message: str


class CommitActionRequest(BaseModel):
    commit_hash: str


class ResetRequest(BaseModel):
    commit_hash: str
    mode: str = "soft"


class StashDropRequest(BaseModel):
    stash_ref: str


class StashRequest(BaseModel):
    include_untracked: bool = False


@router.get("/workspaces/{name}/git-log")
def get_git_log(name: str, limit: int = 50, skip: int = 0):
    ws_path = resolve_workspace_path(name)
    safe_limit = max(1, min(limit, GIT_LOG_MAX_ENTRIES))
    safe_skip = min(max(0, skip), GIT_LOG_MAX_SKIP)
    args = [
        "--no-pager", "log", "--date-order",
        f"--max-count={safe_limit}",
        "--date=format-local:%Y-%m-%d %H:%M",
        "--pretty=format:%H\t%ad\t%an\t%D\t%s",
    ]
    if safe_skip > 0:
        args.insert(4, f"--skip={safe_skip}")
    return run_git_command(args, cwd=ws_path, operation="log")


@router.post("/workspaces/{name}/cherry-pick")
def git_cherry_pick(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    result = run_git_command(["cherry-pick", commit_hash], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="cherry-pick")
    logger.info("cherry-pick workspace=%s commit=%s rc=%d", name, commit_hash[:8], result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/revert")
def git_revert(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    result = run_git_command(["revert", "--no-edit", commit_hash], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="revert")
    logger.info("revert workspace=%s commit=%s rc=%d", name, commit_hash[:8], result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/reset")
def git_reset(name: str, body: ResetRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    if body.mode not in ("soft", "hard"):
        raise HTTPException(status_code=400, detail=f"Invalid reset mode: {body.mode}")
    result = run_git_command(["reset", f"--{body.mode}", commit_hash], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="reset")
    logger.info("reset workspace=%s mode=%s commit=%s rc=%d", name, body.mode, commit_hash[:8], result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/commit")
def git_commit(name: str, body: CommitRequest):
    ws_path = resolve_workspace_path(name)
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="コミットメッセージを入力してください")
    add_result = run_git_command(["add", "-A"], cwd=ws_path, operation="add")
    if add_result["exit_code"] != 0:
        return add_result
    result = run_git_command(["commit", "-m", message], cwd=ws_path, operation="commit")
    logger.info("commit workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.get("/workspaces/{name}/stash-list")
def git_stash_list(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(["stash", "list", "--format=%gd\t%gs\t%cr"], cwd=ws_path, operation="stash list")
    if result["exit_code"] != 0:
        return result
    entries = []
    for line in result["stdout"].splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 2)
        if len(parts) >= 3:
            entries.append({"ref": parts[0], "message": parts[1], "time": parts[2]})
    return {"status": "ok", "entries": entries}


@router.post("/workspaces/{name}/stash-drop")
def git_stash_drop(name: str, body: StashDropRequest):
    ws_path = resolve_workspace_path(name)
    ref = body.stash_ref.strip()
    if not STASH_REF_PATTERN.match(ref):
        raise HTTPException(status_code=400, detail=f"Invalid stash ref: {ref}")
    result = run_git_command(["stash", "drop", ref], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="stash drop")
    logger.info("stash-drop workspace=%s ref=%s rc=%d", name, ref, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/stash-pop-index")
def git_stash_pop_index(name: str, body: StashDropRequest):
    ws_path = resolve_workspace_path(name)
    ref = body.stash_ref.strip()
    if not STASH_REF_PATTERN.match(ref):
        raise HTTPException(status_code=400, detail=f"Invalid stash ref: {ref}")
    result = run_git_command(["stash", "pop", ref], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="stash pop")
    logger.info("stash-pop workspace=%s ref=%s rc=%d", name, ref, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/stash")
def git_stash(name: str, body: StashRequest = None):
    ws_path = resolve_workspace_path(name)
    args = ["stash"]
    if body and body.include_untracked:
        args.append("-u")
    result = run_git_command(args, cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="stash")
    logger.info("stash workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/stash-pop")
def git_stash_pop(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="stash pop")
    logger.info("stash-pop workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result
