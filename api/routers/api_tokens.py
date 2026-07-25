"""スコープ付き API トークン管理エンドポイント。

- POST   /api-tokens      : 新規トークン発行（raw トークンはレスポンスで一度だけ返す）
- GET    /api-tokens      : 一覧（secret_hash は含まない）
- DELETE /api-tokens/{id} : 失効

すべてメイントークン認証（verify_token）のみを要求する。dispatch scope の
API トークン自身でこれらのエンドポイントを呼ぶことはできない
（verify_dispatch_token は POST /dispatch にしか使わないため）。
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import (
    API_TOKEN_MAX_NAME_LEN,
    API_TOKEN_SCOPE_DISPATCH,
    create_api_token,
    list_api_tokens,
    revoke_api_token,
    verify_token,
)
from ..errors import not_found

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


class CreateApiTokenBody(BaseModel):
    name: str = Field("", max_length=API_TOKEN_MAX_NAME_LEN)


@router.post("/api-tokens")
def create_token(body: CreateApiTokenBody):
    name = body.name.strip() or "Unnamed token"
    meta, raw_token = create_api_token(name, scope=API_TOKEN_SCOPE_DISPATCH)
    return {**meta, "token": raw_token}


@router.get("/api-tokens")
def list_tokens():
    return list_api_tokens()


@router.delete("/api-tokens/{token_id}")
def revoke_token(token_id: str):
    if not revoke_api_token(token_id):
        raise not_found("API token not found")
    return {"ok": True}
