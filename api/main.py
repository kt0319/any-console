from dotenv import load_dotenv

load_dotenv()

import logging
import platform
import re
import secrets
import shutil
import socket
import subprocess
import time
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles

from .auth import verify_token
from .common import BACKGROUND_EXECUTOR, SYSTEM_CMD_TIMEOUT_SEC, UPLOAD_DIR, WORK_DIR, load_all_config, save_all_config
from .common import LOG_BUFFER
from .routers import git, jobs, logs, terminal, workspaces

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

app = FastAPI(title="pi-console")

BOOT_VERSION = str(int(time.time()))

UI_DIR = Path(__file__).resolve().parent.parent / "ui"

app.include_router(workspaces.router)
app.include_router(git.router)
app.include_router(jobs.router)
app.include_router(terminal.router)
app.include_router(terminal.ws_router)


@app.on_event("shutdown")
def shutdown_executor():
    BACKGROUND_EXECUTOR.shutdown(wait=False)


@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check():
    return {"ok": True, "hostname": socket.gethostname(), "version": _get_app_version()}


def _get_app_version() -> str:
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M"],
            capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        pass
    return ""


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


IS_DARWIN = platform.system() == "Darwin"


def _get_ip() -> str | None:
    if not IS_DARWIN:
        try:
            result = subprocess.run(
                ["hostname", "-I"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            )
            if result.returncode == 0:
                addrs = result.stdout.strip().split()
                if addrs:
                    return addrs[0]
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except socket.gaierror:
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
    except OSError:
        pass
    return None


def _get_uptime() -> str | None:
    if IS_DARWIN:
        try:
            result = subprocess.run(
                ["sysctl", "-n", "kern.boottime"],
                capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
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
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        return None
    try:
        result = subprocess.run(
            ["uptime", "-p"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def _get_cpu_temp() -> str | None:
    if IS_DARWIN:
        return None
    try:
        temp_raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        return f"{int(temp_raw) / 1000:.1f} °C"
    except (OSError, ValueError):
        return None


def _get_memory() -> str | None:
    if IS_DARWIN:
        try:
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            )
            if result.returncode != 0:
                return None
            total_bytes = int(result.stdout.strip())

            result = subprocess.run(
                ["vm_stat"], capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
            )
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
        except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
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
    except (OSError, ValueError):
        pass
    return None


@app.get("/system/processes", dependencies=[Depends(verify_token)])
def get_system_processes():
    PROCESS_LIMIT = 15
    try:
        if IS_DARWIN:
            cmd = ["ps", "aux", "-r"]
        else:
            cmd = ["ps", "aux", "--sort=-%cpu"]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=SYSTEM_CMD_TIMEOUT_SEC,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail="ps command failed")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="ps command timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="ps command not found")

    lines = result.stdout.strip().splitlines()
    processes = []
    for line in lines[1:PROCESS_LIMIT + 1]:
        parts = line.split(None, 10)
        if len(parts) < 11:
            continue
        processes.append({
            "pid": int(parts[1]),
            "name": Path(parts[10].split()[0]).name,
            "cpu": float(parts[2]),
            "mem": float(parts[3]),
            "command": parts[10],
        })
    return processes


@app.get("/system/info", dependencies=[Depends(verify_token)])
def get_system_info():
    info = {}

    info["hostname"] = socket.gethostname()

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


def _existing_workspace_names() -> set[str]:
    if not WORK_DIR.is_dir():
        return set()
    return {
        d.name for d in WORK_DIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    }


@app.get("/settings/export", dependencies=[Depends(verify_token)])
def export_settings():
    config = load_all_config()
    existing = _existing_workspace_names()
    return {k: v for k, v in config.items() if k in existing}


@app.post("/settings/import", dependencies=[Depends(verify_token)])
async def import_settings(request: Request):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Expected JSON object")
    existing = _existing_workspace_names()
    current = load_all_config()
    for name, ws_config in data.items():
        if name in existing and isinstance(ws_config, dict):
            current[name] = ws_config
    save_all_config(current)
    return {"status": "ok"}


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
