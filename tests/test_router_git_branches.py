"""api/routers/git_branches.py のエンドポイント単体テスト。

既存の test_git_operations.py / test_git_checkout_branch.py がカバーしていない
GETエンドポイント・バリデーション・set-upstream 周辺を補完する。
git commit を要求しないバリデーション中心の薄いテスト。
"""
import subprocess

from conftest import AUTH


class TestBranchListsEmpty:
    def test_branches_on_freshly_init_repo(self, client, git_workspace):
        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_remote_branches_on_freshly_init_repo(self, client, git_workspace):
        res = client.get("/workspaces/test-ws/branches/remote", headers=AUTH)
        assert res.status_code == 200
        assert isinstance(res.json(), list)


class TestDeleteBranchValidation:
    def test_invalid_branch_name_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/delete-branch",
            headers=AUTH,
            json={"branch": "bad name!"},
        )
        assert res.status_code == 400

    def test_empty_branch_name_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/delete-branch",
            headers=AUTH,
            json={"branch": ""},
        )
        assert res.status_code == 400


class TestCreateBranchValidation:
    def test_invalid_start_point_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/create-branch",
            headers=AUTH,
            json={"branch": "feature", "start_point": "ZZZZ-not-a-hash"},
        )
        assert res.status_code == 400

    def test_invalid_branch_name_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/create-branch",
            headers=AUTH,
            json={"branch": "bad branch!"},
        )
        assert res.status_code == 400


class TestCheckoutValidation:
    def test_invalid_branch_name_rejected(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/checkout",
            headers=AUTH,
            json={"branch": "bad branch!"},
        )
        assert res.status_code == 400


class TestUnknownWorkspace:
    def test_status_unknown_workspace_returns_400(self, client, isolate_fs):
        res = client.get("/workspaces/no-such/status", headers=AUTH)
        assert res.status_code == 400

    def test_branches_unknown_workspace_returns_400(self, client, isolate_fs):
        res = client.get("/workspaces/no-such/branches", headers=AUTH)
        assert res.status_code == 400


class TestFetchNoRemote:
    def test_fetch_returns_structured_response(self, client, git_workspace):
        # No remote configured: endpoint should still return a structured 200 response
        res = client.post("/workspaces/test-ws/fetch", headers=AUTH)
        assert res.status_code == 200
        body = res.json()
        assert "exit_code" in body
