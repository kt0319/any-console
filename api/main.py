import json
import os
import secrets
import shutil
import socket
import subprocess
import time
import http.client
import asyncio
import importlib.util
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile, WebSocket
from fastapi.websockets import WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import verify_token
from .jobs import TERMINAL_JOB, JobDefinition
from .runner import run_job

app = FastAPI(title="pi-console")

UI_DIR = Path(__file__).resolve().parent.parent / "ui"
WORK_DIR = Path.home() / "work"
UPLOAD_DIR = Path("/tmp/pi-console-uploads")
TERMINAL_TIMEOUT_SEC = 600
WORKSPACE_JOBS_DIR = Path(".pi-console/jobs")


@dataclass
class TerminalSession:
    workspace: str | None
    port: int
    pid: int | None
    expires_at: float


TERMINAL_SESSIONS: dict[str, TerminalSession] = {}


def recover_terminal_sessions() -> None:
    """起動時に既存の ttyd プロセスを検出して TERMINAL_SESSIONS に再登録する"""
    try:
        result = subprocess.run(
            ["pgrep", "-a", "ttyd"], capture_output=True, text=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return
    if result.returncode != 0:
        return

    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        pid_str = parts[0]
        port = None
        session_id = None
        for i, arg in enumerate(parts):
            if arg == "--port" and i + 1 < len(parts):
                try:
                    port = int(parts[i + 1])
                except ValueError:
                    pass
            if arg == "--base-path" and i + 1 < len(parts):
                bp = parts[i + 1]
                prefix = "/terminal/s/"
                if bp.startswith(prefix):
                    session_id = bp[len(prefix):].rstrip("/")
        if port and session_id and session_id not in TERMINAL_SESSIONS:
            TERMINAL_SESSIONS[session_id] = TerminalSession(
                workspace=None,
                port=port,
                pid=int(pid_str),
                expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
            )


recover_terminal_sessions()


class RunRequest(BaseModel):
    job: str
    args: dict[str, str] = {}
    workspace: str | None = None


def git_info(directory: Path) -> dict:
    info = {
        "branch": None,
        "last_commit": None,
        "last_commit_message": None,
        "github_url": None,
        "clean": None,
        "ahead": 0,
        "behind": 0,
        "insertions": 0,
        "deletions": 0,
        "changed_files": 0,
    }
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
        )
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()

        result = subprocess.run(
            ["git", "log", "-1", "--format=%cI"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
        )
        if result.returncode == 0 and result.stdout.strip():
            info["last_commit"] = result.stdout.strip()

        result = subprocess.run(
            ["git", "log", "-1", "--format=%s"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
        )
        if result.returncode == 0 and result.stdout.strip():
            info["last_commit_message"] = result.stdout.strip()

        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            if "github.com" in url:
                url = url.removesuffix(".git")
                if url.startswith("git@github.com:"):
                    url = "https://github.com/" + url[len("git@github.com:"):]
                info["github_url"] = url

        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
        )
        if result.returncode == 0:
            info["clean"] = len(result.stdout.strip()) == 0

        if not info["clean"]:
            stat_result = subprocess.run(
                ["git", "diff", "--shortstat"],
                capture_output=True, text=True, timeout=5, cwd=str(directory),
            )
            staged_result = subprocess.run(
                ["git", "diff", "--staged", "--shortstat"],
                capture_output=True, text=True, timeout=5, cwd=str(directory),
            )
            for out in (stat_result.stdout, staged_result.stdout):
                if not out:
                    continue
                m_files = re.search(r"(\d+) file", out)
                m_ins = re.search(r"(\d+) insertion", out)
                m_del = re.search(r"(\d+) deletion", out)
                if m_files:
                    info["changed_files"] += int(m_files.group(1))
                if m_ins:
                    info["insertions"] += int(m_ins.group(1))
                if m_del:
                    info["deletions"] += int(m_del.group(1))

        result = subprocess.run(
            ["git", "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            capture_output=True, text=True, timeout=5, cwd=str(directory),
        )
        if result.returncode == 0:
            parts = result.stdout.strip().split()
            if len(parts) == 2:
                info["ahead"] = int(parts[0])
                info["behind"] = int(parts[1])
    except (subprocess.TimeoutExpired, OSError):
        pass
    return info


class CloneRequest(BaseModel):
    url: str
    name: str | None = None


@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check():
    return {"ok": True}


@app.get("/github/repos", dependencies=[Depends(verify_token)])
def list_github_repos():
    try:
        all_repos = []

        # 自分のリポジトリ
        result = subprocess.run(
            ["gh", "repo", "list", "--limit", "100", "--json", "nameWithOwner,url,description"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            all_repos.extend(json.loads(result.stdout))

        # 所属組織一覧を取得
        org_result = subprocess.run(
            ["gh", "org", "list"],
            capture_output=True, text=True, timeout=30,
        )
        if org_result.returncode == 0:
            orgs = [o.strip() for o in org_result.stdout.strip().splitlines() if o.strip()]
            for org in orgs:
                org_repos = subprocess.run(
                    ["gh", "repo", "list", org, "--limit", "100", "--json", "nameWithOwner,url,description"],
                    capture_output=True, text=True, timeout=30,
                )
                if org_repos.returncode == 0:
                    all_repos.extend(json.loads(org_repos.stdout))

        # 重複排除してソート
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


@app.post("/workspaces", dependencies=[Depends(verify_token)])
def clone_workspace(body: CloneRequest):
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URLを入力してください")
    m = re.match(r"https?://github\.com/(.+?)/?$", url)
    if m:
        url = f"git@github.com:{m.group(1)}.git"

    # ディレクトリ名を決定
    if body.name:
        dir_name = body.name.strip()
    else:
        # URLからリポジトリ名を抽出
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
            capture_output=True, text=True, timeout=300, cwd=str(WORK_DIR),
        )
        if result.returncode != 0:
            return {
                "status": "error",
                "exit_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        return {
            "status": "ok",
            "name": dir_name,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Clone timed out")


def _build_workspace_entry(d: Path) -> dict:
    gi = git_info(d)
    return {
        "name": d.name,
        "branch": gi["branch"],
        "last_commit": gi["last_commit"],
        "last_commit_message": gi["last_commit_message"],
        "github_url": gi["github_url"],
        "clean": gi["clean"],
        "ahead": gi["ahead"],
        "behind": gi["behind"],
        "insertions": gi["insertions"],
        "deletions": gi["deletions"],
        "changed_files": gi["changed_files"],
    }


def _background_fetch(dirs: list[Path]):
    def fetch(d):
        try:
            subprocess.run(
                ["git", "fetch", "--quiet"],
                capture_output=True, text=True, timeout=15, cwd=str(d),
            )
        except (subprocess.TimeoutExpired, OSError):
            pass
    with ThreadPoolExecutor(max_workers=4) as pool:
        pool.map(fetch, dirs)


@app.get("/workspaces", dependencies=[Depends(verify_token)])
def list_workspaces():
    if not WORK_DIR.is_dir():
        return []
    dirs = sorted(
        [d for d in WORK_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")],
        key=lambda d: d.name,
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        result = list(pool.map(_build_workspace_entry, dirs))
    ThreadPoolExecutor(max_workers=1).submit(_background_fetch, dirs)
    return result


def get_git_branches(directory: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "branch", "--format=%(refname:short)"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=str(directory),
        )
        if result.returncode == 0:
            return [b for b in result.stdout.strip().splitlines() if b]
    except (subprocess.TimeoutExpired, OSError):
        pass
    return []


def get_git_remote_branches(directory: Path) -> list[str]:
    try:
        subprocess.run(
            ["git", "fetch", "--prune"],
            capture_output=True, text=True, timeout=30, cwd=str(directory),
        )
        result = subprocess.run(
            ["git", "branch", "-r", "--format=%(refname:short)"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=str(directory),
        )
        if result.returncode == 0:
            branches = []
            for b in result.stdout.strip().splitlines():
                b = b.strip()
                if not b or b.endswith("/HEAD"):
                    continue
                # "origin/main" -> "main"
                if "/" in b:
                    b = b.split("/", 1)[1]
                if b not in branches:
                    branches.append(b)
            return branches
    except (subprocess.TimeoutExpired, OSError):
        pass
    return []


def resolve_workspace_path(workspace: str | None) -> Path | None:
    if not workspace:
        return None
    ws_path = WORK_DIR / workspace
    if not ws_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Workspace not found: {workspace}")
    valid = [d.name for d in WORK_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
    if workspace not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid workspace: {workspace}")
    return ws_path


def cleanup_terminal_sessions() -> None:
    now = time.time()
    expired = [sid for sid, session in TERMINAL_SESSIONS.items() if session.expires_at <= now]
    for sid in expired:
        TERMINAL_SESSIONS.pop(sid, None)


@app.get("/terminal/sessions", dependencies=[Depends(verify_token)])
async def list_terminal_sessions():
    cleanup_terminal_sessions()
    now = time.time()
    return [
        {
            "session_id": sid,
            "workspace": s.workspace,
            "url": f"/terminal/s/{sid}/",
            "expires_in": int(s.expires_at - now),
        }
        for sid, s in TERMINAL_SESSIONS.items()
    ]


@app.delete("/terminal/sessions/{session_id}", dependencies=[Depends(verify_token)])
async def delete_terminal_session(session_id: str):
    session = TERMINAL_SESSIONS.pop(session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    if session.pid:
        try:
            os.kill(session.pid, 9)
        except ProcessLookupError:
            pass
    return {"status": "ok"}


def tmux_pane_in_copy_mode(tmux_session: str) -> bool:
    result = subprocess.run(
        ["tmux", "display-message", "-t", tmux_session, "-p", "#{pane_in_mode}"],
        capture_output=True, text=True, timeout=5,
    )
    return result.stdout.strip() == "1"


@app.post("/terminal/sessions/{session_id}/scroll", dependencies=[Depends(verify_token)])
async def terminal_scroll(session_id: str, body: dict):
    session = get_terminal_session(session_id)
    direction = body.get("direction")
    if direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'")
    tmux_session = f"pi-{session.port}"
    try:
        in_copy = tmux_pane_in_copy_mode(tmux_session)
        if direction == "up":
            if not in_copy:
                subprocess.run(
                    ["tmux", "copy-mode", "-t", tmux_session],
                    capture_output=True, text=True, timeout=5,
                )
            subprocess.run(
                ["tmux", "send-keys", "-t", tmux_session, "-X", "page-up"],
                capture_output=True, text=True, timeout=5,
            )
        else:
            if in_copy:
                subprocess.run(
                    ["tmux", "send-keys", "-t", tmux_session, "-X", "page-down"],
                    capture_output=True, text=True, timeout=5,
                )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok"}


def get_terminal_session(session_id: str) -> TerminalSession:
    cleanup_terminal_sessions()
    session = TERMINAL_SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    if session.expires_at <= time.time():
        TERMINAL_SESSIONS.pop(session_id, None)
        raise HTTPException(status_code=410, detail="Terminal session expired")
    session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
    return session


def parse_terminal_stdout(stdout: str) -> tuple[int | None, int | None]:
    port_match = re.search(r"(?m)^PORT=(\d+)$", stdout or "")
    pid_match = re.search(r"(?m)^PID=(\d+)$", stdout or "")
    port = int(port_match.group(1)) if port_match else None
    pid = int(pid_match.group(1)) if pid_match else None
    return port, pid


def websockets_available() -> bool:
    return importlib.util.find_spec("websockets") is not None


def get_workspace_custom_jobs_dir(workspace_path: Path) -> Path:
    jobs_dir = workspace_path / WORKSPACE_JOBS_DIR
    jobs_dir.mkdir(parents=True, exist_ok=True)
    return jobs_dir


def parse_open_url(script_path: Path) -> str:
    try:
        for line in script_path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^#\s*open-url:\s*(.+)$", line)
            if m:
                return m.group(1).strip()
    except OSError:
        pass
    return ""


def get_workspace_custom_jobs(workspace_path: Path) -> dict[str, JobDefinition]:
    jobs_dir = get_workspace_custom_jobs_dir(workspace_path)
    custom: dict[str, JobDefinition] = {}
    for script_path in sorted(jobs_dir.glob("*.sh")):
        if not script_path.is_file():
            continue
        job_name = script_path.stem
        custom[job_name] = JobDefinition(
            script=str(script_path),
            label=job_name,
            description=f"Workspace custom job: {job_name}",
            args=[],
            script_path_override=script_path,
            open_url=parse_open_url(script_path),
        )
    return custom


def get_workspace_jobs(workspace_path: Path | None) -> dict:
    if not workspace_path:
        return {}
    return get_workspace_custom_jobs(workspace_path)


def read_script_content(job_def) -> str:
    try:
        return job_def.script_path.read_text(encoding="utf-8")
    except OSError:
        return ""


def job_definition_to_dict(job_def) -> dict:
    return {
        "label": job_def.label,
        "description": job_def.description,
        "script": job_def.script,
        "script_content": read_script_content(job_def),
        "open_url": job_def.open_url,
        "args": [
            {
                "name": arg.name,
                "values": arg.values,
                "required": arg.required,
                "dynamic": arg.dynamic,
            }
            for arg in job_def.args
        ],
    }


@app.get("/workspaces/{name}/status", dependencies=[Depends(verify_token)])
def get_workspace_status(name: str):
    ws_path = resolve_workspace_path(name)
    gi = git_info(ws_path)
    return {
        "name": name,
        "branch": gi["branch"],
        "last_commit": gi["last_commit"],
        "last_commit_message": gi["last_commit_message"],
        "github_url": gi["github_url"],
        "clean": gi["clean"],
        "ahead": gi["ahead"],
        "behind": gi["behind"],
        "insertions": gi["insertions"],
        "deletions": gi["deletions"],
        "changed_files": gi["changed_files"],
    }


@app.get("/workspaces/{name}/branches", dependencies=[Depends(verify_token)])
def list_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return get_git_branches(ws_path)


@app.get("/workspaces/{name}/branches/remote", dependencies=[Depends(verify_token)])
def list_remote_branches(name: str):
    ws_path = resolve_workspace_path(name)
    return get_git_remote_branches(ws_path)


@app.get("/workspaces/{name}/jobs", dependencies=[Depends(verify_token)])
def list_workspace_jobs(name: str):
    ws_path = resolve_workspace_path(name)
    jobs = get_workspace_jobs(ws_path)
    return {name: job_definition_to_dict(job_def) for name, job_def in jobs.items()}


class CreateJobRequest(BaseModel):
    name: str
    label: str = ""
    script: str
    open_url: str = ""


class CheckoutRequest(BaseModel):
    branch: str


@app.post("/workspaces/{name}/jobs", dependencies=[Depends(verify_token)])
def create_workspace_job(name: str, body: CreateJobRequest):
    ws_path = resolve_workspace_path(name)
    job_name = body.name.strip()
    if not job_name or not re.match(r"^[a-zA-Z0-9_-]+$", job_name):
        raise HTTPException(status_code=400, detail="ジョブ名は英数字・ハイフン・アンダースコアのみ")
    jobs_dir = get_workspace_custom_jobs_dir(ws_path)
    script_path = jobs_dir / f"{job_name}.sh"
    if script_path.exists():
        raise HTTPException(status_code=409, detail=f"ジョブ '{job_name}' は既に存在します")
    script_content = body.script.strip()
    if not script_content:
        raise HTTPException(status_code=400, detail="スクリプト内容が空です")
    open_url = body.open_url.strip()
    header = "#!/usr/bin/env bash\nset -euo pipefail\n\n"
    if not script_content.startswith("#!"):
        script_content = header + script_content
    if open_url:
        lines = script_content.split("\n")
        insert_idx = 0
        for i, line in enumerate(lines):
            if line.startswith("#!"):
                insert_idx = i + 1
                break
        lines.insert(insert_idx, f"# open-url: {open_url}")
        script_content = "\n".join(lines)
    script_path.write_text(script_content + "\n", encoding="utf-8")
    script_path.chmod(0o755)
    return {"status": "ok", "name": job_name}


@app.delete("/workspaces/{name}/jobs/{job_name}", dependencies=[Depends(verify_token)])
def delete_workspace_job(name: str, job_name: str):
    ws_path = resolve_workspace_path(name)
    jobs_dir = get_workspace_custom_jobs_dir(ws_path)
    script_path = jobs_dir / f"{job_name}.sh"
    if not script_path.is_file():
        raise HTTPException(status_code=404, detail=f"ジョブ '{job_name}' が見つかりません")
    script_path.unlink()
    return {"status": "ok", "name": job_name}


@app.post("/workspaces/{name}/create-branch", dependencies=[Depends(verify_token)])
def create_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = body.branch.strip()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch is required")
    if not re.match(r"^[a-zA-Z0-9_./-]+$", branch):
        raise HTTPException(status_code=400, detail=f"Invalid branch name: {branch}")
    try:
        result = subprocess.run(
            ["git", "checkout", "-b", branch],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Branch creation timed out")


@app.post("/workspaces/{name}/checkout", dependencies=[Depends(verify_token)])
def checkout_branch(name: str, body: CheckoutRequest):
    ws_path = resolve_workspace_path(name)
    branch = body.branch.strip()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch is required")
    if not re.match(r"^[a-zA-Z0-9_./-]+$", branch):
        raise HTTPException(status_code=400, detail=f"Invalid branch name: {branch}")

    local_branches = get_git_branches(ws_path)
    is_local = branch in local_branches

    try:
        if is_local:
            result = subprocess.run(
                ["git", "checkout", branch],
                capture_output=True, text=True, timeout=30, cwd=str(ws_path),
            )
        else:
            result = subprocess.run(
                ["git", "checkout", "-b", branch, f"origin/{branch}"],
                capture_output=True, text=True, timeout=30, cwd=str(ws_path),
            )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Checkout timed out")


def ssh_env() -> dict[str, str]:
    if os.environ.get("SSH_AUTH_SOCK"):
        return dict(os.environ)
    candidates = [
        Path(f"/run/user/{os.getuid()}/gnupg/S.gpg-agent.ssh"),
        Path(f"/run/user/{os.getuid()}/ssh-agent.socket"),
    ]
    for sock in candidates:
        if sock.exists():
            env = dict(os.environ)
            env["SSH_AUTH_SOCK"] = str(sock)
            return env
    return dict(os.environ)


@app.post("/workspaces/{name}/pull", dependencies=[Depends(verify_token)])
def git_pull(name: str):
    ws_path = resolve_workspace_path(name)
    env = ssh_env()
    run_opts = dict(capture_output=True, text=True, timeout=60, cwd=str(ws_path), env=env)
    try:
        dirty = subprocess.run(
            ["git", "status", "--porcelain"], capture_output=True, text=True, cwd=str(ws_path),
        ).stdout.strip()
        stashed = False
        if dirty:
            stash_result = subprocess.run(["git", "stash"], **run_opts)
            stashed = stash_result.returncode == 0
        result = subprocess.run(["git", "pull", "--rebase"], **run_opts)
        stash_msg = ""
        if stashed:
            pop = subprocess.run(["git", "stash", "pop"], **run_opts)
            if pop.returncode != 0:
                stash_msg = f"\n⚠️ stash pop failed:\n{pop.stderr}"
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr + stash_msg,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git pull timed out")


@app.post("/workspaces/{name}/push", dependencies=[Depends(verify_token)])
def git_push(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "push"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
            env=ssh_env(),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git push timed out")


@app.get("/workspaces/{name}/git-log", dependencies=[Depends(verify_token)])
def get_git_log(name: str, limit: int = 50, skip: int = 0):
    ws_path = resolve_workspace_path(name)
    safe_limit = max(1, min(limit, 200))
    safe_skip = max(0, skip)
    try:
        cmd = [
            "git",
            "--no-pager",
            "log",
            "--all",
            "--date-order",
            f"--max-count={safe_limit}",
            "--date=format:%Y-%m-%d %H:%M",
            "--pretty=format:%H\t%ad\t%an\t%D\t%s",
        ]
        if safe_skip > 0:
            cmd.insert(4, f"--skip={safe_skip}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git log timed out")


def validate_commit_hash(commit_hash: str) -> str:
    if not re.match(r"^[0-9a-f]{4,40}$", commit_hash):
        raise HTTPException(status_code=400, detail=f"Invalid commit hash: {commit_hash}")
    return commit_hash


class CommitActionRequest(BaseModel):
    commit_hash: str


class ResetRequest(BaseModel):
    commit_hash: str
    mode: str = "soft"


@app.post("/workspaces/{name}/cherry-pick", dependencies=[Depends(verify_token)])
def git_cherry_pick(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    try:
        result = subprocess.run(
            ["git", "cherry-pick", commit_hash],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git cherry-pick timed out")


@app.post("/workspaces/{name}/revert", dependencies=[Depends(verify_token)])
def git_revert(name: str, body: CommitActionRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    try:
        result = subprocess.run(
            ["git", "revert", "--no-edit", commit_hash],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git revert timed out")


@app.post("/workspaces/{name}/reset", dependencies=[Depends(verify_token)])
def git_reset(name: str, body: ResetRequest):
    ws_path = resolve_workspace_path(name)
    commit_hash = validate_commit_hash(body.commit_hash)
    if body.mode not in ("soft", "hard"):
        raise HTTPException(status_code=400, detail=f"Invalid reset mode: {body.mode}")
    try:
        result = subprocess.run(
            ["git", "reset", f"--{body.mode}", commit_hash],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git reset timed out")


@app.post("/workspaces/{name}/fetch", dependencies=[Depends(verify_token)])
def git_fetch(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "fetch", "--prune"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git fetch timed out")


@app.post("/workspaces/{name}/stash", dependencies=[Depends(verify_token)])
def git_stash(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "stash"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git stash timed out")


@app.post("/workspaces/{name}/stash-pop", dependencies=[Depends(verify_token)])
def git_stash_pop(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        result = subprocess.run(
            ["git", "stash", "pop"],
            capture_output=True, text=True, timeout=60, cwd=str(ws_path),
        )
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git stash pop timed out")


@app.get("/workspaces/{name}/diff/{commit_hash}", dependencies=[Depends(verify_token)])
def get_commit_diff(name: str, commit_hash: str):
    ws_path = resolve_workspace_path(name)
    if not commit_hash.isalnum():
        raise HTTPException(status_code=400, detail="Invalid commit hash")
    try:
        result = subprocess.run(
            ["git", "--no-pager", "diff", f"{commit_hash}~1", commit_hash],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        files_result = subprocess.run(
            ["git", "diff", "--name-only", f"{commit_hash}~1", commit_hash],
            capture_output=True, text=True, timeout=10, cwd=str(ws_path),
        )
        files = [f for f in files_result.stdout.splitlines() if f.strip()] if files_result.returncode == 0 else []
        return {
            "status": "ok" if result.returncode == 0 else "error",
            "files": files,
            "diff": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git diff timed out")


@app.get("/workspaces/{name}/diff", dependencies=[Depends(verify_token)])
def get_workspace_diff(name: str):
    ws_path = resolve_workspace_path(name)
    try:
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=10, cwd=str(ws_path),
        )
        diff_result = subprocess.run(
            ["git", "diff"],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        diff_staged_result = subprocess.run(
            ["git", "diff", "--staged"],
            capture_output=True, text=True, timeout=30, cwd=str(ws_path),
        )
        files = [
            line[3:] for line in status_result.stdout.splitlines() if len(line) > 3
        ] if status_result.returncode == 0 else []
        diff_text = ""
        if diff_staged_result.returncode == 0 and diff_staged_result.stdout:
            diff_text += diff_staged_result.stdout
        if diff_result.returncode == 0 and diff_result.stdout:
            if diff_text:
                diff_text += "\n"
            diff_text += diff_result.stdout
        return {
            "status": "ok",
            "files": files,
            "diff": diff_text,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git diff timed out")


@app.api_route(
    "/terminal/s/{session_id}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def terminal_http_proxy(session_id: str, path: str, request: Request):
    session = get_terminal_session(session_id)
    target_path = f"/terminal/s/{session_id}/{path}"
    if request.url.query:
        target_path += "?" + request.url.query

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in {"host", "connection", "content-length"}
    }
    body = await request.body()

    conn = http.client.HTTPConnection("127.0.0.1", session.port, timeout=30)
    try:
        conn.request(request.method, target_path, body=body, headers=headers)
        upstream = conn.getresponse()
        content = upstream.read()
        response_headers = {
            k: v
            for k, v in upstream.getheaders()
            if k.lower() not in {"transfer-encoding", "connection", "keep-alive"}
        }
        return Response(content=content, status_code=upstream.status, headers=response_headers)
    except OSError:
        raise HTTPException(status_code=502, detail="terminal upstream unavailable")
    finally:
        conn.close()


@app.websocket("/terminal/s/{session_id}/{path:path}")
async def terminal_ws_proxy(websocket: WebSocket, session_id: str, path: str):
    try:
        session = get_terminal_session(session_id)
    except HTTPException:
        await websocket.close(code=1008)
        return

    if not websockets_available():
        await websocket.accept()
        await websocket.send_text("websockets package is required on server")
        await websocket.close(code=1011)
        return

    import websockets  # type: ignore

    backend_path = f"/terminal/s/{session_id}/{path}"
    if websocket.url.query:
        backend_path += "?" + websocket.url.query
    backend_url = f"ws://127.0.0.1:{session.port}{backend_path}"

    client_subprotocols = websocket.headers.get("sec-websocket-protocol", "").split(",")
    client_subprotocols = [s.strip() for s in client_subprotocols if s.strip()]
    await websocket.accept(subprotocol=client_subprotocols[0] if client_subprotocols else None)
    try:
        async with websockets.connect(
            backend_url, max_size=None,
            subprotocols=[websockets.Subprotocol(s) for s in client_subprotocols] if client_subprotocols else None,
        ) as upstream:
            async def client_to_upstream():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                        data = msg.get("bytes")
                        if data is None and msg.get("text") is not None:
                            data = msg["text"].encode("utf-8")
                        if data:
                            await upstream.send(data)
                except (WebSocketDisconnect, OSError):
                    pass

            async def upstream_to_client():
                try:
                    async for message in upstream:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except (WebSocketDisconnect, OSError):
                    pass

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_upstream()),
                    asyncio.create_task(upstream_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except (WebSocketDisconnect, OSError, websockets.exceptions.ConnectionClosed):
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024


@app.post("/upload-image", dependencies=[Depends(verify_token)])
async def upload_image(file: UploadFile):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported type: {file.content_type}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = file.content_type.split("/")[-1].replace("jpeg", "jpg")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{timestamp}-{secrets.token_hex(4)}.{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(data)

    return {"status": "ok", "path": str(filepath)}


@app.post("/run", dependencies=[Depends(verify_token)])
def execute_job(body: RunRequest):
    ws_path = resolve_workspace_path(body.workspace)

    if body.job == "terminal":
        job_def = TERMINAL_JOB
    else:
        available_jobs = get_workspace_jobs(ws_path)
        job_def = available_jobs.get(body.job)
        if not job_def:
            raise HTTPException(status_code=400, detail=f"Unknown job: {body.job}")

    ordered_args: list[str] = []
    for arg_option in job_def.args:
        value = body.args.get(arg_option.name)
        if value is None:
            if arg_option.required:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required argument: {arg_option.name}",
                )
            continue

        if arg_option.dynamic == "branches":
            if not ws_path:
                raise HTTPException(status_code=400, detail="Workspace is required for this job")
            allowed = get_git_branches(ws_path)
            if value not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid branch: {value}",
                )
        elif arg_option.values and value not in arg_option.values:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid value for {arg_option.name}: {value} (allowed: {arg_option.values})",
            )
        ordered_args.append(value)

    workspace_path = str(ws_path) if ws_path else ""
    terminal_session_id: str | None = None
    extra_env: dict[str, str] | None = None
    if body.job == "terminal":
        if not websockets_available():
            return {
                "status": "error",
                "exit_code": 1,
                "stdout": "",
                "stderr": "server missing dependency: websockets (pip install websockets)",
            }
        terminal_session_id = secrets.token_urlsafe(24)
        extra_env = {"TERMINAL_BASE_PATH": f"/terminal/s/{terminal_session_id}"}

    try:
        result = run_job(job_def, ordered_args, workspace=workspace_path, extra_env=extra_env)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Job timed out")

    payload = {
        "status": "ok" if result.returncode == 0 else "error",
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }
    if body.job == "terminal":
        port, pid = parse_terminal_stdout(result.stdout)
        if payload["status"] == "ok" and port:
            session_id = terminal_session_id or secrets.token_urlsafe(24)
            TERMINAL_SESSIONS[session_id] = TerminalSession(
                workspace=body.workspace,
                port=port,
                pid=pid,
                expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
            )
            payload["port"] = port
            payload["session_id"] = session_id
            payload["terminal_url"] = f"/terminal/s/{session_id}/"
            payload["expires_in"] = TERMINAL_TIMEOUT_SEC
        elif payload["status"] == "ok":
            payload["status"] = "error"
            payload["stderr"] = (
                (payload.get("stderr") or "") + "\nfailed to parse ttyd port"
            ).strip()
    return payload


@app.get("/system/info", dependencies=[Depends(verify_token)])
def get_system_info():
    info = {}

    info["hostname"] = socket.gethostname()

    try:
        result = subprocess.run(
            ["hostname", "-I"], capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            addrs = result.stdout.strip().split()
            info["ip"] = addrs[0] if addrs else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        info["ip"] = ""

    try:
        os_release = Path("/etc/os-release").read_text(encoding="utf-8")
        for line in os_release.splitlines():
            if line.startswith("PRETTY_NAME="):
                info["os"] = line.split("=", 1)[1].strip('"')
                break
    except OSError:
        pass

    try:
        result = subprocess.run(
            ["uptime", "-p"], capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            info["uptime"] = result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    try:
        temp_raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        info["cpu_temp"] = f"{int(temp_raw) / 1000:.1f} °C"
    except (OSError, ValueError):
        pass

    try:
        meminfo = Path("/proc/meminfo").read_text(encoding="utf-8")
        mem = {}
        for line in meminfo.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0] in ("MemTotal:", "MemAvailable:"):
                mem[parts[0].rstrip(":")] = int(parts[1])
        if "MemTotal" in mem:
            total_gb = mem["MemTotal"] / 1024 / 1024
            available_gb = mem.get("MemAvailable", 0) / 1024 / 1024
            used_gb = total_gb - available_gb
            info["memory"] = f"{used_gb:.1f} / {total_gb:.1f} GB"
    except (OSError, ValueError):
        pass

    try:
        usage = shutil.disk_usage("/")
        total_gb = usage.total / (1024 ** 3)
        used_gb = usage.used / (1024 ** 3)
        info["disk"] = f"{used_gb:.1f} / {total_gb:.1f} GB"
    except OSError:
        pass

    return info


BOOT_VERSION = str(int(time.time()))


@app.get("/")
def serve_index():
    html = (UI_DIR / "index.html").read_text()
    html = re.sub(r'href="([^"]+\.css)"', rf'href="\1?v={BOOT_VERSION}"', html)
    html = re.sub(r'src="([^"]+\.js)"', rf'src="\1?v={BOOT_VERSION}"', html)
    return Response(content=html, media_type="text/html",
                    headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=str(UI_DIR)), name="ui")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8888)
