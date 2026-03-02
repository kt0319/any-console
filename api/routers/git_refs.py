import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LONG_TIMEOUT_SEC,
    GIT_SHORT_TIMEOUT_SEC,
    resolve_workspace_path,
)
from ..git_utils import (
    get_git_branches,
    get_git_remote_branches,
    git_info_to_status_dict,
    invalidate_git_info,
    run_git_command,
    ssh_env,
)
from .git_shared import get_current_branch, validate_branch_name

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


class DeleteBranchRequest(BaseModel):
    branch: str
    remote: bool = False


class CheckoutRequest(BaseModel):
    branch: str


@router.get("/workspaces/{name}/status")
def get_workspace_status(name: str):
    ws_path = resolve_workspace_path(name)
    return git_info_to_status_dict(ws_path, name)


@router.get("/workspaces/{name}/branches")
def list_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return get_git_branches(ws_path)


@router.get("/workspaces/{name}/branches/remote")
def list_remote_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return get_git_remote_branches(ws_path)


@router.post("/workspaces/{name}/delete-branch")
def delete_branch(name: str, body: DeleteBranchRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)

    if body.remote:
        result = run_git_command(
            ["push", "origin", "--delete", branch], cwd=ws_path,
            timeout=GIT_LONG_TIMEOUT_SEC, env=ssh_env(), operation="delete remote branch",
        )
    else:
        current_branch = run_git_command(
            ["rev-parse", "--abbrev-ref", "HEAD"], cwd=ws_path, operation="current branch",
        )["stdout"].strip()
        if branch == current_branch:
            raise HTTPException(status_code=400, detail="現在のブランチは削除できません")
        result = run_git_command(["branch", "-D", branch], cwd=ws_path, operation="delete branch")

    logger.info("delete-branch workspace=%s branch=%s remote=%s rc=%d", name, branch, body.remote, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/create-branch")
def create_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)
    result = run_git_command(["checkout", "-b", branch], cwd=ws_path, operation="create-branch")
    logger.info("create-branch workspace=%s branch=%s rc=%d", name, branch, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/checkout")
def checkout_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)

    local_branches = get_git_branches(ws_path)
    args = ["checkout", branch] if branch in local_branches else ["checkout", "-b", branch, f"origin/{branch}"]
    result = run_git_command(args, cwd=ws_path, operation="checkout")
    logger.info("checkout workspace=%s branch=%s rc=%d", name, branch, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/pull")
def git_pull(name: str):
    ws_path = resolve_workspace_path(name)
    env = ssh_env()
    dirty_result = run_git_command(["status", "--porcelain"], cwd=ws_path, operation="status")
    dirty = dirty_result["stdout"].strip()
    stashed = False
    if dirty:
        stash_result = run_git_command(["stash"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="stash")
        stashed = stash_result["exit_code"] == 0
    result = run_git_command(["pull", "--rebase"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="pull")
    stash_msg = ""
    if stashed:
        pop = run_git_command(["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="stash pop")
        if pop["exit_code"] != 0:
            stash_msg = f"\n⚠️ stash pop failed:\n{pop['stderr']}"
    logger.info("pull workspace=%s rc=%d", name, result["exit_code"])
    result["stderr"] += stash_msg
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/push")
def git_push(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(["push"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=ssh_env(), operation="push")
    logger.info("push workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/set-upstream")
def git_set_upstream(name: str):
    ws_path = resolve_workspace_path(name)
    branch = get_current_branch(ws_path)
    result = run_git_command(
        ["branch", "--set-upstream-to", f"origin/{branch}"],
        cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC, env=ssh_env(), operation="set upstream",
    )
    logger.info("set-upstream workspace=%s branch=%s rc=%d", name, branch, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/push-upstream")
def git_push_upstream(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(
        ["push", "-u", "origin", "HEAD"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC,
        env=ssh_env(), operation="push upstream",
    )
    logger.info("push-upstream workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/fetch")
def git_fetch(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(["fetch", "--prune"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="fetch")
    logger.info("fetch workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result
