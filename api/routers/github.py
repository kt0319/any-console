import json
import logging
import subprocess

from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import resolve_workspace_path

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])

GH_TIMEOUT_SEC = 15


def _run_gh(args: list[str], cwd: str) -> dict | list | None:
    try:
        result = subprocess.run(
            ["gh", *args],
            capture_output=True, text=True,
            timeout=GH_TIMEOUT_SEC, cwd=cwd,
        )
        if result.returncode != 0:
            logger.warning("gh command failed: %s stderr=%s", args, result.stderr.strip())
            return None
        return json.loads(result.stdout)
    except FileNotFoundError:
        logger.warning("gh CLI not found")
        return None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
        logger.warning("gh command error: %s %s", args, e)
        return None


@router.get("/workspaces/{name}/github/info")
def github_info(name: str):
    ws_path = resolve_workspace_path(name)
    data = _run_gh(
        ["repo", "view", "--json",
         "name,owner,description,url,stargazerCount,forkCount,isPrivate,defaultBranchRef,primaryLanguage"],
        cwd=str(ws_path),
    )
    if data is None:
        return {"status": "error", "message": "GitHub情報を取得できませんでした"}
    return {"status": "ok", "data": data}


@router.get("/workspaces/{name}/github/issues")
def github_issues(name: str):
    ws_path = resolve_workspace_path(name)
    data = _run_gh(
        ["issue", "list", "--limit", "30", "--json",
         "number,title,state,author,labels,createdAt,updatedAt"],
        cwd=str(ws_path),
    )
    if data is None:
        return {"status": "error", "message": "Issues を取得できませんでした"}
    return {"status": "ok", "data": data}


@router.get("/workspaces/{name}/github/pulls")
def github_pulls(name: str):
    ws_path = resolve_workspace_path(name)
    data = _run_gh(
        ["pr", "list", "--limit", "30", "--json",
         "number,title,state,author,labels,createdAt,updatedAt,headRefName,isDraft"],
        cwd=str(ws_path),
    )
    if data is None:
        return {"status": "error", "message": "Pull Requests を取得できませんでした"}
    return {"status": "ok", "data": data}
