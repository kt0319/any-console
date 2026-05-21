import hmac
import json
import logging
import secrets
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


def ensure_default_token() -> str | None:
    """data/auth.json がなければ 32 文字のランダムトークンを生成・保存する。

    生成したトークンを返す。既にファイルが存在する場合は None を返す。
    認証の無効化判定は呼び出し元が行い、無効化時はこの関数を呼ばないこと。
    """
    if _AUTH_FILE.exists():
        return None
    token = secrets.token_urlsafe(24)  # 24 bytes → 32 base64url chars
    update_token(token)
    return token


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
    return request.client.host if request.client else ""
