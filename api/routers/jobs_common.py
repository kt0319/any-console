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
    resolve_workspace_id,
    save_global_config_section,
    save_workspace_config_section,
)
from ..errors import bad_request, not_found
from ..git_utils import split_worktree_name
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



def resolve_jobs_owner(workspace_name: str) -> str:
    """worktree のワークスペースはベースのワークスペースとジョブを共有する。

    '{base} [{branch}]' 形式の名前からベースを取り出し、登録済みであればその名前を返す。
    """
    if not workspace_name:
        return workspace_name
    parts = split_worktree_name(workspace_name)
    if parts and resolve_workspace_id(parts[0]):
        return parts[0]
    return workspace_name


def ws_jobs_context(name):
    resolve_workspace_path(name)
    owner = resolve_jobs_owner(name)
    return load_workspace_jobs_data(owner), lambda data: save_workspace_jobs_data(owner, data), "Job"


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
        detached_tab=entry.get("detached_tab", False),
        type=entry.get("type", "command"),
        url=entry.get("url", ""),
        timeout_sec=entry.get("timeout_sec") or None,
        notify_phrase=entry.get("notify_phrase", ""),
        working_enabled=entry.get("working_enabled", True),
        notify_on_done=entry.get("notify_on_done", False),
    )


def parse_jobs_data(data):
    return {name: entry_to_job_definition(name, entry) for name, entry in data.items()}


def get_workspace_jobs(workspace_name):
    if not workspace_name:
        return {}
    common_data = load_common_jobs_data()
    ws_data = load_workspace_jobs_data(resolve_jobs_owner(workspace_name))
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
        "detached_tab": job_def.detached_tab,
        "type": job_def.type,
        "url": job_def.url,
        "timeout_sec": job_def.timeout_sec,
        "notify_phrase": job_def.notify_phrase,
        "working_enabled": job_def.working_enabled,
        "notify_on_done": job_def.notify_on_done,
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


def _apply_agent_watch_fields(
    entry: dict,
    notify_phrase: str,
    working_enabled: bool,
) -> None:
    if notify_phrase:
        entry["notify_phrase"] = notify_phrase
    if not working_enabled:
        entry["working_enabled"] = False


def build_job_entry(
    command: str,
    label: str,
    icon: str,
    icon_color: str,
    confirm: bool,
    detached_tab: bool = False,
    job_type: str = "command",
    url: str = "",
    timeout_sec: int | None = None,
    notify_phrase: str = "",
    working_enabled: bool = True,
    notify_on_done: bool = False,
) -> dict:
    entry: dict[str, Any] = {}
    if job_type == "browser":
        entry["type"] = "browser"
        entry["url"] = url
    else:
        entry["command"] = command
    label = label.strip()
    if label:
        entry["label"] = label
    _apply_icon_fields(entry, icon, icon_color)
    if not confirm:
        entry["confirm"] = False
    if detached_tab:
        entry["detached_tab"] = True
    if timeout_sec is not None:
        entry["timeout_sec"] = timeout_sec
    if notify_on_done:
        entry["notify_on_done"] = True
    _apply_agent_watch_fields(entry, notify_phrase, working_enabled)
    return entry


class JobRequest(BaseModel):
    label: str = Field(..., max_length=MAX_LABEL_LENGTH)
    type: str = Field("command", max_length=20)
    command: str = Field("", max_length=MAX_COMMAND_LENGTH)
    url: str = Field("", max_length=2000)
    icon: str = Field("", max_length=MAX_ICON_VALUE_LENGTH)
    icon_color: str = Field("", max_length=20)
    confirm: bool = True
    detached_tab: bool = False
    timeout_sec: int | None = Field(None, ge=1, le=86400)
    notify_phrase: str = Field("", max_length=200)
    working_enabled: bool = True
    notify_on_done: bool = False


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
    job_type = (body.type or "command").strip() or "command"
    if job_type == "browser":
        url = body.url.strip()
        if not url:
            raise bad_request("URL is empty")
        return label, "", job_type, url
    command = body.command.strip()
    if not command:
        raise bad_request("Command is empty")
    return label, command, "command", ""


def save_job(data, save_fn, job_name, body, log_msg):
    label, command, job_type, url = _validate_job_fields(body)
    notify_phrase = "" if job_type == "browser" else body.notify_phrase.strip()
    # notify_on_done は非ターミナル実行（detached_tab=False）の完了通知にのみ意味を持つ。
    notify_on_done = job_type != "browser" and not body.detached_tab and body.notify_on_done
    if job_name is None:
        job_name = generate_job_key(data)
    data[job_name] = build_job_entry(
        command, label, body.icon, body.icon_color, body.confirm, body.detached_tab,
        job_type=job_type, url=url, timeout_sec=body.timeout_sec,
        notify_phrase=notify_phrase,
        working_enabled=body.working_enabled if job_type != "browser" else True,
        notify_on_done=notify_on_done,
    )
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
