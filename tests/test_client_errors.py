"""POST /client-errors のテスト"""

import logging

from conftest import AUTH


class TestClientErrors:
    def test_minimal_payload_accepted(self, client):
        res = client.post("/client-errors", json={"type": "vue"}, headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

    def test_full_payload_accepted(self, client):
        body = {
            "type": "error",
            "message": "Cannot read properties of undefined",
            "stack": "Error\n  at foo (a.js:10:5)",
            "source": "https://example/app.js",
            "lineno": 10,
            "colno": 5,
            "url": "https://example/page",
            "user_agent": "Mozilla/5.0 ...",
            "info": "render function",
        }
        res = client.post("/client-errors", json=body, headers=AUTH)
        assert res.status_code == 200

    def test_logs_warning_with_sanitized_values(self, client, caplog):
        body = {"type": "vue", "message": "boom\x00here", "stack": "trace"}
        with caplog.at_level(logging.WARNING, logger="api.routers.system"):
            client.post("/client-errors", json=body, headers=AUTH)
        text = "\n".join(r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING)
        assert "client-error" in text
        # control char must be escaped
        assert "boom\\x00here" in text
        assert "boom\x00here" not in text

    def test_rejects_oversize_message(self, client):
        body = {"type": "vue", "message": "x" * 2001}
        res = client.post("/client-errors", json=body, headers=AUTH)
        assert res.status_code == 422

    def test_requires_auth(self, client):
        res = client.post("/client-errors", json={"type": "vue"})
        assert res.status_code == 401
