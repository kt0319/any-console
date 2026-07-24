from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import resolve_workspace_path
from ..gh_utils import run_gh_json_cached

router = APIRouter(dependencies=[Depends(verify_token)])


def _github_fetch(name: str, suffix: str, gh_args: list[str], error_message: str):
    ws_path = resolve_workspace_path(name)
    data = run_gh_json_cached(f"{name}:{suffix}", gh_args, cwd=str(ws_path))
    if data is None:
        return {"status": "error", "detail": error_message}
    return {"status": "ok", "data": data}


@router.get("/workspaces/{name}/github/issues")
def github_issues(name: str):
    return _github_fetch(
        name, "issues",
        ["issue", "list", "--limit", "30", "--json",
         "number,title,state,author,labels,createdAt,updatedAt"],
        "Failed to fetch issues",
    )


@router.get("/workspaces/{name}/github/pulls")
def github_pulls(name: str):
    return _github_fetch(
        name, "pulls",
        ["pr", "list", "--limit", "30", "--json",
         "number,title,state,author,labels,createdAt,updatedAt,headRefName,isDraft"],
        "Failed to fetch pull requests",
    )


@router.get("/workspaces/{name}/github/runs")
def github_runs(name: str):
    return _github_fetch(
        name, "runs",
        ["run", "list", "--limit", "15", "--json",
         "databaseId,displayTitle,status,conclusion,event,headBranch,createdAt,updatedAt,url,workflowName"],
        "Failed to fetch actions",
    )
