"""api/auth.py の tailscale 名前解決・キャッシュテスト。"""

import subprocess
import time
from unittest import mock


class TestResolveTailscaleName:
    def test_returns_empty_on_subprocess_error(self, monkeypatch):
        from api import auth
        monkeypatch.setattr(auth, "_tailscale_cache", {})
        with mock.patch("subprocess.run", side_effect=OSError("not found")):
            assert auth.resolve_tailscale_name("100.64.0.1") == ""

    def test_returns_empty_on_timeout(self, monkeypatch):
        from api import auth
        monkeypatch.setattr(auth, "_tailscale_cache", {})
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("tailscale", 5)):
            assert auth.resolve_tailscale_name("100.64.0.1") == ""

    def test_returns_hostname_from_peer(self, monkeypatch):
        from api import auth
        monkeypatch.setattr(auth, "_tailscale_cache", {})
        status_json = '{"Peer": {"abc": {"TailscaleIPs": ["100.64.0.2"], "HostName": "my-peer"}}, "Self": {}}'
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = status_json
        with mock.patch("subprocess.run", return_value=result):
            assert auth.resolve_tailscale_name("100.64.0.2") == "my-peer"

    def test_returns_self_hostname(self, monkeypatch):
        from api import auth
        monkeypatch.setattr(auth, "_tailscale_cache", {})
        status_json = '{"Peer": {}, "Self": {"TailscaleIPs": ["100.64.0.1"], "HostName": "my-host"}}'
        result = mock.MagicMock()
        result.returncode = 0
        result.stdout = status_json
        with mock.patch("subprocess.run", return_value=result):
            assert auth.resolve_tailscale_name("100.64.0.1") == "my-host"

    def test_cache_hit_returns_cached_name(self, monkeypatch):
        from api import auth
        monkeypatch.setattr(auth, "_tailscale_cache", {"100.64.0.1": (time.monotonic(), "cached-host")})
        with mock.patch("subprocess.run") as mock_run:
            result = auth.resolve_tailscale_name("100.64.0.1")
        mock_run.assert_not_called()
        assert result == "cached-host"

    def test_expired_cache_refetches(self, monkeypatch):
        from api import auth
        old_ts = time.monotonic() - auth._TAILSCALE_CACHE_TTL - 1
        monkeypatch.setattr(auth, "_tailscale_cache", {"100.64.0.1": (old_ts, "old-name")})
        with mock.patch("subprocess.run", side_effect=OSError("no tailscale")):
            result = auth.resolve_tailscale_name("100.64.0.1")
        assert result == ""
