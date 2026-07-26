"""/run エンドポイント。

TERMINAL_JOB（tmux セッション生成）を扱う。ジョブのコマンドは
セッション作成後に tmux へ送り込まれて実行される（自動実行）。
"""

import logging
import re
import shlex

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..activity import log_activity
from ..auth import verify_token
from ..common import (
    MAX_COMMAND_LENGTH,
    resolve_workspace_path,
    sanitize_log_value,
)
from ..errors import bad_request
from ..job_models import TERMINAL_JOB_KEY
from ..terminal_session import create_registered_session
from ..tmux import send_keys_to_tmux, wait_pane_ready

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
    # UIが「+」等の操作で直接開いたリクエストであることの明示フラグ。/run は
    # 外部ツールから直接叩かれることも想定するエンドポイントのため、既定は
    # False（=タブバーには出さず Tabs & Sessions パネルのみに表示）。
    interactive: bool = False


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
        interactive=body.interactive,
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


@router.post("/run")
def execute_job(body: RunRequest):
    ws_path = resolve_workspace_path(body.workspace)

    if body.job != TERMINAL_JOB_KEY:
        raise bad_request(f"Unknown job: {body.job}")

    return _create_terminal_session(body, ws_path)
