import logging
import re
import subprocess

from fastapi import APIRouter, Depends
from fastapi import HTTPException
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    get_git_branches,
    get_git_remote_branches,
    git_info,
    resolve_workspace_path,
    ssh_env,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/workspaces/{name}/status")
def get_workspace_status(name: str):
    ws_path = resolve_workspace_path(name)
    gi = git_info(ws_path)
    return {
        "name": name,
        "branch": gi["branch"],
        "last_commit": gi["last_commit"],
        "last_commit_message": gi["last_commit_message"],
        "github_url": gi["github_url"],
        "clean": gi["clean"],
        "ahead": gi["ahead"],
        "behind": gi["behind"],
        "insertions": gi["insertions"],
        "deletions": gi["deletions"],
        "changed_files": gi["changed_files"],
    }


@router.get("/workspaces/{name}/branches")
def list_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return get_git_branches(ws_path)


@router.get("/workspaces/{name}/branches/remote")
def list_remote_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return get_git_remote_branches(ws_path)


class CheckoutRequest(BaseModel):
    branch: str


@router.post("/workspaces/{name}/create-branch")
def create_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = body.branch.strip()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch is required")
    if not re.match(r"^[a-zA-Z0-9_./-]+$", branch):
        raise HTTPException(status_code=400, detail=f"Invalid branch name: {branch}")
    try:
        result = subprocess.run(
            ["git", "checkout", "-b", branch],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        logger.info("create-branch workspace=%s branch=%s rc=%d", name, branch, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Branch creation timed out")


@router.post("/workspaces/{name}/checkout")
def checkout_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = body.branch.strip()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch is required")
    if not re.match(r"^[a-zA-Z0-9_./-]+$", branch):
        raise HTTPException(status_code=400, detail=f"Invalid branch name: {branch}")

    local_branches = get_git_branches(ws_path)
    is_local = branch in local_branches

    try:
        if is_local:
            result = subprocess.run(
                ["git", "checkout", branch],
                capture_output=True, text=True, timeout=30, cwd=str(ws_path),
            )
        else:
            result = subprocess.run(
                ["git", "checkout", "-b", branch, f"origin/{branch}"],
                capture_output=True, text=True, timeout=30, cwd=str(ws_path),
            )
        logger.info("checkout workspace=%s branch=%s rc=%d", name, branch, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Checkout timed out")


@router.post("/workspaces/{name}/pull")
def git_pull(name: str):
    ws_path = resolve_workspace_path(name)
    env = ssh_env()
    run_opts = dict(capture_output=True, text=True, timeout=60, cwd=str(ws_path), env=env)
    try:
        dirty = subprocess.run(
            ["git", "status", "--porcelain"], capture_output=True, text=True, cwd=str(ws_path),
        ).stdout.strip()
        stashed = False
        if dirty:
            stash_result = subprocess.run(["git", "stash"], **run_opts)
            stashed = stash_result.returncode == 0
        result = subprocess.run(["git", "pull", "--rebase"], **run_opts)
        stash_msg = ""
        if stashed:
            pop = subprocess.run(["git", "stash", "pop"], **run_opts)
            if pop.returncode != 0:
                stash_msg = f"\n⚠️ stash pop failed:\n{pop.stderr}"
        logger.info("pull workspace=%s rc=%d", name, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr + stash_msg,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git pull timed out")


@router.post("/workspaces/{name}/push")
def git_push(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "push"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
            env=ssh_env(),
        )
        logger.info("push workspace=%s rc=%d", name, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git push timed out")


@router.get("/workspaces/{name}/git-log")
def get_git_log(name: str, limit: int = 50, skip: int = 0):
    ws_path = resolve_workspace_path(name)
    safe_limit = max(1, min(limit, 200))
    safe_skip = max(0, skip)
    try:
        cmd = [
            "git",
            "--no-pager",
            "log",
            "--all",
            "--date-order",
            f"--max-count={safe_limit}",
            "--date=format:%Y-%m-%d %H:%M",
            "--pretty=format:%H\t%ad\t%an\t%D\t%s",
        ]
        if safe_skip > 0:
            cmd.insert(4, f"--skip={safe_skip}")
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git log timed out")


def validate_commit_hash(commit_hash: str) -> str:
    if not re.match(r"^[0-9a-f]{4,40}$", commit_hash):
        raise HTTPException(status_code=400, detail=f"Invalid commit hash: {commit_hash}")
    return commit_hash


class CommitActionRequest(BaseModel):
    commit_hash: str


class ResetRequest(BaseModel):
    commit_hash: str
    mode: str = "soft"


@router.post("/workspaces/{name}/cherry-pick")
def git_cherry_pick(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    try:
        result = subprocess.run(
            ["git", "cherry-pick", commit_hash],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        logger.info("cherry-pick workspace=%s commit=%s rc=%d", name, commit_hash[:8], result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git cherry-pick timed out")


@router.post("/workspaces/{name}/revert")
def git_revert(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    try:
        result = subprocess.run(
            ["git", "revert", "--no-edit", commit_hash],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        logger.info("revert workspace=%s commit=%s rc=%d", name, commit_hash[:8], result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git revert timed out")


@router.post("/workspaces/{name}/reset")
def git_reset(name: str, body: ResetRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    if body.mode not in ("soft", "hard"):
        raise HTTPException(status_code=400, detail=f"Invalid reset mode: {body.mode}")
    try:
        result = subprocess.run(
            ["git", "reset", f"--{body.mode}", commit_hash],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        logger.info("reset workspace=%s mode=%s commit=%s rc=%d", name, body.mode, commit_hash[:8], result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git reset timed out")


@router.post("/workspaces/{name}/fetch")
def git_fetch(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "fetch", "--prune"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        logger.info("fetch workspace=%s rc=%d", name, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git fetch timed out")


@router.post("/workspaces/{name}/stash")
def git_stash(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "stash"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        logger.info("stash workspace=%s rc=%d", name, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git stash timed out")


@router.post("/workspaces/{name}/stash-pop")
def git_stash_pop(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "stash", "pop"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        logger.info("stash-pop workspace=%s rc=%d", name, result.returncode)
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git stash pop timed out")


@router.get("/workspaces/{name}/diff/{commit_hash}")
def get_commit_diff(name: str, commit_hash: str):
    ws_path = resolve_workspace_path(name)
    if not commit_hash.isalnum():
        raise HTTPException(status_code=400, detail="Invalid commit hash")
    try:
        result = subprocess.run(
            ["git", "--no-pager", "diff", f"{commit_hash}~1", commit_hash],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        files_result = subprocess.run(
            ["git", "diff", "--name-only", f"{commit_hash}~1", commit_hash],
            capture_output=True, text=True, timeout=10, cwd=str(ws_path),
        )
        files = [f for f in files_result.stdout.splitlines() if f.strip()] if files_result.returncode == 0 else []
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "files": files,
            "diff": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git diff timed out")


@router.get("/workspaces/{name}/diff")
def get_workspace_diff(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=10, cwd=str(ws_path),
        )
        diff_result = subprocess.run(
            ["git", "diff"],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        diff_staged_result = subprocess.run(
            ["git", "diff", "--staged"],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        files = [
            line[3:] for line in status_result.stdout.splitlines() if len(line) > 3
        ] if status_result.returncode == 0 else []
        diff_text = ""
        if diff_staged_result.returncode == 0 and diff_staged_result.stdout:
            diff_text += diff_staged_result.stdout
        if diff_result.returncode == 0 and diff_result.stdout:
            if diff_text:
                diff_text += "\n"
            diff_text += diff_result.stdout
        return {
            "status": "ok",
            "files": files,
            "diff": diff_text,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git diff timed out")
