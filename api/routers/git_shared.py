import base64
import mimetypes
import os
import re
import subprocess
from pathlib import Path

from fastapi import HTTPException

from ..common import BRANCH_NAME_PATTERN, GIT_SHORT_TIMEOUT_SEC, run_git_command

STASH_REF_PATTERN = re.compile(r"^stash@\{\d+\}$")


def run_git_subprocess(args, cwd, text=True):
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=text,
            timeout=GIT_SHORT_TIMEOUT_SEC,
            cwd=str(cwd),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Git operation timed out")
MAX_DIFF_SIZE = 10 * 1024 * 1024
GIT_LOG_MAX_SKIP = 10000

HIDDEN_DIRS = {".git"}

MAX_FILE_SIZE = 512 * 1024
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"}
MAX_IMAGE_PREVIEW_SIZE = 5 * 1024 * 1024
MAX_WORKSPACE_UPLOAD_SIZE = 10 * 1024 * 1024


def _resolve_rename_path(path: str) -> str:
    """'dir/{old => new}' 形式のリネームパスからリネーム後のパスを抽出する"""
    import re
    m = re.search(r'\{[^}]* => ([^}]*)\}', path)
    if not m:
        return path
    new_name = m.group(1).strip()
    return path[:m.start()] + new_name + path[m.end():]


def parse_numstat(stdout: str) -> dict[str, dict[str, int | None]]:
    stats: dict[str, dict[str, int | None]] = {}
    for line in stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 2)
        if len(parts) < 3:
            continue
        ins_raw, del_raw, path = parts
        if not path:
            continue
        insertions = None if ins_raw == "-" else int(ins_raw or 0)
        deletions = None if del_raw == "-" else int(del_raw or 0)
        stat = {"insertions": insertions, "deletions": deletions}
        stats[path] = stat
        resolved = _resolve_rename_path(path)
        if resolved != path:
            stats[resolved] = stat
    return stats


def parse_numstat_result(result: dict[str, object]) -> dict[str, dict[str, int | None]]:
    if result.get("exit_code") != 0:
        return {}
    stdout = result.get("stdout")
    return parse_numstat(stdout) if isinstance(stdout, str) else {}


def build_file_entry(
    name: str,
    numstat: dict[str, dict[str, int | None]],
    status: str | None = None,
) -> dict[str, str | int | None]:
    stat = numstat.get(name, {})
    entry: dict[str, str | int | None] = {
        "name": name,
        "insertions": stat.get("insertions"),
        "deletions": stat.get("deletions"),
    }
    if status is not None:
        entry["status"] = status
    return entry


def validate_branch_name(branch: str) -> str:
    branch = branch.strip()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch is required")
    if not BRANCH_NAME_PATTERN.match(branch):
        raise HTTPException(status_code=400, detail=f"Invalid branch name: {branch}")
    return branch


def get_current_branch(ws_path):
    result = run_git_command(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=ws_path, operation="current branch",
    )
    branch = result["stdout"].strip()
    if result["exit_code"] != 0 or not branch:
        raise HTTPException(status_code=400, detail="現在のブランチを取得できません")
    return branch


def resolve_workspace_target_path(ws_path, path: str):
    target = (ws_path / path).resolve()
    try:
        target.relative_to(ws_path.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    return target


def validate_workspace_relative_target(ws_path, target):
    rel = target.relative_to(ws_path.resolve())
    if any(part in HIDDEN_DIRS for part in rel.parts):
        raise HTTPException(status_code=400, detail="Invalid path")
    return rel


def resolve_and_validate_workspace_path(ws_path, path: str):
    target = resolve_workspace_target_path(ws_path, path)
    rel = validate_workspace_relative_target(ws_path, target)
    return target, rel


def read_file_content_response(path: str, target: Path):
    try:
        size = target.stat().st_size
    except OSError:
        raise HTTPException(status_code=500, detail="Cannot stat file")

    ext = target.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        if size > MAX_IMAGE_PREVIEW_SIZE:
            return {"status": "ok", "path": path, "image": True, "too_large": True, "size": size}
        try:
            raw = target.read_bytes()
        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied")
        except OSError:
            raise HTTPException(status_code=500, detail="Cannot read file")
        mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data_url = f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}"
        return {"status": "ok", "path": path, "image": True, "size": size, "mime_type": mime_type, "data_url": data_url}

    if ext in BINARY_EXTENSIONS:
        return {"status": "ok", "path": path, "binary": True, "size": size}

    if size > MAX_FILE_SIZE:
        return {"status": "ok", "path": path, "too_large": True, "size": size}

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"status": "ok", "path": path, "content": content, "size": size}


def read_blob_content_response(path: str, raw: bytes):
    size = len(raw)
    ext = Path(path).suffix.lower()
    name = Path(path).name

    if ext in IMAGE_EXTENSIONS:
        if size > MAX_IMAGE_PREVIEW_SIZE:
            return {"status": "ok", "path": path, "image": True, "too_large": True, "size": size}
        mime_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        data_url = f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}"
        return {"status": "ok", "path": path, "image": True, "size": size, "mime_type": mime_type, "data_url": data_url}

    if ext in BINARY_EXTENSIONS:
        return {"status": "ok", "path": path, "binary": True, "size": size}

    if size > MAX_FILE_SIZE:
        return {"status": "ok", "path": path, "too_large": True, "size": size}

    content = raw.decode("utf-8", errors="replace")
    return {"status": "ok", "path": path, "content": content, "size": size}


def list_directory_entries(ws_path, target):
    entries = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name in HIDDEN_DIRS:
                    continue
                if entry.is_symlink():
                    item = {"name": entry.name, "type": "symlink"}
                    try:
                        target_raw = os.readlink(entry.path)
                        item["link_target"] = target_raw
                        resolved = (target / target_raw).resolve()
                        try:
                            rel_target = resolved.relative_to(ws_path.resolve())
                            rel_target_path = str(rel_target)
                            item["target_path"] = "" if rel_target_path == "." else rel_target_path
                            if resolved.is_dir():
                                item["target_type"] = "dir"
                            elif resolved.is_file():
                                item["target_type"] = "file"
                            else:
                                item["target_type"] = "missing"
                        except ValueError:
                            item["target_type"] = "outside"
                    except OSError:
                        item["target_type"] = "missing"
                    entries.append(item)
                    continue

                entry_type = "dir" if entry.is_dir(follow_symlinks=False) else "file"
                item = {"name": entry.name, "type": entry_type}
                if entry_type == "file":
                    try:
                        item["size"] = entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
                entries.append(item)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    type_order = {"dir": 0, "symlink": 1, "file": 2}
    entries.sort(key=lambda e: (type_order.get(e["type"], 3), e["name"].lower()))
    return entries
