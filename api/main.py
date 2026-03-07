from dotenv import load_dotenv

load_dotenv()

import logging
import re
import secrets
import socket
import time
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles

from .auth import verify_token
from .common import BACKGROUND_EXECUTOR, LOG_BUFFER, MAX_UPLOAD_SIZE, UPLOAD_DIR, _current_device
from .icons import ICONS_DIR
from .rate_limiter import RateLimitMiddleware
from .routers import git, github, jobs, logs, settings, system, terminal, workspaces

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

app = FastAPI(title="pi-console")

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
app.include_router(logs.router)
app.include_router(system.router)
app.include_router(settings.router)


EXCLUDE_LOG_PREFIXES = (
    "/logs",
    "/auth/check",
    "/system/",
    "/icons/",
    "/ui/",
    "/styles",
    "/app.",
    "/state.",
    "/auth.",
    "/workspace.",
    "/git.",
    "/jobs.",
    "/terminal.",
    "/settings.",
    "/quick-input.",
    "/icon-picker.",
    "/utils.",
    "/favicon",
    "/sw.js",
    "/manifest",
    "/icon-",
)


@app.middleware("http")
async def set_device_name(request: Request, call_next):
    device = request.headers.get("X-Device-Name", "")
    _current_device.set(device)
    return await call_next(request)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    path = request.url.path
    if any(path.startswith(p) for p in EXCLUDE_LOG_PREFIXES):
        return await call_next(request)
    if path == "/" and request.method == "GET":
        return await call_next(request)

    start = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000)

    LOG_BUFFER.add(
        {
            "ts": datetime.now().astimezone().isoformat(),
            "method": request.method,
            "path": path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "detail": "",
        }
    )
    return response



@app.on_event("shutdown")
def shutdown_cleanup():
    with terminal._sessions_lock:
        sessions = list(terminal.TERMINAL_SESSIONS.values())
    for session in sessions:
        terminal._detach_pty_bridge(session)
    BACKGROUND_EXECUTOR.shutdown(wait=False)


@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check():
    return {"status": "ok", "hostname": socket.gethostname(), "version": system.get_app_version()}


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
    port = int(os.environ.get("PI_CONSOLE_PORT", "8888"))
    uvicorn.run(app, host="0.0.0.0", port=port, **ssl_kwargs)
