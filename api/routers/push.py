"""Push 通知エンドポイント。"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import verify_token
from ..push import add_subscription, get_vapid_public_key, remove_subscription

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


@router.get("/push/vapid-public-key")
def vapid_public_key():
    return {"publicKey": get_vapid_public_key()}


class PushSubscription(BaseModel):
    endpoint: str
    keys: dict


@router.post("/push/subscribe")
def subscribe(sub: PushSubscription):
    add_subscription(sub.model_dump())
    return {"status": "ok"}


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.delete("/push/subscribe")
def unsubscribe(body: UnsubscribeRequest):
    remove_subscription(body.endpoint)
    return {"status": "ok"}
