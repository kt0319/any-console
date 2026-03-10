import shutil

from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse

from ..auth import verify_token
from ..common import MAX_UPLOAD_SIZE, resolve_workspace_path
from ..errors import bad_request, conflict, forbidden, not_found, server_error, too_large
from ..validators import validate_git_ref
from .git_shared import (
    list_directory_entries,
    read_blob_content_response,
    read_file_content_response,
    resolve_and_validate_workspace_path,
    run_raw_git,
    validate_workspace_relative_target,
)

router = APIRouter(dependencies=[Depends(verify_token)])


def _git_tree_spec(ref: str, rel_path: str) -> str:
    return ref if not rel_path else f"{ref}:{rel_path}"


def list_directory_entries_at_ref(ws_path, rel_path: str, ref: str):
    tree_spec = _git_tree_spec(ref, rel_path)
    result = run_raw_git(["git", "ls-tree", "-z", tree_spec], cwd=ws_path)
    if result.returncode != 0:
        raise not_found("Directory not found")

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
    type_result = run_raw_git(["git", "cat-file", "-t", blob_spec], cwd=ws_path)
    if type_result.returncode != 0 or type_result.stdout.strip() != "blob":
        raise not_found("File not found")

    result = run_raw_git(["git", "show", blob_spec], cwd=ws_path, text=False)
    if result.returncode != 0:
        raise not_found("File not found")
    return read_blob_content_response(path, result.stdout)


@router.get("/workspaces/{name}/files")
def list_files(name: str, path: str = Query(""), ref: str | None = Query(None)):
    ws_path = resolve_workspace_path(name)
    target, rel = resolve_and_validate_workspace_path(ws_path, path)

    rel_path = str(rel)
    if rel_path == ".":
        rel_path = ""

    ref_value = validate_git_ref(ref)
    if ref_value:
        entries = list_directory_entries_at_ref(ws_path, rel_path, ref_value)
        return {"status": "ok", "path": rel_path, "entries": entries}

    if not target.is_dir():
        raise not_found("Directory not found")

    entries = list_directory_entries(ws_path, target)
    return {"status": "ok", "path": rel_path, "entries": entries}


@router.get("/workspaces/{name}/file-content")
def get_file_content(name: str, path: str = Query(...), ref: str | None = Query(None)):
    ws_path = resolve_workspace_path(name)
    target, rel = resolve_and_validate_workspace_path(ws_path, path)
    rel_path = str(rel)
    if rel_path == ".":
        raise not_found("File not found")

    ref_value = validate_git_ref(ref)
    if ref_value:
        return read_file_content_at_ref(ws_path, rel_path, ref_value)

    if target.is_symlink():
        raise bad_request("Symlinks not supported")
    if not target.is_file():
        raise not_found("File not found")
    return read_file_content_response(path, target)


@router.post("/workspaces/{name}/upload")
async def upload_file_to_workspace(
    name: str,
    path: str = Form(""),
    file: UploadFile = File(...),
):
    ws_path = resolve_workspace_path(name)
    target_dir, rel_dir = resolve_and_validate_workspace_path(ws_path, path)
    if not target_dir.is_dir():
        raise not_found("Directory not found")

    filename = (file.filename or "").strip()
    if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
        raise bad_request("Invalid file name")

    target_file = (target_dir / filename).resolve()
    validate_workspace_relative_target(ws_path, target_file)
    if target_file.exists():
        raise conflict(f"File already exists: {filename}")

    data = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(data) > MAX_UPLOAD_SIZE:
        raise too_large("File too large (max 10MB)")

    try:
        target_file.write_bytes(data)
    except PermissionError:
        raise forbidden("Permission denied") from None
    except OSError:
        raise server_error("Cannot write file") from None

    rel_path = str(rel_dir / filename)
    return {"status": "ok", "path": rel_path, "size": len(data)}


@router.post("/workspaces/{name}/rename")
def rename_file(name: str, src: str = Body(...), dest: str = Body(...)):
    ws_path = resolve_workspace_path(name)
    src_target, _ = resolve_and_validate_workspace_path(ws_path, src)
    dest_target, _ = resolve_and_validate_workspace_path(ws_path, dest)

    if not src_target.exists():
        raise not_found("Source not found")
    if not dest_target.parent.exists():
        raise bad_request("Destination directory not found")
    if dest_target.exists():
        raise conflict("Destination already exists")

    try:
        src_target.rename(dest_target)
    except PermissionError:
        raise forbidden("Permission denied") from None
    except OSError as e:
        raise server_error(f"Rename failed: {e}") from None

    return {"status": "ok"}


@router.post("/workspaces/{name}/delete-file")
def delete_file(name: str, path: str = Body(..., embed=True)):
    ws_path = resolve_workspace_path(name)
    target, _ = resolve_and_validate_workspace_path(ws_path, path)

    if not target.exists():
        raise not_found("File not found")

    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    except PermissionError:
        raise forbidden("Permission denied") from None
    except OSError as e:
        raise server_error(f"Delete failed: {e}") from None

    return {"status": "ok"}


@router.get("/workspaces/{name}/download")
def download_file(name: str, path: str = Query(...)):
    ws_path = resolve_workspace_path(name)
    target, _ = resolve_and_validate_workspace_path(ws_path, path)

    if not target.is_file():
        raise not_found("File not found")

    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type="application/octet-stream",
    )
