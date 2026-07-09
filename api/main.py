import asyncio
import fcntl
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

from . import auth as auth_module
from .auth import verify_token
from .client_log import ClientLogMiddleware
from .common import BACKGROUND_EXECUTOR, MAX_UPLOAD_SIZE, UPLOAD_DIR
from .errors import bad_request, too_large
from .icons import ICONS_DIR
from .rate_limiter import RateLimitMiddleware
from .routers import devices as devices_router
from .routers import (
    dispatch,
    git,
    github,
    groups,
    job_runner,
    jobs,
    settings,
    status_stream,
    system,
    terminal,
    workspaces,
)
from .routers import preview as preview_router
from .routers import push as push_router
from .security_headers import SecurityHeadersMiddleware

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
    except OSError:
        return False


def _print_token_notice(host: str, port: int, token: str) -> None:
    # SECURITY: トークンを URL のクエリに埋め込まない。埋め込むとブラウザ履歴・
    # プロキシ/アクセスログに残る（UI はクエリの token を消費しないので利点もない）。
    # 起動ログへの平文出力は初回ブートストラップに必要な一度きりの妥協。
    display_host = "localhost" if host in ("0.0.0.0", "::", "") else host  # noqa: S104
    url = f"http://{display_host}:{port}/"
    border = "=" * 64
    msg = (
        f"\n{border}\n"
        f"any-console: First-run auth token:\n"
        f"  {token}\n"
        f"Open {url} on your device and sign in with this token.\n"
        f"{border}"
    )
    print(msg, flush=True)  # noqa: T201


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
            _print_token_notice(host, port, auto_token)
    _emit_insecure_bind_warning(host)
    from .preview import set_self_ports, start_scanner, stop_scanner
    from .push import has_subscriptions, init_vapid
    _display_host = "localhost" if host in ("0.0.0.0", "::", "") else host  # noqa: S104
    init_vapid(sub=f"https://{_display_host}")
    set_self_ports([port])
    start_scanner()
    if has_subscriptions():
        from .agent_watch import ensure_phrase_task
        ensure_phrase_task()
    yield
    stop_scanner()
    from .agent_watch import shutdown as agent_watch_shutdown
    agent_watch_shutdown()
    from .git_watch import shutdown as git_watch_shutdown
    git_watch_shutdown()
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
app.include_router(jobs.router)
app.include_router(job_runner.router)
app.include_router(dispatch.router)
app.include_router(devices_router.router)
app.include_router(preview_router.router)
app.include_router(terminal.router)
app.include_router(terminal.ws_router)
app.include_router(status_stream.ws_router)
app.include_router(system.router)
app.include_router(settings.router)
app.include_router(push_router.router)



def _autoregister_device(request: Request, response: Response, source: str) -> dict | None:
    """device cookie が無ければデバイスを登録して cookie を発行する。

    cookie に既に有効な device があればスキップ。stale な場合は同一UA・sourceの
    既存デバイスを再利用（secret 再発行）し、見つからなければ新規登録する。
    """
    from .devices import (
        autoname_from_user_agent,
        find_or_register_device,
        get_device,
        verify_device,
    )
    from .routers.devices import _set_device_cookies
    existing = verify_device(
        request.cookies.get("any_console_device", ""),
        request.cookies.get("any_console_secret", ""),
    )
    if existing:
        return existing
    ua = request.headers.get("user-agent", "")
    name = autoname_from_user_agent(ua)
    device_id, raw_secret = find_or_register_device(name, ua, source=source)
    _set_device_cookies(response, request, device_id, raw_secret)
    return get_device(device_id)


@app.get("/auth/check")
async def auth_check(request: Request, response: Response, auth_subject: str = Depends(verify_token)):
    # auth_subject は verify_token の戻り値:
    #   - "tailscale:<login>" → Tailscale 経由
    #   - "device:<id>"       → 登録済みデバイス cookie
    #   - 32文字程度のトークン文字列 → Bearer（外部API）
    #   - "" → 認証無効化されている
    #
    # Tailscale 経由でまだ device 登録されていなければ自動登録する。
    # ブラウザの通常ログインは /devices/register が device cookie を直接発行する。
    tailscale_user = None
    device = None
    if auth_subject.startswith("tailscale:"):
        auth_method = "tailscale"
        tailscale_user = auth_subject[len("tailscale:"):]
        device = _autoregister_device(request, response, source="tailscale")
    elif auth_subject.startswith("device:"):
        from .devices import get_device
        auth_method = "device"
        device = get_device(auth_subject[len("device:"):])
    elif auth_subject:
        auth_method = "token"
    else:
        auth_method = "disabled"
    return {
        "status": "ok",
        "hostname": socket.gethostname(),
        "version": system.get_app_version(),
        "auth_method": auth_method,
        "tailscale_user": tailscale_user,
        "device": device,
    }


@app.post("/auth/logout")
def auth_logout(request: Request, response: Response):
    # device cookie は HttpOnly なのでサーバ側でクリアする。現在 device は revoke して
    # 端末を確実にログアウトさせる（トークンを知っていれば再登録できる）。
    from .auth import COOKIE_DEVICE_ID
    from .devices import revoke_device
    from .routers.devices import _clear_device_cookies
    device_id = request.cookies.get(COOKIE_DEVICE_ID, "")
    if device_id:
        revoke_device(device_id)
    _clear_device_cookies(response)
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


class HashedAssetStaticFiles(StaticFiles):
    """Vite が出力する /assets/* はファイル名にハッシュが入っており内容が変わらないので、
    ブラウザに 1 年間 immutable キャッシュさせて再ダウンロードを避ける。
    それ以外（index.html / sw.js など）は別ハンドラで no-cache 指定済み。"""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.startswith("assets/") and getattr(response, "status_code", 0) == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


ICONS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/icons", StaticFiles(directory=str(ICONS_DIR)), name="icons")
app.mount("/", HashedAssetStaticFiles(directory=str(FRONTEND_DIR)), name="ui")

app.add_middleware(ClientLogMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

if __name__ == "__main__":
    ssl_keyfile = os.environ.get("SSL_KEYFILE")
    ssl_certfile = os.environ.get("SSL_CERTFILE")
    host, port = _resolve_bind()
    if ssl_keyfile and ssl_certfile:
        uvicorn.run(app, host=host, port=port, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                    ssl_keyfile=ssl_keyfile, ssl_certfile=ssl_certfile,
                    ws_ping_interval=30, ws_ping_timeout=60)
    else:
        uvicorn.run(app, host=host, port=port, proxy_headers=True, forwarded_allow_ips="127.0.0.1",
                    ws_ping_interval=30, ws_ping_timeout=60)
