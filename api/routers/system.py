import getpass
import logging
import platform
import re
import shutil
import socket
import time
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import verify_token
from ..common import SYSTEM_CMD_TIMEOUT_SEC, run_subprocess_safe, sanitize_log_value
from ..errors import server_error

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_token)])

IS_DARWIN = platform.system() == "Darwin"
PROCESS_LIST_LIMIT = 15
PS_FIELD_COUNT = 11


def _run_cmd_safe(cmd: list[str], timeout: float = SYSTEM_CMD_TIMEOUT_SEC, cwd: str | None = None) -> str | None:
    result = run_subprocess_safe(cmd, timeout=timeout, cwd=cwd)
    if result is not None and result.returncode == 0:
        return str(result.stdout)
    return None


def get_app_version() -> str:
    out = _run_cmd_safe(
        ["git", "log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M"],
        cwd=str(Path(__file__).resolve().parent.parent.parent),
    )
    return out.strip() if out and out.strip() else ""


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


@router.get("/system/info")
def get_system_info():
    info = {"hostname": socket.gethostname(), "user": getpass.getuser(), "work_dir": str(Path.home())}
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
