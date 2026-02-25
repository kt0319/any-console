import logging
import os
import re
import secrets
import signal
import subprocess
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import (
    TERMINAL_TIMEOUT_SEC,
    command_result_dict,
    get_git_branches,
    load_workspace_config_section,
    resolve_workspace_path,
    save_workspace_config_section,
)
from ..jobs import TERMINAL_JOB, JobDefinition
from ..runner import run_job
from .terminal import (
    TERMINAL_SESSIONS,
    TerminalSession,
    create_pty_session,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def load_workspace_jobs_data(workspace_name):
    return load_workspace_config_section(workspace_name, "jobs", {})


def save_workspace_jobs_data(workspace_name, data):
    save_workspace_config_section(workspace_name, "jobs", data)


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
    }


@router.get("/workspaces/{name}/jobs")
def list_workspace_jobs(name: str):
    resolve_workspace_path(name)
    jobs = get_workspace_jobs(name)
    return {jname: job_definition_to_dict(job_def) for jname, job_def in jobs.items()}


ICON_PATTERN = re.compile(r"^(mdi-[a-zA-Z0-9-]+|favicon:[a-zA-Z0-9._-]+|data:image/.+)$")
ICON_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{3,6}$")


def validate_icon(icon: str) -> str:
    icon = icon.strip()
    if not icon:
        return ""
    if len(icon) > 500:
        raise HTTPException(status_code=400, detail="Icon value too long")
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


def build_job_entry(command: str, icon: str, icon_color: str, confirm: bool) -> dict:
    entry = {"command": command}
    _apply_icon_fields(entry, icon, icon_color)
    if not confirm:
        entry["confirm"] = False
    return entry


class CreateJobRequest(BaseModel):
    name: str = Field(..., max_length=100)
    command: str = Field(..., max_length=10000)
    icon: str = Field("", max_length=500)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True


@router.post("/workspaces/{name}/jobs")
def create_workspace_job(name: str, body: CreateJobRequest):
    resolve_workspace_path(name)
    job_name = body.name.strip()
    if not job_name or not re.match(r"^[a-zA-Z0-9_-]+$", job_name):
        raise HTTPException(status_code=400, detail="ジョブ名は英数字・ハイフン・アンダースコアのみ")
    command = body.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="コマンドが空です")
    data = load_workspace_jobs_data(name)
    if job_name in data:
        raise HTTPException(status_code=409, detail=f"ジョブ '{job_name}' は既に存在します")
    data[job_name] = build_job_entry(command, body.icon, body.icon_color, body.confirm)
    save_workspace_jobs_data(name, data)
    logger.info("job created workspace=%s job=%s", name, job_name)
    return {"status": "ok", "name": job_name}


class UpdateJobRequest(BaseModel):
    command: str = Field(..., max_length=10000)
    icon: str = Field("", max_length=500)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True


@router.put("/workspaces/{name}/jobs/{job_name}")
def update_workspace_job(name: str, job_name: str, body: UpdateJobRequest):
    resolve_workspace_path(name)
    data = load_workspace_jobs_data(name)
    if job_name not in data:
        raise HTTPException(status_code=404, detail=f"ジョブ '{job_name}' が見つかりません")
    command = body.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="コマンドが空です")
    data[job_name] = build_job_entry(command, body.icon, body.icon_color, body.confirm)
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


def get_workspace_links(workspace_name):
    return load_workspace_config_section(workspace_name, "links", [])


def save_workspace_links(workspace_name, links):
    save_workspace_config_section(workspace_name, "links", links)


def normalize_url(url):
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url



def build_link_entry(label: str, url: str, icon: str, icon_color: str) -> dict:
    entry = {"label": label, "url": url}
    _apply_icon_fields(entry, icon, icon_color)
    return entry


@router.get("/workspaces/{name}/links")
def list_workspace_links(name: str):
    resolve_workspace_path(name)
    return get_workspace_links(name)


class CreateLinkRequest(BaseModel):
    label: str = Field("", max_length=200)
    url: str = Field(..., max_length=2000)
    icon: str = Field("", max_length=500)
    icon_color: str = Field("", max_length=20)


@router.post("/workspaces/{name}/links")
def create_workspace_link(name: str, body: CreateLinkRequest):
    resolve_workspace_path(name)
    label = body.label.strip()
    url = normalize_url(body.url)
    if not url:
        raise HTTPException(status_code=400, detail="URLを入力してください")
    links = get_workspace_links(name)
    links.append(build_link_entry(label, url, body.icon, body.icon_color))
    save_workspace_links(name, links)
    logger.info("link created workspace=%s label=%s", name, label)
    return {"status": "ok"}


@router.put("/workspaces/{name}/links/{index}")
def update_workspace_link(name: str, index: int, body: CreateLinkRequest):
    resolve_workspace_path(name)
    links = get_workspace_links(name)
    if index < 0 or index >= len(links):
        raise HTTPException(status_code=404, detail="リンクが見つかりません")
    url = normalize_url(body.url)
    if not url:
        raise HTTPException(status_code=400, detail="URLを入力してください")
    label = body.label.strip()
    links[index] = build_link_entry(label, url, body.icon, body.icon_color)
    save_workspace_links(name, links)
    logger.info("link updated workspace=%s index=%d", name, index)
    return {"status": "ok"}


@router.delete("/workspaces/{name}/links/{index}")
def delete_workspace_link(name: str, index: int):
    resolve_workspace_path(name)
    links = get_workspace_links(name)
    if index < 0 or index >= len(links):
        raise HTTPException(status_code=404, detail="リンクが見つかりません")
    removed = links.pop(index)
    save_workspace_links(name, links)
    logger.info("link deleted workspace=%s label=%s", name, removed.get("label", ""))
    return {"status": "ok"}


class RunRequest(BaseModel):
    job: str
    args: dict[str, str] = {}
    workspace: str | None = None
    icon: str | None = None
    icon_color: str | None = None


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
        ordered_args.append(value)

    if body.job == "terminal":
        cwd_path = str(ws_path) if ws_path else None
        session_id = secrets.token_urlsafe(24)
        try:
            fd, pid = create_pty_session(cwd_path)
        except OSError as e:
            logger.error("pty fork failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to create terminal: {e}")
        try:
            TERMINAL_SESSIONS[session_id] = TerminalSession(
                workspace=body.workspace,
                fd=fd,
                pid=pid,
                expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
                icon=body.icon,
                icon_color=body.icon_color,
            )
        except Exception:
            os.close(fd)
            try:
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            raise
        logger.info("terminal session created session=%s pid=%d workspace=%s",
                     session_id, pid, body.workspace or "(none)")
        return {
            "status": "ok",
            "session_id": session_id,
            "ws_url": f"/terminal/ws/{session_id}",
            "expires_in": TERMINAL_TIMEOUT_SEC,
        }

    cwd_path = str(ws_path) if ws_path else ""
    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    try:
        result = run_job(job_def, ordered_args, workspace=cwd_path)
    except subprocess.TimeoutExpired:
        logger.warning("job timeout job=%s workspace=%s", body.job, body.workspace or "(none)")
        raise HTTPException(status_code=504, detail="Job timed out")

    payload = command_result_dict(result)

    if result.returncode == 0:
        logger.info("job ok job=%s workspace=%s", body.job, body.workspace or "(none)")
    else:
        logger.warning("job failed job=%s workspace=%s rc=%d stderr=%s",
                        body.job, body.workspace or "(none)", result.returncode, result.stderr[:200])
    return payload
