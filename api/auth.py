import hmac
import ipaddress
import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

_AUTH_FILE = Path(__file__).resolve().parent.parent / "data" / "auth.json"

COOKIE_NAME_TOKEN = "any_console_session"  # noqa: S105 (cookie name, not a secret)


def _load_token_from_file() -> str:
    try:
        token = json.loads(_AUTH_FILE.read_text()).get("token", "")
        return str(token) if token else ""
    except (OSError, json.JSONDecodeError, AttributeError):
        return ""


ANY_CONSOLE_TOKEN: str = _load_token_from_file()


def verify_ws_token(token: str) -> bool:
    if not ANY_CONSOLE_TOKEN:
        return True
    return hmac.compare_digest(token, ANY_CONSOLE_TOKEN)


def update_token(new_token: str) -> None:
    global ANY_CONSOLE_TOKEN
    _AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    _AUTH_FILE.write_text(json.dumps({"token": new_token}))
    ANY_CONSOLE_TOKEN = new_token


def _parse_trusted_proxies(raw: str) -> list:
    networks = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            networks.append(ipaddress.ip_network(token, strict=False))
        except ValueError:
            logger.warning("invalid entry in ANY_CONSOLE_TRUSTED_PROXIES: %s", token)
    return networks


_TRUSTED_PROXY_NETWORKS = _parse_trusted_proxies(os.environ.get("ANY_CONSOLE_TRUSTED_PROXIES", ""))


def _is_trusted_proxy(ip: str) -> bool:
    if not _TRUSTED_PROXY_NETWORKS or not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED_PROXY_NETWORKS)


def verify_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    if not ANY_CONSOLE_TOKEN:
        return ""
    if credentials is not None and hmac.compare_digest(credentials.credentials, ANY_CONSOLE_TOKEN):
        return str(credentials.credentials)
    cookie_token = str(request.cookies.get(COOKIE_NAME_TOKEN, "") or "")
    if cookie_token and hmac.compare_digest(cookie_token, ANY_CONSOLE_TOKEN):
        return cookie_token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid token",
    )


def _extract_client_ip(request: Request) -> str:
    client_ip: str = request.client.host if request.client else ""
    if _is_trusted_proxy(client_ip):
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            return str(forwarded_for).split(",")[0].strip()
    return client_ip
