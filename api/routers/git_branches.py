from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..activity import log_activity
from ..auth import verify_token
from ..common import (
    GIT_LONG_TIMEOUT_SEC,
    resolve_workspace_path,
)
from ..errors import bad_request
from ..git_lock import workspace_write_lock
from ..git_utils import (
    git_branch,
    git_branches,
    git_default_branch,
    git_remote_branches,
    run_git_command,
    ssh_env,
)
from ..validators import validate_branch_name, validate_commit_ref
from .git_helpers import execute_git_action, get_current_branch, rev_parse

_COMMIT_PREVIEW_LIMIT = 3


def _commits_between(ws_path, range_expr: str) -> dict:
    """range_expr (例: "abcd..HEAD" または "@{u}..HEAD") のコミット件数と直近メッセージを返す。"""
    log = run_git_command(
        ["log", range_expr, "--pretty=format:%s", "-n", str(_COMMIT_PREVIEW_LIMIT)],
        cwd=ws_path, operation="log range",
    )
    count_res = run_git_command(
        ["rev-list", "--count", range_expr], cwd=ws_path, operation="rev-list count",
    )
    if log["exit_code"] != 0 or count_res["exit_code"] != 0:
        return {"count": 0, "messages": []}
    try:
        count = int(count_res["stdout"].strip() or "0")
    except ValueError:
        count = 0
    messages = [line for line in log["stdout"].splitlines() if line]
    return {"count": count, "messages": messages}

router = APIRouter(dependencies=[Depends(verify_token)])


def _stash_if_dirty(ws_path, env) -> bool:
    dirty = run_git_command(["status", "--porcelain"], cwd=ws_path, operation="status")["stdout"].strip()
    if not dirty:
        return False
    result = run_git_command(["stash"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="stash")
    return bool(result["exit_code"] == 0)


def _unstash(ws_path, env, result: dict) -> None:
    pop = run_git_command(["stash", "pop"], cwd=ws_path, timeout=GIT_LONG_TIMEOUT_SEC, env=env, operation="stash pop")
    if pop["exit_code"] != 0:
        result["stderr"] += f"\n⚠️ stash pop failed:\n{pop['stderr']}"


class DeleteBranchRequest(BaseModel):
    branch: str
    remote: bool = False


class CheckoutRequest(BaseModel):
    branch: str
    start_point: str | None = None
    base_branch: str | None = None


def _parse_upstream_track(track: str) -> dict:
    body = (track or "").strip()
    if body.startswith("[") and body.endswith("]"):
        body = body[1:-1]
    if not body:
        return {"ahead": 0, "behind": 0, "gone": False}
    if body == "gone":
        return {"ahead": 0, "behind": 0, "gone": True}
    ahead = 0
    behind = 0
    for part in body.split(","):
        part = part.strip()
        if part.startswith("ahead "):
            try:
                ahead = int(part[6:])
            except ValueError:
                pass
        elif part.startswith("behind "):
            try:
                behind = int(part[7:])
            except ValueError:
                pass
    return {"ahead": ahead, "behind": behind, "gone": False}


def _branch_tracking_info(ws_path) -> dict[str, dict]:
    res = run_git_command(
        ["for-each-ref", "--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname)", "refs/heads"],
        cwd=ws_path, operation="for-each-ref upstream",
    )
    info: dict[str, dict] = {}
    if res["exit_code"] != 0:
        return info
    for line in res["stdout"].splitlines():
        parts = line.split("|", 3)
        if len(parts) != 4:
            continue
        name, upstream, track, tip = parts
        info[name] = {"upstream": upstream or None, "tip": tip, **_parse_upstream_track(track)}
    return info


def _unpublished_commit_counts(ws_path, tips: dict[str, str]) -> dict[str, int]:
    """upstream未設定のブランチはgitのupstream:trackが常に空でahead/behindを
    計算できないため、originのどのリモートブランチにも含まれないコミット数を
    「未push件数」の代わりとして数える（git_info.pyのHEAD向け実装と同じ考え方）。

    ブランチごとに `rev-list --count <branch> --not --remotes=origin` を起動すると
    upstream未設定ブランチの本数ぶん直列にプロセスが増える（N+1）ため、
    origin未到達コミットの親子関係を1回の rev-list --parents で取り、各ブランチ
    先端からの到達数をPython側で数える。値は従来のブランチごとのcountと同じ
    （複数ブランチが共有する未pushコミットはそれぞれのブランチで数える）。
    """
    if not tips:
        return {}
    res = run_git_command(
        ["rev-list", "--branches", "--not", "--remotes=origin", "--parents"],
        cwd=ws_path, operation="rev-list unpublished",
    )
    if res["exit_code"] != 0:
        return dict.fromkeys(tips, 0)
    # commit hash -> 親hash一覧。このdictに載っているコミット＝origin未到達。
    parents: dict[str, list[str]] = {}
    for line in res["stdout"].splitlines():
        hashes = line.split()
        if hashes:
            parents[hashes[0]] = hashes[1:]
    counts: dict[str, int] = {}
    for branch, tip in tips.items():
        if tip not in parents:
            counts[branch] = 0
            continue
        seen = {tip}
        stack = [tip]
        while stack:
            for parent in parents.get(stack.pop(), ()):
                # dict外の親はorigin到達済み＝そこで打ち切る（数えない）
                if parent in parents and parent not in seen:
                    seen.add(parent)
                    stack.append(parent)
        counts[branch] = len(seen)
    return counts


@router.get("/workspaces/{name}/branches")
def list_branches(name: str):
    ws_path = resolve_workspace_path(name)
    branches = git_branches(ws_path)
    current = git_branch(ws_path)
    default_branch = git_default_branch(ws_path)
    tracking = _branch_tracking_info(ws_path)
    no_upstream_tips = {
        b: tracking[b]["tip"]
        for b in branches
        if b in tracking and not tracking[b].get("upstream") and tracking[b].get("tip")
    }
    unpublished = _unpublished_commit_counts(ws_path, no_upstream_tips)
    out = []
    for b in branches:
        t = tracking.get(b, {})
        upstream = t.get("upstream")
        ahead = t.get("ahead", 0) if upstream else unpublished.get(b, 0)
        out.append({
            "name": b,
            "current": b == current,
            "is_default": b == default_branch,
            "upstream": upstream,
            "ahead": ahead,
            "behind": t.get("behind", 0),
            "gone": t.get("gone", False),
        })
    return out


@router.get("/workspaces/{name}/branches/remote")
def list_remote_branches(name: str):
    # 読み取り専用。リモート追跡refの更新は POST /workspaces/{name}/fetch が担う
    # （UI の REMOTE タップは fetch → この GET の順で呼ぶ）。
    ws_path = resolve_workspace_path(name)
    return git_remote_branches(ws_path)


@router.post("/workspaces/{name}/delete-branch")
def delete_branch(name: str, body: DeleteBranchRequest):
    branch = validate_branch_name(body.branch)
    ws_path = resolve_workspace_path(name)
    if body.remote:
        before_hash = rev_parse(ws_path, f"origin/{branch}", "rev-parse remote branch before delete")
        result = execute_git_action(
            name, ["push", "origin", "--delete", branch],
            operation="delete remote branch", env=ssh_env(), log_extra=f"branch={branch}",
        )
        if result["status"] == "ok":
            log_activity(name, "git_delete_branch", branch=branch, remote=True, commit=before_hash)
        return result
    if branch == get_current_branch(ws_path):
        raise bad_request("Cannot delete the current branch")
    before_hash = rev_parse(ws_path, branch, "rev-parse branch before delete")
    result = execute_git_action(name, ["branch", "-D", branch], operation="delete branch", log_extra=f"branch={branch}")
    if result["status"] == "ok":
        log_activity(name, "git_delete_branch", branch=branch, remote=False, commit=before_hash)
    return result


@router.post("/workspaces/{name}/create-branch")
def create_branch(name: str, body: CheckoutRequest):
    branch = validate_branch_name(body.branch)
    ws_path = resolve_workspace_path(name)
    args = ["checkout", "-b", branch]
    if body.start_point:
        args.append(validate_commit_ref(body.start_point))
    elif body.base_branch:
        args.append(validate_branch_name(body.base_branch))
    result = execute_git_action(name, args, operation="create-branch", log_extra=f"branch={branch}")
    if result["status"] == "ok":
        commit = rev_parse(ws_path, "HEAD", "rev-parse after create-branch")
        log_activity(name, "git_create_branch", branch=branch, commit=commit)
    return result


@router.post("/workspaces/{name}/checkout")
def checkout_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = validate_branch_name(body.branch)
    local_branches = git_branches(ws_path)
    args = ["checkout", branch] if branch in local_branches else ["checkout", "-b", branch, f"origin/{branch}"]
    result = execute_git_action(name, args, operation="checkout", log_extra=f"branch={branch}")
    if result["status"] == "ok":
        commit = rev_parse(ws_path, "HEAD", "rev-parse after checkout")
        log_activity(name, "git_checkout", branch=branch, commit=commit)
    return result


@router.post("/workspaces/{name}/pull")
def git_pull(name: str):
    with workspace_write_lock(name):
        ws_path = resolve_workspace_path(name)
        env = ssh_env()
        before_hash = rev_parse(ws_path, "HEAD", "rev-parse before pull")
        stashed = _stash_if_dirty(ws_path, env)
        result = execute_git_action(name, ["pull", "--rebase"], operation="pull", env=env)
        if stashed:
            _unstash(ws_path, env, result)
        if result["status"] == "ok" and before_hash:
            result["commits"] = _commits_between(ws_path, f"{before_hash}..HEAD")
            after_hash = rev_parse(ws_path, "HEAD", "rev-parse after pull")
            log_activity(name, "git_pull", from_commit=before_hash, commit=after_hash)
        return result


@router.post("/workspaces/{name}/push")
def git_push(name: str):
    ws_path = resolve_workspace_path(name)
    before_hash = rev_parse(ws_path, "@{u}", "rev-parse upstream before push")
    pending = _commits_between(ws_path, "@{u}..HEAD")
    result = execute_git_action(name, ["push"], operation="push", env=ssh_env())
    if result["status"] == "ok":
        result["commits"] = pending
        commit = rev_parse(ws_path, "HEAD", "rev-parse after push")
        log_activity(name, "git_push", from_commit=before_hash, commit=commit)
    return result


class PushBranchRequest(BaseModel):
    branch: str


@router.post("/workspaces/{name}/push-branch")
def git_push_branch(name: str, body: PushBranchRequest):
    branch = validate_branch_name(body.branch)
    ws_path = resolve_workspace_path(name)
    before_hash = rev_parse(ws_path, f"origin/{branch}", "rev-parse remote branch before push")
    pending = _commits_between(ws_path, f"origin/{branch}..{branch}")
    result = execute_git_action(
        name, ["push", "-u", "origin", f"{branch}:{branch}"],
        operation="push branch", env=ssh_env(), log_extra=f"branch={branch}",
    )
    if result["status"] == "ok":
        result["commits"] = pending
        commit = rev_parse(ws_path, branch, "rev-parse pushed branch")
        log_activity(name, "git_push", branch=branch, from_commit=before_hash, commit=commit)
    return result


@router.post("/workspaces/{name}/set-upstream")
def git_set_upstream(name: str):
    ws_path = resolve_workspace_path(name)
    branch = get_current_branch(ws_path)
    result = execute_git_action(
        name, ["branch", "--set-upstream-to", f"origin/{branch}"],
        operation="set upstream", env=ssh_env(), log_extra=f"branch={branch}",
    )
    if result["status"] == "ok":
        log_activity(name, "git_set_upstream", branch=branch)
    return result


@router.post("/workspaces/{name}/push-upstream")
def git_push_upstream(name: str):
    ws_path = resolve_workspace_path(name)
    result = execute_git_action(name, ["push", "-u", "origin", "HEAD"], operation="push upstream", env=ssh_env())
    if result["status"] == "ok":
        commit = rev_parse(ws_path, "HEAD", "rev-parse after push upstream")
        log_activity(name, "git_push", commit=commit)
    return result


@router.post("/workspaces/{name}/fetch")
def git_fetch(name: str):
    result = execute_git_action(name, ["fetch", "--prune"], operation="fetch", env=ssh_env())
    if result["status"] == "ok":
        log_activity(name, "git_fetch")
    return result
