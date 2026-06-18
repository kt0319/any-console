import json
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth as auth_module
from ..auth import verify_token
from ..common import GLOBAL_CONFIG_KEY, MAX_COMMAND_LENGTH, MAX_LABEL_LENGTH
from ..config import (
    check_config_health,
    find_workspace_key,
    load_all_config,
    load_global_config_section,
    save_all_config,
    save_global_config_section,
)
from ..errors import bad_request, too_large

router = APIRouter(dependencies=[Depends(verify_token)])

_LABEL_PREVIEW_LEN = 20


def _default_label(command: str) -> str:
    return command[:_LABEL_PREVIEW_LEN] + ("..." if len(command) > _LABEL_PREVIEW_LEN else "")

MAX_IMPORT_SIZE = 1024 * 1024
MAX_TOKEN_LENGTH = 256


@router.get("/settings/auth")
def get_auth_settings():
    return {"auth_required": bool(auth_module.ANY_CONSOLE_TOKEN)}


class AuthSettings(BaseModel):
    enabled: bool
    token: str = Field("", max_length=MAX_TOKEN_LENGTH)


@router.put("/settings/auth")
def put_auth_settings(body: AuthSettings):
    if body.enabled and not body.token.strip():
        raise bad_request("Token is required when authentication is enabled")
    new_token = body.token.strip() if body.enabled else ""
    auth_module.update_token(new_token)
    return {"auth_required": bool(new_token)}


@router.get("/settings/config-health")
def get_config_health():
    return check_config_health()


@router.get("/settings/export")
def export_settings():
    return load_all_config()


async def _parse_import_body(request: Request) -> dict:
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_IMPORT_SIZE:
        raise too_large("Import data too large (max 1MB)")
    body = await request.body()
    if len(body) > MAX_IMPORT_SIZE:
        raise too_large("Import data too large (max 1MB)")
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        raise bad_request("Invalid JSON") from None
    if not isinstance(data, dict):
        raise bad_request("Expected JSON object")
    return data


def _apply_import_entry(current: dict, identifier: str, ws_config) -> None:
    if identifier == GLOBAL_CONFIG_KEY and isinstance(ws_config, dict):
        current[identifier] = ws_config
        return
    if not isinstance(ws_config, dict):
        return
    target_id = find_workspace_key(current, identifier)
    if target_id is None:
        return
    if not Path(current[target_id].get("path", "")).is_dir():
        return
    merged = {**current[target_id], **ws_config}
    merged["name"] = current[target_id].get("name") or target_id
    current[target_id] = merged


@router.post("/settings/import")
async def import_settings(request: Request):
    data = await _parse_import_body(request)
    current = load_all_config()
    for identifier, ws_config in data.items():
        _apply_import_entry(current, identifier, ws_config)
    try:
        save_all_config(current)
    except ValueError as e:
        raise bad_request(str(e)) from None
    return {"status": "ok"}


class EditorSettings(BaseModel):
    url_template: str = Field("", max_length=2000)


@router.get("/settings/editor")
def get_editor_settings():
    editor = load_global_config_section("editor", {})
    if not isinstance(editor, dict):
        editor = {}
    url_template = editor.get("url_template", "")
    return {"url_template": url_template}


@router.put("/settings/editor")
def put_editor_settings(body: EditorSettings):
    url_template = body.url_template.strip()
    save_global_config_section("editor", {"url_template": url_template})
    return {"status": "ok", "url_template": url_template}


RADIAL_KEY_COUNT = 8
RADIAL_SPECIAL_COUNT = 4
RADIAL_LABEL_MAX = 20
RADIAL_ACTION_MAX = 60
RADIAL_KEY_NAME_MAX = 30


class RadialKeyDef(BaseModel):
    key: str = Field(..., max_length=RADIAL_KEY_NAME_MAX)
    ctrl: bool = False
    shift: bool = False
    label: str = Field("", max_length=RADIAL_LABEL_MAX)


class RadialSpecialDef(BaseModel):
    label: str = Field(..., max_length=RADIAL_LABEL_MAX)
    action: str = Field(..., max_length=RADIAL_ACTION_MAX)
    payload: dict | None = None


class RadialSettings(BaseModel):
    keys: list[RadialKeyDef] = Field(default_factory=list)
    specials: list[RadialSpecialDef] = Field(default_factory=list)


@router.get("/settings/radial")
def get_radial_settings():
    raw = load_global_config_section("radial", {})
    if not isinstance(raw, dict):
        raw = {}
    keys = raw.get("keys") if isinstance(raw.get("keys"), list) else []
    specials = raw.get("specials") if isinstance(raw.get("specials"), list) else []
    return {"keys": keys, "specials": specials}


@router.put("/settings/radial")
def put_radial_settings(body: RadialSettings):
    if len(body.keys) not in (0, RADIAL_KEY_COUNT):
        raise bad_request(f"keys must have 0 or {RADIAL_KEY_COUNT} items")
    if len(body.specials) not in (0, RADIAL_SPECIAL_COUNT):
        raise bad_request(f"specials must have 0 or {RADIAL_SPECIAL_COUNT} items")
    save_global_config_section("radial", body.model_dump())
    return {"status": "ok"}


MAX_RECENT_JOBS = 5
MAX_RECENT_JOB_COMMAND_LENGTH = 10000


class RecentJobItem(BaseModel):
    key: str = Field(..., max_length=400)
    workspace: str = Field(..., max_length=200)
    wsIcon: str = Field("", max_length=MAX_LABEL_LENGTH)
    wsIconColor: str = Field("", max_length=50)
    jobName: str = Field(..., max_length=200)
    jobLabel: str = Field("", max_length=MAX_LABEL_LENGTH)
    jobIcon: str = Field("", max_length=MAX_LABEL_LENGTH)
    jobIconColor: str = Field("", max_length=50)
    jobCommand: str = Field("", max_length=MAX_RECENT_JOB_COMMAND_LENGTH)
    jobConfirm: bool | None = None
    jobHiddenTab: bool = False


@router.get("/recent-jobs")
def get_recent_jobs():
    jobs = load_global_config_section("recent_jobs", [])
    if not isinstance(jobs, list):
        jobs = []
    return {"jobs": jobs[:MAX_RECENT_JOBS]}


@router.post("/recent-jobs")
def record_recent_job(item: RecentJobItem):
    jobs = load_global_config_section("recent_jobs", [])
    if not isinstance(jobs, list):
        jobs = []
    jobs = [j for j in jobs if isinstance(j, dict) and j.get("key") != item.key]
    jobs.insert(0, item.model_dump())
    jobs = jobs[:MAX_RECENT_JOBS]
    save_global_config_section("recent_jobs", jobs)
    return {"jobs": jobs}


class SnippetItem(BaseModel):
    label: str = Field("", max_length=MAX_LABEL_LENGTH)
    command: str = Field(..., max_length=MAX_COMMAND_LENGTH)


class UpdateSnippetsRequest(BaseModel):
    snippets: list[SnippetItem] = Field(default_factory=list)


@router.get("/snippets")
def get_snippets():
    snippets = load_global_config_section("snippets", [])
    if not isinstance(snippets, list):
        snippets = []
    sanitized: list[dict] = []
    for item in snippets:
        if not isinstance(item, dict):
            continue
        command = str(item.get("command", "")).strip()
        if not command:
            continue
        label = str(item.get("label", "")).strip()
        if not label:
            label = _default_label(command)
        sanitized.append({"label": label[:MAX_LABEL_LENGTH], "command": command[:MAX_COMMAND_LENGTH]})
    return {"snippets": sanitized}


@router.put("/snippets")
def put_snippets(body: UpdateSnippetsRequest):
    snippets: list[dict] = []
    for item in body.snippets:
        command = item.command.strip()
        if not command:
            continue
        label = item.label.strip() or _default_label(command)
        snippets.append({"label": label[:MAX_LABEL_LENGTH], "command": command[:MAX_COMMAND_LENGTH]})
    save_global_config_section("snippets", snippets)
    return {"status": "ok", "snippets": snippets}

