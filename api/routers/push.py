"""Push 通知エンドポイント。"""

import logging
import re

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from ..auth import verify_token
from ..errors import service_unavailable
from ..push import add_subscription, get_vapid_public_key, remove_subscription, set_vapid_sub

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/push/vapid-public-key")
def vapid_public_key():
    key = get_vapid_public_key()
    if key is None:
        raise service_unavailable("Push notifications are not available on this server")
    return {"publicKey": key}


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict


def _extract_sub(request: Request) -> str | None:
    """Origin / Referer ヘッダーからスキーム＋ホスト（ポートなし）を取り出す。"""
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    m = re.match(r"(https?://[^/:]+)", origin)
    return m.group(1) if m else None


@router.post("/push/subscribe")
def subscribe(sub: PushSubscription, request: Request):
    detected = _extract_sub(request)
    if detected:
        set_vapid_sub(detected)
        logger.info("push sub auto-detected: %s", detected)
    add_subscription(sub.model_dump())
    return {"status": "ok"}


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.delete("/push/subscribe")
def unsubscribe(body: UnsubscribeRequest):
    remove_subscription(body.endpoint)
    return {"status": "ok"}
