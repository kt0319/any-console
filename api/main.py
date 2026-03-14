from dotenv import load_dotenv

load_dotenv()

import logging
import re
import secrets
import socket
import subprocess
import time
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles

from .auth import verify_token
from .common import BACKGROUND_EXECUTOR, MAX_UPLOAD_SIZE, UPLOAD_DIR
from .icons import ICONS_DIR
from .rate_limiter import RateLimitMiddleware
from .routers import git, github, jobs, settings, system, terminal, workspaces

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

app = FastAPI(title="any-console")

BOOT_VERSION = str(int(time.time()))
UI_DIR = Path(__file__).resolve().parent.parent / "ui"
DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
FRONTEND_DIR = DIST_DIR if DIST_DIR.is_dir() else UI_DIR

app.include_router(workspaces.router)
app.include_router(git.router)
app.include_router(github.router)
app.include_router(jobs.router)
app.include_router(terminal.router)
app.include_router(terminal.ws_router)
app.include_router(system.router)
app.include_router(settings.router)


@app.on_event("shutdown")
def shutdown_cleanup():
    with terminal.sessions_lock:
        sessions = list(terminal.TERMINAL_SESSIONS.values())
    for session in sessions:
        terminal._detach_pty_bridge(session)
    BACKGROUND_EXECUTOR.shutdown(wait=False)


def _resolve_tailscale_name(ip: str) -> str:
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            for peer in (data.get("Peer") or {}).values():
                for addr in peer.get("TailscaleIPs", []):
                    if addr == ip:
                        return peer.get("HostName", "")
            self_ips = (data.get("Self") or {}).get("TailscaleIPs", [])
            if ip in self_ips:
                return data.get("Self", {}).get("HostName", "")
    except Exception:
        logger.debug("tailscale name resolve failed for %s", ip, exc_info=True)
    return ""


@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check(request: Request):
    client_ip = request.client.host if request.client else ""
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    client_name = _resolve_tailscale_name(client_ip)
    return {
        "status": "ok",
        "hostname": socket.gethostname(),
        "version": system.get_app_version(),
        "client_name": client_name or client_ip,
    }


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


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


@app.get("/")
def serve_index(request: Request):
    html = (FRONTEND_DIR / "index.html").read_text()
    if FRONTEND_DIR == UI_DIR:
        version = BOOT_VERSION
        cache_bust = request.query_params.get("_")
        if cache_bust and re.fullmatch(r"[0-9]{8,20}", cache_bust):
            version = cache_bust
        html = re.sub(r'href="(?!https?://)([^"]+\.css)"', rf'href="\1?v={version}"', html)
        html = re.sub(r'src="(?!https?://)([^"]+\.js)"', rf'src="\1?v={version}"', html)
    return Response(content=html, media_type="text/html", headers={"Cache-Control": "no-cache"})


ICONS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/icons", StaticFiles(directory=str(ICONS_DIR)), name="icons")
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR)), name="ui")

app.add_middleware(RateLimitMiddleware)

if __name__ == "__main__":
    import os

    ssl_kwargs = {}
    ssl_keyfile = os.environ.get("SSL_KEYFILE")
    ssl_certfile = os.environ.get("SSL_CERTFILE")
    if ssl_keyfile and ssl_certfile:
        ssl_kwargs["ssl_keyfile"] = ssl_keyfile
        ssl_kwargs["ssl_certfile"] = ssl_certfile
    port = int(os.environ.get("ANY_CONSOLE_PORT", "8888"))
    uvicorn.run(app, host="0.0.0.0", port=port, proxy_headers=True, forwarded_allow_ips="127.0.0.1", **ssl_kwargs)
