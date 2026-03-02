import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import GLOBAL_CONFIG_KEY, WORK_DIR
from ..config import (
    load_all_config,
    load_global_config_section,
    save_all_config,
    save_global_config_section,
)

router = APIRouter(dependencies=[Depends(verify_token)])

MAX_IMPORT_SIZE = 1024 * 1024


def _existing_workspace_names() -> set[str]:
    if not WORK_DIR.is_dir():
        return set()
    return {d.name for d in WORK_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")}


@router.get("/settings/export")
def export_settings():
    config = load_all_config()
    existing = _existing_workspace_names()
    exported = {k: v for k, v in config.items() if k in existing}
    if isinstance(config.get(GLOBAL_CONFIG_KEY), dict):
        exported[GLOBAL_CONFIG_KEY] = config[GLOBAL_CONFIG_KEY]
    return exported


@router.post("/settings/import")
async def import_settings(request: Request):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_IMPORT_SIZE:
        raise HTTPException(status_code=413, detail="Import data too large (max 1MB)")
    body = await request.body()
    if len(body) > MAX_IMPORT_SIZE:
        raise HTTPException(status_code=413, detail="Import data too large (max 1MB)")
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Expected JSON object")
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
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok"}


class SnippetItem(BaseModel):
    label: str = Field("", max_length=200)
    command: str = Field(..., max_length=10000)


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
        sanitized.append({"label": label[:200], "command": command[:10000]})
    return {"snippets": sanitized}


@router.put("/snippets")
def put_snippets(body: UpdateSnippetsRequest):
    snippets: list[dict] = []
    for item in body.snippets:
        command = item.command.strip()
        if not command:
            continue
        label = item.label.strip() or (command[:20] + ("..." if len(command) > 20 else ""))
        snippets.append({"label": label[:200], "command": command[:10000]})
    save_global_config_section("snippets", snippets)
    return {"status": "ok", "snippets": snippets}
