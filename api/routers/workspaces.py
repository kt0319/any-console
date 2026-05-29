import logging
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    BACKGROUND_EXECUTOR,
    BACKGROUND_FETCH_TIMEOUT_SEC,
    generate_workspace_id,
    run_subprocess_safe,
)
from ..config import (
    delete_workspace_config,
    ensure_workspace_exists,
    list_workspace_entries,
    load_global_config_section,
    resolve_workspace_id,
    save_global_config_section,
    save_workspace_config,
)
from ..errors import bad_request, conflict
from ..git_utils import (
    git_branch,
    git_github_url,
    git_info_to_status_dict,
    git_is_repo,
    git_worktree_list,
)
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
    ws_id, config = item
    ws_path = Path(config.get("path", ""))
    is_dir = ws_path.is_dir()
    is_git = git_is_repo(ws_path) if is_dir else False
    branch = git_branch(ws_path) if is_git else None
    github_url = git_github_url(ws_path) if is_git else None
    info = {
        "id": ws_id,
        "name": config.get("name") or ws_id,
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


def _dynamic_worktree_entries(existing_paths: set[str]) -> list[dict]:
    """登録済みgitワークスペースのlinked worktreeをgitから動的に列挙する。
    configに登録されていないworktreeのみを返す（既存パスはスキップ）。
    """
    entries = list_workspace_entries()
    result = []
    for ws_id, config in entries.items():
        ws_path = Path(config.get("path", ""))
        if not ws_path.is_dir() or not git_is_repo(ws_path):
            continue
        base_name = config.get("name") or ws_id
        for wt in git_worktree_list(ws_path)[1:]:  # インデックス0はmain
            wt_path_str = wt.get("path", "")
            if not wt_path_str:
                continue
            wt_path = Path(wt_path_str)
            if not wt_path.is_dir():
                continue
            try:
                resolved = str(wt_path.resolve())
            except OSError:
                resolved = wt_path_str
            if resolved in existing_paths:
                continue
            branch = wt.get("branch") or ""
            result.append({
                "id": None,
                "name": f"{base_name} [{branch}]",
                "path": wt_path_str,
                "is_git_repo": True,
                "branch": branch,
                "icon": config.get("icon", ""),
                "icon_color": config.get("icon_color", ""),
                "hidden": False,
                "exists": True,
                "worktree": True,
                "worktree_base": base_name,
                "worktree_branch": branch,
            })
    return result


@router.get("/workspaces")
def list_workspaces():
    entries = list_workspace_entries()
    if not entries:
        return []
    workspace_order = load_global_config_section("workspace_order", [])
    sorted_items = sorted(entries.items(), key=_sort_key_by_workspace_order(workspace_order))
    result = list(BACKGROUND_EXECUTOR.map(_workspace_summary, sorted_items))
    existing_paths: set[str] = set()
    for r in result:
        try:
            existing_paths.add(str(Path(r["path"]).resolve()))
        except OSError:
            existing_paths.add(r["path"])
    result.extend(_dynamic_worktree_entries(existing_paths))
    git_dirs = [Path(e.get("path", "")) for e in entries.values() if Path(e.get("path", "")).is_dir()]
    BACKGROUND_EXECUTOR.submit(_background_fetch, git_dirs)
    return result



@router.get("/workspaces/statuses")
def list_workspace_statuses():
    entries = list_workspace_entries()
    items = []
    existing_paths: set[str] = set()
    for ws_id, config in entries.items():
        ws_path = Path(config.get("path", ""))
        if ws_path.is_dir() and git_is_repo(ws_path):
            display_name = config.get("name") or ws_id
            items.append((ws_path, display_name))
            try:
                existing_paths.add(str(ws_path.resolve()))
            except OSError:
                existing_paths.add(str(ws_path))
    for wt in _dynamic_worktree_entries(existing_paths):
        items.append((Path(wt["path"]), wt["name"]))

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
    name: str | None = None
    path: str | None = None


def _apply_name_update(config: dict, ws_id: str | None, new_name_raw: str) -> None:
    new_name = validate_workspace_name(new_name_raw)
    for other_id, other_entry in list_workspace_entries().items():
        if other_id == ws_id:
            continue
        if other_entry.get("name") == new_name:
            raise conflict(f"'{new_name}' is already registered")
    config["name"] = new_name


def _apply_path_update(config: dict, ws_id: str | None, new_path_raw: str) -> None:
    new_path = new_path_raw.strip()
    if not new_path:
        raise bad_request("Path is required")
    abs_path = Path(new_path).expanduser().resolve()
    if not abs_path.is_dir():
        raise bad_request(f"Directory does not exist: {new_path}")
    for other_id, other_entry in list_workspace_entries().items():
        if other_id == ws_id:
            continue
        if Path(other_entry.get("path", "")).resolve() == abs_path:
            raise conflict(f"Path already used: {abs_path}")
    config["path"] = str(abs_path)


@router.put("/workspaces/{name}/config")
def update_workspace_config_endpoint(name: str, body: UpdateConfigRequest):
    config = dict(ensure_workspace_exists(name))
    config["icon"] = normalize_icon(body.icon.strip())
    config["icon_color"] = body.icon_color.strip()
    config["hidden"] = body.hidden
    ws_id = resolve_workspace_id(name)
    if body.name is not None:
        _apply_name_update(config, ws_id, body.name)
    if body.path is not None:
        _apply_path_update(config, ws_id, body.path)
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
    display_name = validate_workspace_name(body.name or abs_path.name)
    entries = list_workspace_entries()
    for entry in entries.values():
        if entry.get("name") == display_name:
            raise conflict(f"'{display_name}' is already registered")
    new_id = generate_workspace_id()
    while new_id in entries:
        new_id = generate_workspace_id()
    save_workspace_config(new_id, {"name": display_name, "path": str(abs_path)})
    logger.info("workspace registered id=%s name=%s path=%s", new_id, display_name, abs_path)
    return {"status": "ok", "id": new_id, "name": display_name}


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
        return Path.home(), ""
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
