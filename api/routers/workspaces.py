import logging
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    BACKGROUND_EXECUTOR,
    BACKGROUND_FETCH_TIMEOUT_SEC,
    default_workspace_dir,
    run_subprocess_safe,
)
from ..config import (
    delete_workspace_config,
    ensure_workspace_exists,
    list_workspace_entries,
    load_global_config_section,
    save_global_config_section,
    save_workspace_config,
)
from ..errors import bad_request, conflict
from ..git_utils import git_branch, git_github_url, git_info_to_status_dict, git_is_repo
from ..icons import normalize_icon
from ..validators import validate_workspace_name

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def _background_fetch(dirs):
    def fetch(workspace_dir):
        if run_subprocess_safe(
            ["git", "fetch", "--quiet"],
            timeout=BACKGROUND_FETCH_TIMEOUT_SEC, cwd=str(workspace_dir),
            log_label=f"background fetch {workspace_dir.name}",
        ) is None:
            logger.warning("background fetch failed dir=%s", workspace_dir.name)

    list(BACKGROUND_EXECUTOR.map(fetch, dirs))


def _sort_key_by_workspace_order(order_list):
    order_map = {name: i for i, name in enumerate(order_list)}

    def key(item):
        name = item[0] if isinstance(item, tuple) else (item.name if hasattr(item, "name") else str(item))
        if name in order_map:
            return (0, order_map[name], name)
        return (1, 0, name)

    return key


def _workspace_summary(item):
    name, config = item
    ws_path = Path(config.get("path", ""))
    is_dir = ws_path.is_dir()
    is_git = git_is_repo(ws_path) if is_dir else False
    branch = git_branch(ws_path) if is_git else None
    github_url = git_github_url(ws_path) if is_git else None
    info = {
        "name": name,
        "path": str(ws_path),
        "is_git_repo": is_git,
        "branch": branch,
        "icon": config.get("icon", ""),
        "icon_color": config.get("icon_color", ""),
        "hidden": config.get("hidden", False),
        "exists": is_dir,
    }
    if github_url:
        info["github_url"] = github_url
    return info


@router.get("/workspaces")
def list_workspaces():
    entries = list_workspace_entries()
    if not entries:
        return []
    workspace_order = load_global_config_section("workspace_order", [])
    sorted_items = sorted(entries.items(), key=_sort_key_by_workspace_order(workspace_order))
    result = list(BACKGROUND_EXECUTOR.map(_workspace_summary, sorted_items))
    git_dirs = [Path(e.get("path", "")) for e in entries.values() if Path(e.get("path", "")).is_dir()]
    BACKGROUND_EXECUTOR.submit(_background_fetch, git_dirs)
    return result


@router.get("/workspaces/statuses")
def list_workspace_statuses():
    entries = list_workspace_entries()
    items = []
    for name, config in entries.items():
        ws_path = Path(config.get("path", ""))
        if ws_path.is_dir() and git_is_repo(ws_path):
            items.append((ws_path, name))

    def _get_status(item):
        return git_info_to_status_dict(item[0], item[1])

    statuses = list(BACKGROUND_EXECUTOR.map(_get_status, items))
    return {"statuses": statuses}


class WorkspaceOrderRequest(BaseModel):
    order: list[str]


@router.put("/workspace-order")
def update_workspace_order(body: WorkspaceOrderRequest):
    save_global_config_section("workspace_order", body.order)
    logger.info("workspace order updated count=%d", len(body.order))
    return {"status": "ok"}


class UpdateConfigRequest(BaseModel):
    icon: str = ""
    icon_color: str = ""
    hidden: bool = False


@router.put("/workspaces/{name}/config")
def update_workspace_config_endpoint(name: str, body: UpdateConfigRequest):
    config = dict(ensure_workspace_exists(name))
    config["icon"] = normalize_icon(body.icon.strip())
    config["icon_color"] = body.icon_color.strip()
    config["hidden"] = body.hidden
    save_workspace_config(name, config)
    logger.info("workspace config updated workspace=%s", name)
    return {"status": "ok"}


class AddWorkspaceRequest(BaseModel):
    path: str
    name: str | None = None


@router.post("/workspaces")
def add_workspace(body: AddWorkspaceRequest):
    existing_path = (body.path or "").strip()
    if not existing_path:
        raise bad_request("Please enter a path")
    abs_path = Path(existing_path).expanduser().resolve()
    if not abs_path.is_dir():
        raise bad_request(f"Directory does not exist: {existing_path}")
    dir_name = validate_workspace_name(body.name or abs_path.name)
    if dir_name in list_workspace_entries():
        raise conflict(f"'{dir_name}' is already registered")
    save_workspace_config(dir_name, {"path": str(abs_path)})
    logger.info("workspace registered name=%s path=%s", dir_name, abs_path)
    return {"status": "ok", "name": dir_name}


@router.delete("/workspaces/{name}")
def delete_workspace(name: str):
    ensure_workspace_exists(name)
    delete_workspace_config(name)
    logger.info("workspace deleted name=%s", name)
    return {"status": "ok"}


_SUGGEST_LIMIT = 50


def _resolve_suggest_base(input_path: str) -> tuple[Path, str]:
    """入力パスから「列挙するディレクトリ」と「フィルタ文字列」を決める。

    - 空: デフォルト(ホーム)を列挙、フィルタなし
    - 既存ディレクトリ(末尾 / 有無問わず): そこを列挙、フィルタなし
    - 中途半端なパス: 親を列挙、最後の要素でフィルタ
    """
    raw = (input_path or "").strip()
    if not raw:
        return default_workspace_dir(), ""
    trimmed = raw.rstrip("/") or "/"
    p = Path(trimmed).expanduser()
    if p.is_dir():
        return p, ""
    parent = p.parent if p.parent != p else p
    return parent, p.name


@router.get("/workspaces/suggest")
def suggest_workspace_dirs(path: str = ""):
    base, filter_str = _resolve_suggest_base(path)
    try:
        base = base.resolve()
    except (OSError, RuntimeError):
        return {"base": str(base), "entries": []}
    if not base.is_dir():
        return {"base": str(base), "entries": []}

    existing = set()
    for cfg in list_workspace_entries().values():
        p = Path(cfg.get("path", ""))
        try:
            existing.add(str(p.resolve()))
        except OSError:
            existing.add(str(p))

    entries = []
    try:
        for child in sorted(base.iterdir(), key=lambda c: c.name.lower()):
            if not child.is_dir() or child.name.startswith("."):
                continue
            if filter_str and not child.name.lower().startswith(filter_str.lower()):
                continue
            entries.append({
                "path": str(child),
                "name": child.name,
                "is_git": (child / ".git").is_dir(),
                "registered": str(child) in existing,
            })
            if len(entries) >= _SUGGEST_LIMIT:
                break
    except (OSError, PermissionError):
        return {"base": str(base), "entries": []}
    return {"base": str(base), "entries": entries}
