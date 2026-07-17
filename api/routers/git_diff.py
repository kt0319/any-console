from fastapi import APIRouter, Body, Depends

from ..auth import verify_token
from ..common import (
    GIT_SHORT_TIMEOUT_SEC,
    MAX_DIFF_SIZE,
    STASH_REF_PATTERN,
    count_file_lines,
    resolve_workspace_path,
)
from ..git_utils import run_git_command
from ..validators import validate_commit_ref
from .git_diff_utils import build_file_entry, build_file_list, parse_numstat_result
from .git_helpers import execute_git_action, resolve_workspace_file

router = APIRouter(dependencies=[Depends(verify_token)])


def _truncate_diff(diff_text: str) -> str:
    if len(diff_text) > MAX_DIFF_SIZE:
        return diff_text[:MAX_DIFF_SIZE] + "\n... (truncated)"
    return diff_text


def _build_diff_response(
    ws_path, full_args: list[str], stat_args: list[str], operation_prefix: str,
):
    """Run full diff + --numstat + --name-only and return the combined response.

    `full_args`: command for the full patch output.
    `stat_args`: command suffix for stat queries (--numstat / --name-only flags will be appended).
    """
    diff_result = run_git_command(full_args, cwd=ws_path, operation=operation_prefix)
    numstat_result = run_git_command(
        [*stat_args, "--numstat"], cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC,
        operation=f"{operation_prefix} --numstat",
    )
    name_only_result = run_git_command(
        [*stat_args, "--name-only"], cwd=ws_path, timeout=GIT_SHORT_TIMEOUT_SEC,
        operation=f"{operation_prefix} --name-only",
    )
    files = build_file_list(name_only_result, parse_numstat_result(numstat_result))
    return {
        "status": diff_result["status"],
        "files": files,
        "diff": _truncate_diff(diff_result["stdout"]),
        "stderr": diff_result["stderr"],
    }


@router.get("/workspaces/{name}/diff/{commit_hash}")
def get_commit_diff(name: str, commit_hash: str):
    ws_path = resolve_workspace_path(name)

    if STASH_REF_PATTERN.match(commit_hash):
        return _build_diff_response(
            ws_path,
            full_args=["stash", "show", "-p", commit_hash],
            stat_args=["stash", "show", commit_hash],
            operation_prefix="stash show",
        )

    validate_commit_ref(commit_hash)
    ref = f"{commit_hash}~1"
    return _build_diff_response(
        ws_path,
        full_args=["--no-pager", "diff", ref, commit_hash],
        stat_args=["diff", ref, commit_hash],
        operation_prefix="diff",
    )


@router.get("/workspaces/{name}/file-diff/{commit_hash}")
def get_file_commit_diff(name: str, commit_hash: str, path: str):
    validate_commit_ref(commit_hash)
    ws_path, _, rel = resolve_workspace_file(name, path)
    diff_result = run_git_command(
        ["--no-pager", "show", "--format=", commit_hash, "--", rel],
        cwd=ws_path,
        operation="show",
    )
    return {
        "status": diff_result["status"],
        "diff": _truncate_diff(diff_result["stdout"]),
        "stderr": diff_result["stderr"],
        "exit_code": diff_result["exit_code"],
    }


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
                if status_code == "??" and file_name not in numstat:
                    numstat[file_name] = {
                        "insertions": count_file_lines(ws_path / file_name),
                        "deletions": 0,
                    }
                entry = build_file_entry(file_name, numstat, status=status_code)
                files.append(entry)
    parts = []
    for r in (diff_staged_result, diff_result):
        if r["exit_code"] == 0 and r["stdout"]:
            parts.append(r["stdout"])
    diff_text = "\n".join(parts)
    return {"status": "ok", "files": files, "diff": _truncate_diff(diff_text)}


@router.post("/workspaces/{name}/git/discard")
def discard_file_changes(name: str, path: str = Body(..., embed=True)):
    resolve_workspace_file(name, path)
    return execute_git_action(name, ["restore", path], operation="restore", log_extra=f"path={path}")
