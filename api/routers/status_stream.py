"""ワークスペース git ステータスのリアルタイム配信 WebSocket。

クライアントは /workspaces/statuses/ws を購読すると、変更のあったワークスペースの
ステータス（/workspaces/statuses の statuses 要素と同形式）を push で受け取る。
認証・keepalive はターミナル WS（routers/terminal.py）と同じ方式に揃えている。
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket
from fastapi.websockets import WebSocketDisconnect

from ..auth import verify_ws_token
from ..common import WS_PING_INTERVAL_SEC
from ..git_watch import subscribe, unsubscribe, watch_available

logger = logging.getLogger(__name__)

ws_router = APIRouter()


@ws_router.websocket("/workspaces/statuses/ws")
async def workspace_statuses_ws(websocket: WebSocket, token: str = ""):
    ws_client_host = (websocket.client.host or "") if websocket.client else ""
    if not verify_ws_token(token, ws_client_host, websocket.headers, websocket.cookies):
        await websocket.close(code=1008, reason="Unauthorized")
        return

    await websocket.accept()
    await subscribe(websocket)
    # FS 監視が使えない環境ではクライアントはポーリングを継続する必要があるため、
    # 接続直後に監視の有無を通知する
    await websocket.send_json({"type": "hello", "watching": watch_available()})
    logger.info("status stream connected watching=%s", watch_available())
    try:
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive(), timeout=WS_PING_INTERVAL_SEC)
            except asyncio.TimeoutError:
                # idle keepalive（クライアントの生存監視用ハートビート）
                await websocket.send_json({"type": "ping"})
                continue
            if msg.get("type") == "websocket.disconnect":
                break
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    finally:
        unsubscribe(websocket)
        logger.info("status stream disconnected")
