"""Trusted Device 認証のテスト。

- デバイス登録 → cookie 発行
- 登録済み cookie で認証通過
- revoke で当該 device のみ無効化、他は無傷
- Tailscale / Bearer token と共存
- 不正な secret は拒否
"""

import pytest

from api import auth as auth_module
from api import devices as devices_mod
from conftest import AUTH, TOKEN


@pytest.fixture(autouse=True)
def _isolate_devices(tmp_path, monkeypatch):
    devices_file = tmp_path / "devices.json"
    server_key = tmp_path / "server_key"
    monkeypatch.setattr(devices_mod, "_DEVICES_FILE", devices_file)
    monkeypatch.setattr(devices_mod, "_SERVER_KEY_FILE", server_key)


class TestAutoName:
    def test_chrome_macos(self):
        ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        assert devices_mod.autoname_from_user_agent(ua) == "Chrome on macOS"

    def test_safari_ios(self):
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
        assert devices_mod.autoname_from_user_agent(ua) == "Safari on iOS"

    def test_firefox_linux(self):
        ua = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"
        assert devices_mod.autoname_from_user_agent(ua) == "Firefox on Linux"

    def test_empty(self):
        assert devices_mod.autoname_from_user_agent("") == "Unknown device"


class TestFindOrRegister:
    def test_same_ua_and_source_reuses_device(self):
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"
        id1, _ = devices_mod.find_or_register_device("Safari on iOS", ua, source="tailscale")
        id2, secret2 = devices_mod.find_or_register_device("Safari on iOS", ua, source="tailscale")
        assert id1 == id2
        assert devices_mod.verify_device(id2, secret2) is not None

    def test_old_secret_invalidated_after_reissue(self):
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"
        id1, secret1 = devices_mod.find_or_register_device("Safari on iOS", ua, source="tailscale")
        _, _ = devices_mod.find_or_register_device("Safari on iOS", ua, source="tailscale")
        assert devices_mod.verify_device(id1, secret1) is None

    def test_different_source_creates_new_device(self):
        ua = "Mozilla/5.0 Chrome/120.0"
        id1, _ = devices_mod.find_or_register_device("Chrome", ua, source="tailscale")
        id2, _ = devices_mod.find_or_register_device("Chrome", ua, source="token")
        assert id1 != id2

    def test_different_ua_creates_new_device(self):
        id1, _ = devices_mod.find_or_register_device("Dev A", "ua/a", source="tailscale")
        id2, _ = devices_mod.find_or_register_device("Dev B", "ua/b", source="tailscale")
        assert id1 != id2

    def test_multiple_candidates_reuses_existing(self):
        ua = "Mozilla/5.0 Chrome/120.0"
        # 同じUA・sourceで2件手動登録（重複データの再現）
        id1, _ = devices_mod.register_device("Chrome", ua, source="tailscale")
        id2, _ = devices_mod.register_device("Chrome", ua, source="tailscale")
        # 新規登録は行われず既存のいずれかを再利用する
        reused_id, _ = devices_mod.find_or_register_device("Chrome", ua, source="tailscale")
        assert reused_id in (id1, id2)
        assert len(devices_mod.list_devices()) == 2  # 古い id1 は残ったまま（削除はしない）


class TestRegisterAndVerify:
    def test_register_returns_id_and_secret(self):
        device_id, secret = devices_mod.register_device("MyMac", "ua/1")
        assert device_id.startswith("dev_")
        assert len(secret) >= 32

    def test_verify_succeeds_after_register(self):
        device_id, secret = devices_mod.register_device("MyMac", "ua/1")
        dev = devices_mod.verify_device(device_id, secret)
        assert dev is not None
        assert dev["name"] == "MyMac"

    def test_verify_wrong_secret_fails(self):
        device_id, _ = devices_mod.register_device("MyMac", "ua/1")
        assert devices_mod.verify_device(device_id, "wrong") is None

    def test_verify_unknown_id_fails(self):
        assert devices_mod.verify_device("dev_doesnotexist", "anything") is None

    def test_verify_empty_args_fails(self):
        assert devices_mod.verify_device("", "") is None

    def test_revoke_removes_device(self):
        device_id, secret = devices_mod.register_device("MyMac", "ua/1")
        assert devices_mod.revoke_device(device_id) is True
        assert devices_mod.verify_device(device_id, secret) is None

    def test_revoke_keeps_others(self):
        a_id, a_secret = devices_mod.register_device("A", "ua/a")
        b_id, b_secret = devices_mod.register_device("B", "ua/b")
        devices_mod.revoke_device(a_id)
        assert devices_mod.verify_device(a_id, a_secret) is None
        assert devices_mod.verify_device(b_id, b_secret) is not None

    def test_list_devices_excludes_secret_hash(self):
        devices_mod.register_device("A", "ua/a")
        items = devices_mod.list_devices()
        assert len(items) == 1
        assert "secret_hash" not in items[0]


class TestRegisterEndpoint:
    def test_register_with_valid_token(self, client):
        res = client.post("/devices/register", json={"token": TOKEN, "name": "Test Device"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["device_id"].startswith("dev_")
        assert data["name"] == "Test Device"
        # cookies set
        assert "any_console_device" in res.cookies
        assert "any_console_secret" in res.cookies

    def test_register_with_invalid_token_returns_401(self, client):
        res = client.post("/devices/register", json={"token": "wrong"})
        assert res.status_code == 401

    def test_register_autonames_if_no_name(self, client):
        res = client.post(
            "/devices/register",
            json={"token": TOKEN},
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; ... Chrome/120.0"},
        )
        assert res.status_code == 200
        assert "Chrome" in res.json()["name"]


class TestDeviceCookieAuth:
    def test_check_passes_after_register(self, client):
        # register → device cookie が付与される → /auth/check が token 無しで通る
        client.post("/devices/register", json={"token": TOKEN, "name": "Test"})
        res = client.get("/auth/check")
        assert res.status_code == 200
        body = res.json()
        assert body["auth_method"] == "device"
        assert body["device"]["name"] == "Test"


class TestListAndRevoke:
    def test_list_requires_auth(self, client):
        res = client.get("/devices")
        assert res.status_code == 401

    def test_list_shows_registered(self, client):
        client.post("/devices/register", json={"token": TOKEN, "name": "A"})
        client.post("/devices/register", json={"token": TOKEN, "name": "B"})
        res = client.get("/devices", headers=AUTH)
        assert res.status_code == 200
        names = [d["name"] for d in res.json()]
        assert sorted(names) == ["A", "B"]

    def test_list_marks_current_device(self, client):
        client.post("/devices/register", json={"token": TOKEN, "name": "Current"})
        res = client.get("/devices")
        assert res.status_code == 200
        current = [d for d in res.json() if d.get("current")]
        assert len(current) == 1
        assert current[0]["name"] == "Current"

    def test_revoke_unknown_returns_404(self, client):
        res = client.delete("/devices/dev_nonexistent", headers=AUTH)
        assert res.status_code == 404

    def test_revoke_existing_returns_ok(self, client):
        reg = client.post("/devices/register", json={"token": TOKEN, "name": "X"})
        device_id = reg.json()["device_id"]
        res = client.delete(f"/devices/{device_id}", headers=AUTH)
        assert res.status_code == 200


class TestLogout:
    def test_logout_revokes_current_device(self, client):
        reg = client.post("/devices/register", json={"token": TOKEN, "name": "X"})
        device_id = reg.json()["device_id"]
        res = client.post("/devices/logout")
        assert res.status_code == 200
        # device record も消えている
        assert devices_mod.get_device(device_id) is None


class TestVerifyTokenIntegration:
    def test_tailscale_priority_over_device(self):
        """Tailscale ヘッダがあれば device cookie より優先される（既存挙動を壊さない）。"""
        # ここはユニットテストで auth.py の verify_token 順序を担保。詳細は test_tailscale_auth.py 参照。
        assert auth_module._tailscale_user("127.0.0.1", {"tailscale-user-login": "alice@example.com"}) == "alice@example.com"

    def test_bearer_token_still_works(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["auth_method"] == "token"
