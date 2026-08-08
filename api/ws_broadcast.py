"""WebSocket 購読者集合への fan-out 送信の共通実装。

git_watch / agent_watch / session_watch / dispatch の各モジュールは
「モジュールローカルな購読者 set へ payload を送り、送信に失敗した接続を
購読解除する」という同一パターンを持つ。切断済み接続の扱い（unsubscribe 側で
タスク停止まで行うか、set から外すだけか）はモジュールごとに異なるため、
on_dead コールバックで注入する。
"""

import asyncio
import logging
from typing import Any, Callable, Iterable

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

logger = logging.getLogger(__name__)

# send_json が「切断済み・半端な状態の接続」で送出しうる例外。
# TimeoutError（builtin, Python 3.11 では OSError のサブクラス）は
# send_timeout 指定時に個別処理するため、except 節の順序に依存する。
SEND_ERRORS = (WebSocketDisconnect, RuntimeError, OSError)


def call_threadsafe(
    loop: asyncio.AbstractEventLoop | None, fn: Callable[..., Any], *args: Any,
) -> None:
    """別スレッドからイベントループへ callback を予約する。

    git_watch / session_watch が持つ「モジュールの _loop が未設定・closed なら
    何もしない」ガード付き call_soon_threadsafe の共通形。
    """
    if loop is None or loop.is_closed():
        return
    loop.call_soon_threadsafe(fn, *args)


async def broadcast_to(
    subscribers: Iterable[WebSocket],
    payload: dict[str, Any],
    *,
    on_dead: Callable[[WebSocket], None],
    send_timeout: float | None = None,
) -> None:
    """全購読者へ payload を送信し、失敗した接続を on_dead で通知する。

    send_timeout を指定すると各送信を wait_for で打ち切る。タイムアウト＝
    読み取りが止まった半開き接続の可能性があるため、購読解除に加えて WS 自体を
    閉じ、クライアントの再接続（接続時の全量再同期）へ倒す（黙って購読だけ
    外すと、共有 WS が OPEN のままのクライアントは再接続せず該当ストリーム
    だけ永続的に stale になるため）。
    """
    dead = []
    for ws in list(subscribers):
        try:
            if send_timeout is None:
                await ws.send_json(payload)
            else:
                await asyncio.wait_for(ws.send_json(payload), timeout=send_timeout)
        except TimeoutError:
            dead.append(ws)
            await _close_ws(ws, send_timeout)
        except SEND_ERRORS:
            dead.append(ws)
    for ws in dead:
        on_dead(ws)


async def _close_ws(ws: WebSocket, timeout: float | None) -> None:
    try:
        await asyncio.wait_for(ws.close(), timeout=timeout)
    except (*SEND_ERRORS, TimeoutError):
        pass
