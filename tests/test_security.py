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

    def test_login_rejects_wrong_token(self, client):
        res = client.post("/auth/login", json={"token": "wrong-token"})
        assert res.status_code == 401

    def test_login_rejects_empty_token(self, client):
        res = client.post("/auth/login", json={"token": ""})
        assert res.status_code == 401

    def test_login_sets_httponly_cookie(self, client):
        from conftest import TOKEN
        res = client.post("/auth/login", json={"token": TOKEN})
        assert res.status_code == 200
        cookie_header = res.headers.get("set-cookie", "")
        assert "any_console_session=" in cookie_header
        assert "HttpOnly" in cookie_header
        assert "SameSite=strict" in cookie_header.lower() or "samesite=strict" in cookie_header.lower()

    def test_cookie_auth_grants_access(self, client):
        from conftest import TOKEN
        login_res = client.post("/auth/login", json={"token": TOKEN})
        assert login_res.status_code == 200
        # TestClient persists cookies on the client instance
        check_res = client.get("/auth/check")
        assert check_res.status_code == 200

    def test_logout_clears_cookie(self, client):
        from conftest import TOKEN
        client.post("/auth/login", json={"token": TOKEN})
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
