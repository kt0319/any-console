"""エージェント hooks のイベント受信エンドポイント。

認証はメインの Bearer トークンではなく hook 専用トークン（X-Hook-Token
ヘッダ）で行う（api/agent_hooks.py 参照）。エージェントのツール実行ごとに
叩かれる高頻度・低コストのエンドポイントのため、rate limiter からは除外
されている（api/rate_limiter.py の _SKIP_EXACT）。
"""

import logging

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from ..agent_hooks import record_event, verify_hook_token
from ..errors import unauthorized

logger = logging.getLogger(__name__)

router = APIRouter()


class HookEventBody(BaseModel):
    session: str = Field(min_length=1, max_length=200)
    event: str = Field(min_length=1, max_length=64)


@router.post("/agent-hooks/events")
async def post_agent_hook_event(body: HookEventBody, x_hook_token: str = Header("")):
    if not verify_hook_token(x_hook_token):
        raise unauthorized("Invalid hook token")
    recognized = record_event(body.session, body.event)
    return {"status": "ok", "recognized": recognized}
