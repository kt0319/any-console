from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from ..auth import verify_token
from ..common import resolve_workspace_path
from .git_shared import (
    MAX_WORKSPACE_UPLOAD_SIZE,
    list_directory_entries,
    read_file_content_response,
    resolve_workspace_target_path,
    validate_workspace_relative_target,
)

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/workspaces/{name}/files")
def list_files(name: str, path: str = Query("")):
    ws_path = resolve_workspace_path(name)
    target = resolve_workspace_target_path(ws_path, path)
    rel = validate_workspace_relative_target(ws_path, target)
    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    rel_path = str(rel)
    if rel_path == ".":
        rel_path = ""

    entries = list_directory_entries(ws_path, target)
    return {"status": "ok", "path": rel_path, "entries": entries}


@router.get("/workspaces/{name}/file-content")
def get_file_content(name: str, path: str = Query(...)):
    ws_path = resolve_workspace_path(name)
    target = resolve_workspace_target_path(ws_path, path)
    validate_workspace_relative_target(ws_path, target)
    if target.is_symlink():
        raise HTTPException(status_code=400, detail="Symlinks not supported")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return read_file_content_response(path, target)


@router.post("/workspaces/{name}/upload")
async def upload_file_to_workspace(
    name: str,
    path: str = Form(""),
    file: UploadFile = File(...),
):
    ws_path = resolve_workspace_path(name)
    target_dir = resolve_workspace_target_path(ws_path, path)
    rel_dir = validate_workspace_relative_target(ws_path, target_dir)
    if not target_dir.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    filename = (file.filename or "").strip()
    if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid file name")

    target_file = (target_dir / filename).resolve()
    validate_workspace_relative_target(ws_path, target_file)
    if target_file.exists():
        raise HTTPException(status_code=409, detail=f"File already exists: {filename}")

    data = await file.read(MAX_WORKSPACE_UPLOAD_SIZE + 1)
    if len(data) > MAX_WORKSPACE_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    try:
        target_file.write_bytes(data)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    except OSError:
        raise HTTPException(status_code=500, detail="Cannot write file")

    rel_path = str(rel_dir / filename)
    return {"status": "ok", "path": rel_path, "size": len(data)}
