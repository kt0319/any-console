"""Trusted Device 認証のテスト。

- デバイス登録 → cookie 発行
- 登録済み cookie で認証通過
- revoke で当該 device のみ無効化、他は無傷
- Tailscale / Bearer token と共存
- 不正な secret は拒否
"""

import threading

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
        assert devices_mod.verify_and_touch_device(id2, secret2) is not None

    def test_old_secret_invalidated_after_reissue(self):
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"
        id1, secret1 = devices_mod.find_or_register_device("Safari on iOS", ua, source="tailscale")
        _, _ = devices_mod.find_or_register_device("Safari on iOS", ua, source="tailscale")
        assert devices_mod.verify_and_touch_device(id1, secret1) is None

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
        dev = devices_mod.verify_and_touch_device(device_id, secret)
        assert dev is not None
        assert dev["name"] == "MyMac"

    def test_verify_wrong_secret_fails(self):
        device_id, _ = devices_mod.register_device("MyMac", "ua/1")
        assert devices_mod.verify_and_touch_device(device_id, "wrong") is None

    def test_verify_unknown_id_fails(self):
        assert devices_mod.verify_and_touch_device("dev_doesnotexist", "anything") is None

    def test_verify_empty_args_fails(self):
        assert devices_mod.verify_and_touch_device("", "") is None

    def test_revoke_removes_device(self):
        device_id, secret = devices_mod.register_device("MyMac", "ua/1")
        assert devices_mod.revoke_device(device_id) is True
        assert devices_mod.verify_and_touch_device(device_id, secret) is None

    def test_revoke_keeps_others(self):
        a_id, a_secret = devices_mod.register_device("A", "ua/a")
        b_id, b_secret = devices_mod.register_device("B", "ua/b")
        devices_mod.revoke_device(a_id)
        assert devices_mod.verify_and_touch_device(a_id, a_secret) is None
        assert devices_mod.verify_and_touch_device(b_id, b_secret) is not None

    def test_list_devices_excludes_secret_hash(self):
        devices_mod.register_device("A", "ua/a")
        items = devices_mod.list_devices()
        assert len(items) == 1
        assert "secret_hash" not in items[0]


class TestServerKeyConcurrency:
    """data/server_key が無い状態で複数スレッドが同時に鍵を要求しても、
    生成される鍵が1個に収束することを回帰確認する（登録済み secret のハッシュが
    後から絶対に一致しなくなる split-brain を防ぐ）。"""

    def test_concurrent_creation_is_serialized_and_agrees_on_one_key(self, monkeypatch):
        orig_token_bytes = devices_mod.secrets.token_bytes
        call_count = {"n": 0}
        other_results = []
        other_attempted = threading.Event()
        other_done = threading.Event()
        holder = {}

        def hooked_token_bytes(n):
            call_count["n"] += 1
            if call_count["n"] == 1:
                # ここは _load_or_create_server_key が _server_key_lock を保持した
                # まま、まだファイルに書き込む前（鍵を新規生成した直後）。別スレッド
                # で同時に呼んでも、書き込みが終わってロックが解放されるまでは
                # 着手できないはず。
                def do_call():
                    other_attempted.set()
                    other_results.append(devices_mod._load_or_create_server_key())
                    other_done.set()

                t = threading.Thread(target=do_call)
                holder["thread"] = t
                t.start()
                assert other_attempted.wait(timeout=2)
                assert not other_done.wait(timeout=0.2), (
                    "concurrent caller should block until the key file is written"
                )
            return orig_token_bytes(n)

        monkeypatch.setattr(devices_mod.secrets, "token_bytes", hooked_token_bytes)

        first_key = devices_mod._load_or_create_server_key()
        holder["thread"].join(timeout=2)

        assert call_count["n"] == 1, "server key must be generated exactly once"
        assert other_results == [first_key]


class TestDevicesFileConcurrency:
    """devices.json への load→変更→save が並行実行されても取りこぼさないことを
    回帰確認する。QRペアリングのclaim(register_device)と、既存端末の何気ない
    リクエスト(verify_and_touch_device)が重なる場面を想定している。"""

    def test_concurrent_register_and_verify_do_not_lose_writes(self, monkeypatch):
        existing_id, existing_secret = devices_mod.register_device("Existing", "ua/existing")

        orig_save = devices_mod._save
        call_count = {"n": 0}
        other_done = threading.Event()
        holder = {}

        def hooked_save(data):
            call_count["n"] += 1
            if call_count["n"] == 1:
                # ここは register_device が _devices_lock を保持したまま、新
                # デバイスを追記した dict をまさに書き込もうとしている間隙。
                # ロックが無ければ、この間に別スレッドの verify_and_touch_device
                # が書き込み前の(新デバイスをまだ含まない)データを読み、直後に
                # 保存し直してこちらの新デバイスを消してしまう(lost update)。
                def do_verify():
                    devices_mod.verify_and_touch_device(existing_id, existing_secret)
                    other_done.set()

                t = threading.Thread(target=do_verify)
                holder["thread"] = t
                t.start()
                assert not other_done.wait(timeout=0.2), (
                    "concurrent verify_and_touch_device should block until register_device releases the lock"
                )
            orig_save(data)

        monkeypatch.setattr(devices_mod, "_save", hooked_save)

        new_id, new_secret = devices_mod.register_device("New", "ua/new")
        holder["thread"].join(timeout=2)

        assert devices_mod.verify_and_touch_device(new_id, new_secret) is not None
        assert devices_mod.verify_and_touch_device(existing_id, existing_secret) is not None
        assert len(devices_mod.list_devices()) == 2


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
        res = client.post("/auth/logout")
        assert res.status_code == 200
        # device record も消えている
        assert devices_mod.get_device(device_id) is None


class TestVerifyTokenIntegration:
    def test_tailscale_priority_over_device(self, monkeypatch):
        """Tailscale ヘッダがあれば device cookie より優先される（既存挙動を壊さない）。

        Tailscale ヘッダ信頼は opt-in（ADR #20）のため有効化してから確認する。
        """
        # ここはユニットテストで auth.py の verify_token 順序を担保。詳細は test_tailscale_auth.py 参照。
        monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", True)
        assert auth_module._tailscale_user("127.0.0.1", {"tailscale-user-login": "alice@example.com"}) == "alice@example.com"

    def test_bearer_token_still_works(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["auth_method"] == "token"
