from dotenv import load_dotenv

load_dotenv()

import asyncio
import logging
import re
import secrets
import socket
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles

from .auth import get_client_ip, get_client_name, is_tailscale_ip, verify_token
from .client_log import ClientLogMiddleware
from .common import BACKGROUND_EXECUTOR, MAX_UPLOAD_SIZE, UPLOAD_DIR, set_workspace_root
from .errors import bad_request, too_large
from .icons import ICONS_DIR
from .rate_limiter import RateLimitMiddleware
from .routers import git, github, jobs, settings, system, terminal, workspaces

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .config import load_global_config_section
    ws_root = load_global_config_section("workspace_root", "")
    if ws_root and isinstance(ws_root, str):
        set_workspace_root(ws_root)
    yield
    from .terminal_session import TERMINAL_SESSIONS, _detach_pty_bridge, sessions_lock
    with sessions_lock:
        sessions = list(TERMINAL_SESSIONS.values())
    for session in sessions:
        _detach_pty_bridge(session)
    BACKGROUND_EXECUTOR.shutdown(wait=False)


app = FastAPI(title="any-console", lifespan=lifespan)

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



@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check(
    client_ip: str = Depends(get_client_ip),
    client_name: str = Depends(get_client_name),
):
    return {
        "status": "ok",
        "hostname": socket.gethostname(),
        "version": system.get_app_version(),
        "client_name": client_name,
        "vpn": is_tailscale_ip(client_ip),
    }


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


async def _write_image_to_clipboard(filepath: Path, content_type: str) -> bool:
    import os
    mime = content_type if content_type.startswith("image/") else "image/png"
    import getpass
    user = os.environ.get("SUDO_USER") or os.environ.get("USER") or getpass.getuser()
    try:
        image_data = filepath.read_bytes()
        proc = await asyncio.create_subprocess_exec(
            "sudo", "-u", user, "env", "DISPLAY=:0",
            "xclip", "-selection", "clipboard", "-t", mime,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        proc.stdin.write(image_data)
        await proc.stdin.drain()
        proc.stdin.close()
        await asyncio.wait_for(proc.wait(), timeout=3.0)
        if proc.returncode == 0:
            logger.info("xclip ok pid=%d user=%s", proc.pid, user)
            return True
        stderr = (await proc.stderr.read()).decode()
        logger.warning("xclip failed returncode=%d stderr=%s", proc.returncode, stderr)
        return False
    except OSError as e:
        logger.warning("xclip failed: %s", e)
        return False


@app.post("/upload-image", dependencies=[Depends(verify_token)])
async def upload_image(file: UploadFile):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise bad_request(f"Unsupported type: {file.content_type}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise too_large("File too large (max 10MB)")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = file.content_type.split("/")[-1].replace("jpeg", "jpg")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{timestamp}-{secrets.token_hex(4)}.{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(data)

    clipboard_ok = await _write_image_to_clipboard(filepath, file.content_type)
    return {"status": "ok", "path": str(filepath), "clipboard": clipboard_ok}


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


@app.get("/sw.js")
def serve_sw():
    sw_file = FRONTEND_DIR / "sw.js"
    content = sw_file.read_text()
    if FRONTEND_DIR == UI_DIR:
        content = content.replace("__BUILD_HASH__", BOOT_VERSION)
    return Response(content=content, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


ICONS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/icons", StaticFiles(directory=str(ICONS_DIR)), name="icons")
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR)), name="ui")

app.add_middleware(ClientLogMiddleware)
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
