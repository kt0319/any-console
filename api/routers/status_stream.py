"""ワークスペース git ステータス／エージェント状態のリアルタイム配信 WebSocket。

クライアントは /workspaces/statuses/ws を購読すると、変更のあったワークスペースの
ステータス（/workspaces/statuses の statuses 要素と同形式、type="statuses"）と、
ターミナルセッションのエージェント状態（type="agent_states"、api/agent_watch.py）、
承認待ち dispatch キューの全量（type="dispatch_queue"、routers/dispatch.py）、
ターミナルセッションの作成・削除（type="session_created"/"session_removed"、
api/session_watch.py）を同じソケットで push で受け取る。
認証・keepalive はターミナル WS（routers/terminal.py）と同じ方式に揃えている。
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket
from fastapi.websockets import WebSocketDisconnect

from ..agent_watch import subscribe as agent_subscribe
from ..agent_watch import unsubscribe as agent_unsubscribe
from ..auth import verify_ws_token
from ..common import WS_PING_INTERVAL_SEC
from ..git_watch import subscribe, unsubscribe
from ..session_watch import subscribe as session_subscribe
from ..session_watch import unsubscribe as session_unsubscribe
from .dispatch import subscribe as dispatch_subscribe
from .dispatch import unsubscribe as dispatch_unsubscribe

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
    await agent_subscribe(websocket)
    await dispatch_subscribe(websocket)
    await session_subscribe(websocket)
    logger.info("status stream connected")
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
        agent_unsubscribe(websocket)
        dispatch_unsubscribe(websocket)
        session_unsubscribe(websocket)
        # 相手切断後の close は RuntimeError になるため握りつぶす（terminal_ws と同様）
        try:
            await websocket.close()
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
        logger.info("status stream disconnected")
