"""ジョブ系ルーター（jobs / job_runner）の共有ロジック。

キャッシュ、I/O、シリアライズ、検証、CRUD ヘルパーをまとめる。
"""

import logging
import secrets
import time
from typing import Any

from pydantic import BaseModel, Field

from ..common import (
    MAX_COMMAND_LENGTH,
    MAX_ICON_VALUE_LENGTH,
    MAX_LABEL_LENGTH,
    WORKSPACE_JOBS_CACHE_TTL_SEC,
    TTLCache,
    resolve_workspace_path,
)
from ..config import (
    load_global_config_section,
    load_workspace_config_section,
    save_global_config_section,
    save_workspace_config_section,
)
from ..errors import bad_request, not_found
from ..job_models import JobDefinition
from ..validators import validate_icon, validate_icon_color

logger = logging.getLogger(__name__)

_workspace_jobs_cache = TTLCache(WORKSPACE_JOBS_CACHE_TTL_SEC)
_common_jobs_cache = TTLCache(WORKSPACE_JOBS_CACHE_TTL_SEC)

COMMON_JOBS_CACHE_KEY = "__common_jobs__"


def load_common_jobs_data():
    return _common_jobs_cache.get_or_set(
        COMMON_JOBS_CACHE_KEY,
        lambda: load_global_config_section("jobs", {}),
    )


def save_common_jobs_data(data):
    save_global_config_section("jobs", data)
    _common_jobs_cache.invalidate(COMMON_JOBS_CACHE_KEY)
    _workspace_jobs_cache.invalidate_all()


def load_workspace_jobs_data(workspace_name):
    return _workspace_jobs_cache.get_or_set(
        workspace_name,
        lambda: load_workspace_config_section(workspace_name, "jobs", {}),
    )


def save_workspace_jobs_data(workspace_name, data):
    save_workspace_config_section(workspace_name, "jobs", data)
    _workspace_jobs_cache.invalidate(workspace_name)


def ws_jobs_context(name):
    resolve_workspace_path(name)
    return load_workspace_jobs_data(name), lambda data: save_workspace_jobs_data(name, data), "Job"


def common_jobs_context():
    return load_common_jobs_data(), save_common_jobs_data, "Common job"


def entry_to_job_definition(name, entry):
    return JobDefinition(
        command=entry.get("command", ""),
        label=entry.get("label", name),
        description=entry.get("description", ""),
        icon=entry.get("icon", ""),
        icon_color=entry.get("icon_color", ""),
        confirm=entry.get("confirm", True),
        hidden_tab=entry.get("hidden_tab", False),
    )


def parse_jobs_data(data):
    return {name: entry_to_job_definition(name, entry) for name, entry in data.items()}


def get_common_jobs():
    return parse_jobs_data(load_common_jobs_data())


def get_workspace_jobs(workspace_name):
    if not workspace_name:
        return {}
    common_data = load_common_jobs_data()
    ws_data = load_workspace_jobs_data(workspace_name)
    merged = {}
    for name, entry in common_data.items():
        merged[name] = (entry, True)
    for name, entry in ws_data.items():
        merged[name] = (entry, False)
    return {name: (entry_to_job_definition(name, entry), is_common)
            for name, (entry, is_common) in merged.items()}


def job_definition_to_dict(job_def, is_common=None):
    d = {
        "label": job_def.label,
        "description": job_def.description,
        "command": job_def.command,
        "icon": job_def.icon,
        "icon_color": job_def.icon_color,
        "confirm": job_def.confirm,
        "hidden_tab": job_def.hidden_tab,
    }
    if is_common is not None:
        d["common"] = is_common
    return d


def serialize_workspace_jobs(workspace_name: str) -> dict:
    jobs = get_workspace_jobs(workspace_name)
    return {jname: job_definition_to_dict(job_def, is_common=is_common)
            for jname, (job_def, is_common) in jobs.items()}


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
    hidden_tab: bool = False,
) -> dict:
    entry: dict[str, Any] = {"command": command}
    label = label.strip()
    if label:
        entry["label"] = label
    _apply_icon_fields(entry, icon, icon_color)
    if not confirm:
        entry["confirm"] = False
    if hidden_tab:
        entry["hidden_tab"] = True
    return entry


class JobRequest(BaseModel):
    label: str = Field(..., max_length=MAX_LABEL_LENGTH)
    command: str = Field(..., max_length=MAX_COMMAND_LENGTH)
    icon: str = Field("", max_length=MAX_ICON_VALUE_LENGTH)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True
    hidden_tab: bool = False


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


def save_job(data, save_fn, job_name, body, log_msg):
    label, command = _validate_job_fields(body)
    if job_name is None:
        job_name = generate_job_key(data)
    data[job_name] = build_job_entry(command, label, body.icon, body.icon_color, body.confirm, body.hidden_tab)
    save_fn(data)
    logger.info(log_msg, job_name)
    return {"status": "ok", "name": job_name}


def delete_job(data, save_fn, job_name, not_found_msg, log_msg):
    if job_name not in data:
        raise not_found(not_found_msg)
    del data[job_name]
    save_fn(data)
    logger.info(log_msg, job_name)
    return {"status": "ok", "name": job_name}


def reorder_jobs(data, save_fn, order, log_msg):
    if sorted(order) != sorted(data.keys()):
        raise bad_request("Job list mismatch")
    reordered = {name: data[name] for name in order}
    save_fn(reordered)
    logger.info(log_msg, len(order))
    return {"status": "ok"}
