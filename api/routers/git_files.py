import subprocess

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ..auth import verify_token
from ..common import GIT_SHORT_TIMEOUT_SEC, resolve_workspace_path, validate_commit_hash
from .git_shared import (
    MAX_WORKSPACE_UPLOAD_SIZE,
    STASH_REF_PATTERN,
    list_directory_entries,
    read_blob_content_response,
    read_file_content_response,
    resolve_workspace_target_path,
    validate_workspace_relative_target,
)

router = APIRouter(dependencies=[Depends(verify_token)])


def validate_git_ref(ref: str | None) -> str | None:
    value = (ref or "").strip()
    if not value:
        return None
    if STASH_REF_PATTERN.match(value):
        return value
    return validate_commit_hash(value)


def _git_tree_spec(ref: str, rel_path: str) -> str:
    return ref if not rel_path else f"{ref}:{rel_path}"


def list_directory_entries_at_ref(ws_path, rel_path: str, ref: str):
    tree_spec = _git_tree_spec(ref, rel_path)
    if rel_path:
        type_result = subprocess.run(
            ["git", "cat-file", "-t", tree_spec],
            capture_output=True,
            text=True,
            timeout=GIT_SHORT_TIMEOUT_SEC,
            cwd=str(ws_path),
        )
        if type_result.returncode != 0 or type_result.stdout.strip() != "tree":
            raise HTTPException(status_code=404, detail="Directory not found")

    result = subprocess.run(
        ["git", "ls-tree", "-z", tree_spec],
        capture_output=True,
        text=True,
        timeout=GIT_SHORT_TIMEOUT_SEC,
        cwd=str(ws_path),
    )
    if result.returncode != 0:
        raise HTTPException(status_code=404, detail="Directory not found")

    entries = []
    for record in result.stdout.split("\0"):
        if not record:
            continue
        try:
            meta, entry_name = record.split("\t", 1)
            _mode, obj_type, _sha = meta.split(" ", 2)
        except ValueError:
            continue
        entries.append({
            "name": entry_name,
            "type": "dir" if obj_type == "tree" else "file",
        })
    entries.sort(key=lambda e: (0 if e["type"] == "dir" else 1, e["name"].lower()))
    return entries


def read_file_content_at_ref(ws_path, path: str, ref: str):
    blob_spec = _git_tree_spec(ref, path)
    type_result = subprocess.run(
        ["git", "cat-file", "-t", blob_spec],
        capture_output=True,
        text=True,
        timeout=GIT_SHORT_TIMEOUT_SEC,
        cwd=str(ws_path),
    )
    if type_result.returncode != 0 or type_result.stdout.strip() != "blob":
        raise HTTPException(status_code=404, detail="File not found")

    result = subprocess.run(
        ["git", "show", blob_spec],
        capture_output=True,
        text=False,
        timeout=GIT_SHORT_TIMEOUT_SEC,
        cwd=str(ws_path),
    )
    if result.returncode != 0:
        raise HTTPException(status_code=404, detail="File not found")
    return read_blob_content_response(path, result.stdout)


@router.get("/workspaces/{name}/files")
def list_files(name: str, path: str = Query(""), ref: str | None = Query(None)):
    ws_path = resolve_workspace_path(name)
    target = resolve_workspace_target_path(ws_path, path)
    rel = validate_workspace_relative_target(ws_path, target)

    rel_path = str(rel)
    if rel_path == ".":
        rel_path = ""

    ref_value = validate_git_ref(ref)
    if ref_value:
        entries = list_directory_entries_at_ref(ws_path, rel_path, ref_value)
        return {"status": "ok", "path": rel_path, "entries": entries}

    if not target.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    entries = list_directory_entries(ws_path, target)
    return {"status": "ok", "path": rel_path, "entries": entries}


@router.get("/workspaces/{name}/file-content")
def get_file_content(name: str, path: str = Query(...), ref: str | None = Query(None)):
    ws_path = resolve_workspace_path(name)
    target = resolve_workspace_target_path(ws_path, path)

    rel = validate_workspace_relative_target(ws_path, target)
    rel_path = str(rel)
    if rel_path == ".":
        raise HTTPException(status_code=404, detail="File not found")

    ref_value = validate_git_ref(ref)
    if ref_value:
        return read_file_content_at_ref(ws_path, rel_path, ref_value)

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


@router.get("/workspaces/{name}/download")
def download_file(name: str, path: str = Query(...)):
    ws_path = resolve_workspace_path(name)
    target = resolve_workspace_target_path(ws_path, path)
    validate_workspace_relative_target(ws_path, target)

    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type="application/octet-stream",
    )
