"""api/routers/git_history.py のエンドポイント単体テスト。

既存の test_git_operations.py / test_boundary.py / test_contract.py がカバーしていない
バリデーション中心の薄いテスト。git commit を要求しない。
"""

from conftest import AUTH


class TestCommitMessageValidation:
    def test_invalid_hash_rejected(self, client, workspace):
        res = client.get(
            "/workspaces/test-ws/commit-message",
            headers=AUTH,
            params={"hash": "not-a-hash"},
        )
        assert res.status_code == 400

    def test_shell_metachar_in_hash_rejected(self, client, workspace):
        res = client.get(
            "/workspaces/test-ws/commit-message",
            headers=AUTH,
            params={"hash": "abc; rm -rf /"},
        )
        assert res.status_code == 400


class TestCommitValidation:
    def test_empty_message_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/commit",
            headers=AUTH,
            json={"message": "   "},
        )
        assert res.status_code == 400


class TestCherryPickRevertValidation:
    def test_cherry_pick_invalid_hash_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/cherry-pick",
            headers=AUTH,
            json={"commit_hash": "not-a-hash"},
        )
        assert res.status_code == 400

    def test_revert_invalid_hash_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/revert",
            headers=AUTH,
            json={"commit_hash": "ZZZ"},
        )
        assert res.status_code == 400


class TestResetValidation:
    def test_invalid_reset_mode_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/reset",
            headers=AUTH,
            json={"commit_hash": "abc1234", "mode": "evil"},
        )
        assert res.status_code == 400

    def test_invalid_hash_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/reset",
            headers=AUTH,
            json={"commit_hash": "not-hex", "mode": "soft"},
        )
        assert res.status_code == 400


class TestMergeRebaseValidation:
    def test_merge_invalid_branch_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/merge",
            headers=AUTH,
            json={"branch": "bad branch!"},
        )
        assert res.status_code == 400

    def test_rebase_invalid_branch_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/rebase",
            headers=AUTH,
            json={"branch": "bad branch!"},
        )
        assert res.status_code == 400


class TestStashRefValidation:
    def test_stash_drop_invalid_ref_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/stash-drop",
            headers=AUTH,
            json={"stash_ref": "not-a-stash-ref"},
        )
        assert res.status_code == 400

    def test_stash_pop_ref_invalid_ref_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/stash-pop-ref",
            headers=AUTH,
            json={"stash_ref": "; rm -rf /"},
        )
        assert res.status_code == 400


class TestStashList:
    def test_stash_list_on_init_repo(self, client, git_workspace):
        # 空 git リポジトリでも stash list は空配列で返る
        res = client.get("/workspaces/test-ws/stash-list", headers=AUTH)
        assert res.status_code == 200
        body = res.json()
        # stash list は initial commit がない場合 exit_code != 0 になりうる
        # その場合は status="ok" ではなく、構造的にレスポンスが返ることだけ確認
        assert "exit_code" in body or body.get("status") == "ok"


class TestGitLogBoundaries:
    def test_git_log_unknown_workspace(self, client, isolate_fs):
        res = client.get("/workspaces/no-such/git-log", headers=AUTH)
        assert res.status_code == 400
