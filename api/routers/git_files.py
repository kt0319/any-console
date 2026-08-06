import shutil
import tempfile
import unicodedata
import zipfile
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..auth import verify_token
from ..common import HIDDEN_DIRS, MAX_UPLOAD_SIZE, MAX_ZIP_DOWNLOAD_SIZE
from ..errors import bad_request, conflict, not_found, too_large
from ..validators import validate_optional_commit_ref
from .git_file_utils import (
    list_directory_entries,
    read_blob_content_response,
    read_file_content_response,
)
from .git_helpers import (
    file_operation_guard,
    resolve_workspace_file,
    run_raw_git,
    validate_workspace_relative_target,
)

router = APIRouter(dependencies=[Depends(verify_token)])


def _git_tree_spec(ref: str, rel_path: str) -> str:
    return ref if not rel_path else f"{ref}:{rel_path}"


def list_directory_entries_at_ref(ws_path, rel_path: str, ref: str):
    tree_spec = _git_tree_spec(ref, rel_path)
    result = run_raw_git(["ls-tree", "-z", tree_spec], cwd=ws_path)
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
    type_result = run_raw_git(["cat-file", "-t", blob_spec], cwd=ws_path)
    if type_result.returncode != 0 or type_result.stdout.strip() != "blob":
        raise not_found("File not found")

    result = run_raw_git(["show", blob_spec], cwd=ws_path, text=False)
    if result.returncode != 0:
        raise not_found("File not found")
    return read_blob_content_response(path, result.stdout)


@router.get("/workspaces/{name}/files")
def list_files(name: str, path: str = Query(""), ref: str | None = Query(None)):
    ws_path, target, rel = resolve_workspace_file(name, path)

    rel_path = str(rel)
    if rel_path == ".":
        rel_path = ""

    ref_value = validate_optional_commit_ref(ref)
    if ref_value:
        entries = list_directory_entries_at_ref(ws_path, rel_path, ref_value)
        return {"status": "ok", "path": rel_path, "entries": entries}

    if not target.is_dir():
        raise not_found("Directory not found")

    entries = list_directory_entries(ws_path, target)
    return {"status": "ok", "path": rel_path, "entries": entries}


@router.get("/workspaces/{name}/file-content")
def get_file_content(name: str, path: str = Query(...), ref: str | None = Query(None)):
    ws_path, target, rel = resolve_workspace_file(name, path)
    rel_path = str(rel)
    if rel_path == ".":
        raise not_found("File not found")

    ref_value = validate_optional_commit_ref(ref)
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
    overwrite: bool = Form(False),
    file: UploadFile = File(...),
):
    ws_path, target_dir, rel_dir = resolve_workspace_file(name, path)
    if target_dir.exists() and not target_dir.is_dir():
        raise bad_request(f"Not a directory: {path}")
    if not target_dir.is_dir():
        # フォルダをまとめてドロップした時、サブディレクトリがまだ無ければ
        # アップロードと同時に作成する（フラットな単一ファイルアップロード
        # では既存ディレクトリへの書き込みのみになりこの分岐は通らない）。
        with file_operation_guard("Cannot create directory"):
            target_dir.mkdir(parents=True, exist_ok=True)

    filename = unicodedata.normalize("NFC", (file.filename or "").strip())
    if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
        raise bad_request("Invalid file name")

    target_file = (target_dir / filename).resolve()
    validate_workspace_relative_target(ws_path, target_file)
    if target_file.exists():
        if target_file.is_dir():
            raise conflict(f"Directory exists at: {filename}")
        if not overwrite:
            raise conflict(f"File already exists: {filename}")

    data = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(data) > MAX_UPLOAD_SIZE:
        raise too_large("File too large (max 10MB)")

    with file_operation_guard("Cannot write file"):
        target_file.write_bytes(data)

    rel_path = str(rel_dir / filename)
    return {"status": "ok", "path": rel_path, "size": len(data)}


@router.post("/workspaces/{name}/rename")
def rename_file(name: str, src: str = Body(...), dest: str = Body(...)):
    ws_path, src_target, _ = resolve_workspace_file(name, src)
    _, dest_target, _ = resolve_workspace_file(name, dest)

    if not src_target.exists():
        raise not_found("Source not found")
    if not dest_target.parent.exists():
        raise bad_request("Destination directory not found")
    if dest_target.exists():
        raise conflict("Destination already exists")

    with file_operation_guard("Rename failed"):
        src_target.rename(dest_target)

    return {"status": "ok"}


@router.post("/workspaces/{name}/delete-file")
def delete_file(name: str, path: str = Body(..., embed=True)):
    _, target, _ = resolve_workspace_file(name, path)

    if not target.exists():
        raise not_found("File not found")

    with file_operation_guard("Delete failed"):
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()

    return {"status": "ok"}


@router.get("/workspaces/{name}/download")
def download_file(name: str, path: str = Query(...)):
    _, target, _ = resolve_workspace_file(name, path)

    if target.is_file():
        return FileResponse(
            path=str(target),
            filename=target.name,
            media_type="application/octet-stream",
        )

    if target.is_dir():
        tmp_dir = tempfile.mkdtemp(prefix="any-console-zip-")
        try:
            with file_operation_guard("Cannot create archive"):
                archive_path = _create_zip_archive(target, Path(tmp_dir))
        except BaseException:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise
        return FileResponse(
            path=str(archive_path),
            filename=f"{target.name}.zip",
            media_type="application/zip",
            background=BackgroundTask(shutil.rmtree, tmp_dir, ignore_errors=True),
        )

    raise not_found("File not found")


def _create_zip_archive(target: Path, tmp_dir: Path) -> Path:
    """ディレクトリを zip 化する。shutil.make_archive は使わない:

    - HIDDEN_DIRS（.git）は中身ごと除外する（ファイル一覧APIの表示規則と揃える。
      make_archive だと一覧に見えない .git がまるごと zip に入ってしまう）
    - symlink は辿らずスキップする（リンク先の実体を格納するとワークスペース外の
      ファイルが混入しうるため）
    - 圧縮前サイズの合計が MAX_ZIP_DOWNLOAD_SIZE を超えたら 413 を返す
      （node_modules 等を含む巨大ディレクトリでワーカーを占有しないため）
    """
    archive_path = tmp_dir / f"{target.name}.zip"
    total_size = 0
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
        stack = [target]
        while stack:
            current = stack.pop()
            zf.mkdir(str(current.relative_to(target.parent)))
            for entry in sorted(current.iterdir(), key=lambda p: p.name):
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if entry.name in HIDDEN_DIRS:
                        continue
                    stack.append(entry)
                elif entry.is_file():
                    total_size += entry.stat().st_size
                    if total_size > MAX_ZIP_DOWNLOAD_SIZE:
                        raise too_large(
                            f"Folder too large to download (max {MAX_ZIP_DOWNLOAD_SIZE // (1024 * 1024)}MB)"
                        )
                    zf.write(entry, str(entry.relative_to(target.parent)))
    return archive_path
