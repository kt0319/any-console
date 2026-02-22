import asyncio
import http.client
import importlib.util
import logging
import os
import re
import subprocess
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket
from fastapi.websockets import WebSocketDisconnect

from ..auth import verify_token
from ..common import TERMINAL_TIMEOUT_SEC

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(verify_token)])


class TerminalSession:
    __slots__ = ("workspace", "port", "pid", "expires_at")

    def __init__(self, workspace: str | None, port: int, pid: int | None, expires_at: float):
        self.workspace = workspace
        self.port = port
        self.pid = pid
        self.expires_at = expires_at


TERMINAL_SESSIONS: dict[str, TerminalSession] = {}


def recover_terminal_sessions() -> None:
    try:
        result = subprocess.run(
            ["pgrep", "-a", "ttyd"], capture_output=True, text=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return
    if result.returncode != 0:
        return

    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        pid_str = parts[0]
        port = None
        session_id = None
        for i, arg in enumerate(parts):
            if arg == "--port" and i + 1 < len(parts):
                try:
                    port = int(parts[i + 1])
                except ValueError:
                    pass
            if arg == "--base-path" and i + 1 < len(parts):
                bp = parts[i + 1]
                prefix = "/terminal/s/"
                if bp.startswith(prefix):
                    session_id = bp[len(prefix):].rstrip("/")
        if port and session_id and session_id not in TERMINAL_SESSIONS:
            TERMINAL_SESSIONS[session_id] = TerminalSession(
                workspace=None,
                port=port,
                pid=int(pid_str),
                expires_at=time.time() + TERMINAL_TIMEOUT_SEC,
            )
            logger.info("recovered terminal session=%s port=%d pid=%s", session_id, port, pid_str)


def cleanup_terminal_sessions() -> None:
    now = time.time()
    expired = [sid for sid, session in TERMINAL_SESSIONS.items() if session.expires_at <= now]
    for sid in expired:
        logger.info("terminal session expired session=%s", sid)
        TERMINAL_SESSIONS.pop(sid, None)


def get_terminal_session(session_id: str) -> TerminalSession:
    cleanup_terminal_sessions()
    session = TERMINAL_SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    if session.expires_at <= time.time():
        TERMINAL_SESSIONS.pop(session_id, None)
        raise HTTPException(status_code=410, detail="Terminal session expired")
    session.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
    return session


def parse_terminal_stdout(stdout: str) -> tuple[int | None, int | None]:
    port_match = re.search(r"(?m)^PORT=(\d+)$", stdout or "")
    pid_match = re.search(r"(?m)^PID=(\d+)$", stdout or "")
    port = int(port_match.group(1)) if port_match else None
    pid = int(pid_match.group(1)) if pid_match else None
    return port, pid


def websockets_available() -> bool:
    return importlib.util.find_spec("websockets") is not None


def tmux_pane_in_copy_mode(tmux_session: str) -> bool:
    result = subprocess.run(
        ["tmux", "display-message", "-t", tmux_session, "-p", "#{pane_in_mode}"],
        capture_output=True, text=True, timeout=5,
    )
    return result.stdout.strip() == "1"


@router.get("/terminal/sessions")
async def list_terminal_sessions():
    cleanup_terminal_sessions()
    now = time.time()
    return [
        {
            "session_id": sid,
            "workspace": s.workspace,
            "url": f"/terminal/s/{sid}/",
            "expires_in": int(s.expires_at - now),
        }
        for sid, s in TERMINAL_SESSIONS.items()
    ]


@router.delete("/terminal/sessions/{session_id}")
async def delete_terminal_session(session_id: str):
    session = TERMINAL_SESSIONS.pop(session_id, None)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    if session.pid:
        try:
            os.kill(session.pid, 9)
        except ProcessLookupError:
            pass
    logger.info("terminal session deleted session=%s", session_id)
    return {"status": "ok"}


@router.post("/terminal/sessions/{session_id}/scroll")
async def terminal_scroll(session_id: str, body: dict):
    session = get_terminal_session(session_id)
    direction = body.get("direction")
    if direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'")
    tmux_session = f"pi-{session.port}"
    try:
        in_copy = tmux_pane_in_copy_mode(tmux_session)
        if direction == "up":
            if not in_copy:
                subprocess.run(
                    ["tmux", "copy-mode", "-t", tmux_session],
                    capture_output=True, text=True, timeout=5,
                )
            subprocess.run(
                ["tmux", "send-keys", "-t", tmux_session, "-X", "page-up"],
                capture_output=True, text=True, timeout=5,
            )
        else:
            if in_copy:
                subprocess.run(
                    ["tmux", "send-keys", "-t", tmux_session, "-X", "page-down"],
                    capture_output=True, text=True, timeout=5,
                )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "ok"}


# HTTP/WSプロキシはdependencies不要（認証はsession_idで担保）
terminal_proxy_router = APIRouter()


@terminal_proxy_router.api_route(
    "/terminal/s/{session_id}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def terminal_http_proxy(session_id: str, path: str, request: Request):
    session = get_terminal_session(session_id)
    target_path = f"/terminal/s/{session_id}/{path}"
    if request.url.query:
        target_path += "?" + request.url.query

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in {"host", "connection", "content-length"}
    }
    body = await request.body()

    conn = http.client.HTTPConnection("127.0.0.1", session.port, timeout=30)
    try:
        conn.request(request.method, target_path, body=body, headers=headers)
        upstream = conn.getresponse()
        content = upstream.read()
        response_headers = {
            k: v
            for k, v in upstream.getheaders()
            if k.lower() not in {"transfer-encoding", "connection", "keep-alive"}
        }
        return Response(content=content, status_code=upstream.status, headers=response_headers)
    except OSError:
        raise HTTPException(status_code=502, detail="terminal upstream unavailable")
    finally:
        conn.close()


@terminal_proxy_router.websocket("/terminal/s/{session_id}/{path:path}")
async def terminal_ws_proxy(websocket: WebSocket, session_id: str, path: str):
    try:
        session = get_terminal_session(session_id)
    except HTTPException:
        await websocket.close(code=1008)
        return

    if not websockets_available():
        await websocket.accept()
        await websocket.send_text("websockets package is required on server")
        await websocket.close(code=1011)
        return

    import websockets  # type: ignore

    backend_path = f"/terminal/s/{session_id}/{path}"
    if websocket.url.query:
        backend_path += "?" + websocket.url.query
    backend_url = f"ws://127.0.0.1:{session.port}{backend_path}"

    client_subprotocols = websocket.headers.get("sec-websocket-protocol", "").split(",")
    client_subprotocols = [s.strip() for s in client_subprotocols if s.strip()]
    await websocket.accept(subprotocol=client_subprotocols[0] if client_subprotocols else None)
    try:
        async with websockets.connect(
            backend_url, max_size=None,
            subprotocols=[websockets.Subprotocol(s) for s in client_subprotocols] if client_subprotocols else None,
        ) as upstream:
            async def client_to_upstream():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                        data = msg.get("bytes")
                        if data is None and msg.get("text") is not None:
                            data = msg["text"].encode("utf-8")
                        if data:
                            await upstream.send(data)
                except (WebSocketDisconnect, OSError):
                    pass

            async def upstream_to_client():
                try:
                    async for message in upstream:
                        if isinstance(message, bytes):
                            await websocket.send_bytes(message)
                        else:
                            await websocket.send_text(message)
                except (WebSocketDisconnect, OSError):
                    pass

            async def keep_session_alive():
                try:
                    while True:
                        await asyncio.sleep(TERMINAL_TIMEOUT_SEC // 2)
                        s = TERMINAL_SESSIONS.get(session_id)
                        if s:
                            s.expires_at = time.time() + TERMINAL_TIMEOUT_SEC
                except asyncio.CancelledError:
                    pass

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_upstream()),
                    asyncio.create_task(upstream_to_client()),
                    asyncio.create_task(keep_session_alive()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except (WebSocketDisconnect, OSError, websockets.exceptions.ConnectionClosed):
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
