"""Rust 移行期間中のプロセス間ブリッジ（docs/RUST_MIGRATION.md）。

Rust front が git 操作・ワークスペース登録変更・ターミナルセッション作成/削除・
dispatch キュー変更を処理した際、Python 側に残る status stream（git_watch /
session_watch / dispatch キュー配信）へ即時反映を伝えるための内部エンドポイント。
push 通知（VAPID/pywebpush）・dispatch scope の API トークン検証は当面 Python 側の
実装をそのまま使い、Rust からはこのブリッジ経由で呼び出す。

SECURITY: 全エンドポイントが loopback からの呼び出しのみ受け付ける。
ターミナルサブシステムの移行（status stream ごと Rust へ移動）が完了した時点で
このルーターごと削除する。
"""

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..agent_hooks import clear_session
from ..auth import API_TOKEN_SCOPE_DISPATCH, _verify_api_token
from ..common import is_loopback_host
from ..devices import verify_and_touch_device
from ..errors import forbidden
from ..git_info import invalidate_git_info
from ..git_watch import notify_workspaces_changed
from ..push import send_push_notification
from ..session_watch import notify_session_created, notify_session_removed

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_loopback(request: Request) -> None:
    client_host = (request.client.host or "") if request.client else ""
    if not is_loopback_host(client_host):
        raise forbidden("Loopback only")


class GitNudgeRequest(BaseModel):
    workspace: str | None = None


@router.post("/internal/git-nudge")
def git_nudge(request: Request, body: GitNudgeRequest):
    _require_loopback(request)
    if body.workspace:
        invalidate_git_info(body.workspace)
    else:
        notify_workspaces_changed()
    return {"status": "ok"}


class SessionEventRequest(BaseModel):
    event: str
    session_id: str


@router.post("/internal/session-event")
def session_event(request: Request, body: SessionEventRequest):
    """Rust 側で作成・削除されたターミナルセッションを session_watch へ即時反映する。"""
    _require_loopback(request)
    if body.event == "created":
        notify_session_created(body.session_id)
    elif body.event == "removed":
        clear_session(body.session_id)
        notify_session_removed(body.session_id)
    else:
        raise forbidden(f"Unknown event: {body.event}")
    return {"status": "ok"}


class SendPushRequest(BaseModel):
    title: str
    body: str
    url: str = "/"
    notif_type: str = ""


@router.post("/internal/send-push")
def send_push(request: Request, body: SendPushRequest):
    """Rust 側からの Web Push 送信要求を実行する（VAPID/pywebpush は Python 側のみ）。"""
    _require_loopback(request)
    send_push_notification(body.title, body.body, url=body.url, notif_type=body.notif_type)
    return {"status": "ok"}


@router.post("/internal/dispatch-queue")
async def dispatch_queue_relay(request: Request):
    """Rust 側 dispatch キューの全量スナップショットを status stream WS 購読者へ中継する。
    スキーマは Rust 側（server/src/dispatch.rs）が決めるため、ここでは検証せず
    そのまま中継する（受け取った JSON をそのまま配信予約する）。"""
    _require_loopback(request)
    payload = await request.json()
    from .dispatch import set_bridged_payload
    set_bridged_payload(payload)
    return {"status": "ok"}


@router.post("/internal/invalidate-job-cache")
def invalidate_job_cache(request: Request):
    """Rust 側の native ジョブ CRUD（作成・更新・削除・並び替え）後に、Python 側
    ジョブキャッシュ（routers/jobs_common.py の TTLCache）を無効化する。無効化
    しないと、まだ Python 側に残る /dispatch 実行パス（_resolve_job_def）が
    最大 60 秒古いジョブ定義を使い続けてしまう。"""
    _require_loopback(request)
    from .jobs_common import invalidate_all_job_caches
    invalidate_all_job_caches()
    return {"status": "ok"}


class VerifyDispatchApiTokenRequest(BaseModel):
    token: str


@router.post("/internal/verify-dispatch-api-token")
def verify_dispatch_api_token(request: Request, body: VerifyDispatchApiTokenRequest):
    """dispatch scope の API トークンを検証する（`auth.py` の `_verify_api_token` を再利用。
    メイントークン/デバイス/Tailscale は Rust 側で既に検証済みのため、ここでは
    api_tokens 配列との照合のみを行う）。"""
    _require_loopback(request)
    entry = _verify_api_token(body.token)
    if entry is not None and entry.get("scope") == API_TOKEN_SCOPE_DISPATCH:
        return {"ok": True, "label": f"token:{entry['id']}"}
    return {"ok": False, "label": None}


class TouchDeviceRequest(BaseModel):
    device_id: str
    raw_secret: str


@router.post("/internal/touch-device")
def touch_device(request: Request, body: TouchDeviceRequest):
    """Rust ネイティブルートでのデバイス cookie 認証成功時に devices.json の
    last_seen_at を更新する（`devices.verify_and_touch_device` を再利用 —
    Rust 側は既に照合済みだが、devices.json への書き込みは Python が唯一の
    ライターであり続けるため、この再照合込みの関数をそのまま呼ぶのが最小の
    変更で済む。呼び出し元（`server/src/auth.rs`）が60秒スロットリング済み）。"""
    _require_loopback(request)
    verify_and_touch_device(body.device_id, body.raw_secret)
    return {"status": "ok"}
