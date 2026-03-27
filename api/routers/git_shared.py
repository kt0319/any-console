import base64
import logging
import mimetypes
import os
import re
import subprocess
from contextlib import contextmanager
from pathlib import Path

from ..common import GIT_LONG_TIMEOUT_SEC, GIT_SHORT_TIMEOUT_SEC, resolve_workspace_path
from ..errors import bad_request, forbidden, server_error, timeout_error
from ..git_utils import _run_git_raw, git_branch, invalidate_git_info, run_git_command

_action_logger = logging.getLogger(__name__)


def execute_git_action(name, args, *, timeout=GIT_LONG_TIMEOUT_SEC, operation="", env=None, log_extra=""):
    ws_path = resolve_workspace_path(name)
    result = run_git_command(args, cwd=ws_path, timeout=timeout, operation=operation, env=env)
    extra = f" {log_extra}" if log_extra else ""
    _action_logger.info("git %s workspace=%s%s rc=%d", operation, name, extra, result["exit_code"])
    invalidate_git_info(name)
    return result


@contextmanager
def file_operation_guard(operation_name):
    try:
        yield
    except PermissionError:
        raise forbidden("Permission denied") from None
    except OSError as e:
        raise server_error(f"{operation_name}: {e}") from None


def run_raw_git(args, cwd, text=True):
    try:
        return _run_git_raw(args, cwd, timeout=GIT_SHORT_TIMEOUT_SEC, text=text)
    except subprocess.TimeoutExpired:
        raise timeout_error("Git operation timed out") from None


MAX_DIFF_SIZE = 10 * 1024 * 1024
GIT_LOG_MAX_SKIP = 10000

HIDDEN_DIRS = {".git"}

MAX_FILE_SIZE = 512 * 1024
BINARY_EXTENSIONS = {
    ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"}
MAX_IMAGE_PREVIEW_SIZE = 5 * 1024 * 1024


def _resolve_rename_path(path: str) -> str:
    """'dir/{old => new}' 形式のリネームパスからリネーム後のパスを抽出する"""
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


def build_file_list(files_result, numstat):
    files = []
    if files_result["exit_code"] == 0:
        for f in files_result["stdout"].splitlines():
            file_name = f.strip()
            if file_name:
                files.append(build_file_entry(file_name, numstat))
    return files


def get_current_branch(ws_path):
    branch = git_branch(ws_path)
    if not branch:
        raise bad_request("現在のブランチを取得できません")
    return branch


def resolve_workspace_target_path(ws_path, path: str):
    target = (ws_path / path).resolve()
    try:
        target.relative_to(ws_path.resolve())
    except ValueError:
        raise bad_request("Invalid path") from None
    return target


def validate_workspace_relative_target(ws_path, target):
    rel = target.relative_to(ws_path.resolve())
    if any(part in HIDDEN_DIRS for part in rel.parts):
        raise bad_request("Invalid path")
    return rel


def resolve_and_validate_workspace_path(ws_path, path: str):
    target = resolve_workspace_target_path(ws_path, path)
    rel = validate_workspace_relative_target(ws_path, target)
    return target, rel


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
    except Exception:
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
