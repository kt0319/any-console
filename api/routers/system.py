import getpass
import logging
import platform
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, Depends

from ..auth import verify_token
from ..common import SYSTEM_CMD_TIMEOUT_SEC, default_workspace_dir
from ..errors import server_error

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_token)])

IS_DARWIN = platform.system() == "Darwin"


def get_app_version() -> str:
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M"],
            capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            cwd=str(Path(__file__).resolve().parent.parent.parent),
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.debug("app version fetch failed: %s", e)
    return ""


def _get_ip() -> str | None:
    if not IS_DARWIN:
        try:
            result = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC)
            if result.returncode == 0:
                addrs = result.stdout.strip().split()
                if addrs:
                    return addrs[0]
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            logger.debug("hostname -I failed: %s", e)
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


def _get_uptime() -> str | None:
    if IS_DARWIN:
        try:
            result = subprocess.run(
                ["sysctl", "-n", "kern.boottime"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            )
            if result.returncode == 0:
                m = re.search(r"sec\s*=\s*(\d+)", result.stdout)
                if m:
                    boot_sec = int(m.group(1))
                    elapsed = int(time.time()) - boot_sec
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
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            logger.debug("macOS uptime failed: %s", e)
        return None
    try:
        result = subprocess.run(["uptime", "-p"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC)
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.debug("uptime -p failed: %s", e)
    return None


def _get_cpu_temp() -> str | None:
    if IS_DARWIN:
        return None
    try:
        temp_raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        return f"{int(temp_raw) / 1000:.1f} °C"
    except (OSError, ValueError) as e:
        logger.debug("cpu temp read failed: %s", e)
        return None


def _get_memory() -> str | None:
    if IS_DARWIN:
        try:
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            )
            if result.returncode != 0:
                return None
            total_bytes = int(result.stdout.strip())

            result = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC)
            if result.returncode != 0:
                return None
            page_size = 16384
            ps_match = re.search(r"page size of (\d+) bytes", result.stdout)
            if ps_match:
                page_size = int(ps_match.group(1))
            free_pages = 0
            for key in ("Pages free", "Pages inactive", "Pages speculative"):
                m = re.search(rf"{key}:\s+(\d+)", result.stdout)
                if m:
                    free_pages += int(m.group(1))
            available_bytes = free_pages * page_size
            total_gb = total_bytes / (1024 ** 3)
            used_gb = (total_bytes - available_bytes) / (1024 ** 3)
            return f"{used_gb:.1f} / {total_gb:.1f} GB"
        except (subprocess.TimeoutExpired, FileNotFoundError, ValueError) as e:
            logger.debug("macOS memory info failed: %s", e)
            return None
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
            return f"{used_gb:.1f} / {total_gb:.1f} GB"
    except (OSError, ValueError) as e:
        logger.debug("memory info read failed: %s", e)
    return None


@router.get("/system/processes")
def get_system_processes():
    process_limit = 15
    try:
        cmd = ["ps", "aux", "-r"] if IS_DARWIN else ["ps", "aux", "--sort=-%cpu"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC)
        if result.returncode != 0:
            raise server_error("ps command failed")
    except subprocess.TimeoutExpired:
        raise server_error("ps command timed out") from None
    except FileNotFoundError:
        raise server_error("ps command not found") from None

    lines = result.stdout.strip().splitlines()
    processes = []
    for line in lines[1:process_limit + 1]:
        parts = line.split(None, 10)
        if len(parts) < 11:
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


@router.get("/system/info")
def get_system_info():
    info = {"hostname": socket.gethostname(), "user": getpass.getuser(), "work_dir": str(default_workspace_dir())}
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
