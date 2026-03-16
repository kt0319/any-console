"""境界値・バリデーションテスト。

パストラバーサル防止、ブランチ名/コミットハッシュ/stash refのバリデーション、
config_schema.pyの正規化・検証をテストする。
"""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from conftest import AUTH


class TestPathTraversal:
    """ワークスペース名によるパストラバーサル防止"""

    @pytest.mark.parametrize("ws_name", [
        "../etc/passwd",
        "test-ws/../../etc/passwd",
        "..%2f..%2fetc%2fpasswd",
        "....//",
    ])
    def test_workspace_traversal_rejected(self, client, workspace, ws_name):
        res = client.get(f"/workspaces/{ws_name}/status", headers=AUTH)
        assert res.status_code in (400, 404, 422)

    def test_nonexistent_workspace_returns_400(self, client):
        res = client.get("/workspaces/nonexistent-ws/status", headers=AUTH)
        assert res.status_code == 400

    @pytest.mark.parametrize("path", [
        "../etc/passwd",
        "../../etc/shadow",
        "sub/../../../etc/passwd",
    ])
    def test_file_content_traversal_rejected(self, client, workspace, path):
        res = client.get(
            "/workspaces/test-ws/file-content",
            headers=AUTH,
            params={"path": path},
        )
        assert res.status_code == 400

    @pytest.mark.parametrize("path", [
        "../etc/passwd",
        "../../outside",
    ])
    def test_files_list_traversal_rejected(self, client, workspace, path):
        res = client.get(
            "/workspaces/test-ws/files",
            headers=AUTH,
            params={"path": path},
        )
        assert res.status_code == 400

    def test_rename_traversal_rejected(self, client, workspace):
        (workspace / "a.txt").write_text("a", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "a.txt", "dest": "../outside.txt"},
        )
        assert res.status_code == 400

    def test_delete_file_traversal_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "../conftest.py"},
        )
        assert res.status_code in (400, 404)


class TestBranchNameValidation:
    """validate_branch_name() の有効/無効パターン"""

    @pytest.mark.parametrize("branch", [
        "main",
        "feature/login",
        "v1.0.0-beta",
        "release_2024",
        "fix/issue-123",
    ])
    def test_valid_branch_names(self, branch):
        from api.validators import validate_branch_name
        assert validate_branch_name(branch) == branch

    @pytest.mark.parametrize("branch", [
        "",
        " ",
        "feature branch",
        "name!@#$",
        "branch\ttab",
        "branch\nnewline",
        "a b",
    ])
    def test_invalid_branch_names(self, branch):
        from api.validators import validate_branch_name
        with pytest.raises(HTTPException) as exc_info:
            validate_branch_name(branch)
        assert exc_info.value.status_code == 400

    def test_branch_name_stripped(self):
        from api.validators import validate_branch_name
        assert validate_branch_name("  main  ") == "main"


class TestCommitHashValidation:
    """COMMIT_HASH_PATTERN の境界テスト"""

    @pytest.mark.parametrize("hash_val", [
        "abcd",
        "a" * 40,
        "0123456789abcdef0123",
        "stash@{0}",
        "stash@{99}",
    ])
    def test_valid_commit_hashes(self, hash_val):
        from api.validators import validate_commit_hash
        assert validate_commit_hash(hash_val) == hash_val

    @pytest.mark.parametrize("hash_val", [
        "abc",
        "a" * 41,
        "ABCD",
        "ghij",
        "xyz123",
        "stash@{-1}",
        "stash@{abc}",
        "stash@{}",
        "",
    ])
    def test_invalid_commit_hashes(self, hash_val):
        from api.validators import validate_commit_hash
        with pytest.raises(HTTPException) as exc_info:
            validate_commit_hash(hash_val)
        assert exc_info.value.status_code == 400


class TestStashRefValidation:
    """validate_stash_ref() の有効/無効パターン"""

    @pytest.mark.parametrize("ref", [
        "stash@{0}",
        "stash@{1}",
        "stash@{99}",
    ])
    def test_valid_stash_refs(self, ref):
        from api.validators import validate_stash_ref
        assert validate_stash_ref(ref) == ref

    @pytest.mark.parametrize("ref", [
        "stash@{}",
        "stash@{-1}",
        "stash@{abc}",
        "stash{0}",
        "refs/stash@{0}",
        "",
        "main",
    ])
    def test_invalid_stash_refs(self, ref):
        from api.validators import validate_stash_ref
        with pytest.raises(HTTPException) as exc_info:
            validate_stash_ref(ref)
        assert exc_info.value.status_code == 400


class TestResolveWorkspacePath:
    """resolve_workspace_path() の境界テスト"""

    def test_none_returns_none(self):
        from api.common import resolve_workspace_path
        assert resolve_workspace_path(None) is None

    def test_empty_returns_none(self):
        from api.common import resolve_workspace_path
        assert resolve_workspace_path("") is None

    def test_traversal_rejected(self):
        from api.common import resolve_workspace_path
        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("../etc")
        assert exc_info.value.status_code == 400

    def test_valid_existing(self, workspace):
        from api.common import resolve_workspace_path
        result = resolve_workspace_path("test-ws")
        assert result is not None
        assert result.name == "test-ws"


class TestConfigSchema:
    """config_schema.py の正規化・検証テスト"""

    def test_normalize_loaded_config_none(self):
        from api.config_schema import normalize_loaded_config
        result, errors = normalize_loaded_config(None, "__global__")
        assert result == {}
        assert errors == []

    def test_normalize_loaded_config_non_dict(self):
        from api.config_schema import normalize_loaded_config
        result, errors = normalize_loaded_config("invalid", "__global__")
        assert result == {}
        assert len(errors) == 1

    def test_normalize_valid_workspace_config(self):
        from api.config_schema import normalize_loaded_config
        raw = {"my-ws": {"icon": "mdi-star", "hidden": True}}
        result, errors = normalize_loaded_config(raw, "__global__")
        assert errors == []
        assert result["my-ws"]["icon"] == "mdi-star"
        assert result["my-ws"]["hidden"] is True

    def test_normalize_invalid_job_config(self):
        from api.config_schema import normalize_loaded_config
        raw = {"my-ws": {"jobs": {"bad": {}}}}
        result, errors = normalize_loaded_config(raw, "__global__")
        assert len(errors) == 1

    def test_validate_config_entry_global(self):
        from api.config_schema import validate_config_entry
        result = validate_config_entry("__global__", {"snippets": []}, "__global__")
        assert isinstance(result, dict)

    def test_validate_config_entry_workspace(self):
        from api.config_schema import validate_config_entry
        result = validate_config_entry("ws", {"icon": "mdi-home"}, "__global__")
        assert result["icon"] == "mdi-home"

    def test_validate_global_config_with_snippets(self):
        from api.config_schema import validate_global_config
        result = validate_global_config({
            "snippets": [{"command": "echo hi", "label": "test"}],
        })
        assert len(result["snippets"]) == 1

    def test_validate_global_config_snippet_requires_command(self):
        from api.config_schema import validate_global_config
        with pytest.raises(ValidationError):
            validate_global_config({"snippets": [{"label": "no cmd"}]})


class TestJobValidation:
    """ジョブ作成時のバリデーション"""

    def test_invalid_icon_format(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "bad icon",
            "command": "echo x",
            "icon": "invalid-icon-format",
        })
        assert res.status_code == 400

    def test_invalid_icon_color(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "bad color",
            "command": "echo x",
            "icon_color": "not-a-color",
        })
        assert res.status_code == 400

    def test_valid_icon_mdi(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "mdi icon",
            "command": "echo x",
            "icon": "mdi-star",
            "icon_color": "#fff",
        })
        assert res.status_code == 200

    def test_label_too_long(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "x" * 201,
            "command": "echo x",
        })
        assert res.status_code in (400, 422)

    def test_command_too_long(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "long cmd",
            "command": "x" * 10001,
        })
        assert res.status_code in (400, 422)


class TestGitLogBoundary:
    """git-log の limit/skip 境界テスト"""

    def test_negative_limit_clamped(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/git-log", headers=AUTH, params={"limit": -1})
        assert res.status_code == 200

    def test_excessive_limit_clamped(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/git-log", headers=AUTH, params={"limit": 999})
        assert res.status_code == 200

    def test_excessive_skip_clamped(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/git-log", headers=AUTH, params={"skip": 99999})
        assert res.status_code == 200
