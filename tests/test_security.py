"""セキュリティリグレッションテスト。

既知の脆弱性対策が維持されていることを確認する。
"""

import inspect
import re

import pytest

from conftest import AUTH


class TestAuthSecurity:
    """認証実装のセキュリティ"""

    def test_uses_hmac_compare_digest(self):
        """auth.pyでhmac.compare_digestが使用されていることを確認"""
        source = inspect.getsource(__import__("api.auth", fromlist=["verify_token"]))
        assert "hmac.compare_digest" in source, (
            "auth.py must use hmac.compare_digest for constant-time comparison"
        )

    def test_invalid_token_returns_401(self, client):
        res = client.get("/auth/check", headers={"Authorization": "Bearer wrong-token"})
        assert res.status_code == 401

    def test_register_rejects_wrong_token(self, client):
        res = client.post("/devices/register", json={"token": "wrong-token"})
        assert res.status_code == 401

    def test_register_rejects_empty_token(self, client):
        res = client.post("/devices/register", json={"token": ""})
        assert res.status_code == 401

    def test_register_sets_httponly_device_cookies(self, client):
        from conftest import TOKEN
        res = client.post("/devices/register", json={"token": TOKEN})
        assert res.status_code == 200
        cookie_header = res.headers.get("set-cookie", "")
        assert "any_console_device=" in cookie_header
        assert "any_console_secret=" in cookie_header
        assert "HttpOnly" in cookie_header
        assert "samesite=strict" in cookie_header.lower()

    def test_device_cookie_auth_grants_access(self, client):
        from conftest import TOKEN
        reg = client.post("/devices/register", json={"token": TOKEN})
        assert reg.status_code == 200
        # TestClient persists cookies → device cookie で認証が通る
        check_res = client.get("/auth/check")
        assert check_res.status_code == 200

    def test_logout_clears_cookie(self, client):
        from conftest import TOKEN
        client.post("/devices/register", json={"token": TOKEN})
        logout_res = client.post("/auth/logout")
        assert logout_res.status_code == 200
        client.cookies.clear()
        check_res = client.get("/auth/check")
        assert check_res.status_code == 401

    def test_websocket_token_not_in_logs_via_url(self):
        """WebSocket URL builder must not embed the token (cookies are used instead)."""
        ws_path = "ui/utils/terminal-ws.js"
        with open(ws_path, encoding="utf-8") as f:
            source = f.read()
        assert "token=" not in source, (
            "buildWebSocketUrl must not include the auth token in the URL"
        )


class TestSecurityHeaders:
    """全レスポンスへのセキュリティヘッダ付与（api/security_headers.py）"""

    def test_headers_present_on_api_response(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.headers.get("x-frame-options") == "DENY"
        assert res.headers.get("x-content-type-options") == "nosniff"
        assert res.headers.get("referrer-policy") == "no-referrer"

    def test_headers_present_on_401_response(self, client):
        res = client.get("/auth/check", headers={"Authorization": "Bearer wrong-token"})
        assert res.status_code == 401
        assert res.headers.get("x-frame-options") == "DENY"

    def test_preview_proxy_paths_are_skipped(self, client):
        # /preview/ はプロキシ先アプリのヘッダ・フレーム利用を壊さないため対象外
        res = client.get("/preview/9999/", headers=AUTH)
        assert "x-frame-options" not in res.headers

    def test_skip_helper(self):
        from api.security_headers import should_skip_security_headers
        assert should_skip_security_headers("/preview/3000/index.html")
        assert not should_skip_security_headers("/auth/check")
        assert not should_skip_security_headers("/")


class TestFirstRunTokenNotice:
    """初回トークン表示にトークン入り URL を含めない（履歴・ログ漏洩防止）"""

    def test_token_not_embedded_in_url(self, capsys):
        from api.main import _print_token_notice
        _print_token_notice("0.0.0.0", 8888, "secret-token-xyz")
        out = capsys.readouterr().out
        assert "secret-token-xyz" in out
        assert "?token=" not in out
        assert "http://localhost:8888/" in out


class TestTailscaleTrustDefault:
    """Tailscale ヘッダ自動認証はデフォルト無効（詳細は test_tailscale_auth.py）"""

    def test_forged_header_does_not_authenticate_by_default(self, client):
        res = client.get(
            "/auth/check",
            headers={"Tailscale-User-Login": "attacker@example.com"},
        )
        assert res.status_code == 401


class TestBranchNameInjection:
    """ブランチ名によるコマンドインジェクション防止"""

    @pytest.mark.parametrize("branch", [
        "main; rm -rf /",
        "main|cat /etc/passwd",
        "main&&whoami",
        "main$(id)",
        "main`id`",
        "main\nwhoami",
    ])
    def test_injection_in_branch_name_rejected(self, client, workspace, branch):
        res = client.post(
            "/workspaces/test-ws/create-branch",
            headers=AUTH,
            json={"branch": branch},
        )
        assert res.status_code == 400


class TestFileOperationSecurity:
    """ファイル操作のパストラバーサル防止"""

    def test_file_content_traversal(self, client, workspace):
        res = client.get(
            "/workspaces/test-ws/file-content",
            headers=AUTH,
            params={"path": "../../etc/passwd"},
        )
        assert res.status_code == 400

    def test_rename_src_traversal(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "../../etc/passwd", "dest": "stolen.txt"},
        )
        assert res.status_code in (400, 404)

    def test_rename_dest_traversal(self, client, workspace):
        (workspace / "test.txt").write_text("data", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "test.txt", "dest": "../../malicious.txt"},
        )
        assert res.status_code == 400

    def test_delete_file_traversal(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "../../important.conf"},
        )
        assert res.status_code in (400, 404)

    def test_download_traversal(self, client, workspace):
        res = client.get(
            "/workspaces/test-ws/download",
            headers=AUTH,
            params={"path": "../../etc/passwd"},
        )
        assert res.status_code == 400

    def test_hidden_dir_access_blocked(self, client, workspace):
        git_dir = workspace / ".git"
        git_dir.mkdir(exist_ok=True)
        (git_dir / "config").write_text("[core]", encoding="utf-8")
        res = client.get(
            "/workspaces/test-ws/file-content",
            headers=AUTH,
            params={"path": ".git/config"},
        )
        assert res.status_code == 400


class TestWorkspaceNameSecurity:
    """ワークスペース名のバリデーション"""

    @pytest.mark.parametrize("name", [
        "..",
        "../secret",
        "ws/../../../etc",
    ])
    def test_workspace_name_traversal(self, client, name):
        res = client.get(f"/workspaces/{name}/status", headers=AUTH)
        assert res.status_code in (400, 404, 422)

    @pytest.mark.parametrize("name", [
        "ws;rm -rf /",
        "ws|cat",
        "ws&&id",
        "ws$(id)",
        "ws`id`",
        "ws name",
        "ws/sub",
    ])
    def test_existing_path_rejects_shell_metachars_in_name(self, client, tmp_path, name):
        target = tmp_path / "real-dir"
        target.mkdir()
        res = client.post(
            "/workspaces",
            headers=AUTH,
            json={"path": str(target), "name": name},
        )
        assert res.status_code == 400


class TestTerminalSessionNameInjection:
    """ターミナルセッション作成時のワークスペース名サニタイズ"""

    def test_terminal_create_rejects_unregistered_unsafe_workspace(self, client):
        # 未登録かつ不正な文字を含む workspace は 400 で弾かれる
        res = client.post(
            "/run",
            headers=AUTH,
            json={"job": "terminal", "workspace": "ws;rm -rf /"},
        )
        assert res.status_code == 400
