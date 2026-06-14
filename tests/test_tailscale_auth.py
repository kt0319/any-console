"""Tailscale auto-auth のテスト。

- Tailscale 経由（loopback / CGNAT）+ Tailscale-User-Login ヘッダ → 認証
- LAN や public からの偽装ヘッダ → 認証されない
- 既存の Bearer token 認証は壊さない
"""

from api.auth import (
    _is_trusted_proxy_source,
    _tailscale_user,
    verify_ws_token,
)


class TestTrustedSource:
    def test_loopback_v4_is_trusted(self):
        assert _is_trusted_proxy_source("127.0.0.1")

    def test_loopback_v6_is_trusted(self):
        assert _is_trusted_proxy_source("::1")

    def test_localhost_label_is_trusted(self):
        assert _is_trusted_proxy_source("localhost")

    def test_tailscale_cgnat_is_trusted(self):
        assert _is_trusted_proxy_source("100.64.0.1")
        assert _is_trusted_proxy_source("100.127.255.255")

    def test_lan_is_not_trusted(self):
        assert not _is_trusted_proxy_source("192.168.1.10")

    def test_public_is_not_trusted(self):
        assert not _is_trusted_proxy_source("8.8.8.8")

    def test_outside_cgnat_is_not_trusted(self):
        # 100.0.0.0/10 の外（100.0〜100.63, 100.128〜100.255）は CGNAT 範囲外
        assert not _is_trusted_proxy_source("100.0.0.1")
        assert not _is_trusted_proxy_source("100.128.0.1")

    def test_empty_is_not_trusted(self):
        assert not _is_trusted_proxy_source("")

    def test_invalid_ip_is_not_trusted(self):
        assert not _is_trusted_proxy_source("not-an-ip")


class TestTailscaleUserHeader:
    def test_trusted_source_with_header_returns_user(self):
        headers = {"tailscale-user-login": "alice@example.com"}
        assert _tailscale_user("127.0.0.1", headers) == "alice@example.com"

    def test_untrusted_source_ignores_header(self):
        headers = {"tailscale-user-login": "alice@example.com"}
        assert _tailscale_user("192.168.1.10", headers) is None

    def test_trusted_source_without_header_returns_none(self):
        assert _tailscale_user("127.0.0.1", {}) is None

    def test_empty_header_value_returns_none(self):
        headers = {"tailscale-user-login": "   "}
        assert _tailscale_user("127.0.0.1", headers) is None


class TestVerifyTokenViaTailscale:
    def test_lan_with_fake_header_is_ignored(self):
        # LAN からの偽装ヘッダは無視される（接続元判定で弾く）
        from api.auth import _tailscale_user
        assert _tailscale_user("192.168.1.5", {"tailscale-user-login": "alice@example.com"}) is None


class TestVerifyWsTokenViaTailscale:
    def test_loopback_with_header_passes_without_token(self):
        assert verify_ws_token("", "127.0.0.1", {"tailscale-user-login": "alice@example.com"})

    def test_untrusted_with_header_falls_back_to_token(self):
        # 偽装ヘッダは無視され、空 token なので拒否
        assert not verify_ws_token("", "192.168.1.5", {"tailscale-user-login": "alice@example.com"})

    def test_no_tailscale_falls_back_to_token(self):
        from conftest import TOKEN
        assert verify_ws_token(TOKEN, "192.168.1.5", {})
        assert not verify_ws_token("wrong", "192.168.1.5", {})

    def test_backward_compat_without_extra_args(self):
        from conftest import TOKEN
        # 既存呼び出し（client_host/headers なし）でも動く
        assert verify_ws_token(TOKEN)
        assert not verify_ws_token("wrong")
