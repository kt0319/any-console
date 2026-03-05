"""セキュリティリグレッションテスト。

既知の脆弱性対策が維持されていることを確認する。
"""

import ast
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


class TestGitCloneInjection:
    """git clone引数インジェクション対策"""

    def test_clone_uses_double_dash(self):
        """workspaces.pyのclone処理で -- オプション終端が使用されていることを確認"""
        source_path = "api/routers/workspaces.py"
        with open(source_path, encoding="utf-8") as f:
            source = f.read()

        tree = ast.parse(source)
        found_clone_with_dash_dash = False
        for node in ast.walk(tree):
            if isinstance(node, (ast.List, ast.Tuple)):
                elements = []
                for elt in node.elts:
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                        elements.append(elt.value)
                if "clone" in elements and "--" in elements:
                    clone_idx = elements.index("clone")
                    dash_idx = elements.index("--")
                    if dash_idx > clone_idx:
                        found_clone_with_dash_dash = True

        assert found_clone_with_dash_dash, (
            "git clone command must include '--' to prevent argument injection"
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

    def test_clone_rejects_traversal_in_dirname(self, client):
        res = client.post(
            "/workspaces",
            headers=AUTH,
            json={"url": "https://github.com/test/repo", "name": "../evil"},
        )
        assert res.status_code == 400
