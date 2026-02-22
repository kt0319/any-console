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
    get_git_branches,
    resolve_workspace_path,
)
from ..jobs import TERMINAL_JOB, JobDefinition
from ..runner import run_job
from .terminal import (
    TERMINAL_SESSIONS,
    TerminalSession,
    parse_terminal_stdout,
    websockets_available,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def get_workspace_custom_jobs_dir(workspace_path):
    jobs_dir = workspace_path / WORKSPACE_JOBS_DIR
    jobs_dir.mkdir(parents=True, exist_ok=True)
    return jobs_dir


def parse_open_url(script_path):
    try:
        for line in script_path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^#\s*open-url:\s*(.+)$", line)
            if m:
                return m.group(1).strip()
    except OSError:
        pass
    return ""


def get_workspace_custom_jobs(workspace_path):
    jobs_dir = get_workspace_custom_jobs_dir(workspace_path)
    custom = {}
    for script_path in sorted(jobs_dir.glob("*.sh")):
        if not script_path.is_file():
            continue
        job_name = script_path.stem
        custom[job_name] = JobDefinition(
            script=str(script_path),
            label=job_name,
            description=f"Workspace custom job: {job_name}",
            args=[],
            script_path_override=script_path,
            open_url=parse_open_url(script_path),
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
        "open_url": job_def.open_url,
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
    open_url: str = ""


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
    open_url = body.open_url.strip()
    header = "#!/usr/bin/env bash\nset -euo pipefail\n\n"
    if not script_content.startswith("#!"):
        script_content = header + script_content
    if open_url:
        lines = script_content.split("\n")
        insert_idx = 0
        for i, line in enumerate(lines):
            if line.startswith("#!"):
                insert_idx = i + 1
                break
        lines.insert(insert_idx, f"# open-url: {open_url}")
        script_content = "\n".join(lines)
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

    workspace_path = str(ws_path) if ws_path else ""
    terminal_session_id: str | None = None
    extra_env: dict[str, str] | None = None
    if body.job == "terminal":
        if not websockets_available():
            return {
                "status": "error",
                "exit_code": 1,
                "stdout": "",
                "stderr": "server missing dependency: websockets (pip install websockets)",
            }
        terminal_session_id = secrets.token_urlsafe(24)
        extra_env = {"TERMINAL_BASE_PATH": f"/terminal/s/{terminal_session_id}"}

    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    try:
        result = run_job(job_def, ordered_args, workspace=workspace_path, extra_env=extra_env)
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

    if body.job == "terminal":
        port, pid = parse_terminal_stdout(result.stdout)
        if payload["status"] == "ok" and port:
            session_id = terminal_session_id or secrets.token_urlsafe(24)
            TERMINAL_SESSIONS[session_id] = TerminalSession(
                workspace=body.workspace,
                port=port,
                pid=pid,
                expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
            )
            payload["port"] = port
            payload["session_id"] = session_id
            payload["terminal_url"] = f"/terminal/s/{session_id}/"
            payload["expires_in"] = TERMINAL_TIMEOUT_SEC
            logger.info("terminal session created session=%s port=%d", session_id, port)
        elif payload["status"] == "ok":
            payload["status"] = "error"
            payload["stderr"] = (
                (payload.get("stderr") or "") + "\nfailed to parse ttyd port"
            ).strip()
    return payload
