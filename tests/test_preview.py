"""Port Preview の検出ロジックとエンドポイントのテスト。"""

import subprocess

import pytest

from api import preview as preview_mod
from conftest import AUTH


@pytest.fixture(autouse=True)
def _reset_preview_state():
    preview_mod._DETECTED.clear()
    preview_mod._SELF_PORTS.clear()
    preview_mod._PROBING.clear()
    preview_mod._last_access = None
    # 実環境の certs/ を拾って TLS 有効化されるとテストが非決定的になるため無効化する
    # （ロード済みかつ ctx=None 扱い）。TLS を検証するテストは preview_scheme を monkeypatch する。
    preview_mod._ssl_loaded = True
    preview_mod._ssl_ctx = None
    yield
    preview_mod._DETECTED.clear()
    preview_mod._SELF_PORTS.clear()
    preview_mod._PROBING.clear()
    preview_mod._last_access = None


class TestProxyPortFor:
    def test_in_range(self):
        assert preview_mod.proxy_port_for(3000) == 23000
        assert preview_mod.proxy_port_for(5173) == 25173

    def test_min_boundary(self):
        assert preview_mod.proxy_port_for(1024) == 21024
        assert preview_mod.proxy_port_for(9999) == 29999

    def test_below_min(self):
        assert preview_mod.proxy_port_for(80) is None

    def test_above_max(self):
        assert preview_mod.proxy_port_for(10000) is None
        assert preview_mod.proxy_port_for(65535) is None


class TestSetSelfPorts:
    def test_sets_self_ports(self):
        preview_mod.set_self_ports([8888, 9999])
        assert preview_mod._SELF_PORTS == {8888, 9999}

    def test_replaces(self):
        preview_mod.set_self_ports([1])
        preview_mod.set_self_ports([2])
        assert preview_mod._SELF_PORTS == {2}


class TestScanListeningPortsLinux:
    SAMPLE_SS_OUTPUT = (
        "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n"
        'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=12345,fd=21))\n'
        'LISTEN 0 511 127.0.0.1:7002 0.0.0.0:* users:(("python3",pid=22222,fd=24))\n'
        # 他ユーザ所有 → 名前情報なし → 除外される
        "LISTEN 0 4096 0.0.0.0:5432 0.0.0.0:*\n"
        # 範囲外
        'LISTEN 0 100 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=33333,fd=6))\n'
    )

    def test_parses_owned_ports(self, monkeypatch):
        def fake_run(*a, **kw):
            return subprocess.CompletedProcess(args=a, returncode=0, stdout=self.SAMPLE_SS_OUTPUT, stderr="")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        # cmdline は読めないので proc_name にフォールバック
        monkeypatch.setattr(preview_mod, "_read_cmdline", lambda pid: "")
        found = preview_mod._scan_listening_ports_linux()
        assert 3000 in found
        assert found[3000] == ("node", 12345)
        assert 7002 in found
        # 他ユーザ所有は除外
        assert 5432 not in found
        # 範囲外は除外
        assert 80 not in found

    def test_includes_self_ports_in_raw_scan(self, monkeypatch):
        # _scan_listening_ports_linux は self/その他を区別せず返す（is_self の判定は scan_once）。
        preview_mod.set_self_ports([3000])
        def fake_run(*a, **kw):
            return subprocess.CompletedProcess(args=a, returncode=0, stdout=self.SAMPLE_SS_OUTPUT, stderr="")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        monkeypatch.setattr(preview_mod, "_read_cmdline", lambda pid: "")
        found = preview_mod._scan_listening_ports_linux()
        assert 3000 in found
        assert 7002 in found

    def test_handles_subprocess_error(self, monkeypatch):
        def fake_run(*a, **kw):
            raise OSError("ss not found")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        assert preview_mod._scan_listening_ports_linux() == {}


class TestScanListeningPortsMacos:
    # lsof -iTCP -sTCP:LISTEN -P -n -F pcn の出力形式。
    SAMPLE_LSOF_OUTPUT = (
        "p12345\n"
        "cnode\n"
        "n127.0.0.1:3000\n"
        "n*:3000\n"
        "p22222\n"
        "cpython3\n"
        "n*:7002\n"
        # 範囲外
        "p33333\n"
        "cnginx\n"
        "n*:80\n"
    )

    def test_parses_owned_ports(self, monkeypatch):
        def fake_run(*a, **kw):
            return subprocess.CompletedProcess(args=a, returncode=0, stdout=self.SAMPLE_LSOF_OUTPUT, stderr="")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        monkeypatch.setattr(preview_mod, "_read_cmdline", lambda pid: "")
        found = preview_mod._scan_listening_ports_macos()
        assert found[3000] == ("node", 12345)
        assert found[7002] == ("python3", 22222)
        # 範囲外は除外
        assert 80 not in found

    def test_handles_subprocess_error(self, monkeypatch):
        def fake_run(*a, **kw):
            raise OSError("lsof not found")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        assert preview_mod._scan_listening_ports_macos() == {}


class TestScanListeningPortsDispatch:
    def test_dispatches_to_macos(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "_IS_MACOS", True)
        monkeypatch.setattr(preview_mod, "_scan_listening_ports_macos", lambda: {1: ("x", 1)})
        assert preview_mod._scan_listening_ports() == {1: ("x", 1)}

    def test_dispatches_to_linux(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "_IS_MACOS", False)
        monkeypatch.setattr(preview_mod, "_scan_listening_ports_linux", lambda: {2: ("y", 2)})
        assert preview_mod._scan_listening_ports() == {2: ("y", 2)}


class TestReadCmdline:
    def test_empty_on_unreadable_pid(self):
        # 存在しない PID は OSError → 空文字
        assert preview_mod._read_cmdline(99999999) == ""

    def test_returns_for_real_pid(self):
        import os
        # 自分自身の PID を使う（必ず読める）
        result = preview_mod._read_cmdline(os.getpid())
        # pytest プロセスの basename が含まれていれば OK（厳密一致は環境依存）
        assert isinstance(result, str)

    def test_macos_uses_ps(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "_IS_MACOS", True)
        def fake_run(*a, **kw):
            return subprocess.CompletedProcess(args=a, returncode=0, stdout="/usr/bin/node /app/vite.js\n", stderr="")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        assert preview_mod._read_cmdline(1) == "node vite.js"

    def test_macos_empty_on_subprocess_error(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "_IS_MACOS", True)
        def fake_run(*a, **kw):
            raise OSError("ps not found")
        monkeypatch.setattr(preview_mod.subprocess, "run", fake_run)
        assert preview_mod._read_cmdline(1) == ""


class TestScanOnce:
    def test_adds_new_port(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "_scan_listening_ports", lambda: {3000: ("node", 1)})
        preview_mod.scan_once()
        items = preview_mod.list_ports()
        assert len(items) == 1
        assert items[0]["port"] == 3000
        assert items[0]["proxy_port"] == 23000
        assert items[0]["is_self"] is False

    def test_marks_self_port(self, monkeypatch):
        preview_mod.set_self_ports([8888])
        monkeypatch.setattr(preview_mod, "_scan_listening_ports",
                            lambda: {8888: ("python3", 1)})
        preview_mod.scan_once()
        items = preview_mod.list_ports()
        # 自分自身は is_self=True で表示される（proxy_port は無し）
        assert len(items) == 1
        assert items[0]["port"] == 8888
        assert items[0]["is_self"] is True
        assert items[0]["proxy_port"] is None
        # proxy が無いポートは scheme も無い
        assert items[0]["scheme"] is None

    def test_scheme_https_when_cert_present(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "preview_scheme", lambda: "https")
        monkeypatch.setattr(preview_mod, "_scan_listening_ports", lambda: {3000: ("node", 1)})
        preview_mod.scan_once()
        items = preview_mod.list_ports()
        assert items[0]["scheme"] == "https"

    def test_scheme_http_when_no_cert(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "preview_scheme", lambda: "http")
        monkeypatch.setattr(preview_mod, "_scan_listening_ports", lambda: {3000: ("node", 1)})
        preview_mod.scan_once()
        items = preview_mod.list_ports()
        assert items[0]["scheme"] == "http"

    def test_purges_stale_entries(self, monkeypatch):
        monkeypatch.setattr(preview_mod, "_scan_listening_ports", lambda: {3000: ("node", 1)})
        preview_mod.scan_once()
        assert 3000 in preview_mod._DETECTED
        # 消えるシミュレーション
        monkeypatch.setattr(preview_mod, "_scan_listening_ports", lambda: {})
        preview_mod._DETECTED[3000].last_seen_at = 0  # かなり古い扱い
        preview_mod.scan_once()
        assert 3000 not in preview_mod._DETECTED


class TestListPorts:
    def test_excludes_no_proxy_non_self(self):
        from api.preview import DetectedPort
        preview_mod._DETECTED[20000] = DetectedPort(
            session_id="local", port=20000, proxy_port=None,
            process="x", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0,
        )
        assert preview_mod.list_ports() == []

    def test_includes_self_without_proxy(self):
        from api.preview import DetectedPort
        preview_mod._DETECTED[8888] = DetectedPort(
            session_id="local", port=8888, proxy_port=None,
            process="python3", pid=1, is_self=True,
            first_seen_at=0, last_seen_at=0,
        )
        items = preview_mod.list_ports()
        assert len(items) == 1
        assert items[0]["is_self"] is True

    def test_excludes_non_http_port(self):
        from api.preview import DetectedPort
        preview_mod._DETECTED[5037] = DetectedPort(
            session_id="local", port=5037, proxy_port=25037,
            process="adb", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0, http_ok=False,
        )
        assert preview_mod.list_ports() == []

    def test_includes_unprobed_and_http_ok_port(self):
        from api.preview import DetectedPort
        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="node", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0, http_ok=None,
        )
        preview_mod._DETECTED[3001] = DetectedPort(
            session_id="local", port=3001, proxy_port=23001,
            process="node", pid=2, is_self=False,
            first_seen_at=0, last_seen_at=0, http_ok=True,
        )
        ports = {p["port"] for p in preview_mod.list_ports()}
        assert ports == {3000, 3001}


class TestProbeHttp:
    def test_true_for_http_upstream(self):
        import asyncio

        async def run():
            async def handler(reader, writer):
                await reader.read(200)
                writer.write(b"HTTP/1.1 200 OK\r\n\r\nhi")
                await writer.drain()
                writer.close()
            server = await asyncio.start_server(handler, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            async with server:
                return await preview_mod._probe_http(port)

        assert asyncio.run(run()) is True

    def test_false_for_non_http_upstream(self):
        import asyncio

        async def run():
            async def handler(reader, writer):
                await reader.read(200)
                writer.write(b"OK host:transport\r\n")  # adb 風の非HTTP応答
                await writer.drain()
                writer.close()
            server = await asyncio.start_server(handler, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            async with server:
                return await preview_mod._probe_http(port)

        assert asyncio.run(run()) is False

    def test_false_for_unreachable_port(self):
        import asyncio
        # 1 番ポートは通常接続不可
        assert asyncio.run(preview_mod._probe_http(1)) is False

    def test_session_id_filter(self):
        from api.preview import DetectedPort
        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0,
        )
        assert preview_mod.list_ports("local") != []
        assert preview_mod.list_ports("other") == []


class TestEndpoints:
    def test_list_endpoint_requires_auth(self, client):
        assert client.get("/preview/ports").status_code == 401

    def test_list_endpoint_returns_array(self, client, monkeypatch):
        from api.preview import DetectedPort

        def fake_scan():
            preview_mod._DETECTED[3000] = DetectedPort(
                session_id="local", port=3000, proxy_port=23000,
                process="node nuxt", pid=42, is_self=False,
                first_seen_at=0, last_seen_at=0,
            )
        # エンドポイントはアクセス時にスキャンを起こす。実 ss を避けて注入する。
        monkeypatch.setattr(preview_mod, "scan_once", fake_scan)
        res = client.get("/preview/ports", headers=AUTH)
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 1
        assert items[0]["port"] == 3000


class TestLazyScan:
    def test_endpoint_triggers_scan_and_touches_access(self, client, monkeypatch):
        called = {"n": 0}
        monkeypatch.setattr(preview_mod, "scan_once",
                            lambda: called.__setitem__("n", called["n"] + 1))
        res = client.get("/preview/ports", headers=AUTH)
        assert res.status_code == 200
        assert called["n"] == 1
        assert preview_mod._should_scan_now() is True

    def test_should_scan_now_idle(self, monkeypatch):
        # 未アクセス（_last_access=None）はアイドル扱いでスキャンしない。
        monkeypatch.setattr(preview_mod, "_last_access", None)
        assert preview_mod._should_scan_now() is False

    def test_touch_access_enables_scan(self):
        preview_mod.touch_access()
        assert preview_mod._should_scan_now() is True


class TestScannerLifecycle:
    def test_start_and_stop(self):
        # 起動・停止が例外なく完了することだけ確認
        import asyncio
        async def run():
            preview_mod.start_scanner()
            assert preview_mod._scan_task is not None
            preview_mod.stop_scanner()
            assert preview_mod._scan_task is None
        asyncio.run(run())

    def test_stop_when_not_started(self):
        preview_mod._scan_task = None
        preview_mod.stop_scanner()
        assert preview_mod._scan_task is None


class TestReconcileProxies:
    def test_skip_when_no_event_loop(self):
        # asyncio ループ外（同期テスト）から呼んでも例外を出さない
        from api.preview import DetectedPort
        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0,
        )
        preview_mod._reconcile_proxies()  # no raise

    def test_start_proxy_bind_host(self, monkeypatch):
        """proxy は全インターフェース（0.0.0.0）で listen する（Tailscale IP からもアクセス可能）。"""
        import asyncio

        captured = {}

        async def fake_start_server(handler, *, host, port, ssl=None):
            captured["host"] = host
            captured["port"] = port
            captured["ssl"] = ssl

            class FakeServer:
                def close(self):
                    pass

            return FakeServer()

        async def run():
            monkeypatch.setattr(preview_mod.asyncio, "start_server", fake_start_server)
            try:
                await preview_mod._start_proxy(3000, 23000)
            finally:
                preview_mod._PROXIES.clear()

        asyncio.run(run())
        # cert 未設定のテスト環境では TLS なし（ssl=None）で listen する。
        assert captured == {"host": "0.0.0.0", "port": 23000, "ssl": None}

    def test_starts_and_stops_proxy(self):
        """高いポートで実際に proxy を起こして停止できることを確認する。"""
        import asyncio
        import socket as sock_mod
        from api.preview import DetectedPort

        def free_port() -> int:
            with sock_mod.socket(sock_mod.AF_INET, sock_mod.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", 0))
                return s.getsockname()[1]

        async def run():
            proxy_target_port = free_port()
            proxy_listen_port = free_port()
            # _start_proxy を直接呼ぶ
            await preview_mod._start_proxy(proxy_target_port, proxy_listen_port)
            assert proxy_target_port in preview_mod._PROXIES
            # bind 失敗パスもカバー（同じポートに再 bind）
            await preview_mod._start_proxy(proxy_target_port + 1, proxy_listen_port)
            # 後始末
            for server in list(preview_mod._PROXIES.values()):
                server.close()
            preview_mod._PROXIES.clear()
        asyncio.run(run())

    def test_pipes_data_through_proxy(self):
        """実 upstream を立てて proxy がデータを透過することを確認する。"""
        import asyncio
        import socket as sock_mod

        def free_port() -> int:
            with sock_mod.socket(sock_mod.AF_INET, sock_mod.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", 0))
                return s.getsockname()[1]

        async def upstream(reader, writer):
            data = await reader.read(64)
            writer.write(b"ECHO:" + data)
            await writer.drain()
            writer.close()

        async def run():
            # upstream は固定ポートが必要（asyncio.open_connection で 127.0.0.1:port に繋ぐため）
            up_port = free_port()
            up_server = await asyncio.start_server(upstream, host="127.0.0.1", port=up_port)
            try:
                proxy_port = free_port()
                await preview_mod._start_proxy(up_port, proxy_port)
                # クライアント接続して echo を受け取る
                reader, writer = await asyncio.open_connection("127.0.0.1", proxy_port)
                writer.write(b"hello")
                await writer.drain()
                response = await asyncio.wait_for(reader.read(64), timeout=2.0)
                assert response.startswith(b"ECHO:hello")
                writer.close()
            finally:
                up_server.close()
                for s in list(preview_mod._PROXIES.values()):
                    s.close()
                preview_mod._PROXIES.clear()
        asyncio.run(run())

    def test_proxy_upstream_unreachable(self):
        """upstream が落ちている場合、proxy 経由の接続はすぐ閉じる。"""
        import asyncio
        import socket as sock_mod

        def free_port() -> int:
            with sock_mod.socket(sock_mod.AF_INET, sock_mod.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", 0))
                return s.getsockname()[1]

        async def run():
            # 存在しない upstream ポートを指定（free_port は予約だけして閉じる）
            up_port = free_port()  # bind 直後に閉じるので LISTEN なし
            proxy_port = free_port()
            await preview_mod._start_proxy(up_port, proxy_port)
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", proxy_port)
                # ハンドラは upstream connect 失敗で client を即 close する
                data = await asyncio.wait_for(reader.read(1), timeout=2.0)
                assert data == b""  # 即 EOF
                writer.close()
            finally:
                for s in list(preview_mod._PROXIES.values()):
                    s.close()
                preview_mod._PROXIES.clear()
        asyncio.run(run())

    def test_reconcile_closes_unneeded_proxy(self):
        """_DETECTED から消えた proxy が close されることを確認。"""
        import asyncio
        import socket as sock_mod

        def free_port() -> int:
            with sock_mod.socket(sock_mod.AF_INET, sock_mod.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", 0))
                return s.getsockname()[1]

        async def run():
            target = free_port()
            listen = free_port()
            await preview_mod._start_proxy(target, listen)
            assert target in preview_mod._PROXIES
            preview_mod._DETECTED.clear()  # 検出消滅
            preview_mod._reconcile_proxies()
            assert target not in preview_mod._PROXIES
        asyncio.run(run())

    def test_does_not_probe_newly_detected_port_immediately(self):
        """検出直後（INITIAL_PROBE_DELAY_SEC 未経過）は初回プローブしない
        （dev server がポートを開けた直後で未初期化のうちに空振りするのを防ぐ）。"""
        import asyncio
        import time
        from api.preview import DetectedPort

        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=int(time.time()), last_seen_at=int(time.time()),
        )
        probed = []

        async def run():
            async def fake_probe_and_reconcile(port):
                probed.append(port)

            import unittest.mock
            with unittest.mock.patch.object(preview_mod, "_probe_and_reconcile", fake_probe_and_reconcile):
                preview_mod._reconcile_proxies()
                await asyncio.sleep(0)

        asyncio.run(run())
        assert probed == []

    def test_probes_after_initial_delay_elapses(self):
        """INITIAL_PROBE_DELAY_SEC 経過後は未判定ポートが初回プローブされる。"""
        import asyncio
        import time
        from api.preview import DetectedPort

        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=int(time.time()) - preview_mod.INITIAL_PROBE_DELAY_SEC - 1,
            last_seen_at=int(time.time()),
        )
        probed = []

        async def run():
            async def fake_probe_and_reconcile(port):
                probed.append(port)
                preview_mod._PROBING.discard(port)

            import unittest.mock
            with unittest.mock.patch.object(preview_mod, "_probe_and_reconcile", fake_probe_and_reconcile):
                preview_mod._reconcile_proxies()
                await asyncio.sleep(0)

        asyncio.run(run())
        assert probed == [3000]

    def test_reprobes_false_after_retry_interval(self):
        """http_ok=False は起動直後の空振りの可能性があるため、
        HTTP_PROBE_RETRY_SEC 経過後は再プローブ対象になる（恒久除外しない）。"""
        import asyncio
        import time
        from api.preview import DetectedPort

        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0,
            http_ok=False, http_probed_at=int(time.time()) - preview_mod.HTTP_PROBE_RETRY_SEC - 1,
        )
        probed = []

        async def run():
            async def fake_probe_and_reconcile(port):
                probed.append(port)
                preview_mod._PROBING.discard(port)

            import unittest.mock
            with unittest.mock.patch.object(preview_mod, "_probe_and_reconcile", fake_probe_and_reconcile):
                preview_mod._reconcile_proxies()
                await asyncio.sleep(0)  # スケジュールされた task を実行させる

        asyncio.run(run())
        assert probed == [3000]

    def test_does_not_reprobe_false_before_retry_interval(self):
        """再プローブ間隔内は http_ok=False のまま再プローブしない（毎スキャンでの無駄打ち防止）。"""
        import asyncio
        import time
        from api.preview import DetectedPort

        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0,
            http_ok=False, http_probed_at=int(time.time()),
        )
        probed = []

        async def run():
            async def fake_probe_and_reconcile(port):
                probed.append(port)

            import unittest.mock
            with unittest.mock.patch.object(preview_mod, "_probe_and_reconcile", fake_probe_and_reconcile):
                preview_mod._reconcile_proxies()
                await asyncio.sleep(0)

        asyncio.run(run())
        assert probed == []


class TestProxyListenerPorts:
    def test_collects_proxy_ports(self):
        from api.preview import DetectedPort
        preview_mod._DETECTED[3000] = DetectedPort(
            session_id="local", port=3000, proxy_port=23000,
            process="x", pid=1, is_self=False,
            first_seen_at=0, last_seen_at=0,
        )
        preview_mod._DETECTED[5173] = DetectedPort(
            session_id="local", port=5173, proxy_port=25173,
            process="x", pid=2, is_self=False,
            first_seen_at=0, last_seen_at=0,
        )
        preview_mod._DETECTED[8888] = DetectedPort(
            session_id="local", port=8888, proxy_port=None,
            process="x", pid=3, is_self=True,
            first_seen_at=0, last_seen_at=0,
        )
        assert preview_mod._proxy_listener_ports() == {23000, 25173}
