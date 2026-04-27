import hmac
import ipaddress
import json
import logging
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

_AUTH_FILE = Path(__file__).resolve().parent.parent / "data" / "auth.json"


def _load_token_from_file() -> str:
    try:
        return json.loads(_AUTH_FILE.read_text()).get("token", "")
    except (OSError, json.JSONDecodeError, AttributeError):
        return ""


ANY_CONSOLE_TOKEN: str = _load_token_from_file()


def update_token(new_token: str) -> None:
    global ANY_CONSOLE_TOKEN
    _AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    _AUTH_FILE.write_text(json.dumps({"token": new_token}))
    ANY_CONSOLE_TOKEN = new_token


_TAILSCALE_CACHE_TTL = 300
_tailscale_cache: dict[str, tuple[float, str]] = {}
_tailscale_cache_lock = threading.Lock()
_TAILSCALE_TIMEOUT_SEC = 5


def verify_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    if not ANY_CONSOLE_TOKEN:
        return ""
    if credentials is None or not hmac.compare_digest(credentials.credentials, ANY_CONSOLE_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    return credentials.credentials


def resolve_tailscale_name(ip: str) -> str:
    with _tailscale_cache_lock:
        if ip in _tailscale_cache:
            ts, name = _tailscale_cache[ip]
            if time.monotonic() - ts < _TAILSCALE_CACHE_TTL:
                return name
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True, text=True, timeout=_TAILSCALE_TIMEOUT_SEC,
        )
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            resolved = ""
            for peer in (data.get("Peer") or {}).values():
                for addr in peer.get("TailscaleIPs", []):
                    if addr == ip:
                        resolved = peer.get("HostName", "")
            if not resolved:
                self_ips = (data.get("Self") or {}).get("TailscaleIPs", [])
                if ip in self_ips:
                    resolved = data.get("Self", {}).get("HostName", "")
            with _tailscale_cache_lock:
                _tailscale_cache[ip] = (time.monotonic(), resolved)
            return resolved
    except (subprocess.TimeoutExpired, OSError, ValueError, KeyError):
        logger.debug("tailscale name resolve failed for %s", ip, exc_info=True)
    return ""


def _extract_client_ip(request: Request) -> str:
    client_ip = request.client.host if request.client else ""
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    return client_ip


def is_tailscale_ip(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    return _extract_client_ip(request)


def get_client_name(request: Request) -> str:
    client_ip = _extract_client_ip(request)
    name = resolve_tailscale_name(client_ip)
    return name or client_ip
