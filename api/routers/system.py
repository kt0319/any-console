import getpass
import logging
import platform
import re
import shutil
import socket
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import SYSTEM_CMD_TIMEOUT_SEC, run_subprocess_safe, sanitize_log_value
from ..errors import bad_request, conflict, not_found, server_error

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_token)])

IS_DARWIN = platform.system() == "Darwin"
PROCESS_LIST_LIMIT = 10
PS_FIELD_COUNT = 11

# any-console のリポジトリルート（git pull で自己更新する対象）。
REPO_DIR = str(Path(__file__).resolve().parent.parent.parent)
GIT_FETCH_TIMEOUT_SEC = 30.0


def _run_cmd_safe(cmd: list[str], timeout: float = SYSTEM_CMD_TIMEOUT_SEC, cwd: str | None = None) -> str | None:
    result = run_subprocess_safe(cmd, timeout=timeout, cwd=cwd)
    if result is not None and result.returncode == 0:
        return str(result.stdout)
    return None


def get_app_version() -> str:
    out = _run_cmd_safe(
        ["git", "log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M"],
        cwd=REPO_DIR,
    )
    return out.strip() if out and out.strip() else ""


def _git(args: list[str], timeout: float = SYSTEM_CMD_TIMEOUT_SEC):
    return run_subprocess_safe(["git", *args], timeout=timeout, cwd=REPO_DIR)


def _git_out(args: list[str], timeout: float = SYSTEM_CMD_TIMEOUT_SEC) -> str | None:
    r = _git(args, timeout=timeout)
    if r is not None and r.returncode == 0:
        return str(r.stdout).strip()
    return None


def get_app_release() -> str:
    """人間が読めるバージョン文字列。リリースタグ基準（例: v0.5.0-38-g844f239）。"""
    return _git_out(["describe", "--tags", "--always"]) or ""


def _get_ip() -> str | None:
    if not IS_DARWIN:
        out = _run_cmd_safe(["hostname", "-I"])
        if out:
            addrs = out.strip().split()
            if addrs:
                return addrs[0]
    try:
        return socket.gethostbyname(socket.gethostname())
    except socket.gaierror as e:
        logger.debug("gethostbyname failed: %s", e)
        return None


def _get_os_name() -> str | None:
    if IS_DARWIN:
        mac_ver = platform.mac_ver()[0]
        return f"macOS {mac_ver}" if mac_ver else "macOS"
    try:
        os_release = Path("/etc/os-release").read_text(encoding="utf-8")
        for line in os_release.splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip('"')
    except OSError as e:
        logger.debug("os-release read failed: %s", e)
    return None


def _format_uptime_seconds(elapsed: int) -> str:
    days, rem = divmod(elapsed, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    parts = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    return "up " + ", ".join(parts) if parts else "up 0 minutes"


def _get_uptime() -> str | None:
    if IS_DARWIN:
        out = _run_cmd_safe(["sysctl", "-n", "kern.boottime"])
        if out:
            m = re.search(r"sec\s*=\s*(\d+)", out)
            if m:
                return _format_uptime_seconds(int(time.time()) - int(m.group(1)))
        return None
    out = _run_cmd_safe(["uptime", "-p"])
    return out.strip() if out else None


def _get_cpu_temp() -> str | None:
    if IS_DARWIN:
        return None
    try:
        temp_raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        return f"{int(temp_raw) / 1000:.1f} °C"
    except (OSError, ValueError) as e:
        logger.debug("cpu temp read failed: %s", e)
        return None


def _get_memory_darwin() -> str | None:
    try:
        memsize_out = _run_cmd_safe(["sysctl", "-n", "hw.memsize"])
        if not memsize_out:
            return None
        total_bytes = int(memsize_out.strip())
        vmstat_out = _run_cmd_safe(["vm_stat"])
        if not vmstat_out:
            return None
        ps_match = re.search(r"page size of (\d+) bytes", vmstat_out)
        page_size = int(ps_match.group(1)) if ps_match else 16384
        free_pages = 0
        for key in ("Pages free", "Pages inactive", "Pages speculative"):
            m = re.search(rf"{key}:\s+(\d+)", vmstat_out)
            if m:
                free_pages += int(m.group(1))
        available_bytes = free_pages * page_size
        total_gb = total_bytes / (1024 ** 3)
        used_gb = (total_bytes - available_bytes) / (1024 ** 3)
        return f"{used_gb:.1f} / {total_gb:.1f} GB"
    except ValueError as e:
        logger.debug("macOS memory info failed: %s", e)
        return None


def _get_memory_linux() -> str | None:
    try:
        meminfo = Path("/proc/meminfo").read_text(encoding="utf-8")
    except (OSError, ValueError) as e:
        logger.debug("memory info read failed: %s", e)
        return None
    mem = {}
    for line in meminfo.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] in ("MemTotal:", "MemAvailable:"):
            try:
                mem[parts[0].rstrip(":")] = int(parts[1])
            except ValueError:
                return None
    if "MemTotal" not in mem:
        return None
    total_gb = mem["MemTotal"] / 1024 / 1024
    available_gb = mem.get("MemAvailable", 0) / 1024 / 1024
    used_gb = total_gb - available_gb
    return f"{used_gb:.1f} / {total_gb:.1f} GB"


def _get_memory() -> str | None:
    return _get_memory_darwin() if IS_DARWIN else _get_memory_linux()


@router.get("/system/processes")
def get_system_processes():
    process_limit = PROCESS_LIST_LIMIT
    cmd = ["ps", "aux", "-r"] if IS_DARWIN else ["ps", "aux", "--sort=-%cpu"]
    result = run_subprocess_safe(cmd, timeout=SYSTEM_CMD_TIMEOUT_SEC)
    if result is None or result.returncode != 0:
        raise server_error("ps command failed")

    lines = result.stdout.strip().splitlines()
    processes = []
    for line in lines[1:process_limit + 1]:
        parts = line.split(None, PS_FIELD_COUNT - 1)
        if len(parts) < PS_FIELD_COUNT:
            continue
        processes.append(
            {
                "pid": int(parts[1]),
                "name": Path(parts[10].split()[0]).name,
                "cpu": float(parts[2]),
                "mem": float(parts[3]),
                "command": parts[10],
            }
        )
    return processes


class ClientErrorReport(BaseModel):
    type: str = Field(..., max_length=40)
    message: str = Field("", max_length=2000)
    stack: str = Field("", max_length=10000)
    source: str = Field("", max_length=500)
    lineno: int | None = None
    colno: int | None = None
    url: str = Field("", max_length=500)
    user_agent: str = Field("", max_length=500)
    info: str = Field("", max_length=1000)


@router.post("/client-errors")
def report_client_error(body: ClientErrorReport):
    logger.warning(
        "client-error type=%s url=%s message=%s info=%s source=%s:%s:%s ua=%s\n%s",
        sanitize_log_value(body.type),
        sanitize_log_value(body.url),
        sanitize_log_value(body.message),
        sanitize_log_value(body.info),
        sanitize_log_value(body.source),
        body.lineno if body.lineno is not None else "?",
        body.colno if body.colno is not None else "?",
        sanitize_log_value(body.user_agent),
        sanitize_log_value(body.stack),
    )
    return {"status": "ok"}


class TmuxKillBody(BaseModel):
    name: str


@router.post("/system/tmux/kill")
def kill_tmux_session(body: TmuxKillBody):
    """指定名の tmux セッションを kill する。ac- プレフィックスなしの
    ユーザ個人セッションを管理画面から削除するために使う。"""
    from ..tmux import kill_tmux_by_name, tmux_session_exists
    name = body.name.strip()
    if not name:
        raise bad_request("Empty session name")
    if not tmux_session_exists(name):
        raise not_found("Session not found")
    kill_tmux_by_name(name)
    return {"ok": True}


class TmuxAdoptBody(BaseModel):
    name: str


@router.post("/system/tmux/adopt")
def adopt_tmux_session(body: TmuxAdoptBody):
    """外部 tmux セッションを any-console 管理化（ac- プレフィックス）にリネームする。

    元の名前を識別子として残しつつ、ランダム ID を付与して衝突を避ける。
    リネーム後は通常の any-console セッションとして UI でタブ化できる。
    """
    import re as _re
    import secrets

    from ..common import TMUX_SESSION_PREFIX
    from ..tmux import _run_tmux_cmd, tmux_session_exists
    name = body.name.strip()
    if not name:
        raise bad_request("Empty session name")
    if name.startswith(TMUX_SESSION_PREFIX):
        raise bad_request("Already managed by any-console")
    if not tmux_session_exists(name):
        raise not_found("Session not found")
    safe = _re.sub(r"[^a-zA-Z0-9_-]", "_", name)
    session_id = f"{safe}-{secrets.token_urlsafe(6)}"
    new_name = f"{TMUX_SESSION_PREFIX}{session_id}"
    result = _run_tmux_cmd("rename-session", "-t", name, new_name)
    if not result or result.returncode != 0:
        stderr = (result.stderr if result else "").strip()
        raise server_error(f"Failed to rename tmux session: {stderr or 'unknown'}")
    logger.info("adopted external tmux session %s -> %s", name, new_name)
    return {"ok": True, "session_id": session_id, "tmux_name": new_name}


@router.get("/system/tmux-info")
def get_tmux_info():
    from ..tmux import _run_tmux_cmd
    info: dict[str, Any] = {"version": "", "sessions": [], "available": False}
    version_res = _run_tmux_cmd("-V")
    if version_res and version_res.returncode == 0:
        info["version"] = version_res.stdout.strip().replace("tmux ", "")
        info["available"] = True
    fmt = "#{session_name}\t#{session_created}\t#{session_windows}\t#{session_attached}"
    sessions_res = _run_tmux_cmd("list-sessions", "-F", fmt)
    if sessions_res and sessions_res.returncode == 0:
        for line in sessions_res.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) < 4:
                continue
            name, created, windows, attached = parts[0], parts[1], parts[2], parts[3]
            try:
                created_int = int(created)
            except ValueError:
                created_int = 0
            info["sessions"].append({
                "name": name,
                "created": created_int,
                "windows": int(windows) if windows.isdigit() else 0,
                "attached": attached == "1",
            })
    return info


@router.get("/system/info")
def get_system_info():
    info = {"hostname": socket.gethostname(), "user": getpass.getuser(), "work_dir": str(Path.home())}
    release = get_app_release()
    if release:
        info["version"] = release
    for key, getter in [
        ("ip", _get_ip),
        ("os", _get_os_name),
        ("uptime", _get_uptime),
        ("cpu_temp", _get_cpu_temp),
        ("memory", _get_memory),
    ]:
        value = getter()
        if value is not None:
            info[key] = value

    try:
        usage = shutil.disk_usage("/")
        total_gb = usage.total / (1024 ** 3)
        used_gb = usage.used / (1024 ** 3)
        info["disk"] = f"{used_gb:.1f} / {total_gb:.1f} GB"
    except OSError:
        pass

    return info


@router.get("/system/update/check")
def check_update():
    """追跡ブランチ（通常 origin/main）に対する更新の有無を返す。

    リリースは release-please が main 上のコミット（タグ）として作るため、
    main を追う＝最新リリースを取り込むことになる。current/latest はリリース
    タグ（例: v0.5.0）で示し、behind は未取り込みコミット数。
    """
    branch = _git_out(["rev-parse", "--abbrev-ref", "HEAD"])
    if branch is None:
        raise server_error("Not a git repository; cannot check for updates")

    upstream = _git_out(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    if not upstream:
        upstream = f"origin/{branch}"
    remote = upstream.split("/", 1)[0]

    fetched = _git(["fetch", "--tags", "--quiet", remote], timeout=GIT_FETCH_TIMEOUT_SEC)
    fetch_ok = fetched is not None and fetched.returncode == 0

    behind = _git_out(["rev-list", "--count", f"HEAD..{upstream}"])
    ahead = _git_out(["rev-list", "--count", f"{upstream}..HEAD"])
    behind_n = int(behind) if behind and behind.isdigit() else 0
    ahead_n = int(ahead) if ahead and ahead.isdigit() else 0

    return {
        "branch": branch,
        "upstream": upstream,
        "version": get_app_release(),
        "current_release": _git_out(["describe", "--tags", "--abbrev=0"]) or "",
        "latest_release": _git_out(["describe", "--tags", "--abbrev=0", upstream]) or "",
        "behind": behind_n,
        "ahead": ahead_n,
        "update_available": behind_n > 0,
        "fetch_ok": fetch_ok,
    }


@router.post("/system/update/apply")
def apply_update():
    """追跡ブランチへ git pull --ff-only で更新する。反映には再起動が必要。"""
    status = _git_out(["status", "--porcelain"])
    if status is None:
        raise server_error("Not a git repository; cannot update")
    if status:
        raise conflict("Uncommitted changes present. Commit or stash before updating.")

    result = _git(["pull", "--ff-only"], timeout=GIT_FETCH_TIMEOUT_SEC)
    if result is None:
        raise server_error("git pull failed to run")
    if result.returncode != 0:
        raise server_error(f"git pull failed: {(result.stderr or '').strip()[:300]}")

    return {
        "ok": True,
        "version": get_app_release(),
        "restart_required": True,
        "output": (result.stdout or "").strip(),
    }
