import asyncio
import fcntl
import hmac
import ipaddress
import logging
import os
import re
import secrets
import shutil
import socket
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth as auth_module
from .auth import COOKIE_NAME_TOKEN, verify_token
from .client_log import ClientLogMiddleware
from .common import BACKGROUND_EXECUTOR, MAX_UPLOAD_SIZE, UPLOAD_DIR
from .errors import bad_request, too_large, unauthorized
from .icons import ICONS_DIR
from .rate_limiter import RateLimitMiddleware
from .routers import groups, git, github, job_runner, jobs, rss, settings, system, terminal, workspaces

DEFAULT_HOST = "0.0.0.0"  # noqa: S104 (intentional: local network bind for personal console)
DEFAULT_PORT = 8888

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


def _resolve_bind() -> tuple[str, int]:
    """config.json の __global__.host / __global__.port を読む。未設定はデフォルト。"""
    from .config import load_global_config_section
    host = load_global_config_section("host", "") or DEFAULT_HOST
    port_raw = load_global_config_section("port", 0)
    try:
        port = int(port_raw) if port_raw else DEFAULT_PORT
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    return str(host), port


def _is_loopback_host(host: str) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _is_auth_disabled() -> bool:
    if os.environ.get("ANY_CONSOLE_DISABLE_AUTH", "").strip() == "1":
        return True
    try:
        from .config import load_global_config_section
        return bool(load_global_config_section("auth_disabled", False))
    except Exception:
        return False


def _print_token_url(host: str, port: int, token: str) -> None:
    display_host = "localhost" if host in ("0.0.0.0", "::", "") else host  # noqa: S104
    url = f"http://{display_host}:{port}/?token={token}"
    border = "=" * 64
    msg = (
        f"\n{border}\n"
        f"any-console: Auth token (open this URL on your device):\n"
        f"  {url}\n"
        f"{border}"
    )
    print(msg, flush=True)  # noqa: T201
    logger.info("any-console: Auth token URL: %s", url)


def _emit_insecure_bind_warning(host: str) -> None:
    if auth_module.ANY_CONSOLE_TOKEN or _is_loopback_host(host) or _is_auth_disabled():
        return
    border = "!" * 72
    logger.warning(
        "\n%s\n"
        "any-console is bound to %s with NO authentication token set.\n"
        "Anyone who can reach this port can run commands and modify Git state.\n"
        "  - Set a token from UI > Security\n"
        "%s",
        border, host, border,
    )


_singleton_lock_fd: int | None = None


def _acquire_singleton_lock(port: int) -> bool:
    """Reject extra workers (uvicorn --workers N).

    any-console relies on in-process state (terminal sessions, rate-limit
    counters, TTL caches), so multiple workers would corrupt state silently.
    """
    global _singleton_lock_fd
    lock_path = Path(tempfile.gettempdir()) / f"any-console-{port}.lock"
    try:
        fd = os.open(str(lock_path), os.O_WRONLY | os.O_CREAT, 0o600)
    except OSError as e:
        logger.warning("singleton lock open failed (%s); continuing", e)
        return True
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        logger.error(
            "another any-console worker is already running on port %s. "
            "any-console requires a single uvicorn worker (do not pass --workers > 1).",
            port,
        )
        return False
    try:
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
    except OSError:
        pass
    _singleton_lock_fd = fd
    return True


def _release_singleton_lock() -> None:
    global _singleton_lock_fd
    if _singleton_lock_fd is None:
        return
    try:
        fcntl.flock(_singleton_lock_fd, fcntl.LOCK_UN)
        os.close(_singleton_lock_fd)
    except OSError:
        pass
    _singleton_lock_fd = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    host, port = _resolve_bind()
    if not _acquire_singleton_lock(port):
        raise SystemExit(1)
    if not _is_auth_disabled():
        auto_token = auth_module.ensure_default_token()
        if auto_token:
            _print_token_url(host, port, auto_token)
    _emit_insecure_bind_warning(host)
    yield
    from .terminal_session import TERMINAL_SESSIONS, _detach_pty_bridge, sessions_lock
    with sessions_lock:
        sessions = list(TERMINAL_SESSIONS.values())
    for session in sessions:
        _detach_pty_bridge(session)
    BACKGROUND_EXECUTOR.shutdown(wait=False)
    _release_singleton_lock()


app = FastAPI(title="any-console", lifespan=lifespan)

BOOT_VERSION = str(int(time.time()))
UI_DIR = Path(__file__).resolve().parent.parent / "ui"
DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
FRONTEND_DIR = DIST_DIR if DIST_DIR.is_dir() else UI_DIR

app.include_router(workspaces.router)
app.include_router(groups.router)
app.include_router(git.router)
app.include_router(github.router)
app.include_router(rss.router)
app.include_router(jobs.router)
app.include_router(job_runner.router)
app.include_router(terminal.router)
app.include_router(terminal.ws_router)
app.include_router(system.router)
app.include_router(settings.router)



@app.get("/auth/check", dependencies=[Depends(verify_token)])
def auth_check():
    return {
        "status": "ok",
        "hostname": socket.gethostname(),
        "version": system.get_app_version(),
    }


COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60


class LoginBody(BaseModel):
    token: str = ""


def _set_session_cookie(response: Response, request: Request, value: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME_TOKEN,
        value=value,
        max_age=COOKIE_MAX_AGE_SEC,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        path="/",
    )


@app.post("/auth/login")
def auth_login(body: LoginBody, request: Request, response: Response):
    if not auth_module.ANY_CONSOLE_TOKEN:
        return {"ok": True, "auth_required": False}
    if not body.token or not hmac.compare_digest(body.token, auth_module.ANY_CONSOLE_TOKEN):
        raise unauthorized("Invalid token")
    _set_session_cookie(response, request, body.token)
    return {"ok": True, "auth_required": True}


@app.post("/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(COOKIE_NAME_TOKEN, path="/")
    return {"ok": True}


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


async def _write_image_to_clipboard(filepath: Path, content_type: str) -> bool:
    if not sys.platform.startswith("linux") or not shutil.which("xclip"):
        return False
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
        if proc.stdin is None or proc.stderr is None:
            return False
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

    data = await file.read(MAX_UPLOAD_SIZE + 1)
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
    ssl_keyfile = os.environ.get("SSL_KEYFILE")
    ssl_certfile = os.environ.get("SSL_CERTFILE")
    host, port = _resolve_bind()
    if ssl_keyfile and ssl_certfile:
        uvicorn.run(app, host=host, port=port, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                    ssl_keyfile=ssl_keyfile, ssl_certfile=ssl_certfile)
    else:
        uvicorn.run(app, host=host, port=port, proxy_headers=True, forwarded_allow_ips="127.0.0.1")
