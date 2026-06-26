"""push.py / routers/push.py のテスト。"""

import json
from unittest.mock import MagicMock, patch

import pytest

from conftest import AUTH


# ---------------------------------------------------------------------------
# push.py コア関数
# ---------------------------------------------------------------------------

class TestVapidKeys:
    def setup_method(self):
        import api.push as p
        self._orig_priv = p._vapid_private_pem
        self._orig_pub = p._vapid_public_b64

    def teardown_method(self):
        import api.push as p
        p._vapid_private_pem = self._orig_priv
        p._vapid_public_b64 = self._orig_pub

    def test_init_vapid_sets_keys(self, tmp_path):
        import api.push as p
        p._vapid_private_pem = None
        p._vapid_public_b64 = None
        with patch.object(p, "_DATA_DIR", tmp_path), \
             patch.object(p, "_VAPID_PRIVATE_FILE", tmp_path / "vapid_private.pem"), \
             patch.object(p, "_VAPID_PUBLIC_FILE", tmp_path / "vapid_public.txt"):
            p.init_vapid()
        assert p._vapid_private_pem is not None
        assert p._vapid_public_b64 is not None

    def test_get_vapid_public_key_triggers_init(self, tmp_path):
        import api.push as p
        p._vapid_private_pem = None
        p._vapid_public_b64 = None
        with patch.object(p, "_DATA_DIR", tmp_path), \
             patch.object(p, "_VAPID_PRIVATE_FILE", tmp_path / "vapid_private.pem"), \
             patch.object(p, "_VAPID_PUBLIC_FILE", tmp_path / "vapid_public.txt"):
            key = p.get_vapid_public_key()
        assert isinstance(key, str)
        assert len(key) > 0

    def test_load_existing_vapid_keys(self, tmp_path):
        import api.push as p
        priv_file = tmp_path / "vapid_private.pem"
        pub_file = tmp_path / "vapid_public.txt"
        # 一度生成してファイルに保存する
        with patch.object(p, "_DATA_DIR", tmp_path), \
             patch.object(p, "_VAPID_PRIVATE_FILE", priv_file), \
             patch.object(p, "_VAPID_PUBLIC_FILE", pub_file):
            p._vapid_private_pem = None
            p._vapid_public_b64 = None
            p.init_vapid()
            first_pub = p._vapid_public_b64
            # リセットして再ロード
            p._vapid_private_pem = None
            p._vapid_public_b64 = None
            p.init_vapid()
            assert p._vapid_public_b64 == first_pub


class TestSubscriptions:
    def setup_method(self, tmp_path_factory):
        import api.push as p
        self._p = p
        self._orig_file = p._SUBSCRIPTIONS_FILE

    def teardown_method(self):
        self._p._SUBSCRIPTIONS_FILE = self._orig_file

    def test_add_and_remove_subscription(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        sub = {"endpoint": "https://example.com/push/1", "keys": {"auth": "a", "p256dh": "b"}}
        p.add_subscription(sub)
        subs = p._load_subscriptions()
        assert len(subs) == 1
        assert subs[0]["endpoint"] == sub["endpoint"]

        p.remove_subscription(sub["endpoint"])
        subs = p._load_subscriptions()
        assert len(subs) == 0

    def test_add_subscription_deduplicates(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        sub = {"endpoint": "https://example.com/push/1", "keys": {}}
        p.add_subscription(sub)
        p.add_subscription(sub)
        subs = p._load_subscriptions()
        assert len(subs) == 1

    def test_load_subscriptions_empty(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "nonexistent.json"
        assert p._load_subscriptions() == []

    def test_load_subscriptions_broken_json(self, tmp_path):
        import api.push as p
        f = tmp_path / "subs.json"
        f.write_text("not json")
        p._SUBSCRIPTIONS_FILE = f
        assert p._load_subscriptions() == []


class TestSendPushNotification:
    def setup_method(self):
        import api.push as p
        self._p = p
        self._orig_file = p._SUBSCRIPTIONS_FILE
        self._orig_priv = p._vapid_private_pem
        self._orig_pub = p._vapid_public_b64

    def teardown_method(self):
        self._p._SUBSCRIPTIONS_FILE = self._orig_file
        self._p._vapid_private_pem = self._orig_priv
        self._p._vapid_public_b64 = self._orig_pub

    def test_send_skips_when_no_subscriptions(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        p._vapid_private_pem = "dummy"
        # サブスクリプションがなければ webpush を呼ばない
        with patch("api.push.send_push_notification.__wrapped__", None, create=True):
            p.send_push_notification("title", "body")  # 例外なければOK

    def test_send_calls_webpush(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        p._vapid_private_pem = "dummy-pem"
        sub = {"endpoint": "https://example.com/push/1", "keys": {"auth": "a", "p256dh": "b"}}
        p.add_subscription(sub)

        mock_webpush = MagicMock()
        mock_exc_cls = type("WebPushException", (Exception,), {"response": None})
        with patch.dict("sys.modules", {"pywebpush": MagicMock(webpush=mock_webpush, WebPushException=mock_exc_cls)}):
            p.send_push_notification("title", "body", "/test")

        mock_webpush.assert_called_once()
        call_kwargs = mock_webpush.call_args.kwargs
        assert call_kwargs["subscription_info"] == sub
        payload = json.loads(call_kwargs["data"])
        assert payload["title"] == "title"
        assert payload["url"] == "/test"

    def test_send_removes_stale_subscription_on_410(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        p._vapid_private_pem = "dummy-pem"
        sub = {"endpoint": "https://example.com/push/gone", "keys": {}}
        p.add_subscription(sub)

        mock_response = MagicMock(status_code=410)
        mock_exc_cls = type("WebPushException", (Exception,), {"response": mock_response})
        exc_instance = mock_exc_cls("gone")
        exc_instance.response = mock_response

        def raise_exc(**kwargs):
            raise exc_instance

        with patch.dict("sys.modules", {"pywebpush": MagicMock(webpush=raise_exc, WebPushException=mock_exc_cls)}):
            p.send_push_notification("title", "body")

        assert p._load_subscriptions() == []

    def test_send_handles_generic_exception(self, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        p._vapid_private_pem = "dummy-pem"
        sub = {"endpoint": "https://example.com/push/1", "keys": {}}
        p.add_subscription(sub)

        mock_exc_cls = type("WebPushException", (Exception,), {"response": None})

        def raise_generic(**kwargs):
            raise RuntimeError("network error")

        with patch.dict("sys.modules", {"pywebpush": MagicMock(webpush=raise_generic, WebPushException=mock_exc_cls)}):
            p.send_push_notification("title", "body")  # 例外が伝播しないこと


# ---------------------------------------------------------------------------
# routers/push.py エンドポイント
# ---------------------------------------------------------------------------

class TestPushRouter:
    def test_get_vapid_public_key(self, client, tmp_path):
        import api.push as p
        p._vapid_public_b64 = "test-public-key"
        res = client.get("/push/vapid-public-key", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["publicKey"] == "test-public-key"

    def test_subscribe(self, client, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        payload = {"endpoint": "https://example.com/push/x", "keys": {"auth": "a", "p256dh": "b"}}
        res = client.post("/push/subscribe", headers=AUTH, json=payload)
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        subs = p._load_subscriptions()
        assert any(s["endpoint"] == payload["endpoint"] for s in subs)

    def test_unsubscribe(self, client, tmp_path):
        import api.push as p
        p._SUBSCRIPTIONS_FILE = tmp_path / "subs.json"
        sub = {"endpoint": "https://example.com/push/y", "keys": {}}
        p.add_subscription(sub)
        res = client.request("DELETE", "/push/subscribe", headers=AUTH, json={"endpoint": sub["endpoint"]})
        assert res.status_code == 200
        assert p._load_subscriptions() == []
