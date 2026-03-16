from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LONG_TIMEOUT_SEC,
    resolve_workspace_path,
)
from ..errors import bad_request
from ..git_utils import (
    git_branches,
    git_info_to_status_dict,
    git_remote_branches,
    run_git_command,
    ssh_env,
)
from ..validators import validate_branch_name, validate_commit_hash
from .git_shared import execute_git_action, get_current_branch

router = APIRouter(dependencies=[Depends(verify_token)])


class DeleteBranchRequest(BaseModel):
    branch: str
    remote: bool = False


class CheckoutRequest(BaseModel):
    branch: str
    start_point: str = None


@router.get("/workspaces/{name}/status")
def get_workspace_status(name: str):
    ws_path = resolve_workspace_path(name)
    return git_info_to_status_dict(ws_path, name)


@router.get("/workspaces/{name}/branches")
def list_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return git_branches(ws_path)


@router.get("/workspaces/{name}/branches/remote")
def list_remote_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return git_remote_branches(ws_path)


@router.post("/workspaces/{name}/delete-branch")
def delete_branch(name: str, body: DeleteBranchRequest):
    branch = validate_branch_name(body.branch)
    if body.remote:
        return execute_git_action(
            name, ["push", "origin", "--delete", branch],
            operation="delete remote branch", env=ssh_env(), log_extra=f"branch={branch}",
        )
    ws_path = resolve_workspace_path(name)
    current_branch = run_git_command(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=ws_path, operation="current branch",
    )["stdout"].strip()
    if branch == current_branch:
        raise bad_request("現在のブランチは削除できません")
    return execute_git_action(name, ["branch", "-D", branch], operation="delete branch", log_extra=f"branch={branch}")


@router.post("/workspaces/{name}/create-branch")
def create_branch(name: str, body: CheckoutRequest):
    branch = validate_branch_name(body.branch)
    args = ["checkout", "-b", branch]
    if body.start_point:
        args.append(validate_commit_hash(body.start_point))
    return execute_git_action(name, args, operation="create-branch", log_extra=f"branch={branch}")


@router.post("/workspaces/{name}/checkout")
def checkout_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)
    local_branches = git_branches(ws_path)
    args = ["checkout", branch] if branch in local_branches else ["checkout", "-b", branch, f"origin/{branch}"]
    return execute_git_action(name, args, operation="checkout", log_extra=f"branch={branch}")


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
    result = execute_git_action(name, ["pull", "--rebase"], operation="pull", env=env)
    if stashed:
        pop = run_git_command(
            ["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC,
            env=env, operation="stash pop",
        )
        if pop["exit_code"] != 0:
            result["stderr"] += f"\n⚠️ stash pop failed:\n{pop['stderr']}"
    return result


@router.post("/workspaces/{name}/push")
def git_push(name: str):
    return execute_git_action(name, ["push"], operation="push", env=ssh_env())


@router.post("/workspaces/{name}/set-upstream")
def git_set_upstream(name: str):
    ws_path = resolve_workspace_path(name)
    branch = get_current_branch(ws_path)
    return execute_git_action(
        name, ["branch", "--set-upstream-to", f"origin/{branch}"],
        operation="set upstream", env=ssh_env(), log_extra=f"branch={branch}",
    )


@router.post("/workspaces/{name}/push-upstream")
def git_push_upstream(name: str):
    return execute_git_action(name, ["push", "-u", "origin", "HEAD"], operation="push upstream", env=ssh_env())


@router.post("/workspaces/{name}/fetch")
def git_fetch(name: str):
    return execute_git_action(name, ["fetch", "--prune"], operation="fetch")
