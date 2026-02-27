import json

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import verify_token
from .. import common

router = APIRouter(dependencies=[Depends(verify_token)])

MAX_IMPORT_SIZE = 1024 * 1024


def _existing_workspace_names() -> set[str]:
    if not common.WORK_DIR.is_dir():
        return set()
    return {d.name for d in common.WORK_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")}


@router.get("/settings/export")
def export_settings():
    config = common.load_all_config()
    existing = _existing_workspace_names()
    return {k: v for k, v in config.items() if k in existing}


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
    current = common.load_all_config()
    for name, ws_config in data.items():
        if name in existing and isinstance(ws_config, dict):
            current[name] = ws_config
    common.save_all_config(current)
    return {"status": "ok"}
