import base64
import mimetypes
import os
import subprocess
from pathlib import Path

from ..common import (
    BINARY_EXTENSIONS,
    GIT_SHORT_TIMEOUT_SEC,
    HIDDEN_DIRS,
    IMAGE_EXTENSIONS,
    MAX_FILE_SIZE,
    MAX_IMAGE_PREVIEW_SIZE,
)
from ..errors import forbidden, server_error
from ..git_utils import run_git_command


def _build_content_response(path: str, ext: str, raw: bytes, size: int):
    filename = Path(path).name
    if ext in IMAGE_EXTENSIONS:
        if size > MAX_IMAGE_PREVIEW_SIZE:
            return {"status": "ok", "path": path, "image": True, "too_large": True, "size": size}
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        data_url = f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}"
        return {"status": "ok", "path": path, "image": True, "size": size, "mime_type": mime_type, "data_url": data_url}

    if ext in BINARY_EXTENSIONS:
        return {"status": "ok", "path": path, "binary": True, "size": size}

    if size > MAX_FILE_SIZE:
        return {"status": "ok", "path": path, "too_large": True, "size": size}

    content = raw.decode("utf-8", errors="replace")
    return {"status": "ok", "path": path, "content": content, "size": size}


def read_file_content_response(path: str, target: Path):
    try:
        size = target.stat().st_size
    except OSError:
        raise server_error("Cannot stat file") from None

    ext = target.suffix.lower()
    needs_read = not (
        ext in BINARY_EXTENSIONS
        or (ext in IMAGE_EXTENSIONS and size > MAX_IMAGE_PREVIEW_SIZE)
        or (ext not in IMAGE_EXTENSIONS and size > MAX_FILE_SIZE)
    )
    if needs_read:
        try:
            raw = target.read_bytes()
        except PermissionError:
            raise forbidden("Permission denied") from None
        except OSError:
            raise server_error("Cannot read file") from None
    else:
        raw = b""
    return _build_content_response(path, ext, raw, size)


def read_blob_content_response(path: str, raw: bytes):
    size = len(raw)
    ext = Path(path).suffix.lower()
    return _build_content_response(path, ext, raw, size)


def _get_gitignored_names(ws_path, target):
    try:
        result = run_git_command(
            ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
            cwd=target, timeout=GIT_SHORT_TIMEOUT_SEC, operation="ls-files",
        )
        if result["exit_code"] != 0:
            return set()
        names = set()
        for line in result["stdout"].splitlines():
            name = line.rstrip("/")
            if name and "/" not in name:
                names.add(name)
        return names
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return set()


def list_directory_entries(ws_path, target):
    ignored_names = _get_gitignored_names(ws_path, target)
    entries = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                if entry.name in HIDDEN_DIRS:
                    continue
                is_ignored = entry.name in ignored_names
                if entry.is_symlink():
                    item = {"name": entry.name, "type": "symlink"}
                    if is_ignored:
                        item["gitignored"] = True
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
                if is_ignored:
                    item["gitignored"] = True
                if entry_type == "file":
                    try:
                        item["size"] = entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
                entries.append(item)
    except PermissionError:
        raise forbidden("Permission denied") from None

    type_order = {"dir": 0, "symlink": 1, "file": 2}
    entries.sort(key=lambda e: (type_order.get(e["type"], 3), e["name"].lower()))
    return entries
