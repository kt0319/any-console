import hmac
import logging
import os
import subprocess
import threading
import time

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()
logger = logging.getLogger(__name__)

ANY_CONSOLE_TOKEN = os.environ.get("ANY_CONSOLE_TOKEN", "")

_TAILSCALE_CACHE_TTL = 300
_tailscale_cache: dict[str, tuple[float, str]] = {}
_tailscale_cache_lock = threading.Lock()
_TAILSCALE_TIMEOUT_SEC = 5


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    if not ANY_CONSOLE_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ANY_CONSOLE_TOKEN is not configured",
        )
    if not hmac.compare_digest(credentials.credentials, ANY_CONSOLE_TOKEN):
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
    except Exception:
        logger.debug("tailscale name resolve failed for %s", ip, exc_info=True)
    return ""


def _extract_client_ip(request: Request) -> str:
    client_ip = request.client.host if request.client else ""
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    return client_ip


def get_client_name(request: Request) -> str:
    client_ip = _extract_client_ip(request)
    name = resolve_tailscale_name(client_ip)
    return name or client_ip
