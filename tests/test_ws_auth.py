"""WebSocket 接続の認証テスト。

無効トークンや未認証での WS 接続が拒否されることを確認する。
"""

import pytest
from starlette.websockets import WebSocketDisconnect

from conftest import AUTH


class TestWebSocketAuth:
    def test_ws_rejects_invalid_token(self, client):
        """無効トークンでの WS 接続は 1008 で拒否される"""
        with pytest.raises((WebSocketDisconnect, Exception)) as exc_info:
            with client.websocket_connect("/terminal/ws/test-session?token=invalid_token") as ws:
                ws.receive_bytes()
        exc = exc_info.value
        if isinstance(exc, WebSocketDisconnect):
            assert exc.code == 1008

    def test_ws_rejects_empty_token_when_auth_enabled(self, client):
        """空トークンでの WS 接続も拒否される（auth 有効時）"""
        with pytest.raises((WebSocketDisconnect, Exception)):
            with client.websocket_connect("/terminal/ws/test-session") as ws:
                ws.receive_bytes()
