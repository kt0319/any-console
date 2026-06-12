"""/dispatch エンドポイント。

外部から「workspace + job + テキスト」を1回のリクエストで投げて、
既存セッション再利用 or 新規作成、ブランチ確認/作成、起動コマンド実行、
text の tmux 送信までを行う。
"""

import asyncio
import json
import logging
import re
import secrets
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    MAX_TERMINAL_SESSIONS,
    TMUX_SESSION_PREFIX,
    resolve_workspace_path,
)
from ..errors import bad_request, server_error, too_many_requests
from ..git_utils import (
    _WORKTREE_NAME_RE,
    git_branch,
    git_branches,
    run_git_raw,
)
from ..job_models import TERMINAL_JOB, TERMINAL_JOB_KEY
from ..terminal_session import (
    TERMINAL_SESSIONS,
    TerminalSession,
    sessions_lock,
)
from ..tmux import (
    create_tmux_session,
    send_keys_to_tmux,
    tmux_session_exists,
    wait_pane_ready,
)
from ..validators import validate_branch_name
from .jobs_common import get_workspace_jobs

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

DISPATCH_TIMEOUT_SEC = 30
SSE_PING_SEC = 20
_PENDING: dict[str, dict] = {}
_SSE_QUEUES: list[asyncio.Queue] = []


def _broadcast(payload: dict) -> None:
    for q in list(_SSE_QUEUES):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


class DispatchRequest(BaseModel):
    workspace: str
    job: str = TERMINAL_JOB_KEY
    text: str = ""
    enter: bool = True
    reuse: bool = True
    branch: str | None = None
    create_branch: bool = False
    base_branch: str | None = None


def _resolve_job_def(workspace: str, job: str):
    if job == TERMINAL_JOB_KEY:
        return TERMINAL_JOB
    available = get_workspace_jobs(workspace)
    entry = available.get(job)
    if not entry:
        raise bad_request(f"Unknown job: {job}")
    job_def, _ = entry
    return job_def


def _ensure_branch(ws_path, branch: str, create: bool, base: str | None) -> None:
    branch = validate_branch_name(branch)
    current = git_branch(ws_path)
    if branch == current:
        return
    branches = git_branches(ws_path)
    if branch in branches:
        args = ["checkout", branch]
    elif create:
        args = ["checkout", "-b", branch]
        if base:
            args.append(validate_branch_name(base))
    else:
        raise bad_request(f"Branch does not exist: {branch}")
    result = run_git_raw(args, ws_path)
    if result.returncode != 0:
        raise bad_request(result.stderr.strip() or "Branch operation failed")


def _find_existing_session(workspace: str, job: str):
    target_job = None if job == TERMINAL_JOB_KEY else job
    with sessions_lock:
        for sid, sess in TERMINAL_SESSIONS.items():
            if sess.workspace != workspace:
                continue
            if sess.job_name != target_job:
                continue
            if tmux_session_exists(sess.tmux_session_name):
                return sid, sess
    return None, None


def _make_session_id(workspace: str) -> str:
    short_id = secrets.token_urlsafe(6)
    m = _WORKTREE_NAME_RE.match(workspace)
    raw = m.group(1) if m else workspace
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", raw)
    return f"{safe}-{short_id}"


def _create_session(workspace: str, ws_path, job: str, job_def):
    with sessions_lock:
        if len(TERMINAL_SESSIONS) >= MAX_TERMINAL_SESSIONS:
            raise too_many_requests(
                f"Maximum number of terminal sessions reached ({MAX_TERMINAL_SESSIONS})",
            )
    session_id = _make_session_id(workspace)
    tmux_name = f"{TMUX_SESSION_PREFIX}{session_id}"
    try:
        create_tmux_session(str(ws_path) if ws_path else None, tmux_name)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        logger.error("tmux session creation failed: %s", e)
        raise server_error(f"Failed to create terminal: {e}") from None
    session = TerminalSession(
        workspace=workspace,
        tmux_session_name=tmux_name,
        icon=job_def.icon,
        icon_color=job_def.icon_color,
        job_name=None if job == TERMINAL_JOB_KEY else job,
        job_label=job_def.label,
    )
    with sessions_lock:
        TERMINAL_SESSIONS[session_id] = session
    session.save_metadata()
    logger.info("dispatch session created session=%s workspace=%s job=%s",
                session_id, workspace, job)
    return session_id, session


class DispatchDecision(BaseModel):
    approved: bool


@router.get("/dispatch/events")
async def dispatch_events():
    async def gen():
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        _SSE_QUEUES.append(q)
        try:
            yield "data: {\"type\":\"hello\"}\n\n"
            for pending_id, p in list(_PENDING.items()):
                if not p["event"].is_set():
                    yield f"data: {json.dumps({'type': 'pending', 'id': pending_id, 'request': p['request']})}\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=SSE_PING_SEC)
                    yield f"data: {json.dumps(item)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            if q in _SSE_QUEUES:
                _SSE_QUEUES.remove(q)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/dispatch/{dispatch_id}/decision")
async def dispatch_decision(dispatch_id: str, body: DispatchDecision):
    p = _PENDING.get(dispatch_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pending dispatch not found")
    p["approved"] = body.approved
    p["event"].set()
    _broadcast({"type": "decided", "id": dispatch_id, "approved": body.approved})
    return {"status": "ok"}


@router.post("/dispatch")
async def dispatch(body: DispatchRequest):
    ws_path = resolve_workspace_path(body.workspace)
    job_def = _resolve_job_def(body.workspace, body.job)

    dispatch_id = secrets.token_urlsafe(8)
    event = asyncio.Event()
    _PENDING[dispatch_id] = {
        "request": body.model_dump(),
        "event": event,
        "approved": False,
    }
    _broadcast({"type": "pending", "id": dispatch_id, "request": body.model_dump()})

    try:
        await asyncio.wait_for(event.wait(), timeout=DISPATCH_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        _PENDING.pop(dispatch_id, None)
        _broadcast({"type": "expired", "id": dispatch_id})
        raise HTTPException(status_code=503, detail="No UI client confirmed within timeout") from None

    record = _PENDING.pop(dispatch_id, {})
    if not record.get("approved"):
        raise HTTPException(status_code=403, detail="Dispatch rejected by user")

    if body.branch:
        _ensure_branch(ws_path, body.branch, body.create_branch, body.base_branch)

    session_id = None
    session = None
    created = False

    if body.reuse:
        session_id, session = _find_existing_session(body.workspace, body.job)

    if session is None:
        session_id, session = _create_session(body.workspace, ws_path, body.job, job_def)
        created = True
        wait_pane_ready(session.tmux_session_name)
        if job_def.command:
            if not send_keys_to_tmux(session.tmux_session_name, job_def.command, enter=True):
                logger.warning("dispatch job launch send-keys failed session=%s", session_id)
        if body.text:
            # 新規セッションは tmux attach 直後の redraw で短い出力が消えるため、
            # WS クライアントが接続したタイミングで送る pending text に積む。
            session.pending_text = body.text
            session.pending_enter = body.enter
    elif body.text:
        if not send_keys_to_tmux(session.tmux_session_name, body.text, enter=body.enter):
            logger.warning("dispatch text send-keys failed session=%s", session_id)

    return {
        "status": "ok",
        "session_id": session_id,
        "workspace": body.workspace,
        "job": body.job,
        "created": created,
        "url": f"/?workspace={body.workspace}&session={session_id}",
        "ws_url": f"/terminal/ws/{session_id}",
    }
