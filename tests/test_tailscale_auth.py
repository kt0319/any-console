"""Tailscale auto-auth のテスト。

- ヘッダ信頼は opt-in（デフォルト無効）: 環境変数 / config で有効化した時のみ働く
- 有効時: Tailscale 経由（loopback / CGNAT）+ Tailscale-User-Login ヘッダ → 認証
- 有効時でも LAN や public からの偽装ヘッダ → 認証されない
- 無効時（デフォルト）: どの接続元からのヘッダも信頼しない
- 既存の Bearer token 認証は壊さない
"""

import json
import subprocess

import pytest

import api.auth as auth_module
from api.auth import (
    _is_tailscale_trust_enabled,
    _is_trusted_proxy_source,
    _resolve_tailscale_name,
    _tailscale_user,
    verify_ws_token,
)


@pytest.fixture()
def trust_enabled(monkeypatch):
    monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", True)


class TestTrustOptIn:
    def test_disabled_by_default(self):
        assert _is_tailscale_trust_enabled() is False

    def test_enabled_via_env(self, monkeypatch):
        monkeypatch.setenv(auth_module.ENV_TRUST_TAILSCALE, "1")
        monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", None)
        assert _is_tailscale_trust_enabled() is True

    def test_env_other_value_stays_disabled(self, monkeypatch):
        monkeypatch.setenv(auth_module.ENV_TRUST_TAILSCALE, "true")
        monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", None)
        assert _is_tailscale_trust_enabled() is False

    def test_enabled_via_config(self, isolate_fs, monkeypatch):
        config_file = isolate_fs["config_file"]
        config_file.write_text(
            json.dumps({"__global__": {"trust_tailscale_auth": True}}), encoding="utf-8",
        )
        monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", None)
        assert _is_tailscale_trust_enabled() is True

    def test_result_is_cached(self, monkeypatch):
        monkeypatch.setattr(auth_module, "_TRUST_TAILSCALE_CACHE", None)
        assert _is_tailscale_trust_enabled() is False
        # キャッシュ後に env を立てても変わらない（反映は再起動）
        monkeypatch.setenv(auth_module.ENV_TRUST_TAILSCALE, "1")
        assert _is_tailscale_trust_enabled() is False

    def test_config_schema_accepts_flag(self):
        from api.config_schema import validate_global_config
        result = validate_global_config({"trust_tailscale_auth": True})
        assert result["trust_tailscale_auth"] is True


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


class TestTailscaleUserHeaderDisabled:
    """デフォルト（opt-in なし）ではどの接続元からもヘッダを信頼しない。"""

    def test_loopback_header_is_ignored_by_default(self):
        headers = {"tailscale-user-login": "alice@example.com"}
        assert _tailscale_user("127.0.0.1", headers) is None

    def test_cgnat_header_is_ignored_by_default(self):
        headers = {"tailscale-user-login": "alice@example.com"}
        assert _tailscale_user("100.64.0.1", headers) is None


class TestTailscaleUserHeaderEnabled:
    def test_trusted_source_with_header_returns_user(self, trust_enabled):
        headers = {"tailscale-user-login": "alice@example.com"}
        assert _tailscale_user("127.0.0.1", headers) == "alice@example.com"

    def test_untrusted_source_ignores_header(self, trust_enabled):
        headers = {"tailscale-user-login": "alice@example.com"}
        assert _tailscale_user("192.168.1.10", headers) is None

    def test_trusted_source_without_header_returns_none(self, trust_enabled):
        assert _tailscale_user("127.0.0.1", {}) is None

    def test_empty_header_value_returns_none(self, trust_enabled):
        headers = {"tailscale-user-login": "   "}
        assert _tailscale_user("127.0.0.1", headers) is None


class TestVerifyTokenViaTailscale:
    def test_lan_with_fake_header_is_ignored(self, trust_enabled):
        # LAN からの偽装ヘッダは無視される（接続元判定で弾く）
        assert _tailscale_user("192.168.1.5", {"tailscale-user-login": "alice@example.com"}) is None


class TestVerifyWsTokenViaTailscale:
    def test_loopback_with_header_passes_without_token(self, trust_enabled):
        assert verify_ws_token("", "127.0.0.1", {"tailscale-user-login": "alice@example.com"})

    def test_loopback_with_header_rejected_by_default(self):
        # opt-in していなければ loopback + ヘッダでも通さない（token へフォールバック）
        assert not verify_ws_token("", "127.0.0.1", {"tailscale-user-login": "alice@example.com"})

    def test_untrusted_with_header_falls_back_to_token(self, trust_enabled):
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


class TestResolveTailscaleName:
    """QRペアリング（api/routers/pairing.py）が使うホスト名解決。"""

    def test_returns_dns_name_from_status_json(self, monkeypatch):
        data = {"Self": {"DNSName": "myhost.tail1234.ts.net."}}
        monkeypatch.setattr(auth_module, "run_tailscale_json", lambda args: data)
        assert _resolve_tailscale_name() == "myhost.tail1234.ts.net"

    def test_returns_none_when_tailscale_not_installed(self, monkeypatch):
        monkeypatch.setattr(auth_module, "run_tailscale_json", lambda args: None)
        assert _resolve_tailscale_name() is None

    def test_returns_none_on_nonzero_exit(self, monkeypatch):
        monkeypatch.setattr(auth_module, "run_tailscale_json", lambda args: None)
        assert _resolve_tailscale_name() is None

    def test_returns_none_on_invalid_json(self, monkeypatch):
        monkeypatch.setattr(auth_module, "run_tailscale_json", lambda args: None)
        assert _resolve_tailscale_name() is None

    def test_returns_none_when_dns_name_missing(self, monkeypatch):
        data = {"Self": {}}
        monkeypatch.setattr(auth_module, "run_tailscale_json", lambda args: data)
        assert _resolve_tailscale_name() is None
