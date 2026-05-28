"""/run エンドポイント。

通常ジョブ（subprocess 実行）と TERMINAL_JOB（tmux セッション生成）の
両方を扱う。
"""

import logging
import re
import secrets
import subprocess

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..activity import log_activity
from ..auth import verify_token
from ..common import (
    JOB_TIMEOUT_SEC,
    MAX_TERMINAL_SESSIONS,
    TMUX_SESSION_PREFIX,
    resolve_workspace_path,
    sanitize_log_value,
)
from ..errors import bad_request, server_error, timeout_error, too_many_requests
from ..git_utils import command_result_dict, git_branches
from ..job_models import TERMINAL_JOB, TERMINAL_JOB_KEY
from ..runner import run_job
from ..terminal_session import (
    TERMINAL_SESSIONS,
    TerminalSession,
    sessions_lock,
)
from ..tmux import create_tmux_session
from ..validators import validate_workspace_name
from .jobs_common import get_workspace_jobs

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


class RunRequest(BaseModel):
    job: str
    args: dict[str, str] = {}
    workspace: str | None = None
    icon: str | None = None
    icon_color: str | None = None
    job_name: str | None = None
    job_label: str | None = None


def _validate_job_args(job_def, body_args, ws_path):
    ordered_args: list[str] = []
    for arg_option in job_def.args:
        value = body_args.get(arg_option.name)
        if value is None:
            if arg_option.required:
                raise bad_request(f"Missing required argument: {arg_option.name}")
            continue

        if arg_option.dynamic == "branches":
            if not ws_path:
                raise bad_request("Workspace is required for this job")
            allowed = git_branches(ws_path)
            if value not in allowed:
                raise bad_request(f"Invalid branch: {value}")
        elif arg_option.values and value not in arg_option.values:
            raise bad_request(
                f"Invalid value for {arg_option.name}: {value} (allowed: {arg_option.values})",
            )
        else:
            if re.search(r"[\x00-\x1f\x7f]", value):
                raise bad_request(f"Invalid characters in argument: {arg_option.name}")
        ordered_args.append(value)
    return ordered_args


def _create_terminal_session(body, ws_path):
    with sessions_lock:
        if len(TERMINAL_SESSIONS) >= MAX_TERMINAL_SESSIONS:
            raise too_many_requests(
                f"Maximum number of terminal sessions reached ({MAX_TERMINAL_SESSIONS})",
            )
    cwd_path = str(ws_path) if ws_path else None
    short_id = secrets.token_urlsafe(6)
    safe_name = validate_workspace_name(body.workspace).replace(".", "_") if body.workspace else None
    session_id = f"{safe_name}-{short_id}" if safe_name else short_id
    tmux_name = f"{TMUX_SESSION_PREFIX}{session_id}"
    try:
        create_tmux_session(cwd_path, tmux_name)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        logger.error("tmux session creation failed: %s", e)
        raise server_error(f"Failed to create terminal: {e}") from None
    session = TerminalSession(
        workspace=body.workspace,
        tmux_session_name=tmux_name,
        icon=body.icon,
        icon_color=body.icon_color,
        job_name=body.job_name,
        job_label=body.job_label,
    )
    with sessions_lock:
        TERMINAL_SESSIONS[session_id] = session
    session.save_metadata()
    logger.info("terminal session created session=%s tmux=%s workspace=%s",
                 session_id, tmux_name, body.workspace or "(none)")
    return {
        "status": "ok",
        "session_id": session_id,
        "ws_url": f"/terminal/ws/{session_id}",
    }


def _run_regular_job(body, job_def, ordered_args, ws_path):
    cwd_path = str(ws_path) if ws_path else ""
    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    try:
        result = run_job(job_def, ordered_args, workspace=cwd_path)
    except subprocess.TimeoutExpired:
        logger.warning("job timeout job=%s workspace=%s sec=%d",
                       body.job, body.workspace or "(none)", JOB_TIMEOUT_SEC)
        raise timeout_error(f"Job execution timed out after {JOB_TIMEOUT_SEC}s") from None
    except OSError as e:
        logger.error("job exec failed job=%s workspace=%s: %s", body.job, body.workspace or "(none)", e)
        raise server_error(f"Job execution failed: {e}") from None

    payload = command_result_dict(result)

    if result.returncode == 0:
        logger.info("job ok job=%s workspace=%s", body.job, body.workspace or "(none)")
        log_activity(body.workspace, "job_run", job=body.job)
    else:
        logger.warning(
            "job failed job=%s workspace=%s rc=%d stderr=%s",
            body.job, body.workspace or "(none)",
            result.returncode, sanitize_log_value(result.stderr[:200]),
        )
    return payload


@router.post("/run")
def execute_job(body: RunRequest):
    ws_path = resolve_workspace_path(body.workspace)

    if body.job == TERMINAL_JOB_KEY:
        job_def = TERMINAL_JOB
    else:
        available_jobs = get_workspace_jobs(body.workspace)
        entry = available_jobs.get(body.job)
        if not entry:
            raise bad_request(f"Unknown job: {body.job}")
        job_def, _ = entry

    ordered_args = _validate_job_args(job_def, body.args, ws_path)

    if body.job == TERMINAL_JOB_KEY:
        return _create_terminal_session(body, ws_path)

    return _run_regular_job(body, job_def, ordered_args, ws_path)
