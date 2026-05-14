from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LONG_TIMEOUT_SEC,
    resolve_workspace_path,
)
from ..errors import bad_request
from ..git_lock import workspace_write_lock
from ..git_utils import (
    git_branch,
    git_branches,
    git_info_to_status_dict,
    git_remote_branches,
    run_git_command,
    ssh_env,
)
from ..validators import validate_branch_name, validate_commit_hash
from .git_helpers import execute_git_action, get_current_branch

_COMMIT_PREVIEW_LIMIT = 3


def _commits_between(ws_path, range_expr: str) -> dict:
    """range_expr (例: "abcd..HEAD" または "@{u}..HEAD") のコミット件数と直近メッセージを返す。"""
    log = run_git_command(
        ["log", range_expr, "--pretty=format:%s", "-n", str(_COMMIT_PREVIEW_LIMIT)],
        cwd=ws_path, operation="log range",
    )
    count_res = run_git_command(
        ["rev-list", "--count", range_expr], cwd=ws_path, operation="rev-list count",
    )
    if log["exit_code"] != 0 or count_res["exit_code"] != 0:
        return {"count": 0, "messages": []}
    try:
        count = int(count_res["stdout"].strip() or "0")
    except ValueError:
        count = 0
    messages = [line for line in log["stdout"].splitlines() if line]
    return {"count": count, "messages": messages}

router = APIRouter(dependencies=[Depends(verify_token)])


def _stash_if_dirty(ws_path, env) -> bool:
    dirty = run_git_command(["status", "--porcelain"], cwd=ws_path, operation="status")["stdout"].strip()
    if not dirty:
        return False
    result = run_git_command(["stash"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="stash")
    return bool(result["exit_code"] == 0)


def _unstash(ws_path, env, result: dict) -> None:
    pop = run_git_command(["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="stash pop")
    if pop["exit_code"] != 0:
        result["stderr"] += f"\n⚠️ stash pop failed:\n{pop['stderr']}"


class DeleteBranchRequest(BaseModel):
    branch: str
    remote: bool = False


class CheckoutRequest(BaseModel):
    branch: str
    start_point: str | None = None


@router.get("/workspaces/{name}/status")
def get_workspace_status(name: str):
    ws_path = resolve_workspace_path(name)
    return git_info_to_status_dict(ws_path, name)


@router.get("/workspaces/{name}/branches")
def list_branches(name: str):
    ws_path = resolve_workspace_path(name)
    branches = git_branches(ws_path)
    current = git_branch(ws_path)
    return [{"name": b, "current": b == current} for b in branches]


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
    if branch == get_current_branch(ws_path):
        raise bad_request("Cannot delete the current branch")
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
    with workspace_write_lock(name):
        ws_path = resolve_workspace_path(name)
        env = ssh_env()
        before_hash = run_git_command(
            ["rev-parse", "HEAD"], cwd=ws_path, operation="rev-parse before pull",
        )["stdout"].strip()
        stashed = _stash_if_dirty(ws_path, env)
        result = execute_git_action(name, ["pull", "--rebase"], operation="pull", env=env)
        if stashed:
            _unstash(ws_path, env, result)
        if result["status"] == "ok" and before_hash:
            result["commits"] = _commits_between(ws_path, f"{before_hash}..HEAD")
        return result


@router.post("/workspaces/{name}/push")
def git_push(name: str):
    ws_path = resolve_workspace_path(name)
    pending = _commits_between(ws_path, "@{u}..HEAD")
    result = execute_git_action(name, ["push"], operation="push", env=ssh_env())
    if result["status"] == "ok":
        result["commits"] = pending
    return result


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
