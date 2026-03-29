import logging
import subprocess
from contextlib import contextmanager

from ..common import (
    GIT_LONG_TIMEOUT_SEC,
    GIT_SHORT_TIMEOUT_SEC,
    HIDDEN_DIRS,
    resolve_workspace_path,
)
from ..errors import bad_request, forbidden, server_error, timeout_error
from ..git_utils import git_branch, invalidate_git_info, run_git_command, run_git_raw

_action_logger = logging.getLogger(__name__)


def execute_git_action(name, args, *, timeout=GIT_LONG_TIMEOUT_SEC, operation="", env=None, log_extra=""):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(args, cwd=ws_path, timeout=timeout, operation=operation, env=env)
    extra = f" {log_extra}" if log_extra else ""
    _action_logger.info("git %s workspace=%s%s rc=%d", operation, name, extra, result["exit_code"])
    invalidate_git_info(name)
    return result


@contextmanager
def file_operation_guard(operation_name):
    try:
        yield
    except PermissionError:
        raise forbidden("Permission denied") from None
    except OSError as e:
        raise server_error(f"{operation_name}: {e}") from None


def run_raw_git(args, cwd, text=True):
    try:
        return run_git_raw(args, cwd, timeout=GIT_SHORT_TIMEOUT_SEC, text=text)
    except subprocess.TimeoutExpired:
        raise timeout_error("Git operation timed out") from None


def get_current_branch(ws_path):
    branch = git_branch(ws_path)
    if not branch:
        raise bad_request("Cannot get current branch")
    return branch


def resolve_workspace_target_path(ws_path, path: str):
    target = (ws_path / path).resolve()
    try:
        target.relative_to(ws_path.resolve())
    except ValueError:
        raise bad_request("Invalid path") from None
    return target


def validate_workspace_relative_target(ws_path, target):
    rel = target.relative_to(ws_path.resolve())
    if any(part in HIDDEN_DIRS for part in rel.parts):
        raise bad_request("Invalid path")
    return rel


def resolve_and_validate_workspace_path(ws_path, path: str):
    target = resolve_workspace_target_path(ws_path, path)
    rel = validate_workspace_relative_target(ws_path, target)
    return target, rel
