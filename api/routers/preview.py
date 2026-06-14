"""Port Preview ルータ。

- `GET /preview/ports` 検出ポート一覧
- `/preview/{session_id}/{port}/{path}` で 127.0.0.1:{port} に HTTP / WebSocket proxy

セキュリティ:
- upstream host は 127.0.0.1 にハードコード。任意 host への転送はできない設計。
- session_id + port の組み合わせが scanner により検出済みである場合のみ proxy する。
  ペインに出ていない（=ユーザが起動していない）ポートにはアクセスさせない。
- 認証は既存の verify_token 依存（HTTP）/ verify_ws_token（WS）に乗る。
"""

from __future__ import annotations

import asyncio
import logging

import httpx
import websockets
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from websockets.exceptions import ConnectionClosed

from ..auth import COOKIE_NAME_TOKEN, verify_token, verify_ws_token
from ..preview import find_port, list_ports

logger = logging.getLogger(__name__)

router = APIRouter()
ws_router = APIRouter()

# 同一プロセスで使い回す httpx クライアント（接続プール）。
_http_client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=2.0))

# Cookie / 認証関係はクライアント browser に管理させ、upstream へ渡さない。
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host",
}


@router.get("/preview/ports", dependencies=[Depends(verify_token)])
def list_detected_ports():
    return list_ports()


def _filter_headers(headers) -> dict:
    return {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP}


def _validate(session_id: str, port: int) -> None:
    if not find_port(session_id, port):
        raise HTTPException(status_code=404, detail="Preview not available for this session/port")


@router.api_route(
    "/preview/{session_id}/{port}/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    dependencies=[Depends(verify_token)],
)
async def proxy(session_id: str, port: int, path: str, request: Request):
    _validate(session_id, port)
    upstream = f"http://127.0.0.1:{port}/{path}"
    try:
        req = _http_client.build_request(
            request.method,
            upstream,
            headers=_filter_headers(request.headers),
            params=request.query_params,
            content=await request.body(),
        )
        resp = await _http_client.send(req, stream=True)
    except httpx.ConnectError as e:
        raise HTTPException(status_code=502, detail=f"Upstream connect failed: {e}") from None
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream error: {e}") from None

    return StreamingResponse(
        resp.aiter_raw(),
        status_code=resp.status_code,
        headers=_filter_headers(resp.headers),
        background=BackgroundTask(resp.aclose),
    )


_WS_DROP_HEADERS = {
    "host", "upgrade", "connection", "sec-websocket-key", "sec-websocket-version",
    "sec-websocket-extensions", "sec-websocket-accept", "origin",
}


async def _ws_authorize(websocket: WebSocket, token: str, session_id: str, port: int) -> bool:
    auth_token = token or websocket.cookies.get(COOKIE_NAME_TOKEN, "")
    ws_client_host = (websocket.client.host or "") if websocket.client else ""
    if not verify_ws_token(auth_token, ws_client_host, websocket.headers, websocket.cookies):
        await websocket.close(code=1008, reason="Unauthorized")
        return False
    if not find_port(session_id, port):
        await websocket.close(code=1008, reason="Preview not available")
        return False
    return True


async def _pump_client_to_upstream(websocket: WebSocket, upstream) -> None:
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                await upstream.send(msg["bytes"])
            elif msg.get("text") is not None:
                await upstream.send(msg["text"])
    except (ConnectionClosed, RuntimeError):
        pass


async def _pump_upstream_to_client(websocket: WebSocket, upstream) -> None:
    try:
        async for msg in upstream:
            if isinstance(msg, (bytes, bytearray)):
                await websocket.send_bytes(bytes(msg))
            else:
                await websocket.send_text(msg)
    except (ConnectionClosed, RuntimeError):
        pass


@ws_router.websocket("/preview/{session_id}/{port}/{path:path}")
async def proxy_ws(websocket: WebSocket, session_id: str, port: int, path: str, token: str = ""):
    if not await _ws_authorize(websocket, token, session_id, port):
        return
    await websocket.accept()
    upstream_url = f"ws://127.0.0.1:{port}/{path}"
    extra_headers = [(k, v) for k, v in websocket.headers.items()
                     if k.lower() not in _WS_DROP_HEADERS]
    try:
        upstream = await websockets.connect(upstream_url, extra_headers=extra_headers, max_size=None)  # type: ignore[attr-defined]
    except (OSError, ConnectionClosed) as e:
        logger.warning("preview ws connect failed port=%d: %s", port, e)
        await websocket.close(code=1011, reason="Upstream WS connect failed")
        return
    try:
        await asyncio.gather(
            _pump_client_to_upstream(websocket, upstream),
            _pump_upstream_to_client(websocket, upstream),
        )
    finally:
        try:
            await upstream.close()
        except (ConnectionClosed, RuntimeError):
            pass
        try:
            await websocket.close()
        except RuntimeError:
            pass
