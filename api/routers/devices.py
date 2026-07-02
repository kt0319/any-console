"""Trusted Device 管理エンドポイント。

- POST /devices/register : token を提示して新規デバイスを登録（cookie 発行）
- GET  /devices          : 登録済みデバイス一覧（要認証）
- DELETE /devices/{id}   : デバイス削除（要認証）
- POST /devices/logout   : 現在デバイスのみログアウト

セキュリティ:
- 登録には現行 token が必須（共有トークンを知っている人だけが新端末登録可能）
- raw secret は Set-Cookie のみで返し、レスポンス JSON には含めない
- 削除はリクエスト元自身の認可（verify_token）を要求する
"""

import hmac
import logging

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from .. import auth as auth_module
from ..auth import (
    COOKIE_DEVICE_ID,
    COOKIE_DEVICE_SECRET,
    verify_token,
)
from ..devices import (
    autoname_from_user_agent,
    get_device,
    list_devices,
    register_device,
    revoke_device,
)
from ..errors import bad_request, not_found, unauthorized

logger = logging.getLogger(__name__)

router = APIRouter()

COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60


class RegisterBody(BaseModel):
    token: str = ""
    name: str = ""


def _is_https(request: Request) -> bool:
    return bool(request.url.scheme == "https")


def _set_device_cookies(response: Response, request: Request, device_id: str, raw_secret: str) -> None:
    secure = _is_https(request)
    response.set_cookie(
        key=COOKIE_DEVICE_ID, value=device_id,
        max_age=COOKIE_MAX_AGE_SEC, httponly=True, samesite="strict", secure=secure, path="/",
    )
    response.set_cookie(
        key=COOKIE_DEVICE_SECRET, value=raw_secret,
        max_age=COOKIE_MAX_AGE_SEC, httponly=True, samesite="strict", secure=secure, path="/",
    )


def _clear_device_cookies(response: Response) -> None:
    response.delete_cookie(COOKIE_DEVICE_ID, path="/")
    response.delete_cookie(COOKIE_DEVICE_SECRET, path="/")


@router.post("/devices/register")
def register(body: RegisterBody, request: Request, response: Response):
    if not auth_module.ANY_CONSOLE_TOKEN:
        # 認証無効化中は登録自体を不要にする
        return {"ok": True, "device_id": None, "name": None, "auth_required": False}
    if not body.token or not hmac.compare_digest(body.token, auth_module.ANY_CONSOLE_TOKEN):
        raise unauthorized("Invalid token")
    ua = request.headers.get("user-agent", "")
    name = (body.name or autoname_from_user_agent(ua)).strip() or "Unknown device"
    device_id, raw_secret = register_device(name, ua)
    _set_device_cookies(response, request, device_id, raw_secret)
    return {"ok": True, "device_id": device_id, "name": name, "auth_required": True}


@router.get("/devices", dependencies=[Depends(verify_token)])
def list_(request: Request):
    current_id = request.cookies.get(COOKIE_DEVICE_ID, "") or None
    devices = list_devices()
    for d in devices:
        d["current"] = d["id"] == current_id
    return devices


@router.delete("/devices/{device_id}", dependencies=[Depends(verify_token)])
def revoke(device_id: str, request: Request, response: Response):
    if not get_device(device_id):
        raise not_found("Device not found")
    if not revoke_device(device_id):
        raise bad_request("Failed to revoke device")
    # 自分自身を取り消した場合は cookie もクリア
    if request.cookies.get(COOKIE_DEVICE_ID, "") == device_id:
        _clear_device_cookies(response)
    return {"ok": True}


@router.post("/devices/logout")
def logout(request: Request, response: Response):
    """現在デバイスのみログアウト（device record も削除）。"""
    device_id = request.cookies.get(COOKIE_DEVICE_ID, "")
    if device_id:
        revoke_device(device_id)
    _clear_device_cookies(response)
    return {"ok": True}
