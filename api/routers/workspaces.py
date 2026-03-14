import json
import logging
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    BACKGROUND_EXECUTOR,
    BACKGROUND_FETCH_TIMEOUT_SEC,
    GIT_CLONE_TIMEOUT_SEC,
    GITHUB_CLI_REPO_LIMIT,
    GITHUB_CLI_TIMEOUT_SEC,
    GITHUB_REPOS_CACHE_TTL_SEC,
    default_workspace_dir,
    TTLCache,
    resolve_workspace_path,
    sanitize_log_value,
)
from ..config import (
    delete_workspace_config,
    list_workspace_entries,
    load_global_config_section,
    load_workspace_config,
    save_global_config_section,
    save_workspace_config,
)
from ..errors import bad_request, conflict, server_error, timeout_error
from ..git_utils import command_result_dict, git_branch, git_github_url, git_info_to_status_dict, git_is_repo
from ..icons import normalize_icon

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

_github_repos_cache = TTLCache(GITHUB_REPOS_CACHE_TTL_SEC)


def _background_fetch(dirs):
    def fetch(workspace_dir):
        try:
            subprocess.run(
                ["git", "fetch", "--quiet"],
                capture_output=True, text=True,
                timeout=BACKGROUND_FETCH_TIMEOUT_SEC, cwd=str(workspace_dir),
            )
        except (subprocess.TimeoutExpired, OSError) as e:
            logger.warning("background fetch failed dir=%s: %s", workspace_dir.name, e)

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
    entries = list_workspace_entries()
    if name not in entries:
        raise bad_request(f"ワークスペース '{name}' が見つかりません")
    config = load_workspace_config(name)
    config["icon"] = normalize_icon(body.icon.strip())
    config["icon_color"] = body.icon_color.strip()
    config["hidden"] = body.hidden
    save_workspace_config(name, config)
    logger.info("workspace config updated workspace=%s", name)
    return {"status": "ok"}


class AddWorkspaceRequest(BaseModel):
    url: str | None = None
    name: str | None = None
    path: str | None = None


@router.post("/workspaces")
def add_workspace(body: AddWorkspaceRequest):
    url = (body.url or "").strip()
    existing_path = (body.path or "").strip()

    github_url_match = re.match(r"https?://github\.com/(.+?)/?$", url)
    if url and github_url_match:
        url = f"git@github.com:{github_url_match.group(1)}.git"

    if existing_path:
        abs_path = Path(existing_path).expanduser().resolve()
        if not abs_path.is_dir():
            raise bad_request(f"ディレクトリが存在しません: {existing_path}")
        dir_name = body.name.strip() if body.name else abs_path.name
        if not dir_name:
            raise bad_request("ワークスペース名を指定してください")
        entries = list_workspace_entries()
        if dir_name in entries:
            raise conflict(f"'{dir_name}' は既に登録されています")
        save_workspace_config(dir_name, {"path": str(abs_path)})
        logger.info("workspace registered name=%s path=%s", dir_name, abs_path)
        return {"status": "ok", "name": dir_name, "mode": "existing"}

    if body.name:
        dir_name = body.name.strip()
    elif url:
        dir_name = url.rstrip("/").split("/")[-1].removesuffix(".git")
    else:
        raise bad_request("URLまたはディレクトリ名を入力してください")

    if not dir_name or not re.match(r"^[a-zA-Z0-9_.-]+$", dir_name):
        raise bad_request("無効なディレクトリ名です")

    entries = list_workspace_entries()
    if dir_name in entries:
        raise conflict(f"'{dir_name}' は既に登録されています")

    target_path = default_workspace_dir() / dir_name
    if target_path.exists():
        raise conflict(f"'{dir_name}' は既に存在します")

    default_workspace_dir().mkdir(parents=True, exist_ok=True)

    if not url:
        target_path.mkdir(parents=False, exist_ok=False)
        save_workspace_config(dir_name, {"path": str(target_path)})
        logger.info("workspace dir created dir=%s", dir_name)
        return {"status": "ok", "name": dir_name, "mode": "directory"}

    try:
        result = subprocess.run(
            ["git", "clone", "--", url, str(target_path)],
            capture_output=True, text=True,
            timeout=GIT_CLONE_TIMEOUT_SEC, cwd=str(default_workspace_dir()),
        )
        resp = command_result_dict(result)
        if result.returncode != 0:
            logger.warning(
                "clone failed url=%s rc=%d stderr=%s",
                url, result.returncode, sanitize_log_value(result.stderr),
            )
        else:
            save_workspace_config(dir_name, {"path": str(target_path)})
            logger.info("clone ok dir=%s", dir_name)
            resp["name"] = dir_name
        return resp
    except subprocess.TimeoutExpired:
        raise timeout_error("Clone timed out") from None


@router.delete("/workspaces/{name}")
def delete_workspace(name: str):
    entries = list_workspace_entries()
    if name not in entries:
        raise bad_request(f"ワークスペース '{name}' が見つかりません")
    delete_workspace_config(name)
    logger.info("workspace deleted name=%s", name)
    return {"status": "ok"}


@router.get("/github/repos")
def list_github_repos():
    cached = _github_repos_cache.get("repos")
    if cached is not None:
        return cached
    try:
        all_repos = []

        result = subprocess.run(
            ["gh", "repo", "list", "--limit", str(GITHUB_CLI_REPO_LIMIT), "--json", "nameWithOwner,url,description"],
            capture_output=True, text=True, timeout=GITHUB_CLI_TIMEOUT_SEC,
        )
        if result.returncode == 0:
            all_repos.extend(json.loads(result.stdout))

        org_result = subprocess.run(
            ["gh", "org", "list"],
            capture_output=True, text=True, timeout=GITHUB_CLI_TIMEOUT_SEC,
        )
        if org_result.returncode == 0:
            orgs = [o.strip() for o in org_result.stdout.strip().splitlines() if o.strip()]
            for org in orgs:
                gh_cmd = [
                    "gh", "repo", "list", org,
                    "--limit", str(GITHUB_CLI_REPO_LIMIT),
                    "--json", "nameWithOwner,url,description",
                ]
                org_repos = subprocess.run(
                    gh_cmd,
                    capture_output=True, text=True, timeout=GITHUB_CLI_TIMEOUT_SEC,
                )
                if org_repos.returncode == 0:
                    all_repos.extend(json.loads(org_repos.stdout))

        seen = set()
        unique_repos = []
        for repo in all_repos:
            key = repo.get("nameWithOwner")
            if key and key not in seen:
                seen.add(key)
                unique_repos.append(repo)
        unique_repos.sort(key=lambda r: r.get("nameWithOwner", "").lower())

        _github_repos_cache.set("repos", unique_repos)
        return unique_repos
    except FileNotFoundError:
        raise server_error("gh command not found") from None
    except subprocess.TimeoutExpired:
        raise timeout_error("gh command timed out") from None
    except json.JSONDecodeError:
        raise server_error("Failed to parse gh output") from None
