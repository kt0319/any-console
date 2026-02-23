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
    command_result_dict,
    git_info_to_status_dict,
    load_workspace_config,
    migrate_workspace_config,
    resolve_workspace_path,
    save_workspace_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


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


@router.get("/workspaces")
def list_workspaces():
    if not WORK_DIR.is_dir():
        return []
    dirs = sorted(
        [workspace_dir for workspace_dir in WORK_DIR.iterdir()
         if workspace_dir.is_dir() and not workspace_dir.name.startswith(".")],
        key=lambda workspace_dir: workspace_dir.name,
    )
    result = list(BACKGROUND_EXECUTOR.map(
        lambda workspace_dir: git_info_to_status_dict(workspace_dir, workspace_dir.name),
        dirs,
    ))
    for ws_data, workspace_dir in zip(result, dirs):
        migrate_workspace_config(workspace_dir.name, workspace_dir)
        config = load_workspace_config(workspace_dir.name)
        ws_data["icon"] = config.get("icon", "")
        ws_data["icon_color"] = config.get("icon_color", "")
        ws_data["hidden"] = config.get("hidden", False)
    BACKGROUND_EXECUTOR.submit(_background_fetch, dirs)
    return result


class UpdateConfigRequest(BaseModel):
    icon: str = ""
    icon_color: str = ""
    hidden: bool = False


@router.put("/workspaces/{name}/config")
def update_workspace_config_endpoint(name: str, body: UpdateConfigRequest):
    resolve_workspace_path(name)
    config = load_workspace_config(name)
    config["icon"] = body.icon.strip()
    config["icon_color"] = body.icon_color.strip()
    config["hidden"] = body.hidden
    save_workspace_config(name, config)
    logger.info("workspace config updated workspace=%s", name)
    return {"status": "ok"}


class CloneRequest(BaseModel):
    url: str
    name: str | None = None


@router.post("/workspaces")
def clone_workspace(body: CloneRequest):
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URLを入力してください")
    github_url_match = re.match(r"https?://github\.com/(.+?)/?$", url)
    if github_url_match:
        url = f"git@github.com:{github_url_match.group(1)}.git"

    if body.name:
        dir_name = body.name.strip()
    else:
        dir_name = url.rstrip("/").split("/")[-1].removesuffix(".git")

    if not dir_name or not re.match(r"^[a-zA-Z0-9_.-]+$", dir_name):
        raise HTTPException(status_code=400, detail="無効なディレクトリ名です")

    target_path = WORK_DIR / dir_name
    if target_path.exists():
        raise HTTPException(status_code=409, detail=f"'{dir_name}' は既に存在します")

    WORK_DIR.mkdir(parents=True, exist_ok=True)

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
            resp["name"] = dir_name
        return resp
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Clone timed out")


@router.get("/github/repos")
def list_github_repos():
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

        return unique_repos
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="gh command not found")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="gh command timed out")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse gh output")
