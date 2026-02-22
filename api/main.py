from dotenv import load_dotenv

load_dotenv()

import logging
import re
import secrets
import shutil
import socket
import subprocess
import time
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Response, UploadFile
from fastapi.staticfiles import StaticFiles

from .auth import verify_token
from .common import BACKGROUND_EXECUTOR, UPLOAD_DIR
from .routers import git, jobs, terminal, workspaces

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

app = FastAPI(title="pi-console")

UI_DIR = Path(__file__).resolve().parent.parent / "ui"

terminal.recover_terminal_sessions()

app.include_router(workspaces.router)
app.include_router(git.router)
app.include_router(jobs.router)
app.include_router(terminal.router)
app.include_router(terminal.terminal_proxy_router)


@app.on_event("shutdown")
def shutdown_executor():
    BACKGROUND_EXECUTOR.shutdown(wait=False)


@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check():
    return {"ok": True}


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
