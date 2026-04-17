import json
import logging
import subprocess

from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import GITHUB_CLI_TIMEOUT_SEC, resolve_workspace_path

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


def _run_gh(args: list[str], cwd: str) -> dict | list | None:
    try:
        result = subprocess.run(
            ["gh", *args],
            capture_output=True, text=True,
            timeout=GITHUB_CLI_TIMEOUT_SEC, cwd=cwd,
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


def _run_gh_endpoint(args, cwd, error_message):
    data = _run_gh(args, cwd=cwd)
    if data is None:
        return {"status": "error", "detail": error_message}
    return {"status": "ok", "data": data}


@router.get("/workspaces/{name}/github/info")
def github_info(name: str):
    ws_path = resolve_workspace_path(name)
    return _run_gh_endpoint(
        ["repo", "view", "--json",
         "name,owner,description,url,stargazerCount,forkCount,isPrivate,defaultBranchRef,primaryLanguage"],
        cwd=str(ws_path), error_message="Failed to fetch GitHub info",
    )


@router.get("/workspaces/{name}/github/issues")
def github_issues(name: str):
    ws_path = resolve_workspace_path(name)
    return _run_gh_endpoint(
        ["issue", "list", "--limit", "30", "--json",
         "number,title,state,author,labels,createdAt,updatedAt"],
        cwd=str(ws_path), error_message="Failed to fetch issues",
    )


@router.get("/workspaces/{name}/github/pulls")
def github_pulls(name: str):
    ws_path = resolve_workspace_path(name)
    return _run_gh_endpoint(
        ["pr", "list", "--limit", "30", "--json",
         "number,title,state,author,labels,createdAt,updatedAt,headRefName,isDraft"],
        cwd=str(ws_path), error_message="Failed to fetch pull requests",
    )


@router.get("/workspaces/{name}/github/runs")
def github_runs(name: str):
    ws_path = resolve_workspace_path(name)
    return _run_gh_endpoint(
        ["run", "list", "--limit", "15", "--json",
         "databaseId,displayTitle,status,conclusion,event,headBranch,createdAt,updatedAt,url,workflowName"],
        cwd=str(ws_path), error_message="Failed to fetch actions",
    )
