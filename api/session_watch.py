"""ターミナルセッション作成・削除のリアルタイム配信（WebSocket push）。

git_watch.py の nudge_workspace() と同じ「スレッドセーフな外部トリガー」パターンを
採用する。セッション作成の中心関数 create_registered_session() は POST /run という
同期エンドポイント（FastAPI の threadpool 実行）からも呼ばれるため、素朴に await
する broadcast では動かない。loop.call_soon_threadsafe() でイベントループ側に
スケジュールする。
"""

import asyncio
import logging
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

logger = logging.getLogger(__name__)

_subscribers: set[WebSocket] = set()
_loop: asyncio.AbstractEventLoop | None = None


def subscriber_count() -> int:
    return len(_subscribers)


async def subscribe(websocket: WebSocket) -> None:
    global _loop
    _loop = asyncio.get_running_loop()
    _subscribers.add(websocket)


def unsubscribe(websocket: WebSocket) -> None:
    _subscribers.discard(websocket)


def notify_session_created(session_id: str) -> None:
    _notify("session_created", session_id)


def notify_session_removed(session_id: str) -> None:
    _notify("session_removed", session_id)


def notify_session_workspace_bound(session_id: str, workspace: str) -> None:
    """cwd照合による自動ワークスペース紐付け（agent_watch._apply_workspace_tag）を
    購読中の全クライアントへ即時push する。session_created/removed と同様
    スレッドセーフ（agent_watchのバックグラウンドポーリングスレッドから呼ばれる）。
    """
    _notify("session_workspace_bound", session_id, workspace=workspace)


def notify_session_job_bound(session_id: str, job_name: str, job_label: str) -> None:
    """前面ジョブのargv照合による自動ジョブタグ付け（agent_watch._apply_job_tag）を
    購読中の全クライアントへ即時push する。
    """
    _notify("session_job_bound", session_id, job_name=job_name, job_label=job_label)


def _notify(event_type: str, session_id: str, **extra: Any) -> None:
    """スレッドセーフ。同期/非同期どちらのルートハンドラからも呼べる。"""
    loop = _loop
    if loop is None or loop.is_closed() or not _subscribers:
        return
    payload = {"type": event_type, "session_id": session_id, **extra}
    loop.call_soon_threadsafe(_schedule_broadcast, payload)


def _schedule_broadcast(payload: dict[str, Any]) -> None:
    asyncio.ensure_future(_broadcast(payload))


async def _broadcast(payload: dict[str, Any]) -> None:
    dead = []
    for ws in list(_subscribers):
        try:
            await ws.send_json(payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            dead.append(ws)
    for ws in dead:
        _subscribers.discard(ws)
