"""QRコードペアリングのテスト。

- start: 認証済みのみ許可、id/url/expires_in_secを返す（tailscale有無でのURL分岐）
- status: pending / claimed / expired / not_found
- claim: 成功 → cookie発行、二重claim拒否、期限切れ拒否、不正token拒否
- 専用レートリミット
"""

import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from api import auth as auth_module
from api.main import app
from api.routers import pairing as pairing_mod
from conftest import AUTH


def _client_with_port(port=8888):
    # デフォルトの `client` フィクスチャは base_url に明示ポートを含まないため、
    # request.url.port が常に None になる。Serve のポート一致確認をテストするには
    # 明示ポート付きのクライアントが要る。
    return TestClient(app, base_url=f"http://testserver:{port}")


@pytest.fixture(autouse=True)
def _isolate_pairing():
    pairing_mod._pairings.clear()
    pairing_mod._rate_counter._counts.clear()
    yield
    pairing_mod._pairings.clear()
    pairing_mod._rate_counter._counts.clear()


def _start(client, monkeypatch=None):
    if monkeypatch is not None:
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: None)
    res = client.post("/auth/pairing/start", headers=AUTH)
    assert res.status_code == 200, res.text
    return res.json()


class TestStart:
    def test_requires_auth(self, client):
        res = client.post("/auth/pairing/start")
        assert res.status_code == 401

    def test_returns_id_url_and_expiry(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        assert data["id"].startswith("pr_")
        assert f"/pair/{data['id']}?t=" in data["url"]
        assert data["expires_in_sec"] == pairing_mod.PAIRING_TTL_SEC

    def test_falls_back_to_request_host_without_tailscale(self, client, monkeypatch):
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: None)
        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.json()["url"].startswith("http://testserver/pair/")

    def test_uses_tailscale_hostname_when_serve_targets_this_port(self, client, monkeypatch):
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        monkeypatch.setattr(pairing_mod, "_tailscale_serve_targets_port", lambda port: port == 8888)
        res = _client_with_port(8888).post("/auth/pairing/start", headers=AUTH)
        assert res.json()["url"].startswith("https://myhost.tail1234.ts.net/pair/")

    def test_falls_back_when_serve_targets_a_different_port(self, client, monkeypatch):
        # tailscaleがインストール済みでホスト名は引けても、Serveが別サービス/別ポート
        # 向けに設定されているだけなら https://<hostname> は any-console に届かない
        # ため、リクエスト自身のhost:portにフォールバックしなければならない
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        monkeypatch.setattr(pairing_mod, "_tailscale_serve_targets_port", lambda port: port == 9999)
        res = _client_with_port(8888).post("/auth/pairing/start", headers=AUTH)
        assert res.json()["url"].startswith("http://testserver:8888/pair/")

    def test_falls_back_when_request_has_no_explicit_port(self, client, monkeypatch):
        # request.url.port が取れない(Hostヘッダにポートが無い)場合は、Serveが
        # 実際にどこへproxyしているか比較しようがないため安全側(フォールバック)に倒す
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        monkeypatch.setattr(pairing_mod, "_tailscale_serve_targets_port", lambda port: True)
        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.json()["url"].startswith("http://testserver/pair/")

    def test_disabled_when_auth_disabled(self, client, monkeypatch):
        monkeypatch.setattr(auth_module, "ANY_CONSOLE_TOKEN", "")
        res = client.post("/auth/pairing/start")
        assert res.status_code == 400

    def test_rate_limited_after_burst(self, client, monkeypatch):
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: None)
        monkeypatch.setattr(pairing_mod, "_START_LIMIT", 2)
        assert client.post("/auth/pairing/start", headers=AUTH).status_code == 200
        assert client.post("/auth/pairing/start", headers=AUTH).status_code == 200
        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 429


class TestTailscaleServeTargetsPort:
    def test_true_when_web_handler_proxies_to_port(self, monkeypatch):
        payload = subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout='{"Web": {"myhost.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8888"}}}}}',
        )
        monkeypatch.setattr(pairing_mod, "run_subprocess_safe", lambda *a, **k: payload)
        assert pairing_mod._tailscale_serve_targets_port(8888) is True

    def test_false_when_proxied_to_a_different_port(self, monkeypatch):
        payload = subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout='{"Web": {"myhost.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:3000"}}}}}',
        )
        monkeypatch.setattr(pairing_mod, "run_subprocess_safe", lambda *a, **k: payload)
        assert pairing_mod._tailscale_serve_targets_port(8888) is False

    def test_false_when_tailscale_not_installed(self, monkeypatch):
        monkeypatch.setattr(pairing_mod, "run_subprocess_safe", lambda *a, **k: None)
        assert pairing_mod._tailscale_serve_targets_port(8888) is False

    def test_false_when_no_web_section(self, monkeypatch):
        payload = subprocess.CompletedProcess(args=[], returncode=0, stdout="{}")
        monkeypatch.setattr(pairing_mod, "run_subprocess_safe", lambda *a, **k: payload)
        assert pairing_mod._tailscale_serve_targets_port(8888) is False

    def test_false_on_invalid_json(self, monkeypatch):
        payload = subprocess.CompletedProcess(args=[], returncode=0, stdout="not json")
        monkeypatch.setattr(pairing_mod, "run_subprocess_safe", lambda *a, **k: payload)
        assert pairing_mod._tailscale_serve_targets_port(8888) is False


class TestStatus:
    def test_unknown_id_returns_not_found(self, client):
        res = client.get("/auth/pairing/pr_doesnotexist/status")
        assert res.status_code == 200
        assert res.json()["status"] == "not_found"

    def test_pending_needs_no_auth(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        res = client.get(f"/auth/pairing/{data['id']}/status")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "pending"
        assert 0 < body["expires_in_sec"] <= pairing_mod.PAIRING_TTL_SEC

    def test_expired_is_swept_on_read(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        pairing_mod._pairings[data["id"]]["expires_at"] = time.time() - 1
        res = client.get(f"/auth/pairing/{data['id']}/status")
        assert res.json()["status"] == "expired"
        assert data["id"] not in pairing_mod._pairings

    def test_claimed_is_observable_then_gone(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        claim_res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert claim_res.status_code == 200, claim_res.text
        status_res = client.get(f"/auth/pairing/{data['id']}/status")
        assert status_res.json()["status"] == "claimed"


class TestClaim:
    def test_success_sets_device_cookies(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True
        assert body["device_id"].startswith("dev_")
        assert "any_console_device" in res.cookies
        assert "any_console_secret" in res.cookies

    def test_claimed_device_can_authenticate(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        res = client.get("/auth/check")
        assert res.status_code == 200
        assert res.json()["auth_method"] == "device"

    def test_wrong_token_rejected(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong-token"})
        assert res.status_code == 401
        # 誤ったtokenでも有効なエントリ自体は消費されない(再試行できる)
        assert data["id"] in pairing_mod._pairings

    def test_unknown_id_rejected(self, client):
        res = client.post("/auth/pairing/pr_nope/claim", json={"token": "anything"})
        assert res.status_code == 410

    def test_expired_rejected(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        pairing_mod._pairings[data["id"]]["expires_at"] = time.time() - 1
        res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert res.status_code == 410

    def test_double_claim_rejected(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        first = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert first.status_code == 200
        second = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert second.status_code == 410

    def test_rate_limited_after_burst(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        monkeypatch.setattr(pairing_mod, "_CLAIM_LIMIT", 2)
        assert client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong"}).status_code == 401
        assert client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong"}).status_code == 401
        res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong"})
        assert res.status_code == 429

    def test_rate_limit_is_scoped_per_pairing_id(self, client, monkeypatch):
        # Tailscale Serve経由では全クライアントがloopback発に見えるため、IPだけの
        # バケットだと1つのpairing_idへの荒らしが無関係な別pairing_idまで
        # 巻き添えでブロックしてしまう。pairing_idごとに独立counterであることを確認する。
        monkeypatch.setattr(pairing_mod, "_CLAIM_LIMIT", 1)
        first = _start(client, monkeypatch)
        second = _start(client, monkeypatch)
        assert client.post(f"/auth/pairing/{first['id']}/claim", json={"token": "wrong"}).status_code == 401
        blocked = client.post(f"/auth/pairing/{first['id']}/claim", json={"token": "wrong"})
        assert blocked.status_code == 429
        # 別のpairing_idへのclaimは影響を受けない
        other_token = pairing_mod._pairings[second["id"]]["token"]
        unaffected = client.post(f"/auth/pairing/{second['id']}/claim", json={"token": other_token})
        assert unaffected.status_code == 200, unaffected.text

    def test_same_user_agent_registers_distinct_devices(self, client, monkeypatch):
        # find_or_register_device のような同一UA再利用はしない: 同一UAの2台を続けて
        # ペアリングしても、先発デバイスのcookie/secretが後発によって無効化されては
        # ならない(claimは常に人間の明示操作であり、tailscale自動登録の再利用ロジックは
        # 想定していない)。
        ua = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"}
        first = _start(client, monkeypatch)
        first_token = pairing_mod._pairings[first["id"]]["token"]
        first_res = client.post(f"/auth/pairing/{first['id']}/claim", json={"token": first_token}, headers=ua)
        assert first_res.status_code == 200, first_res.text
        first_device_cookies = dict(first_res.cookies)

        second = _start(client, monkeypatch)
        second_token = pairing_mod._pairings[second["id"]]["token"]
        second_res = client.post(f"/auth/pairing/{second['id']}/claim", json={"token": second_token}, headers=ua)
        assert second_res.status_code == 200, second_res.text

        assert first_res.json()["device_id"] != second_res.json()["device_id"]
        # 先発デバイスのcookieがまだ有効であること(secretが回転させられていない)。
        # `client` の cookie jar は second claim の Set-Cookie で上書き済みなので、
        # 別クライアントに先発デバイスのcookieだけを積んで確認する。
        from fastapi.testclient import TestClient
        from api.main import app
        check_client = TestClient(app)
        check_client.cookies.set("any_console_device", first_device_cookies["any_console_device"])
        check_client.cookies.set("any_console_secret", first_device_cookies["any_console_secret"])
        check = check_client.get("/auth/check")
        assert check.status_code == 200

    def test_registration_failure_rolls_back_and_allows_retry(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]

        def _boom(*a, **k):
            raise OSError("disk full")

        monkeypatch.setattr(pairing_mod, "register_device", _boom)
        failed = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert failed.status_code == 500
        # tokenはまだ破棄されていないので、同じ有効なQRでリトライできる
        assert data["id"] in pairing_mod._pairings
        assert pairing_mod._pairings[data["id"]]["claimed"] is False
        assert pairing_mod._pairings[data["id"]]["claiming"] is False

        monkeypatch.undo()
        retry = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert retry.status_code == 200, retry.text

    def test_in_progress_claim_rejects_concurrent_claim(self, client, monkeypatch):
        # 登録処理中(claiming=True)は、同じtokenでの二重claimも弾く必要がある
        # (先発呼び出しが完了するまで新しいデバイスを2つ作ってしまわないように)。
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        pairing_mod._pairings[data["id"]]["claiming"] = True
        res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert res.status_code == 410

    def test_in_progress_claim_still_reports_pending_status(self, client, monkeypatch):
        # デバイス登録中(claiming=True)でも、エントリはdictに残ったままなので
        # statusはpendingを返し続ける(not_foundになって発行元が「期限切れ」と
        # 誤認しポーリングを止めてしまうことを防ぐ)。
        data = _start(client, monkeypatch)
        pairing_mod._pairings[data["id"]]["claiming"] = True
        res = client.get(f"/auth/pairing/{data['id']}/status")
        assert res.status_code == 200
        assert res.json()["status"] == "pending"


class TestStatusRateLimit:
    def test_rate_limited_after_burst(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        monkeypatch.setattr(pairing_mod, "_STATUS_LIMIT", 2)
        assert client.get(f"/auth/pairing/{data['id']}/status").status_code == 200
        assert client.get(f"/auth/pairing/{data['id']}/status").status_code == 200
        res = client.get(f"/auth/pairing/{data['id']}/status")
        assert res.status_code == 429

    def test_rate_limit_is_scoped_per_pairing_id(self, client, monkeypatch):
        # claimと同じ理由: IPだけのバケットだと、無関係なpairing_idへの荒らしで
        # 正規のpairingのstatusポーリングまで429にされてしまう。
        monkeypatch.setattr(pairing_mod, "_STATUS_LIMIT", 1)
        first = _start(client, monkeypatch)
        second = _start(client, monkeypatch)
        assert client.get(f"/auth/pairing/{first['id']}/status").status_code == 200
        assert client.get(f"/auth/pairing/{first['id']}/status").status_code == 429
        # 別のpairing_idへのstatusは影響を受けない
        assert client.get(f"/auth/pairing/{second['id']}/status").status_code == 200


def test_pair_page_serves_spa_shell(client):
    res = client.get("/pair/pr_anything")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
