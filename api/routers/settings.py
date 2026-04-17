import json
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import GLOBAL_CONFIG_KEY, MAX_COMMAND_LENGTH, MAX_LABEL_LENGTH
from ..config import (
    list_workspace_entries,
    load_all_config,
    load_global_config_section,
    save_all_config,
    save_global_config_section,
)
from ..errors import bad_request, too_large

router = APIRouter(dependencies=[Depends(verify_token)])

MAX_IMPORT_SIZE = 1024 * 1024


def _existing_workspace_names() -> set[str]:
    entries = list_workspace_entries()
    return {name for name, cfg in entries.items() if Path(cfg.get("path", "")).is_dir()}


@router.get("/settings/export")
def export_settings():
    return load_all_config()


@router.post("/settings/import")
async def import_settings(request: Request):
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
    existing = _existing_workspace_names()
    current = load_all_config()
    for name, ws_config in data.items():
        if name == GLOBAL_CONFIG_KEY and isinstance(ws_config, dict):
            current[name] = ws_config
            continue
        if name in existing and isinstance(ws_config, dict):
            current[name] = ws_config
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
            label = command[:20] + ("..." if len(command) > 20 else "")
        sanitized.append({"label": label[:MAX_LABEL_LENGTH], "command": command[:MAX_COMMAND_LENGTH]})
    return {"snippets": sanitized}


@router.put("/snippets")
def put_snippets(body: UpdateSnippetsRequest):
    snippets: list[dict] = []
    for item in body.snippets:
        command = item.command.strip()
        if not command:
            continue
        label = item.label.strip() or (command[:20] + ("..." if len(command) > 20 else ""))
        snippets.append({"label": label[:MAX_LABEL_LENGTH], "command": command[:MAX_COMMAND_LENGTH]})
    save_global_config_section("snippets", snippets)
    return {"status": "ok", "snippets": snippets}
