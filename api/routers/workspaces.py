import logging
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    BACKGROUND_EXECUTOR,
    BACKGROUND_FETCH_EXECUTOR,
    collapse_user_path,
    expand_workspace_path,
    generate_entity_id,
    safe_resolve_str,
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
from ..git_info import git_info_to_status_dict
from ..git_utils import (
    background_fetch,
    git_branch,
    git_default_branch,
    git_github_url,
    git_is_repo,
    git_worktree_list,
    list_git_workspace_paths,
    registered_paths_by_resolved,
    worktree_display_name,
)
from ..git_watch import notify_workspaces_changed
from ..icons import normalize_icon
from ..validators import validate_workspace_name

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def _background_fetch(dirs):
    def fetch(workspace_dir):
        if not background_fetch(workspace_dir, log_label=f"background fetch {workspace_dir.name}"):
            logger.warning("background fetch failed dir=%s", workspace_dir.name)

    list(BACKGROUND_FETCH_EXECUTOR.map(fetch, dirs))


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
    default_branch = git_default_branch(ws_path) if is_git else None
    info = {
        "id": ws_id,
        "name": config.get("name") or ws_id,
        "path": str(ws_path),
        "is_git_repo": is_git,
        "branch": branch,
        "icon": config.get("icon", ""),
        "icon_color": config.get("icon_color", ""),
        "group_id": config.get("group_id") or None,
        "exists": is_dir,
    }
    if github_url:
        info["github_url"] = github_url
    if default_branch:
        info["default_branch"] = default_branch
    return info


def _registered_workspace_paths() -> set[str]:
    """登録済みワークスペースの解決済みパス集合。動的worktreeの重複判定に使う。"""
    return set(registered_paths_by_resolved().keys())


def _dynamic_worktree_entries(
    is_git_repo_map: dict[str, bool] | None = None,
    include_github_url: bool = False,
) -> list[dict]:
    """登録済みgitワークスペースのlinked worktreeをgitから動的に列挙する。
    configに登録されていないworktreeのみを返す（登録済みパスはスキップ）。
    is_git_repo_map が渡された場合、is_git_repo の再判定（サブプロセス起動）をスキップして再利用する。
    ワークスペースごとの git worktree list 呼び出しは並列実行する。

    include_github_url は /workspaces（都度取得、頻度低）でのみ true にする
    （github_url・default_branchの解決を含む）。/workspaces/statuses は各
    パスに対して git_info()（github_url も含めて解決済み）を別途呼ぶため、
    ここでも呼ぶと同じworktreeに対しgit remote相当の呼び出しが二重になる。
    数秒間隔でポーリングされる高頻度パスでサブプロセスを増やすと実機
    Raspberry Pi の共有スレッドプール枯渇（docs/DECISIONS.md ADR #18/#19）
    を再発させかねないため、常には呼ばない。
    """
    existing_paths = _registered_workspace_paths()

    def _entries_for(item):
        ws_id, config = item
        ws_path = expand_workspace_path(config.get("path", ""))
        if not ws_path.is_dir():
            return []
        is_git = is_git_repo_map.get(ws_id, False) if is_git_repo_map is not None else git_is_repo(ws_path)
        if not is_git:
            return []
        base_name = config.get("name") or ws_id
        entries = []
        for wt in git_worktree_list(ws_path)[1:]:  # インデックス0はmain
            wt_path_str = wt.get("path", "")
            if not wt_path_str:
                continue
            wt_path = Path(wt_path_str)
            if not wt_path.is_dir() or safe_resolve_str(wt_path) in existing_paths:
                continue
            branch = wt.get("branch") or ""
            entry = {
                "id": None,
                "name": worktree_display_name(base_name, branch),
                "path": wt_path_str,
                "is_git_repo": True,
                "branch": branch,
                "icon": config.get("icon", ""),
                "icon_color": config.get("icon_color", ""),
                "exists": True,
                "worktree": True,
                "worktree_base": base_name,
                "worktree_branch": branch,
            }
            if include_github_url:
                # worktreeはmainリポジトリとgitディレクトリ（remote設定含む）を
                # 共有するため、worktree自身のパスからでも github_url /
                # default_branch を解決できる。
                if github_url := git_github_url(wt_path):
                    entry["github_url"] = github_url
                if default_branch := git_default_branch(wt_path):
                    entry["default_branch"] = default_branch
            entries.append(entry)
        return entries

    results = BACKGROUND_EXECUTOR.map(_entries_for, list_workspace_entries().items())
    return [entry for entries in results for entry in entries]


@router.get("/workspaces")
def list_workspaces():
    entries = list_workspace_entries()
    if not entries:
        return []
    workspace_order = load_global_config_section("workspace_order", [])
    sorted_items = sorted(entries.items(), key=_sort_key_by_workspace_order(workspace_order))
    result = list(BACKGROUND_EXECUTOR.map(_workspace_summary, sorted_items))
    is_git_repo_map = {r["id"]: r["is_git_repo"] for r in result}
    result.extend(_dynamic_worktree_entries(is_git_repo_map, include_github_url=True))
    git_dirs = [
        expand_workspace_path(e.get("path", ""))
        for e in entries.values()
        if expand_workspace_path(e.get("path", "")).is_dir()
    ]
    BACKGROUND_FETCH_EXECUTOR.submit(_background_fetch, git_dirs)
    return result


@router.get("/workspaces/statuses")
def list_workspace_statuses():
    items = [(path, name) for name, path in list_git_workspace_paths()]
    for wt in _dynamic_worktree_entries():
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
    group_id: str | None = None
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
        if expand_workspace_path(other_entry.get("path", "")).resolve() == abs_path:
            raise conflict(f"Path already used: {abs_path}")
    config["path"] = collapse_user_path(abs_path)


@router.put("/workspaces/{name}/config")
def update_workspace_config_endpoint(name: str, body: UpdateConfigRequest):
    config = dict(ensure_workspace_exists(name))
    config["icon"] = normalize_icon(body.icon.strip())
    config["icon_color"] = body.icon_color.strip()
    config["group_id"] = body.group_id or None

    ws_id = resolve_workspace_id(name)
    if body.name is not None:
        _apply_name_update(config, ws_id, body.name)
    if body.path is not None:
        _apply_path_update(config, ws_id, body.path)
    save_workspace_config(name, config)
    notify_workspaces_changed()
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
    new_id = generate_entity_id()
    while new_id in entries:
        new_id = generate_entity_id()
    save_workspace_config(new_id, {"name": display_name, "path": collapse_user_path(abs_path)})
    notify_workspaces_changed()
    logger.info("workspace registered id=%s name=%s path=%s", new_id, display_name, abs_path)
    return {"status": "ok", "id": new_id, "name": display_name}


@router.delete("/workspaces/{name}")
def delete_workspace(name: str):
    ensure_workspace_exists(name)
    delete_workspace_config(name)
    notify_workspaces_changed()
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

    existing = set(registered_paths_by_resolved().keys())

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
