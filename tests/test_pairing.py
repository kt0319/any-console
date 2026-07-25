"""QRコードペアリングのテスト。

- start: 認証済みのみ許可、id/url/expires_in_secを返す（tailscale有無でのURL分岐）
- status: pending / claimed / expired / not_found
- claim: 成功 → cookie発行、二重claim拒否、期限切れ拒否、不正token拒否
- 専用レートリミット
"""

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


def _client_loopback(host="localhost", port=8888):
    # 起動時通知どおり http://localhost:8888 でアクセスしているケースを再現する。
    return TestClient(app, base_url=f"http://{host}:{port}")


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

    def test_uses_tailscale_hostname_and_own_port_when_available(self, client, monkeypatch):
        # MagicDNS名が引ければ、Tailscale Serveの設定有無に関わらず、この
        # プロセス自身の待受ポートと組み合わせてtailnet越しに到達させる
        # (Serveの検出はしない — 無くてもtailnet経由の直接アクセスで届くため)。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = _client_with_port(8888).post("/auth/pairing/start", headers=AUTH)
        assert res.json()["url"].startswith("http://myhost.tail1234.ts.net:8888/pair/")

    def test_infers_scheme_default_port_when_request_has_no_explicit_port(self, client, monkeypatch):
        # request.url.port はHostヘッダに明示ポートが無いとNoneになるが、それは
        # 「ポート不明」ではなくscheme標準ポート(http→80)を意味する。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.json()["url"].startswith("http://myhost.tail1234.ts.net:80/pair/")

    def test_bind_loopback_only_falls_back_to_request_origin_for_non_loopback_request(self, client, monkeypatch):
        # __global__.host がloopback専用の場合、MagicDNS名を使っても結局
        # どこからも到達できない。リクエスト自体はloopbackではない(LAN/tailnet
        # IP直打ち等)ので、その場合はリクエスト自身のnetlocへフォールバックする
        # (拒否はしない — そのnetloc自体は到達可能な可能性が高いため)。
        from api.config import save_global_config_section

        save_global_config_section("host", "127.0.0.1")
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        assert res.json()["url"].startswith("http://testserver/pair/")

    def test_loopback_without_explicit_port_infers_scheme_default(self, client, monkeypatch):
        # https://localhost (ポート省略。native TLSを443番で運用し、そのURLで
        # 開いた想定) でも暗黙の443番を補ってMagicDNS名+ポートへ差し替えられる
        # こと。補わなければportがNoneのまま扱われ、到達不能なloopbackの
        # netlocがQRに残るか、無条件に400へ落ちてしまう。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = TestClient(app, base_url="https://localhost").post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        assert res.json()["url"].startswith("https://myhost.tail1234.ts.net:443/pair/")

    def test_loopback_origin_uses_hostname_preserving_scheme_when_available(self, client, monkeypatch):
        # 発行元がhttp://localhost:8888(起動時通知どおり)で開いている場合、
        # そのままだとQRの宛先が「スキャンした端末自身のlocalhost」になり
        # 絶対に繋がらない。MagicDNS名+実ポートに差し替えなければならない。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = _client_loopback("localhost", 8888).post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        assert res.json()["url"].startswith("http://myhost.tail1234.ts.net:8888/pair/")

    def test_loopback_origin_preserves_https_scheme(self, client, monkeypatch):
        # native TLS(SSL_KEYFILE/SSL_CERTFILE)運用でhttps://localhost:8888から
        # 開いている場合、そのポートはTLSを要求するのでhttpに決め打ちしては
        # ならない。requestのschemeをそのまま引き継ぐ。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = TestClient(app, base_url="https://localhost:8888").post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        assert res.json()["url"].startswith("https://myhost.tail1234.ts.net:8888/pair/")

    def test_loopback_origin_uses_ip_form_too(self, client, monkeypatch):
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = _client_loopback("127.0.0.1", 8888).post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        assert res.json()["url"].startswith("http://myhost.tail1234.ts.net:8888/pair/")

    def test_loopback_origin_rejected_without_a_tailscale_hostname(self, client, monkeypatch):
        # tailscaleホスト名も引けず、リクエスト自体がloopbackなら、他端末から
        # 到達できるURLを作りようがないため、明確なエラーで拒否する。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: None)
        res = _client_loopback("localhost", 8888).post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 400
        assert "localhost" in res.json()["detail"]

    def test_loopback_origin_rejected_when_bind_is_loopback_only(self, client, monkeypatch):
        # __global__.host が 127.0.0.1/::1 のようなloopback専用でbindされている
        # 場合、MagicDNS名が引けてもこのプロセスはtailnetのインターフェース上で
        # 待ち受けていないため、差し替えたURLも結局どの他端末からも到達できない。
        from api.config import save_global_config_section

        save_global_config_section("host", "127.0.0.1")
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = _client_loopback("localhost", 8888).post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 400
        assert "localhost" in res.json()["detail"]

    def test_loopback_origin_still_used_when_bind_is_not_loopback_only(self, client, monkeypatch):
        from api.config import save_global_config_section

        save_global_config_section("host", "0.0.0.0")
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: "myhost.tail1234.ts.net")
        res = _client_loopback("localhost", 8888).post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        assert res.json()["url"].startswith("http://myhost.tail1234.ts.net:8888/pair/")

    def test_disabled_when_auth_disabled(self, client, monkeypatch):
        monkeypatch.setattr(auth_module, "ANY_CONSOLE_TOKEN", "")
        res = client.post("/auth/pairing/start")
        assert res.status_code == 400

    def test_rate_limited_after_burst(self, client, monkeypatch):
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: None)
        monkeypatch.setattr(pairing_mod, "_PAIRING_RATE_LIMIT", 2)
        assert client.post("/auth/pairing/start", headers=AUTH).status_code == 200
        assert client.post("/auth/pairing/start", headers=AUTH).status_code == 200
        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 429

    def test_sweeps_stale_entries_from_a_previous_start(self, client, monkeypatch):
        first = _start(client, monkeypatch)
        pairing_mod._pairings[first["id"]]["expires_at"] = time.time() - 1
        _start(client, monkeypatch)
        assert first["id"] not in pairing_mod._pairings

    def test_ttl_starts_after_url_discovery_not_before(self, client, monkeypatch):
        # _build_pairing_url は tailscale サブプロセスを最大2回呼び、遅い環境
        # では数秒かかりうる。expires_at をそれより前の時刻で確定すると、
        # レスポンスに乗る expires_in_sec(常にPAIRING_TTL_SEC固定)より
        # バックエンドの寿命が先に尽きてしまう。expires_at は URL 確定後の
        # 時刻を起点にしなければならない。
        monkeypatch.setattr(pairing_mod, "_resolve_tailscale_name", lambda: None)
        clock = {"t": 1_000_000.0}
        monkeypatch.setattr(pairing_mod.time, "time", lambda: clock["t"])
        orig_build = pairing_mod._build_pairing_url

        def slow_build(request, pairing_id, pairing_token):
            clock["t"] += 10  # tailscaleサブプロセス呼び出しに10秒かかった体で進める
            return orig_build(request, pairing_id, pairing_token)

        monkeypatch.setattr(pairing_mod, "_build_pairing_url", slow_build)

        res = client.post("/auth/pairing/start", headers=AUTH)
        assert res.status_code == 200, res.text
        entry = pairing_mod._pairings[res.json()["id"]]
        assert entry["expires_at"] == pytest.approx(clock["t"] + pairing_mod.PAIRING_TTL_SEC)


class TestEffectivePort:
    def _request(self, scheme, port=None):
        from starlette.requests import Request

        host_header = "testserver" if port is None else f"testserver:{port}"
        scope = {
            "type": "http",
            "scheme": scheme,
            "server": ("testserver", port or 80),
            "headers": [(b"host", host_header.encode())],
            "path": "/",
            "method": "GET",
        }
        return Request(scope)

    def test_explicit_port_is_used_as_is(self):
        assert pairing_mod._effective_port(self._request("http", 8888)) == 8888

    def test_infers_443_for_https_without_explicit_port(self):
        assert pairing_mod._effective_port(self._request("https")) == 443

    def test_infers_80_for_http_without_explicit_port(self):
        assert pairing_mod._effective_port(self._request("http")) == 80

    def test_unknown_for_non_http_scheme_without_explicit_port(self):
        # FastAPI/Starletteの実運用では http/https 以外は来ないが、念のための
        # フォールバック(推測しようがないので素直にNoneを返す)を確認する。
        assert pairing_mod._effective_port(self._request("ws")) is None


class TestIsLoopbackHost:
    def test_localhost(self):
        assert pairing_mod._is_loopback_host("localhost") is True

    def test_ipv4_loopback(self):
        assert pairing_mod._is_loopback_host("127.0.0.1") is True

    def test_ipv6_loopback(self):
        assert pairing_mod._is_loopback_host("::1") is True

    def test_lan_ip_is_not_loopback(self):
        assert pairing_mod._is_loopback_host("192.168.1.10") is False

    def test_empty_is_not_loopback(self):
        assert pairing_mod._is_loopback_host("") is False


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

    def test_claim_extends_expiry_for_observation_window(self, client, monkeypatch):
        # claim成功時にexpires_atが観測猶予(_CLAIMED_OBSERVATION_SEC)分延長される
        # ことを確認する(token自体は既に破棄済みなので延命してもリプレイの
        # リスクは無い)。元の90秒期限ギリギリでclaimが成立した場合でも、
        # 発行元のポーリングが少し遅れただけでclaimedを見損ねてexpired扱いに
        # なることを防ぐ。
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        before = time.time()
        client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        entry = pairing_mod._pairings[data["id"]]
        assert entry["expires_at"] == pytest.approx(before + pairing_mod._CLAIMED_OBSERVATION_SEC, abs=2)

    def test_claimed_tombstone_eventually_expires(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        token = pairing_mod._pairings[data["id"]]["token"]
        client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        pairing_mod._pairings[data["id"]]["expires_at"] = time.time() - 1
        res = client.get(f"/auth/pairing/{data['id']}/status")
        assert res.json()["status"] == "not_found"
        assert data["id"] not in pairing_mod._pairings


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
        # start呼び出し分のカウントは対象外にする(start/status/claimは1バケット共有のため)。
        pairing_mod._rate_counter._counts.clear()
        monkeypatch.setattr(pairing_mod, "_PAIRING_RATE_LIMIT", 2)
        assert client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong"}).status_code == 401
        assert client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong"}).status_code == 401
        res = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": "wrong"})
        assert res.status_code == 429

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

        # register_device の差し替えだけを個別スコープの monkeypatch.context() で
        # 行う。fixtureのmonkeypatchでこの後 undo() すると、autouse の isolate_fs
        # フィクスチャが張った隔離（_DEVICES_FILE等）まで一緒に巻き戻ってしまい、
        # 下のretry呼び出しが本番の実ファイルに書き込んでしまう。
        with monkeypatch.context() as m:
            m.setattr(pairing_mod, "register_device", _boom)
            failed = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert failed.status_code == 500
        # entryは一切変更していないので、同じ有効なQRでリトライできる
        assert data["id"] in pairing_mod._pairings
        assert pairing_mod._pairings[data["id"]]["claimed"] is False

        retry = client.post(f"/auth/pairing/{data['id']}/claim", json={"token": token})
        assert retry.status_code == 200, retry.text


class TestStatusRateLimit:
    def test_rate_limited_after_burst(self, client, monkeypatch):
        data = _start(client, monkeypatch)
        # start呼び出し分のカウントは対象外にする(start/status/claimは1バケット共有のため)。
        pairing_mod._rate_counter._counts.clear()
        monkeypatch.setattr(pairing_mod, "_PAIRING_RATE_LIMIT", 2)
        assert client.get(f"/auth/pairing/{data['id']}/status").status_code == 200
        assert client.get(f"/auth/pairing/{data['id']}/status").status_code == 200
        res = client.get(f"/auth/pairing/{data['id']}/status")
        assert res.status_code == 429

    def test_rate_limit_is_shared_across_pairing_ids(self, client, monkeypatch):
        # pairing_idごとの個別スコープは持たない(シンプルさを優先し、IPごとに
        # start/status/claimをまとめて絞るだけの単純な制限にしている)。同じIP
        # からの別pairing_idへのstatusも同じバケットを消費する。
        first = _start(client, monkeypatch)
        second = _start(client, monkeypatch)
        pairing_mod._rate_counter._counts.clear()
        monkeypatch.setattr(pairing_mod, "_PAIRING_RATE_LIMIT", 1)
        assert client.get(f"/auth/pairing/{first['id']}/status").status_code == 200
        res = client.get(f"/auth/pairing/{second['id']}/status")
        assert res.status_code == 429


def test_pair_page_serves_spa_shell(client):
    res = client.get("/pair/pr_anything")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]


def test_pair_page_rewrites_asset_paths_to_root_relative(client):
    # /pair/{pairing_id} は index.html をそのまま返す(main.py serve_pair_page参照)。
    # ソースモード(dist/未ビルド)でのasset pathが相対("vue-main.js")のままだと、
    # ブラウザは現在のパス("/pair/xxx")を基準に解決して"/pair/vue-main.js"を
    # 要求してしまう。これは動的ルート"/pair/{pairing_id}"自身にマッチし、
    # moduleスクリプトとして期待されるJSの代わりにHTMLシェルが返るため
    # MIME不一致でスクリプトが読み込まれない。ルート相対に固定されていること
    # を確認する。
    res = client.get("/pair/pr_anything")
    assert res.status_code == 200
    assert 'src="/vue-main.js' in res.text
    assert 'src="vue-main.js' not in res.text
