import logging
import re
import secrets
import subprocess
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import (
    GLOBAL_CONFIG_KEY,
    MAX_COMMAND_LENGTH,
    MAX_ICON_VALUE_LENGTH,
    MAX_LABEL_LENGTH,
    MAX_TERMINAL_SESSIONS,
    TERMINAL_TIMEOUT_SEC,
    TMUX_SESSION_PREFIX,
    WORKSPACE_JOBS_CACHE_TTL_SEC,
    TTLCache,
    resolve_workspace_path,
    sanitize_log_value,
)
from ..config import (
    load_all_config,
    load_global_config_section,
    load_workspace_config_section,
    save_global_config_section,
    save_workspace_config_section,
)
from ..errors import bad_request, not_found, server_error, timeout_error, too_many_requests
from ..git_utils import command_result_dict, git_branches
from ..job_models import TERMINAL_JOB, JobDefinition
from ..runner import run_job
from ..terminal_session import (
    TERMINAL_SESSIONS,
    TerminalSession,
    sessions_lock,
)
from ..tmux import create_tmux_session
from ..validators import validate_icon, validate_icon_color

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])
_workspace_jobs_cache = TTLCache(WORKSPACE_JOBS_CACHE_TTL_SEC)
_global_jobs_cache = TTLCache(WORKSPACE_JOBS_CACHE_TTL_SEC)

GLOBAL_JOBS_CACHE_KEY = "__global_jobs__"


def _cached_load(cache, key, loader):
    cached = cache.get(key)
    if cached is not None:
        return cached
    data = loader()
    cache.set(key, data)
    return data


def load_global_jobs_data():
    return _cached_load(_global_jobs_cache, GLOBAL_JOBS_CACHE_KEY,
                        lambda: load_global_config_section("jobs", {}))


def save_global_jobs_data(data):
    save_global_config_section("jobs", data)
    _global_jobs_cache.invalidate(GLOBAL_JOBS_CACHE_KEY)
    _workspace_jobs_cache.invalidate_all()


def load_workspace_jobs_data(workspace_name):
    return _cached_load(_workspace_jobs_cache, workspace_name,
                        lambda: load_workspace_config_section(workspace_name, "jobs", {}))


def save_workspace_jobs_data(workspace_name, data):
    save_workspace_config_section(workspace_name, "jobs", data)
    _workspace_jobs_cache.invalidate(workspace_name)


def _ws_jobs_context(name):
    resolve_workspace_path(name)
    return load_workspace_jobs_data(name), lambda data: save_workspace_jobs_data(name, data)


def _entry_to_job_definition(name, entry):
    return JobDefinition(
        command=entry.get("command", ""),
        label=entry.get("label", name),
        description=entry.get("description", ""),
        icon=entry.get("icon", ""),
        icon_color=entry.get("icon_color", ""),
        confirm=entry.get("confirm", True),
        terminal=entry.get("terminal", True),
    )


def _parse_jobs_data(data):
    return {name: _entry_to_job_definition(name, entry) for name, entry in data.items()}


def get_global_jobs():
    return _parse_jobs_data(load_global_jobs_data())


def get_workspace_jobs(workspace_name):
    if not workspace_name:
        return {}
    global_data = load_global_jobs_data()
    ws_data = load_workspace_jobs_data(workspace_name)
    merged = {}
    for name, entry in global_data.items():
        merged[name] = (entry, True)
    for name, entry in ws_data.items():
        merged[name] = (entry, False)
    jobs = {}
    for name, (entry, is_global) in merged.items():
        jobs[name] = _entry_to_job_definition(name, entry)
        jobs[name]._is_global = is_global
    return jobs


def job_definition_to_dict(job_def, include_global=False):
    d = {
        "label": job_def.label,
        "description": job_def.description,
        "command": job_def.command,
        "icon": job_def.icon,
        "icon_color": job_def.icon_color,
        "confirm": job_def.confirm,
        "terminal": job_def.terminal,
    }
    if include_global:
        d["global"] = getattr(job_def, "_is_global", False)
    return d


def serialize_workspace_jobs(workspace_name: str) -> dict:
    jobs = get_workspace_jobs(workspace_name)
    return {jname: job_definition_to_dict(job_def, include_global=True) for jname, job_def in jobs.items()}


@router.get("/jobs/workspaces")
def list_all_workspace_jobs():
    all_config = load_all_config()
    global_jobs_data = all_config.get(GLOBAL_CONFIG_KEY, {}).get("jobs", {})
    result = {}
    for name in sorted(all_config.keys()):
        if name == GLOBAL_CONFIG_KEY or not isinstance(all_config[name], dict):
            continue
        ws_jobs_data = all_config[name].get("jobs", {})
        merged = {}
        for is_global, jobs_data in [(True, global_jobs_data), (False, ws_jobs_data)]:
            for jname, entry in jobs_data.items():
                job = _entry_to_job_definition(jname, entry)
                job._is_global = is_global
                merged[jname] = job
        result[name] = {
            jname: job_definition_to_dict(jdef, include_global=True)
            for jname, jdef in merged.items()
        }
    return result


@router.get("/workspaces/{name}/jobs")
def list_workspace_jobs(name: str):
    resolve_workspace_path(name)
    return serialize_workspace_jobs(name)


@router.get("/workspaces/{name}/jobs/{job_name}")
def get_workspace_job(name: str, job_name: str):
    resolve_workspace_path(name)
    jobs = get_workspace_jobs(name)
    job_def = jobs.get(job_name)
    if not job_def:
        raise not_found(f"Job '{job_name}' not found")
    return job_definition_to_dict(job_def)


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


class JobRequest(BaseModel):
    label: str = Field(..., max_length=MAX_LABEL_LENGTH)
    command: str = Field(..., max_length=MAX_COMMAND_LENGTH)
    icon: str = Field("", max_length=MAX_ICON_VALUE_LENGTH)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True
    terminal: bool = True


class ReorderJobsRequest(BaseModel):
    order: list[str] = Field(default_factory=list)


def generate_job_key(existing: dict) -> str:
    for _ in range(20):
        candidate = f"job_{secrets.token_hex(6)}"
        if candidate not in existing:
            return candidate
    return f"job_{int(time.time())}"


def _validate_job_fields(body):
    label = body.label.strip()
    if not label:
        raise bad_request("Please enter a display name")
    command = body.command.strip()
    if not command:
        raise bad_request("Command is empty")
    return label, command


def _create_job(data, save_fn, body, log_msg):
    label, command = _validate_job_fields(body)
    job_name = generate_job_key(data)
    data[job_name] = build_job_entry(command, label, body.icon, body.icon_color, body.confirm, body.terminal)
    save_fn(data)
    logger.info(log_msg, job_name)
    return {"status": "ok", "name": job_name}


def _update_job(data, save_fn, job_name, body, not_found_msg, log_msg):
    if job_name not in data:
        raise not_found(not_found_msg)
    label, command = _validate_job_fields(body)
    data[job_name] = build_job_entry(command, label, body.icon, body.icon_color, body.confirm, body.terminal)
    save_fn(data)
    logger.info(log_msg, job_name)
    return {"status": "ok", "name": job_name}


def _delete_job(data, save_fn, job_name, not_found_msg, log_msg):
    if job_name not in data:
        raise not_found(not_found_msg)
    del data[job_name]
    save_fn(data)
    logger.info(log_msg, job_name)
    return {"status": "ok", "name": job_name}


def _reorder_jobs(data, save_fn, order, log_msg):
    if sorted(order) != sorted(data.keys()):
        raise bad_request("Job list mismatch")
    reordered = {name: data[name] for name in order}
    save_fn(reordered)
    logger.info(log_msg, len(order))
    return {"status": "ok"}


@router.post("/workspaces/{name}/jobs")
def create_workspace_job(name: str, body: JobRequest):
    data, save_fn = _ws_jobs_context(name)
    return _create_job(data, save_fn, body, "job created workspace=%s job=%%s" % name)


@router.put("/workspaces/{name}/job-order")
def reorder_workspace_jobs(name: str, body: ReorderJobsRequest):
    data, save_fn = _ws_jobs_context(name)
    return _reorder_jobs(data, save_fn, body.order, "jobs reordered workspace=%s count=%%d" % name)


@router.put("/workspaces/{name}/jobs/{job_name}")
def update_workspace_job(name: str, job_name: str, body: JobRequest):
    data, save_fn = _ws_jobs_context(name)
    return _update_job(data, save_fn, job_name, body,
                       f"Job '{job_name}' not found",
                       "job updated workspace=%s job=%%s" % name)


@router.delete("/workspaces/{name}/jobs/{job_name}")
def delete_workspace_job(name: str, job_name: str):
    data, save_fn = _ws_jobs_context(name)
    return _delete_job(data, save_fn, job_name,
                       f"Job '{job_name}' not found",
                       "job deleted workspace=%s job=%%s" % name)


@router.get("/global/jobs")
def list_global_jobs():
    data = load_global_jobs_data()
    jobs = _parse_jobs_data(data)
    return {jname: job_definition_to_dict(jdef) for jname, jdef in jobs.items()}


@router.post("/global/jobs")
def create_global_job(body: JobRequest):
    data = load_global_jobs_data()
    return _create_job(data, save_global_jobs_data, body, "global job created job=%s")


@router.put("/global/jobs/{job_name}")
def update_global_job(job_name: str, body: JobRequest):
    data = load_global_jobs_data()
    return _update_job(data, save_global_jobs_data, job_name, body,
                       f"Global job '{job_name}' not found",
                       "global job updated job=%s")


@router.delete("/global/jobs/{job_name}")
def delete_global_job(job_name: str):
    data = load_global_jobs_data()
    return _delete_job(data, save_global_jobs_data, job_name,
                       f"Global job '{job_name}' not found",
                       "global job deleted job=%s")


@router.put("/global/job-order")
def reorder_global_jobs(body: ReorderJobsRequest):
    data = load_global_jobs_data()
    return _reorder_jobs(data, save_global_jobs_data, body.order, "global jobs reordered count=%d")


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
    safe_name = body.workspace.replace(".", "_") if body.workspace else None
    session_id = f"{safe_name}-{short_id}" if safe_name else short_id
    tmux_name = f"{TMUX_SESSION_PREFIX}{session_id}"
    try:
        create_tmux_session(cwd_path, tmux_name)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        logger.error("tmux session creation failed: %s", e)
        raise server_error(f"Failed to create terminal: {e}") from None
    session = TerminalSession(
        workspace=body.workspace,
        expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
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
        "expires_in": TERMINAL_TIMEOUT_SEC,
    }


def _run_regular_job(body, job_def, ordered_args, ws_path):
    cwd_path = str(ws_path) if ws_path else ""
    logger.info("job start job=%s workspace=%s", body.job, body.workspace or "(none)")
    try:
        result = run_job(job_def, ordered_args, workspace=cwd_path)
    except subprocess.TimeoutExpired:
        logger.warning("job timeout job=%s workspace=%s", body.job, body.workspace or "(none)")
        raise timeout_error("Job timed out") from None

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


@router.post("/run")
def execute_job(body: RunRequest):
    ws_path = resolve_workspace_path(body.workspace)

    if body.job == "terminal":
        job_def = TERMINAL_JOB
    else:
        available_jobs = get_workspace_jobs(body.workspace)
        job_def = available_jobs.get(body.job)
        if not job_def:
            raise bad_request(f"Unknown job: {body.job}")

    ordered_args = _validate_job_args(job_def, body.args, ws_path)

    if body.job == "terminal":
        return _create_terminal_session(body, ws_path)

    return _run_regular_job(body, job_def, ordered_args, ws_path)
