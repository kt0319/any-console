import json
import logging
import re
import secrets
import subprocess
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    TERMINAL_TIMEOUT_SEC,
    WORKSPACE_JOBS_DIR,
    WORKSPACE_LINKS_FILE,
    get_git_branches,
    resolve_workspace_path,
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


def get_workspace_custom_jobs_dir(workspace_path):
    jobs_dir = workspace_path / WORKSPACE_JOBS_DIR
    jobs_dir.mkdir(parents=True, exist_ok=True)
    return jobs_dir


def parse_script_metadata(script_path):
    metadata = {"open_url": "", "icon": "", "icon_color": ""}
    try:
        content = script_path.read_text(encoding="utf-8")
    except OSError:
        return metadata
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            if stripped and not stripped.startswith("set "):
                break
            continue
        if stripped.startswith("# open-url:"):
            metadata["open_url"] = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("# icon-color:"):
            metadata["icon_color"] = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("# icon:"):
            metadata["icon"] = stripped.split(":", 1)[1].strip()
    return metadata


def get_workspace_custom_jobs(workspace_path):
    jobs_dir = get_workspace_custom_jobs_dir(workspace_path)
    custom = {}
    for script_path in sorted(jobs_dir.glob("*.sh")):
        if not script_path.is_file():
            continue
        job_name = script_path.stem
        metadata = parse_script_metadata(script_path)
        custom[job_name] = JobDefinition(
            script=str(script_path),
            label=job_name,
            description=f"Workspace custom job: {job_name}",
            args=[],
            script_path_override=script_path,
            icon=metadata["icon"],
            icon_color=metadata["icon_color"],
        )
    return custom


def get_workspace_jobs(workspace_path):
    if not workspace_path:
        return {}
    return get_workspace_custom_jobs(workspace_path)


def read_script_content(job_def):
    try:
        return job_def.script_path.read_text(encoding="utf-8")
    except OSError:
        return ""


def job_definition_to_dict(job_def):
    return {
        "label": job_def.label,
        "description": job_def.description,
        "script": job_def.script,
        "script_content": read_script_content(job_def),
        "icon": job_def.icon,
        "icon_color": job_def.icon_color,
        "args": [
            {
                "name": arg.name,
                "values": arg.values,
                "required": arg.required,
                "dynamic": arg.dynamic,
            }
            for arg in job_def.args
        ],
    }


@router.get("/workspaces/{name}/jobs")
def list_workspace_jobs(name: str):
    ws_path = resolve_workspace_path(name)
    jobs = get_workspace_jobs(ws_path)
    return {name: job_definition_to_dict(job_def) for name, job_def in jobs.items()}


class CreateJobRequest(BaseModel):
    name: str
    label: str = ""
    script: str
    icon: str = ""
    icon_color: str = ""


@router.post("/workspaces/{name}/jobs")
def create_workspace_job(name: str, body: CreateJobRequest):
    ws_path = resolve_workspace_path(name)
    job_name = body.name.strip()
    if not job_name or not re.match(r"^[a-zA-Z0-9_-]+$", job_name):
        raise HTTPException(status_code=400, detail="ジョブ名は英数字・ハイフン・アンダースコアのみ")
    jobs_dir = get_workspace_custom_jobs_dir(ws_path)
    script_path = jobs_dir / f"{job_name}.sh"
    if script_path.exists():
        raise HTTPException(status_code=409, detail=f"ジョブ '{job_name}' は既に存在します")
    script_content = body.script.strip()
    if not script_content:
        raise HTTPException(status_code=400, detail="スクリプト内容が空です")
    header = "#!/usr/bin/env bash\nset -euo pipefail\n"
    icon = body.icon.strip()
    icon_color = body.icon_color.strip()
    metadata_lines = ""
    if icon:
        metadata_lines += f"# icon: {icon}\n"
    if icon_color:
        metadata_lines += f"# icon-color: {icon_color}\n"
    if not script_content.startswith("#!"):
        header += metadata_lines + "\n"
        script_content = header + script_content
    elif metadata_lines:
        lines = script_content.split("\n", 1)
        rest = lines[1] if len(lines) > 1 else ""
        script_content = f"{lines[0]}\n{metadata_lines}{rest}"
    script_path.write_text(script_content + "\n", encoding="utf-8")
    script_path.chmod(0o755)
    logger.info("job created workspace=%s job=%s", name, job_name)
    return {"status": "ok", "name": job_name}


@router.delete("/workspaces/{name}/jobs/{job_name}")
def delete_workspace_job(name: str, job_name: str):
    ws_path = resolve_workspace_path(name)
    jobs_dir = get_workspace_custom_jobs_dir(ws_path)
    script_path = jobs_dir / f"{job_name}.sh"
    if not script_path.is_file():
        raise HTTPException(status_code=404, detail=f"ジョブ '{job_name}' が見つかりません")
    script_path.unlink()
    logger.info("job deleted workspace=%s job=%s", name, job_name)
    return {"status": "ok", "name": job_name}


def get_workspace_links(workspace_path):
    links_file = workspace_path / WORKSPACE_LINKS_FILE
    if not links_file.is_file():
        return []
    try:
        return json.loads(links_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def save_workspace_links(workspace_path, links):
    links_file = workspace_path / WORKSPACE_LINKS_FILE
    links_file.parent.mkdir(parents=True, exist_ok=True)
    links_file.write_text(json.dumps(links, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_url(url):
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url


@router.get("/workspaces/{name}/links")
def list_workspace_links(name: str):
    ws_path = resolve_workspace_path(name)
    return get_workspace_links(ws_path)


class CreateLinkRequest(BaseModel):
    label: str = ""
    url: str
    icon: str = ""
    icon_color: str = ""


@router.post("/workspaces/{name}/links")
def create_workspace_link(name: str, body: CreateLinkRequest):
    ws_path = resolve_workspace_path(name)
    label = body.label.strip()
    url = normalize_url(body.url)
    if not url:
        raise HTTPException(status_code=400, detail="URLを入力してください")
    links = get_workspace_links(ws_path)
    link_entry = {"label": label, "url": url}
    icon = body.icon.strip()
    if icon:
        link_entry["icon"] = icon
    icon_color = body.icon_color.strip()
    if icon_color:
        link_entry["icon_color"] = icon_color
    links.append(link_entry)
    save_workspace_links(ws_path, links)
    logger.info("link created workspace=%s label=%s", name, label)
    return {"status": "ok"}


@router.delete("/workspaces/{name}/links/{index}")
def delete_workspace_link(name: str, index: int):
    ws_path = resolve_workspace_path(name)
    links = get_workspace_links(ws_path)
    if index < 0 or index >= len(links):
        raise HTTPException(status_code=404, detail="リンクが見つかりません")
    removed = links.pop(index)
    save_workspace_links(ws_path, links)
    logger.info("link deleted workspace=%s label=%s", name, removed.get("label", ""))
    return {"status": "ok"}


class RunRequest(BaseModel):
    job: str
    args: dict[str, str] = {}
    workspace: str | None = None


@router.post("/run")
def execute_job(body: RunRequest):
    ws_path = resolve_workspace_path(body.workspace)

    if body.job == "terminal":
        job_def = TERMINAL_JOB
    else:
        available_jobs = get_workspace_jobs(ws_path)
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
        workspace_str = str(ws_path) if ws_path else None
        session_id = secrets.token_urlsafe(24)
        try:
            fd, pid = create_pty_session(workspace_str)
        except OSError as e:
            logger.error("pty fork failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to create terminal: {e}")
        TERMINAL_SESSIONS[session_id] = TerminalSession(
            workspace=body.workspace,
            fd=fd,
            pid=pid,
            expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
        )
        logger.info("terminal session created session=%s pid=%d workspace=%s",
                     session_id, pid, body.workspace or "(none)")
        return {
            "status": "ok",
            "session_id": session_id,
            "ws_url": f"/terminal/ws/{session_id}",
            "expires_in": TERMINAL_TIMEOUT_SEC,
        }

    workspace_path = str(ws_path) if ws_path else ""
    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    try:
        result = run_job(job_def, ordered_args, workspace=workspace_path)
    except subprocess.TimeoutExpired:
        logger.warning("job timeout job=%s workspace=%s", body.job, body.workspace or "(none)")
        raise HTTPException(status_code=504, detail="Job timed out")

    payload = {
        "status": "ok" if result.returncode == 0 else "error",
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }

    if result.returncode == 0:
        logger.info("job ok job=%s workspace=%s", body.job, body.workspace or "(none)")
    else:
        logger.warning("job failed job=%s workspace=%s rc=%d stderr=%s",
                        body.job, body.workspace or "(none)", result.returncode, result.stderr[:200])
    return payload
