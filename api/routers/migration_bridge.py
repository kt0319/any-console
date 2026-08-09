"""Rust 移行期間中のプロセス間ブリッジ（docs/RUST_MIGRATION.md）。

Rust front が git 操作・ワークスペース登録変更を処理した際、Python 側に残る
status stream（git_watch）へ即時反映を伝えるための内部エンドポイント。
移行前は API 経由の git 操作が同一プロセス内で `invalidate_git_info`（= nudge）を
呼んでいた即時 push 挙動を、プロセスをまたいで復元する。

SECURITY: loopback からの呼び出しのみ受け付ける。作用はキャッシュ無効化と
再計算予約だけで状態を変更しない（最悪でも余分な再計算が走るのみ）。
ターミナルサブシステムの移行（status stream ごと Rust へ移動）が完了した時点で
このルーターごと削除する。
"""

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..common import is_loopback_host
from ..errors import forbidden
from ..git_info import invalidate_git_info
from ..git_watch import notify_workspaces_changed

logger = logging.getLogger(__name__)

router = APIRouter()


class GitNudgeRequest(BaseModel):
    workspace: str | None = None


@router.post("/internal/git-nudge")
def git_nudge(request: Request, body: GitNudgeRequest):
    client_host = (request.client.host or "") if request.client else ""
    if not is_loopback_host(client_host):
        raise forbidden("Loopback only")
    if body.workspace:
        invalidate_git_info(body.workspace)
    else:
        notify_workspaces_changed()
    return {"status": "ok"}
