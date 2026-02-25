import logging
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    BRANCH_NAME_PATTERN,
    GIT_LOG_MAX_ENTRIES,
    GIT_LONG_TIMEOUT_SEC,
    GIT_SHORT_TIMEOUT_SEC,
    get_git_branches,
    get_git_remote_branches,
    git_info_to_status_dict,
    invalidate_git_info,
    resolve_workspace_path,
    run_git_command,
    ssh_env,
    validate_commit_hash,
)

STASH_REF_PATTERN = re.compile(r"^stash@\{\d+\}$")
MAX_DIFF_SIZE = 10 * 1024 * 1024
GIT_LOG_MAX_SKIP = 10000

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


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


class CommitRequest(BaseModel):
    message: str


class CheckoutRequest(BaseModel):
    branch: str


def validate_branch_name(branch: str) -> str:
    branch = branch.strip()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch is required")
    if not BRANCH_NAME_PATTERN.match(branch):
        raise HTTPException(status_code=400, detail=f"Invalid branch name: {branch}")
    return branch


@router.post("/workspaces/{name}/create-branch")
def create_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)
    result = run_git_command(
        ["checkout", "-b", branch], cwd=ws_path, operation="create-branch",
    )
    logger.info("create-branch workspace=%s branch=%s rc=%d", name, branch, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/checkout")
def checkout_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)

    local_branches = get_git_branches(ws_path)
    is_local = branch in local_branches

    if is_local:
        args = ["checkout", branch]
    else:
        args = ["checkout", "-b", branch, f"origin/{branch}"]
    result = run_git_command(args, cwd=ws_path, operation="checkout")
    logger.info("checkout workspace=%s branch=%s rc=%d", name, branch, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/pull")
def git_pull(name: str):
    ws_path = resolve_workspace_path(name)
    env = ssh_env()
    dirty_result = run_git_command(
        ["status", "--porcelain"], cwd=ws_path, operation="status",
    )
    dirty = dirty_result["stdout"].strip()
    stashed = False
    if dirty:
        stash_result = run_git_command(
            ["stash"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC,
            env=env, operation="stash",
        )
        stashed = stash_result["exit_code"] == 0
    result = run_git_command(
        ["pull", "--rebase"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC,
        env=env, operation="pull",
    )
    stash_msg = ""
    if stashed:
        pop = run_git_command(
            ["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC,
            env=env, operation="stash pop",
        )
        if pop["exit_code"] != 0:
            stash_msg = f"\n⚠️ stash pop failed:\n{pop['stderr']}"
    logger.info("pull workspace=%s rc=%d", name, result["exit_code"])
    result["stderr"] += stash_msg
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/push")
def git_push(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(
        ["push"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC,
        env=ssh_env(), operation="push",
    )
    logger.info("push workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


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


class CommitActionRequest(BaseModel):
    commit_hash: str


class ResetRequest(BaseModel):
    commit_hash: str
    mode: str = "soft"


@router.post("/workspaces/{name}/cherry-pick")
def git_cherry_pick(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    result = run_git_command(
        ["cherry-pick", commit_hash], cwd=ws_path,
        timeout=GIT_LONG_TIMEOUT_SEC, operation="cherry-pick",
    )
    logger.info("cherry-pick workspace=%s commit=%s rc=%d", name, commit_hash[:8], result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/revert")
def git_revert(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    result = run_git_command(
        ["revert", "--no-edit", commit_hash], cwd=ws_path,
        timeout=GIT_LONG_TIMEOUT_SEC, operation="revert",
    )
    logger.info("revert workspace=%s commit=%s rc=%d", name, commit_hash[:8], result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/reset")
def git_reset(name: str, body: ResetRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    if body.mode not in ("soft", "hard"):
        raise HTTPException(status_code=400, detail=f"Invalid reset mode: {body.mode}")
    result = run_git_command(
        ["reset", f"--{body.mode}", commit_hash], cwd=ws_path,
        timeout=GIT_LONG_TIMEOUT_SEC, operation="reset",
    )
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


@router.post("/workspaces/{name}/fetch")
def git_fetch(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(
        ["fetch", "--prune"], cwd=ws_path,
        timeout=GIT_LONG_TIMEOUT_SEC, operation="fetch",
    )
    logger.info("fetch workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


class StashDropRequest(BaseModel):
    stash_ref: str


@router.get("/workspaces/{name}/stash-list")
def git_stash_list(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(
        ["stash", "list", "--format=%gd\t%gs\t%cr"],
        cwd=ws_path, operation="stash list",
    )
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
    result = run_git_command(
        ["stash", "drop", ref], cwd=ws_path,
        timeout=GIT_LONG_TIMEOUT_SEC, operation="stash drop",
    )
    logger.info("stash-drop workspace=%s ref=%s rc=%d", name, ref, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/stash-pop-index")
def git_stash_pop_index(name: str, body: StashDropRequest):
    ws_path = resolve_workspace_path(name)
    ref = body.stash_ref.strip()
    if not STASH_REF_PATTERN.match(ref):
        raise HTTPException(status_code=400, detail=f"Invalid stash ref: {ref}")
    result = run_git_command(
        ["stash", "pop", ref], cwd=ws_path,
        timeout=GIT_LONG_TIMEOUT_SEC, operation="stash pop",
    )
    logger.info("stash-pop workspace=%s ref=%s rc=%d", name, ref, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/stash")
def git_stash(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(
        ["stash"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="stash",
    )
    logger.info("stash workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.post("/workspaces/{name}/stash-pop")
def git_stash_pop(name: str):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(
        ["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, operation="stash pop",
    )
    logger.info("stash-pop workspace=%s rc=%d", name, result["exit_code"])
    invalidate_git_info(name)
    return result


@router.get("/workspaces/{name}/diff/{commit_hash}")
def get_commit_diff(name: str, commit_hash: str):
    ws_path = resolve_workspace_path(name)
    validate_commit_hash(commit_hash)
    result = run_git_command(
        ["--no-pager", "diff", f"{commit_hash}~1", commit_hash],
        cwd=ws_path, operation="diff",
    )
    files_result = run_git_command(
        ["diff", "--name-only", f"{commit_hash}~1", commit_hash],
        cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC, operation="diff --name-only",
    )
    files = [f for f in files_result["stdout"].splitlines() if f.strip()] if files_result["exit_code"] == 0 else []
    diff_text = result["stdout"]
    if len(diff_text) > MAX_DIFF_SIZE:
        diff_text = diff_text[:MAX_DIFF_SIZE] + "\n... (truncated)"
    return {
        "status": result["status"],
        "files": files,
        "diff": diff_text,
        "stderr": result["stderr"],
    }


@router.get("/workspaces/{name}/diff")
def get_workspace_diff(name: str):
    ws_path = resolve_workspace_path(name)
    status_result = run_git_command(
        ["status", "--porcelain"], cwd=ws_path,
        timeout=GIT_SHORT_TIMEOUT_SEC, operation="status",
    )
    diff_result = run_git_command(["diff"], cwd=ws_path, operation="diff")
    diff_staged_result = run_git_command(["diff", "--staged"], cwd=ws_path, operation="diff --staged")
    files = [
        line[3:] for line in status_result["stdout"].splitlines() if len(line) > 3
    ] if status_result["exit_code"] == 0 else []
    diff_text = ""
    if diff_staged_result["exit_code"] == 0 and diff_staged_result["stdout"]:
        diff_text += diff_staged_result["stdout"]
    if diff_result["exit_code"] == 0 and diff_result["stdout"]:
        if diff_text:
            diff_text += "\n"
        diff_text += diff_result["stdout"]
    if len(diff_text) > MAX_DIFF_SIZE:
        diff_text = diff_text[:MAX_DIFF_SIZE] + "\n... (truncated)"
    return {
        "status": "ok",
        "files": files,
        "diff": diff_text,
    }


HIDDEN_DIRS = {".git"}


@router.get("/workspaces/{name}/files")
def list_files(name: str, path: str = Query("")):
    ws_path = resolve_workspace_path(name)
    target = (ws_path / path).resolve()
    try:
        target.relative_to(ws_path.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    rel_path = str(target.relative_to(ws_path.resolve()))
    if rel_path == ".":
        rel_path = ""

    entries = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name in HIDDEN_DIRS or entry.is_symlink():
                    continue
                entry_type = "dir" if entry.is_dir(follow_symlinks=False) else "file"
                item = {"name": entry.name, "type": entry_type}
                if entry_type == "file":
                    try:
                        item["size"] = entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
                entries.append(item)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    entries.sort(key=lambda e: (0 if e["type"] == "dir" else 1, e["name"].lower()))
    return {"status": "ok", "path": rel_path, "entries": entries}


MAX_FILE_SIZE = 512 * 1024
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
}


@router.get("/workspaces/{name}/file-content")
def get_file_content(name: str, path: str = Query(...)):
    ws_path = resolve_workspace_path(name)
    target = (ws_path / path).resolve()
    try:
        target.relative_to(ws_path.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    if target.is_symlink():
        raise HTTPException(status_code=400, detail="Symlinks not supported")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        size = target.stat().st_size
    except OSError:
        raise HTTPException(status_code=500, detail="Cannot stat file")

    ext = target.suffix.lower()
    if ext in BINARY_EXTENSIONS:
        return {"status": "ok", "path": path, "binary": True, "size": size}

    if size > MAX_FILE_SIZE:
        return {"status": "ok", "path": path, "too_large": True, "size": size}

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"status": "ok", "path": path, "content": content, "size": size}
