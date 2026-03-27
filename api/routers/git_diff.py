from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import GIT_SHORT_TIMEOUT_SEC, MAX_DIFF_SIZE, STASH_REF_PATTERN, resolve_workspace_path
from ..git_utils import run_git_command
from ..validators import validate_commit_hash
from .git_shared import build_file_entry, build_file_list, parse_numstat_result

router = APIRouter(dependencies=[Depends(verify_token)])


def _build_diff_response(ws_path, diff_args, numstat_args, name_only_args, operation_prefix):
    result = run_git_command(diff_args, cwd=ws_path, operation=operation_prefix)
    numstat_result = run_git_command(
        numstat_args, cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC,
        operation=f"{operation_prefix} --numstat",
    )
    files_result = run_git_command(
        name_only_args, cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC,
        operation=f"{operation_prefix} --name-only",
    )
    numstat = parse_numstat_result(numstat_result)
    files = build_file_list(files_result, numstat)
    diff_text = result["stdout"]
    if len(diff_text) > MAX_DIFF_SIZE:
        diff_text = diff_text[:MAX_DIFF_SIZE] + "\n... (truncated)"
    return {"status": result["status"], "files": files, "diff": diff_text, "stderr": result["stderr"]}


@router.get("/workspaces/{name}/diff/{commit_hash}")
def get_commit_diff(name: str, commit_hash: str):
    ws_path = resolve_workspace_path(name)

    if STASH_REF_PATTERN.match(commit_hash):
        return _build_diff_response(
            ws_path,
            diff_args=["stash", "show", "-p", commit_hash],
            numstat_args=["stash", "show", "--numstat", commit_hash],
            name_only_args=["stash", "show", "--name-only", commit_hash],
            operation_prefix="stash show",
        )

    validate_commit_hash(commit_hash)
    return _build_diff_response(
        ws_path,
        diff_args=["--no-pager", "diff", f"{commit_hash}~1", commit_hash],
        numstat_args=["diff", "--numstat", f"{commit_hash}~1", commit_hash],
        name_only_args=["diff", "--name-only", f"{commit_hash}~1", commit_hash],
        operation_prefix="diff",
    )


@router.get("/workspaces/{name}/diff")
def get_workspace_diff(name: str):
    ws_path = resolve_workspace_path(name)
    status_result = run_git_command(
        ["status", "--porcelain", "--untracked-files=all"], cwd=ws_path,
        timeout=GIT_SHORT_TIMEOUT_SEC, operation="status",
    )
    diff_result = run_git_command(["diff"], cwd=ws_path, operation="diff")
    diff_staged_result = run_git_command(["diff", "--staged"], cwd=ws_path, operation="diff --staged")
    numstat_result = run_git_command(
        ["diff", "--numstat", "HEAD"], cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC, operation="diff --numstat HEAD",
    )
    numstat = parse_numstat_result(numstat_result)
    files = []
    if status_result["exit_code"] == 0:
        for line in status_result["stdout"].splitlines():
            if len(line) > 3:
                status_code = line[:2].strip()
                file_name = line[3:]
                entry = build_file_entry(file_name, numstat, status=status_code)
                files.append(entry)
    diff_text = ""
    if diff_staged_result["exit_code"] == 0 and diff_staged_result["stdout"]:
        diff_text += diff_staged_result["stdout"]
    if diff_result["exit_code"] == 0 and diff_result["stdout"]:
        if diff_text:
            diff_text += "\n"
        diff_text += diff_result["stdout"]
    if len(diff_text) > MAX_DIFF_SIZE:
        diff_text = diff_text[:MAX_DIFF_SIZE] + "\n... (truncated)"
    return {"status": "ok", "files": files, "diff": diff_text}
