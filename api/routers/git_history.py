from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    GIT_LOG_MAX_ENTRIES,
    GIT_LOG_MAX_SKIP,
    resolve_workspace_path,
)
from ..errors import bad_request
from ..git_utils import run_git_command
from ..validators import validate_branch_name, validate_commit_ref, validate_stash_ref
from .git_helpers import (
    execute_git_action,
    execute_git_action_with_activity,
    resolve_workspace_file,
    rev_parse,
)

router = APIRouter(dependencies=[Depends(verify_token)])


class CommitRequest(BaseModel):
    message: str


class GitActionRequest(BaseModel):
    commit_hash: str = ""
    branch: str = ""
    stash_ref: str = ""
    mode: str = "soft"
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
    if safe_skip > 0:
        args.insert(4 + (1 if graph else 0), f"--skip={safe_skip}")
    return run_git_command(args, cwd=ws_path, operation="log")


@router.get("/workspaces/{name}/file-history")
def get_file_history(name: str, path: str, limit: int = 50):
    ws_path, _, rel = resolve_workspace_file(name, path)
    safe_limit = max(1, min(limit, GIT_LOG_MAX_ENTRIES))
    args = [
        "--no-pager", "log", "--follow",
        f"--max-count={safe_limit}",
        "--date=format-local:%Y-%m-%d %H:%M",
        "--pretty=format:%H\t%ad\t%an\t%s",
        "--", rel,
    ]
    return run_git_command(args, cwd=ws_path, operation="log --follow")


def _execute_commit_action(name: str, ws_path, commit_hash: str, git_args: list[str], operation: str, event: str):
    """コミット指定系アクション（cherry-pick / revert）の実行 + activity 記録。"""
    h = validate_commit_ref(commit_hash)
    return execute_git_action_with_activity(
        name, ws_path, [*git_args, h],
        operation=operation, event=event, log_extra=f"commit={h[:8]}", source_commit=h,
    )


@router.get("/workspaces/{name}/commit-message")
def get_commit_message(name: str, hash: str):
    h = validate_commit_ref(hash)
    ws_path = resolve_workspace_path(name)
    result = run_git_command(["--no-pager", "log", "-1", "--format=%B", h], cwd=ws_path, operation="commit-message")
    return {"message": result.get("stdout", "").strip() if result.get("status") == "ok" else ""}


@router.post("/workspaces/{name}/cherry-pick")
def git_cherry_pick(name: str, body: GitActionRequest):
    ws_path = resolve_workspace_path(name)
    return _execute_commit_action(name, ws_path, body.commit_hash, ["cherry-pick"], "cherry-pick", "git_cherry_pick")


@router.post("/workspaces/{name}/revert")
def git_revert(name: str, body: GitActionRequest):
    ws_path = resolve_workspace_path(name)
    return _execute_commit_action(name, ws_path, body.commit_hash, ["revert", "--no-edit"], "revert", "git_revert")


@router.post("/workspaces/{name}/merge")
def git_merge(name: str, body: GitActionRequest):
    branch = validate_branch_name(body.branch)
    ws_path = resolve_workspace_path(name)
    before_hash = rev_parse(ws_path, "HEAD", "rev-parse before merge")
    return execute_git_action_with_activity(
        name, ws_path, ["merge", branch],
        operation="merge", event="git_merge", log_extra=f"branch={branch}",
        branch=branch, from_commit=before_hash,
    )


@router.post("/workspaces/{name}/rebase")
def git_rebase(name: str, body: GitActionRequest):
    branch = validate_branch_name(body.branch)
    ws_path = resolve_workspace_path(name)
    before_hash = rev_parse(ws_path, "HEAD", "rev-parse before rebase")
    return execute_git_action_with_activity(
        name, ws_path, ["rebase", branch],
        operation="rebase", event="git_rebase", log_extra=f"branch={branch}",
        branch=branch, from_commit=before_hash,
    )


@router.post("/workspaces/{name}/reset")
def git_reset(name: str, body: GitActionRequest):
    commit_hash = validate_commit_ref(body.commit_hash)
    if body.mode not in ("soft", "mixed", "hard"):
        raise bad_request(f"Invalid reset mode: {body.mode}")
    ws_path = resolve_workspace_path(name)
    before_hash = rev_parse(ws_path, "HEAD", "rev-parse before reset")
    return execute_git_action_with_activity(
        name, ws_path, ["reset", f"--{body.mode}", commit_hash],
        operation="reset", event="git_reset", log_extra=f"mode={body.mode} commit={commit_hash[:8]}",
        resolve_head=False, mode=body.mode, from_commit=before_hash, commit=commit_hash,
    )


@router.post("/workspaces/{name}/commit")
def git_commit(name: str, body: CommitRequest):
    ws_path = resolve_workspace_path(name)
    message = body.message.strip()
    if not message:
        raise bad_request("Please enter a commit message")
    add_result = run_git_command(["add", "-A"], cwd=ws_path, operation="add")
    if add_result["exit_code"] != 0:
        return add_result
    return execute_git_action_with_activity(
        name, ws_path, ["commit", "-m", message],
        operation="commit", event="git_commit", message=message,
    )


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
def git_stash_drop(name: str, body: GitActionRequest):
    ref = validate_stash_ref(body.stash_ref)
    return execute_git_action_with_activity(
        name, None, ["stash", "drop", ref],
        operation="stash drop", event="git_stash_drop", log_extra=f"ref={ref}",
        resolve_head=False, ref=ref,
    )


@router.post("/workspaces/{name}/stash-pop-ref")
def git_stash_pop_ref(name: str, body: GitActionRequest):
    ref = validate_stash_ref(body.stash_ref)
    return execute_git_action(name, ["stash", "pop", ref], operation="stash pop", log_extra=f"ref={ref}")


@router.post("/workspaces/{name}/stash")
def git_stash(name: str, body: GitActionRequest | None = None):
    args = ["stash"]
    if body and body.include_untracked:
        args.append("-u")
    return execute_git_action(name, args, operation="stash")


@router.post("/workspaces/{name}/stash-pop")
def git_stash_pop(name: str):
    return execute_git_action(name, ["stash", "pop"], operation="stash pop")
