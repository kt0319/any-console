"""X-Forwarded-For ヘッダの信頼制御テスト。

ANY_CONSOLE_TRUSTED_PROXIES が空の場合は X-Forwarded-For を信頼しない。
明示的に許可された proxy からの場合のみ採用する。
"""
import importlib


def _reload_auth_with_proxies(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("ANY_CONSOLE_TRUSTED_PROXIES", raising=False)
    else:
        monkeypatch.setenv("ANY_CONSOLE_TRUSTED_PROXIES", value)
    import api.auth as auth_mod
    return importlib.reload(auth_mod)


class TestTrustedProxyParser:
    def test_empty_means_no_trust(self, monkeypatch):
        auth_mod = _reload_auth_with_proxies(monkeypatch, None)
        assert not auth_mod._is_trusted_proxy("127.0.0.1")
        assert not auth_mod._is_trusted_proxy("8.8.8.8")
        assert not auth_mod._is_trusted_proxy("")

    def test_cidr_match(self, monkeypatch):
        auth_mod = _reload_auth_with_proxies(monkeypatch, "127.0.0.0/8,10.0.0.0/8")
        assert auth_mod._is_trusted_proxy("127.0.0.1")
        assert auth_mod._is_trusted_proxy("10.1.2.3")
        assert not auth_mod._is_trusted_proxy("8.8.8.8")
        assert not auth_mod._is_trusted_proxy("")

    def test_invalid_entries_ignored(self, monkeypatch):
        auth_mod = _reload_auth_with_proxies(monkeypatch, "not-an-ip,192.168.0.0/16")
        assert auth_mod._is_trusted_proxy("192.168.1.1")
        assert not auth_mod._is_trusted_proxy("not-an-ip")


def teardown_module(module):
    """Restore default auth module state for subsequent tests."""
    import os
    os.environ.pop("ANY_CONSOLE_TRUSTED_PROXIES", None)
    import api.auth as auth_mod
    importlib.reload(auth_mod)
