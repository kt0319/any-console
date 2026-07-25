"""スコープ付き API トークン（api/auth.py の api_tokens）のテスト。

- 発行・一覧・失効の基本 CRUD
- 保存されるのは HMAC ハッシュのみ（raw トークンは保存されない）
- POST /dispatch は dispatch トークンでも通る
- direct: true は dispatch トークンで拒否される
- 最重要: /dispatch/{id}/decision・ステータスストリーム WS は dispatch トークンでは
  絶対に通らない（メイントークンのみ）。dispatch トークン漏洩だけで自己承認できて
  しまう経路がないことを担保する。
"""

import json

import pytest

from api import auth as auth_module
from conftest import AUTH, TOKEN


@pytest.fixture(autouse=True)
def _isolate_auth_file(tmp_path, monkeypatch):
    auth_file = tmp_path / "auth.json"
    monkeypatch.setattr(auth_module, "_AUTH_FILE", auth_file)
    monkeypatch.setattr(auth_module, "ANY_CONSOLE_TOKEN", TOKEN)
    return auth_file


class TestCreateApiToken:
    def test_returns_metadata_and_raw_token(self):
        meta, raw = auth_module.create_api_token("github-actions")
        assert meta["id"].startswith("tok_")
        assert meta["name"] == "github-actions"
        assert meta["scope"] == "dispatch"
        assert meta["last_used"] is None
        assert "secret_hash" not in meta
        assert len(raw) >= 32

    def test_default_scope_is_dispatch(self):
        meta, _ = auth_module.create_api_token("x")
        assert meta["scope"] == "dispatch"

    def test_raw_token_not_persisted(self, _isolate_auth_file):
        _, raw = auth_module.create_api_token("x")
        saved = json.loads(_isolate_auth_file.read_text(encoding="utf-8"))
        blob = json.dumps(saved)
        assert raw not in blob

    def test_empty_name_falls_back_to_default(self):
        meta, _ = auth_module.create_api_token("")
        assert meta["name"] == "Unnamed token"

    def test_name_truncated_to_max_len(self):
        meta, _ = auth_module.create_api_token("x" * 200)
        assert len(meta["name"]) == auth_module.API_TOKEN_MAX_NAME_LEN

    def test_preserves_main_token_in_auth_file(self, _isolate_auth_file):
        auth_module.update_token("main-secret")
        auth_module.create_api_token("x")
        saved = json.loads(_isolate_auth_file.read_text(encoding="utf-8"))
        assert saved["token"] == "main-secret"
        assert len(saved["api_tokens"]) == 1

    def test_update_token_preserves_api_tokens(self, _isolate_auth_file):
        auth_module.create_api_token("x")
        auth_module.update_token("new-main-secret")
        saved = json.loads(_isolate_auth_file.read_text(encoding="utf-8"))
        assert len(saved["api_tokens"]) == 1
        assert saved["token"] == "new-main-secret"


class TestListAndGetApiTokens:
    def test_list_excludes_secret_hash(self):
        auth_module.create_api_token("a")
        items = auth_module.list_api_tokens()
        assert len(items) == 1
        assert "secret_hash" not in items[0]

    def test_list_empty_by_default(self):
        assert auth_module.list_api_tokens() == []

    def test_get_existing_returns_metadata(self):
        meta, _ = auth_module.create_api_token("a")
        got = auth_module.get_api_token(meta["id"])
        assert got is not None
        assert got["name"] == "a"

    def test_get_unknown_returns_none(self):
        assert auth_module.get_api_token("tok_doesnotexist") is None


class TestRevokeApiToken:
    def test_revoke_removes_token(self):
        meta, _ = auth_module.create_api_token("a")
        assert auth_module.revoke_api_token(meta["id"]) is True
        assert auth_module.get_api_token(meta["id"]) is None

    def test_revoke_unknown_returns_false(self):
        assert auth_module.revoke_api_token("tok_nope") is False

    def test_revoke_keeps_others(self):
        a, _ = auth_module.create_api_token("a")
        b, _ = auth_module.create_api_token("b")
        auth_module.revoke_api_token(a["id"])
        assert auth_module.get_api_token(a["id"]) is None
        assert auth_module.get_api_token(b["id"]) is not None


class TestVerifyApiToken:
    def test_verify_succeeds_after_create(self):
        _, raw = auth_module.create_api_token("a")
        dev = auth_module._verify_api_token(raw)
        assert dev is not None
        assert dev["scope"] == "dispatch"

    def test_verify_wrong_token_fails(self):
        auth_module.create_api_token("a")
        assert auth_module._verify_api_token("not-a-real-token") is None

    def test_verify_empty_fails(self):
        assert auth_module._verify_api_token("") is None

    def test_verify_touches_last_used(self):
        meta, raw = auth_module.create_api_token("a")
        assert meta["last_used"] is None
        auth_module._verify_api_token(raw)
        updated = auth_module.get_api_token(meta["id"])
        assert updated["last_used"] is not None

    def test_verify_after_revoke_fails(self):
        meta, raw = auth_module.create_api_token("a")
        auth_module.revoke_api_token(meta["id"])
        assert auth_module._verify_api_token(raw) is None


class TestApiTokenEndpoints:
    def test_create_requires_main_auth(self, client):
        res = client.post("/api-tokens", json={"name": "x"})
        assert res.status_code == 401

    def test_create_returns_raw_token_once(self, client):
        res = client.post("/api-tokens", headers=AUTH, json={"name": "ci"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["name"] == "ci"
        assert data["scope"] == "dispatch"
        assert "token" in data and len(data["token"]) >= 32
        assert "secret_hash" not in data

    def test_list_requires_main_auth(self, client):
        res = client.get("/api-tokens")
        assert res.status_code == 401

    def test_list_shows_created_tokens(self, client):
        client.post("/api-tokens", headers=AUTH, json={"name": "a"})
        client.post("/api-tokens", headers=AUTH, json={"name": "b"})
        res = client.get("/api-tokens", headers=AUTH)
        assert res.status_code == 200
        names = sorted(t["name"] for t in res.json())
        assert names == ["a", "b"]

    def test_list_response_excludes_raw_token(self, client):
        create_res = client.post("/api-tokens", headers=AUTH, json={"name": "a"})
        raw = create_res.json()["token"]
        list_res = client.get("/api-tokens", headers=AUTH)
        assert raw not in list_res.text

    def test_revoke_requires_main_auth(self, client):
        res = client.delete("/api-tokens/tok_x")
        assert res.status_code == 401

    def test_revoke_unknown_returns_404(self, client):
        res = client.delete("/api-tokens/tok_doesnotexist", headers=AUTH)
        assert res.status_code == 404

    def test_revoke_existing_returns_ok(self, client):
        create_res = client.post("/api-tokens", headers=AUTH, json={"name": "a"})
        token_id = create_res.json()["id"]
        res = client.delete(f"/api-tokens/{token_id}", headers=AUTH)
        assert res.status_code == 200
        assert client.get("/api-tokens", headers=AUTH).json() == []

    def test_dispatch_token_itself_cannot_manage_tokens(self, client):
        """dispatch scope のトークンで /api-tokens を叩いても弾かれる
        （verify_token のみを要求しており verify_dispatch_token は使わないため）。"""
        create_res = client.post("/api-tokens", headers=AUTH, json={"name": "a"})
        raw = create_res.json()["token"]
        res = client.get("/api-tokens", headers={"Authorization": f"Bearer {raw}"})
        assert res.status_code == 401


class TestDispatchTokenOnDispatchEndpoint:
    """POST /dispatch は dispatch トークンでも通る。他は通らない。"""

    def _create_dispatch_token(self, client, name="ci"):
        res = client.post("/api-tokens", headers=AUTH, json={"name": name})
        assert res.status_code == 200, res.text
        return res.json()

    def test_dispatch_token_can_queue(self, client, workspace):
        token = self._create_dispatch_token(client)
        res = client.post(
            "/dispatch",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"workspace": "test-ws", "text": "echo hi"},
        )
        assert res.status_code == 202, res.text

    def test_dispatch_token_rejects_direct_true(self, client, workspace):
        token = self._create_dispatch_token(client)
        res = client.post(
            "/dispatch",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"workspace": "test-ws", "text": "echo hi", "direct": True},
        )
        assert res.status_code == 400
        assert "Direct execution is not allowed for dispatch token" in res.json()["detail"]

    def test_main_token_still_allows_direct_true(self, client, workspace):
        res = client.post(
            "/dispatch", headers=AUTH,
            json={"workspace": "test-ws", "text": "echo hi", "direct": True},
        )
        assert res.status_code == 200

    def test_unknown_token_rejected(self, client, workspace):
        res = client.post(
            "/dispatch",
            headers={"Authorization": "Bearer not-a-real-token"},
            json={"workspace": "test-ws", "text": "echo hi"},
        )
        assert res.status_code == 401

    def test_revoked_dispatch_token_rejected(self, client, workspace):
        token = self._create_dispatch_token(client)
        client.delete(f"/api-tokens/{token['id']}", headers=AUTH)
        res = client.post(
            "/dispatch",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"workspace": "test-ws", "text": "echo hi"},
        )
        assert res.status_code == 401

    def test_dispatch_token_use_updates_last_used(self, client, workspace):
        token = self._create_dispatch_token(client)
        assert token["last_used"] is None
        client.post(
            "/dispatch",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"workspace": "test-ws", "text": "echo hi"},
        )
        listed = client.get("/api-tokens", headers=AUTH).json()
        assert listed[0]["last_used"] is not None

    def test_dispatch_token_logs_token_identity(self, client, workspace):
        from unittest import mock
        token = self._create_dispatch_token(client)
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(
                "/dispatch",
                headers={"Authorization": f"Bearer {token['token']}"},
                json={"workspace": "test-ws", "text": "echo hi"},
            )
        assert res.status_code == 202
        log.assert_called_once_with(
            "test-ws", "dispatch_pending", job="terminal", text="echo hi",
            auth=f"token:{token['id']}",
        )


class TestDispatchTokenExcludedFromOtherEndpoints:
    """最重要: dispatch トークンだけが漏れても、承認や WS 購読はできない。"""

    def _create_dispatch_token(self, client, name="ci"):
        res = client.post("/api-tokens", headers=AUTH, json={"name": name})
        return res.json()

    def test_dispatch_token_cannot_approve_decision(self, client, workspace):
        # メイントークンでキューへ積む（外部からの想定シナリオ通り）
        enqueue = client.post(
            "/dispatch", headers=AUTH, json={"workspace": "test-ws", "text": "echo hi"},
        )
        dispatch_id = enqueue.json()["id"]

        token = self._create_dispatch_token(client)
        res = client.post(
            f"/dispatch/{dispatch_id}/decision",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"approved": True},
        )
        assert res.status_code == 401

    def test_dispatch_token_cannot_open_status_stream_ws(self, client, workspace):
        token = self._create_dispatch_token(client)
        with pytest.raises(Exception):  # noqa: B017 - starlette closes with 1008 → WebSocketDisconnect
            with client.websocket_connect(f"/workspaces/statuses/ws?token={token['token']}"):
                pass

    def test_dispatch_token_cannot_list_devices(self, client, workspace):
        token = self._create_dispatch_token(client)
        res = client.get("/devices", headers={"Authorization": f"Bearer {token['token']}"})
        assert res.status_code == 401


class TestAuthLabel:
    def test_main_token_labeled_main(self):
        from api.routers.dispatch import _auth_label
        assert _auth_label(TOKEN) == "main"

    def test_disabled_auth_labeled_disabled(self):
        from api.routers.dispatch import _auth_label
        assert _auth_label("") == "disabled"

    def test_tailscale_identity_passthrough(self):
        from api.routers.dispatch import _auth_label
        assert _auth_label("tailscale:alice@example.com") == "tailscale:alice@example.com"

    def test_device_identity_passthrough(self):
        from api.routers.dispatch import _auth_label
        assert _auth_label("device:dev_abc") == "device:dev_abc"

    def test_token_identity_passthrough(self):
        from api.routers.dispatch import _auth_label
        assert _auth_label("token:tok_abc") == "token:tok_abc"
