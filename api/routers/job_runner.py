"""/run エンドポイント。

通常ジョブ（subprocess 実行）と TERMINAL_JOB（tmux セッション生成）の
両方を扱う。
"""

import logging
import re
import shlex
import subprocess

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..activity import log_activity
from ..auth import verify_token
from ..common import (
    JOB_TIMEOUT_SEC,
    MAX_COMMAND_LENGTH,
    resolve_workspace_path,
    sanitize_log_value,
)
from ..errors import bad_request, server_error, timeout_error
from ..git_utils import command_result_dict
from ..job_models import TERMINAL_JOB, TERMINAL_JOB_KEY
from ..push import send_push_notification
from ..runner import run_job
from ..terminal_session import create_registered_session
from ..tmux import send_keys_to_tmux, wait_pane_ready
from .jobs_common import get_workspace_jobs

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


class RunRequest(BaseModel):
    job: str
    workspace: str | None = None
    icon: str | None = None
    icon_color: str | None = None
    job_name: str | None = None
    job_label: str | None = None
    command: str | None = None
    command_vars: dict[str, str] = {}


_PLACEHOLDER_RE = re.compile(r"\[\[\s*([A-Za-z0-9_]+)\s*\]\]")


def _substitute_placeholders(command: str | None, command_vars: dict[str, str]) -> str | None:
    """コマンド内の [[name]] を command_vars の値で置換する。

    値は shlex.quote で 1 個の安全な引数にする（シェルへ解釈させない）。
    未指定の [[name]] はそのまま残す（呼び出し側が全て埋める前提）。
    """
    if not command or not command_vars:
        return command

    def repl(m: re.Match) -> str:
        name = m.group(1)
        if name in command_vars:
            return shlex.quote(command_vars[name])
        return str(m.group(0))

    return _PLACEHOLDER_RE.sub(repl, command)


def _strip_comment_lines(command: str) -> str:
    """先頭が # の行（コメント行）を除去する。"""
    lines = [line for line in command.splitlines() if not re.match(r"^\s*#", line)]
    return "\n".join(lines)


def _validate_terminal_command(command: str | None) -> str | None:
    """ターミナルへ自動投入するコマンドを検証する。

    複数行シェルスクリプトを許容するため改行は通すが、NUL は send-keys
    （subprocess 引数）に渡せないので弾く。空文字列は None とみなす。
    """
    if not command:
        return None
    command = _strip_comment_lines(command).strip()
    if not command:
        return None
    if len(command) > MAX_COMMAND_LENGTH:
        raise bad_request("Command is too long")
    if "\x00" in command:
        raise bad_request("Invalid characters in command")
    return command


def _create_terminal_session(body, ws_path):
    command = _substitute_placeholders(body.command, body.command_vars)
    command = _validate_terminal_command(command)
    session_id, session = create_registered_session(
        ws_path,
        workspace=body.workspace,
        icon=body.icon,
        icon_color=body.icon_color,
        job_name=body.job_name,
        job_label=body.job_label,
    )
    tmux_name = session.tmux_session_name
    logger.info("terminal session created session=%s tmux=%s workspace=%s",
                 session_id, tmux_name, body.workspace or "(none)")

    # コマンドはサーバ側で送り込む。ブラウザ接続を待たずにセッション内で実行が
    # 始まるため、接続前に閉じても／無接続でも走り続ける（自動実行）。
    # シェル起動直後の取りこぼしを避けるためペイン準備を短時間待つ。
    if command:
        wait_pane_ready(tmux_name)
        if not send_keys_to_tmux(tmux_name, command):
            logger.warning("autorun send-keys failed session=%s", session_id)
        log_activity(body.workspace, "terminal_run",
                     job=body.job_name or sanitize_log_value(command[:80]))

    return {
        "status": "ok",
        "session_id": session_id,
        "ws_url": f"/terminal/ws/{session_id}",
    }


def _run_regular_job(body, job_def, ws_path):
    cwd_path = str(ws_path) if ws_path else ""
    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    timeout_sec = job_def.timeout_sec if job_def.timeout_sec is not None else JOB_TIMEOUT_SEC
    try:
        result = run_job(job_def, workspace=cwd_path)
    except subprocess.TimeoutExpired:
        logger.warning("job timeout job=%s workspace=%s sec=%d",
                       body.job, body.workspace or "(none)", timeout_sec)
        raise timeout_error(f"Job execution timed out after {timeout_sec}s") from None
    except OSError as e:
        logger.error("job exec failed job=%s workspace=%s: %s", body.job, body.workspace or "(none)", e)
        raise server_error(f"Job execution failed: {e}") from None

    payload = command_result_dict(result)

    ok = result.returncode == 0
    if ok:
        logger.info("job ok job=%s workspace=%s", body.job, body.workspace or "(none)")
        log_activity(body.workspace, "job_run", job=body.job)
    else:
        logger.warning(
            "job failed job=%s workspace=%s rc=%d stderr=%s",
            body.job, body.workspace or "(none)",
            result.returncode, sanitize_log_value(result.stderr[:200]),
        )

    if job_def.notify_on_done:
        label = job_def.label or body.job
        status = "Succeeded" if ok else f"Failed (exit {result.returncode})"
        url = f"/?workspace={body.workspace}" if body.workspace else "/"
        send_push_notification(
            title=f"{label}: {status}",
            body=body.workspace or "",
            url=url,
            notif_type="job_done",
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

    if body.job == TERMINAL_JOB_KEY:
        return _create_terminal_session(body, ws_path)

    return _run_regular_job(body, job_def, ws_path)
