"""api/routers/git_diff.py のエンドポイント単体テスト。"""

from unittest import mock

from conftest import AUTH


class TestTruncateDiff:
    def test_short_diff_unchanged(self):
        from api.routers.git_diff import _truncate_diff
        assert _truncate_diff("small") == "small"

    def test_long_diff_truncated(self):
        from api.routers.git_diff import _truncate_diff
        from api.common import MAX_DIFF_SIZE
        big = "x" * (MAX_DIFF_SIZE + 100)
        result = _truncate_diff(big)
        assert result.endswith("... (truncated)")
        assert len(result) < len(big)


class TestGetCommitDiff:
    def test_stash_ref_dispatches_to_stash_show(self, client, git_workspace_with_commit):
        ok_result = {"status": "ok", "stdout": "diff content", "stderr": "", "exit_code": 0}
        numstat_result = {"status": "ok", "stdout": "", "stderr": "", "exit_code": 0}
        with mock.patch("api.routers.git_diff.run_git_command", return_value=ok_result) as run:
            res = client.get(
                "/workspaces/test-ws/diff/stash@{0}",
                headers=AUTH,
            )
        assert res.status_code == 200
        calls = [c.args[0] for c in run.call_args_list]
        assert any("stash" in c for c in calls)

    def test_commit_hash_dispatches_to_diff(self, client, git_workspace_with_commit):
        ok_result = {"status": "ok", "stdout": "some diff", "stderr": "", "exit_code": 0}
        with mock.patch("api.routers.git_diff.run_git_command", return_value=ok_result):
            res = client.get(
                "/workspaces/test-ws/diff/abcdef1234567890abcdef1234567890abcdef12",
                headers=AUTH,
            )
        assert res.status_code == 200
        data = res.json()
        assert "diff" in data

    def test_invalid_commit_hash_returns_400(self, client, git_workspace_with_commit):
        res = client.get(
            "/workspaces/test-ws/diff/not-a-hash!!",
            headers=AUTH,
        )
        assert res.status_code == 400


class TestGetFileCommitDiff:
    def test_returns_diff_for_valid_hash(self, client, git_workspace_with_commit, tmp_path):
        ok_result = {"status": "ok", "stdout": "file diff", "stderr": "", "exit_code": 0}
        with mock.patch("api.routers.git_diff.run_git_command", return_value=ok_result):
            res = client.get(
                "/workspaces/test-ws/file-diff/abcdef1234567890abcdef1234567890abcdef12",
                params={"path": "README.md"},
                headers=AUTH,
            )
        assert res.status_code == 200
        data = res.json()
        assert "diff" in data

    def test_invalid_hash_returns_400(self, client, git_workspace_with_commit):
        res = client.get(
            "/workspaces/test-ws/file-diff/bad!!hash",
            params={"path": "README.md"},
            headers=AUTH,
        )
        assert res.status_code == 400


class TestGetWorkspaceDiff:
    def test_returns_ok_for_git_workspace(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/diff", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "files" in data
        assert "diff" in data

    def test_unknown_workspace_returns_error(self, client):
        res = client.get("/workspaces/no-such-ws/diff", headers=AUTH)
        assert res.status_code in (400, 404)


class TestDiscardFileChanges:
    def test_discard_returns_result(self, client, git_workspace_with_commit):
        ok_result = {"status": "ok", "stdout": "", "stderr": "", "exit_code": 0}
        with mock.patch("api.routers.git_helpers.run_git_command", return_value=ok_result):
            res = client.post(
                "/workspaces/test-ws/git/discard",
                headers=AUTH,
                json={"path": "README.md"},
            )
        assert res.status_code == 200
