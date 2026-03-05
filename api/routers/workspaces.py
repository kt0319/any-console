import json
import logging
import re
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import verify_token
from ..common import (
    BACKGROUND_EXECUTOR,
    BACKGROUND_FETCH_TIMEOUT_SEC,
    GIT_CLONE_TIMEOUT_SEC,
    GITHUB_CLI_TIMEOUT_SEC,
    WORK_DIR,
    TTLCache,
    log_operation,
    resolve_workspace_path,
)
from ..config import (
    load_global_config_section,
    load_workspace_config,
    save_global_config_section,
    save_workspace_config,
)
from ..git_utils import command_result_dict, git_branch, git_is_repo
from ..icons import normalize_icon

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

_github_repos_cache = TTLCache(300)


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

    def key(workspace_dir):
        name = workspace_dir.name
        if name in order_map:
            return (0, order_map[name], name)
        return (1, 0, name)

    return key


def _lightweight_workspace_info(workspace_dir):
    name = workspace_dir.name
    is_git = git_is_repo(workspace_dir)
    branch = git_branch(workspace_dir) if is_git else None
    config = load_workspace_config(name)
    return {
        "name": name,
        "is_git_repo": is_git,
        "branch": branch,
        "icon": config.get("icon", ""),
        "icon_color": config.get("icon_color", ""),
        "hidden": config.get("hidden", False),
    }


@router.get("/workspaces")
def list_workspaces():
    if not WORK_DIR.is_dir():
        return []
    workspace_order = load_global_config_section("workspace_order", [])
    dirs = sorted(
        [workspace_dir for workspace_dir in WORK_DIR.iterdir()
         if workspace_dir.is_dir() and not workspace_dir.name.startswith(".")],
        key=_sort_key_by_workspace_order(workspace_order),
    )
    result = list(BACKGROUND_EXECUTOR.map(_lightweight_workspace_info, dirs))
    BACKGROUND_EXECUTOR.submit(_background_fetch, dirs)
    return result


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
    resolve_workspace_path(name)
    config = load_workspace_config(name)
    config["icon"] = normalize_icon(body.icon.strip())
    config["icon_color"] = body.icon_color.strip()
    config["hidden"] = body.hidden
    save_workspace_config(name, config)
    logger.info("workspace config updated workspace=%s", name)
    return {"status": "ok"}


class CloneRequest(BaseModel):
    url: str | None = None
    name: str | None = None


@router.post("/workspaces")
def clone_workspace(body: CloneRequest):
    url = (body.url or "").strip()
    github_url_match = re.match(r"https?://github\.com/(.+?)/?$", url)
    if url and github_url_match:
        url = f"git@github.com:{github_url_match.group(1)}.git"

    if body.name:
        dir_name = body.name.strip()
    elif url:
        dir_name = url.rstrip("/").split("/")[-1].removesuffix(".git")
    else:
        raise HTTPException(status_code=400, detail="URLまたはディレクトリ名を入力してください")

    if not dir_name or not re.match(r"^[a-zA-Z0-9_.-]+$", dir_name):
        raise HTTPException(status_code=400, detail="無効なディレクトリ名です")

    target_path = WORK_DIR / dir_name
    if target_path.exists():
        raise HTTPException(status_code=409, detail=f"'{dir_name}' は既に存在します")

    WORK_DIR.mkdir(parents=True, exist_ok=True)

    if not url:
        target_path.mkdir(parents=False, exist_ok=False)
        logger.info("workspace dir created dir=%s", dir_name)
        log_operation("ワークスペース作成", dir_name)
        return {"status": "ok", "name": dir_name, "mode": "directory"}

    try:
        result = subprocess.run(
            ["git", "clone", url, str(target_path)],
            capture_output=True, text=True,
            timeout=GIT_CLONE_TIMEOUT_SEC, cwd=str(WORK_DIR),
        )
        resp = command_result_dict(result)
        if result.returncode != 0:
            logger.warning("clone failed url=%s rc=%d stderr=%s", url, result.returncode, result.stderr)
        else:
            logger.info("clone ok dir=%s", dir_name)
            log_operation("clone", "", url)
            resp["name"] = dir_name
        return resp
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Clone timed out") from None


@router.get("/github/repos")
def list_github_repos():
    cached = _github_repos_cache.get("repos")
    if cached is not None:
        return cached
    try:
        all_repos = []

        result = subprocess.run(
            ["gh", "repo", "list", "--limit", "100", "--json", "nameWithOwner,url,description"],
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
                org_repos = subprocess.run(
                    ["gh", "repo", "list", org, "--limit", "100", "--json", "nameWithOwner,url,description"],
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
        raise HTTPException(status_code=500, detail="gh command not found") from None
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="gh command timed out") from None
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse gh output") from None
