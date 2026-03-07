import logging
import os
import re
import secrets
import subprocess
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import (
    MAX_TERMINAL_SESSIONS,
    TERMINAL_TIMEOUT_SEC,
    WORKSPACE_JOBS_CACHE_TTL_SEC,
    TTLCache,
    log_operation,
    resolve_workspace_path,
    sanitize_log_value,
)
from ..config import load_workspace_config_section, save_workspace_config_section
from ..git_utils import command_result_dict, get_git_branches
from ..icons import normalize_icon
from ..jobs import TERMINAL_JOB, JobDefinition
from ..runner import run_job
from .terminal import (
    TERMINAL_SESSIONS,
    TMUX_SESSION_PREFIX,
    TerminalSession,
    _sessions_lock,
    create_tmux_session,
    save_tmux_metadata,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])
_workspace_jobs_cache = TTLCache(WORKSPACE_JOBS_CACHE_TTL_SEC)


def workspace_jobs_cache_key(workspace_name):
    return (str(os.fspath(resolve_workspace_path(workspace_name))), workspace_name)


def load_workspace_jobs_data(workspace_name):
    cache_key = workspace_jobs_cache_key(workspace_name)
    cached = _workspace_jobs_cache.get(cache_key)
    if cached is not None:
        return cached
    data = load_workspace_config_section(workspace_name, "jobs", {})
    _workspace_jobs_cache.set(cache_key, data)
    return data


def save_workspace_jobs_data(workspace_name, data):
    save_workspace_config_section(workspace_name, "jobs", data)
    _workspace_jobs_cache.invalidate(workspace_jobs_cache_key(workspace_name))


def get_workspace_jobs(workspace_name):
    if not workspace_name:
        return {}
    data = load_workspace_jobs_data(workspace_name)
    jobs = {}
    for name, entry in data.items():
        jobs[name] = JobDefinition(
            command=entry.get("command", ""),
            label=entry.get("label", name),
            description=entry.get("description", ""),
            icon=entry.get("icon", ""),
            icon_color=entry.get("icon_color", ""),
            confirm=entry.get("confirm", True),
            terminal=entry.get("terminal", True),
        )
    return jobs


def job_definition_to_dict(job_def):
    return {
        "label": job_def.label,
        "description": job_def.description,
        "command": job_def.command,
        "icon": job_def.icon,
        "icon_color": job_def.icon_color,
        "confirm": job_def.confirm,
        "terminal": job_def.terminal,
    }


@router.get("/workspaces/{name}/jobs")
def list_workspace_jobs(name: str):
    resolve_workspace_path(name)
    jobs = get_workspace_jobs(name)
    return {jname: job_definition_to_dict(job_def) for jname, job_def in jobs.items()}


@router.get("/workspaces/{name}/jobs/{job_name}")
def get_workspace_job(name: str, job_name: str):
    resolve_workspace_path(name)
    jobs = get_workspace_jobs(name)
    job_def = jobs.get(job_name)
    if not job_def:
        raise HTTPException(status_code=404, detail=f"ジョブ '{job_name}' が見つかりません")
    return job_definition_to_dict(job_def)


ICON_PATTERN = re.compile(
    r"^(mdi-[a-zA-Z0-9-]+|favicon:[a-zA-Z0-9._-]+|data:image/.+|icon:[a-f0-9]{16}\.(png|jpg|gif|webp|svg))$",
)
ICON_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{3,6}$")
MAX_ICON_VALUE_LEN = 200_000


def validate_icon(icon: str) -> str:
    icon = icon.strip()
    if not icon:
        return ""
    if len(icon) > MAX_ICON_VALUE_LEN:
        raise HTTPException(status_code=400, detail="Icon value too long")
    icon = normalize_icon(icon)
    if not ICON_PATTERN.match(icon):
        raise HTTPException(status_code=400, detail=f"Invalid icon format: {icon}")
    return icon


def validate_icon_color(color: str) -> str:
    color = color.strip()
    if not color:
        return ""
    if not ICON_COLOR_PATTERN.match(color):
        raise HTTPException(status_code=400, detail=f"Invalid icon color: {color}")
    return color


def _apply_icon_fields(entry: dict, icon: str, icon_color: str) -> None:
    icon = validate_icon(icon)
    icon_color = validate_icon_color(icon_color)
    if icon:
        entry["icon"] = icon
    if icon_color:
        entry["icon_color"] = icon_color


def build_job_entry(
    command: str,
    label: str,
    icon: str,
    icon_color: str,
    confirm: bool,
    terminal: bool = True,
) -> dict:
    entry = {"command": command}
    label = label.strip()
    if label:
        entry["label"] = label
    _apply_icon_fields(entry, icon, icon_color)
    if not confirm:
        entry["confirm"] = False
    if not terminal:
        entry["terminal"] = False
    return entry


class CreateJobRequest(BaseModel):
    label: str = Field(..., max_length=200)
    command: str = Field(..., max_length=10000)
    icon: str = Field("", max_length=MAX_ICON_VALUE_LEN)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True
    terminal: bool = True


def generate_job_key(existing: dict) -> str:
    for _ in range(20):
        candidate = f"job_{secrets.token_hex(6)}"
        if candidate not in existing:
            return candidate
    return f"job_{int(time.time())}"


@router.post("/workspaces/{name}/jobs")
def create_workspace_job(name: str, body: CreateJobRequest):
    resolve_workspace_path(name)
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="表示名を入力してください")
    command = body.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="コマンドが空です")
    data = load_workspace_jobs_data(name)
    job_name = generate_job_key(data)
    data[job_name] = build_job_entry(command, label, body.icon, body.icon_color, body.confirm, body.terminal)
    save_workspace_jobs_data(name, data)
    logger.info("job created workspace=%s job=%s", name, job_name)
    return {"status": "ok", "name": job_name}


class UpdateJobRequest(BaseModel):
    label: str = Field(..., max_length=200)
    command: str = Field(..., max_length=10000)
    icon: str = Field("", max_length=MAX_ICON_VALUE_LEN)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True
    terminal: bool = True


class ReorderJobsRequest(BaseModel):
    order: list[str] = Field(default_factory=list)


@router.put("/workspaces/{name}/job-order")
def reorder_workspace_jobs(name: str, body: ReorderJobsRequest):
    resolve_workspace_path(name)
    data = load_workspace_jobs_data(name)
    existing_names = list(data.keys())
    if sorted(body.order) != sorted(existing_names):
        raise HTTPException(status_code=400, detail="ジョブ一覧が一致しません")

    reordered = {job_name: data[job_name] for job_name in body.order}
    save_workspace_jobs_data(name, reordered)
    logger.info("jobs reordered workspace=%s count=%d", name, len(body.order))
    return {"status": "ok"}


@router.put("/workspaces/{name}/jobs/{job_name}")
def update_workspace_job(name: str, job_name: str, body: UpdateJobRequest):
    resolve_workspace_path(name)
    data = load_workspace_jobs_data(name)
    if job_name not in data:
        raise HTTPException(status_code=404, detail=f"ジョブ '{job_name}' が見つかりません")
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="表示名を入力してください")
    command = body.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="コマンドが空です")
    data[job_name] = build_job_entry(command, label, body.icon, body.icon_color, body.confirm, body.terminal)
    save_workspace_jobs_data(name, data)
    logger.info("job updated workspace=%s job=%s", name, job_name)
    return {"status": "ok", "name": job_name}


@router.delete("/workspaces/{name}/jobs/{job_name}")
def delete_workspace_job(name: str, job_name: str):
    resolve_workspace_path(name)
    data = load_workspace_jobs_data(name)
    if job_name not in data:
        raise HTTPException(status_code=404, detail=f"ジョブ '{job_name}' が見つかりません")
    del data[job_name]
    save_workspace_jobs_data(name, data)
    logger.info("job deleted workspace=%s job=%s", name, job_name)
    return {"status": "ok", "name": job_name}


class RunRequest(BaseModel):
    job: str
    args: dict[str, str] = {}
    workspace: str | None = None
    icon: str | None = None
    icon_color: str | None = None
    job_name: str | None = None
    job_label: str | None = None


@router.post("/run")
def execute_job(body: RunRequest):
    ws_path = resolve_workspace_path(body.workspace)

    if body.job == "terminal":
        job_def = TERMINAL_JOB
    else:
        available_jobs = get_workspace_jobs(body.workspace)
        job_def = available_jobs.get(body.job)
        if not job_def:
            raise HTTPException(status_code=400, detail=f"Unknown job: {body.job}")

    ordered_args: list[str] = []
    for arg_option in job_def.args:
        value = body.args.get(arg_option.name)
        if value is None:
            if arg_option.required:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required argument: {arg_option.name}",
                )
            continue

        if arg_option.dynamic == "branches":
            if not ws_path:
                raise HTTPException(status_code=400, detail="Workspace is required for this job")
            allowed = get_git_branches(ws_path)
            if value not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid branch: {value}",
                )
        elif arg_option.values and value not in arg_option.values:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid value for {arg_option.name}: {value} (allowed: {arg_option.values})",
            )
        else:
            if re.search(r"[\x00-\x1f\x7f]", value):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid characters in argument: {arg_option.name}",
                )
        ordered_args.append(value)

    if body.job == "terminal":
        with _sessions_lock:
            if len(TERMINAL_SESSIONS) >= MAX_TERMINAL_SESSIONS:
                raise HTTPException(
                    status_code=429,
                    detail=f"セッション数が上限({MAX_TERMINAL_SESSIONS})に達しています",
                )
        cwd_path = str(ws_path) if ws_path else None
        session_id = secrets.token_urlsafe(24)
        tmux_name = f"{TMUX_SESSION_PREFIX}{session_id}"
        try:
            create_tmux_session(cwd_path, tmux_name)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            logger.error("tmux session creation failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to create terminal: {e}") from None
        with _sessions_lock:
            TERMINAL_SESSIONS[session_id] = TerminalSession(
                workspace=body.workspace,
                expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
                tmux_session_name=tmux_name,
                icon=body.icon,
                icon_color=body.icon_color,
                job_name=body.job_name,
                job_label=body.job_label,
            )
        save_tmux_metadata(tmux_name, body.workspace, body.icon, body.icon_color, body.job_name, body.job_label)
        action = "ジョブ実行" if body.job_name else "ターミナル起動"
        log_operation(action, body.workspace or "", body.job_label or body.job_name or job_def.label)
        logger.info("terminal session created session=%s tmux=%s workspace=%s",
                     session_id, tmux_name, body.workspace or "(none)")
        return {
            "status": "ok",
            "session_id": session_id,
            "ws_url": f"/terminal/ws/{session_id}",
            "expires_in": TERMINAL_TIMEOUT_SEC,
        }

    cwd_path = str(ws_path) if ws_path else ""
    log_operation("ジョブ実行", body.workspace or "", job_def.label)
    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    try:
        result = run_job(job_def, ordered_args, workspace=cwd_path)
    except subprocess.TimeoutExpired:
        logger.warning("job timeout job=%s workspace=%s", body.job, body.workspace or "(none)")
        raise HTTPException(status_code=504, detail="Job timed out") from None

    payload = command_result_dict(result)

    if result.returncode == 0:
        logger.info("job ok job=%s workspace=%s", body.job, body.workspace or "(none)")
    else:
        logger.warning(
            "job failed job=%s workspace=%s rc=%d stderr=%s",
            body.job, body.workspace or "(none)",
            result.returncode, sanitize_log_value(result.stderr[:200]),
        )
    return payload
