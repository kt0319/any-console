from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LOG_MAX_ENTRIES,
    resolve_workspace_path,
)
from ..errors import bad_request
from ..git_utils import run_git_command
from ..validators import validate_branch_name, validate_commit_hash, validate_stash_ref
from .git_shared import GIT_LOG_MAX_SKIP, execute_git_action

router = APIRouter(dependencies=[Depends(verify_token)])


class CommitRequest(BaseModel):
    message: str


class CommitActionRequest(BaseModel):
    commit_hash: str


class ResetRequest(BaseModel):
    commit_hash: str
    mode: str = "soft"


class StashRefRequest(BaseModel):
    stash_ref: str


class MergeRequest(BaseModel):
    branch: str


class StashRequest(BaseModel):
    include_untracked: bool = False


@router.get("/workspaces/{name}/git-log")
def get_git_log(name: str, limit: int = 50, skip: int = 0, graph: bool = False):
    ws_path = resolve_workspace_path(name)
    safe_limit = max(1, min(limit, GIT_LOG_MAX_ENTRIES))
    safe_skip = min(max(0, skip), GIT_LOG_MAX_SKIP)
    args = [
        "--no-pager", "log", "--date-order",
        f"--max-count={safe_limit}",
        "--date=format-local:%Y-%m-%d %H:%M",
        "--pretty=format:%H\t%ad\t%an\t%D\t%s",
    ]
    if graph:
        args.insert(3, "--graph")
        args.insert(4, "--all")
    if safe_skip > 0:
        args.insert(4 + (2 if graph else 0), f"--skip={safe_skip}")
    return run_git_command(args, cwd=ws_path, operation="log")


@router.post("/workspaces/{name}/cherry-pick")
def git_cherry_pick(name: str, body: CommitActionRequest):
    commit_hash = validate_commit_hash(body.commit_hash)
    return execute_git_action(
        name, ["cherry-pick", commit_hash],
        operation="cherry-pick", log_extra=f"commit={commit_hash[:8]}",
    )


@router.post("/workspaces/{name}/revert")
def git_revert(name: str, body: CommitActionRequest):
    commit_hash = validate_commit_hash(body.commit_hash)
    return execute_git_action(
        name, ["revert", "--no-edit", commit_hash],
        operation="revert", log_extra=f"commit={commit_hash[:8]}",
    )


@router.post("/workspaces/{name}/merge")
def git_merge(name: str, body: MergeRequest):
    branch = validate_branch_name(body.branch)
    return execute_git_action(name, ["merge", branch], operation="merge", log_extra=f"branch={branch}")


@router.post("/workspaces/{name}/rebase")
def git_rebase(name: str, body: MergeRequest):
    branch = validate_branch_name(body.branch)
    return execute_git_action(name, ["rebase", branch], operation="rebase", log_extra=f"branch={branch}")


@router.post("/workspaces/{name}/reset")
def git_reset(name: str, body: ResetRequest):
    commit_hash = validate_commit_hash(body.commit_hash)
    if body.mode not in ("soft", "hard"):
        raise bad_request(f"Invalid reset mode: {body.mode}")
    return execute_git_action(
        name, ["reset", f"--{body.mode}", commit_hash],
        operation="reset", log_extra=f"mode={body.mode} commit={commit_hash[:8]}",
    )


@router.post("/workspaces/{name}/commit")
def git_commit(name: str, body: CommitRequest):
    ws_path = resolve_workspace_path(name)
    message = body.message.strip()
    if not message:
        raise bad_request("コミットメッセージを入力してください")
    add_result = run_git_command(["add", "-A"], cwd=ws_path, operation="add")
    if add_result["exit_code"] != 0:
        return add_result
    return execute_git_action(name, ["commit", "-m", message], operation="commit")


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
def git_stash_drop(name: str, body: StashRefRequest):
    ref = validate_stash_ref(body.stash_ref)
    return execute_git_action(name, ["stash", "drop", ref], operation="stash drop", log_extra=f"ref={ref}")


@router.post("/workspaces/{name}/stash-pop-ref")
def git_stash_pop_ref(name: str, body: StashRefRequest):
    ref = validate_stash_ref(body.stash_ref)
    return execute_git_action(name, ["stash", "pop", ref], operation="stash pop", log_extra=f"ref={ref}")


@router.post("/workspaces/{name}/stash")
def git_stash(name: str, body: StashRequest = None):
    args = ["stash"]
    if body and body.include_untracked:
        args.append("-u")
    return execute_git_action(name, args, operation="stash")


@router.post("/workspaces/{name}/stash-pop")
def git_stash_pop(name: str):
    return execute_git_action(name, ["stash", "pop"], operation="stash pop")
