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


class TestDefaultBranch:
    def test_no_remote_head_no_branch_is_default(self, client, git_workspace_with_commit):
        # フレッシュなgit initリポジトリにはrefs/remotes/origin/HEADが無いため、
        # どのブランチもis_defaultにならない
        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        assert all(b["is_default"] is False for b in res.json())

    def test_marks_branch_matching_remote_head_as_default(self, client, git_workspace_with_commit, isolate_fs):
        # bareリポジトリをoriginとして追加しpushすることで、実際のclone同様に
        # refs/remotes/origin/HEADが作られる状態を再現する
        bare_path = isolate_fs["work"] / "origin.git"
        subprocess.run(["git", "init", "--bare", str(bare_path)], check=True, capture_output=True)
        subprocess.run(
            ["git", "remote", "add", "origin", str(bare_path)],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        current_branch = subprocess.run(
            ["git", "branch", "--show-current"], cwd=git_workspace_with_commit,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        subprocess.run(
            ["git", "push", "-u", "origin", current_branch],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        subprocess.run(
            ["git", "remote", "set-head", "origin", "-a"],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )

        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        entry = next(b for b in res.json() if b["name"] == current_branch)
        assert entry["is_default"] is True


class TestBranchListUnpublishedAhead:
    def test_branch_without_upstream_counts_unpublished_commits_as_ahead(self, client, git_workspace_with_commit, isolate_fs):
        # upstream未設定のブランチは %(upstream:track) が常に空でahead/behindを
        # 計算できないため、originのどのリモートブランチにも含まれないコミット数を
        # 未push件数として数える（回帰: 常に0が返っていた不具合の修正確認）。
        bare_path = isolate_fs["work"] / "origin.git"
        subprocess.run(["git", "init", "--bare", str(bare_path)], check=True, capture_output=True)
        subprocess.run(
            ["git", "remote", "add", "origin", str(bare_path)],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        current_branch = subprocess.run(
            ["git", "branch", "--show-current"], cwd=git_workspace_with_commit,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        subprocess.run(
            ["git", "push", "-u", "origin", current_branch],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )

        subprocess.run(
            ["git", "checkout", "-b", "feature/no-upstream"],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        (git_workspace_with_commit / "new_file.txt").write_text("hello\n", encoding="utf-8")
        subprocess.run(["git", "add", "new_file.txt"], cwd=git_workspace_with_commit, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "add file"],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )

        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        entry = next(b for b in res.json() if b["name"] == "feature/no-upstream")
        assert entry["upstream"] is None
        assert entry["ahead"] == 1

    def test_multiple_no_upstream_branches_count_shared_commits_each(self, client, git_workspace_with_commit, isolate_fs):
        # 一括化（rev-list --parents 1回 + Python側到達数計算）後も、複数の
        # upstream未設定ブランチが未pushコミットを共有する場合はそれぞれの
        # ブランチで数える（従来のブランチごとの rev-list --count と同じ値）。
        bare_path = isolate_fs["work"] / "origin.git"
        subprocess.run(["git", "init", "--bare", str(bare_path)], check=True, capture_output=True)
        subprocess.run(
            ["git", "remote", "add", "origin", str(bare_path)],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        current_branch = subprocess.run(
            ["git", "branch", "--show-current"], cwd=git_workspace_with_commit,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        subprocess.run(
            ["git", "push", "-u", "origin", current_branch],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )

        def commit_file(branch_new, filename):
            if branch_new:
                subprocess.run(
                    ["git", "checkout", "-b", branch_new],
                    cwd=git_workspace_with_commit, check=True, capture_output=True,
                )
            (git_workspace_with_commit / filename).write_text("x\n", encoding="utf-8")
            subprocess.run(["git", "add", filename], cwd=git_workspace_with_commit, check=True, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"add {filename}"],
                cwd=git_workspace_with_commit, check=True, capture_output=True,
            )

        commit_file("feature/a", "a1.txt")
        commit_file(None, "a2.txt")
        # feature/a の2コミットを引き継いでさらに1コミット
        commit_file("feature/b", "b1.txt")

        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        by_name = {b["name"]: b for b in res.json()}
        assert by_name["feature/a"]["ahead"] == 2
        assert by_name["feature/b"]["ahead"] == 3

    def test_branch_with_upstream_uses_git_tracking_ahead(self, client, git_workspace_with_commit, isolate_fs):
        bare_path = isolate_fs["work"] / "origin.git"
        subprocess.run(["git", "init", "--bare", str(bare_path)], check=True, capture_output=True)
        subprocess.run(
            ["git", "remote", "add", "origin", str(bare_path)],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        current_branch = subprocess.run(
            ["git", "branch", "--show-current"], cwd=git_workspace_with_commit,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        subprocess.run(
            ["git", "push", "-u", "origin", current_branch],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        (git_workspace_with_commit / "another_file.txt").write_text("hi\n", encoding="utf-8")
        subprocess.run(["git", "add", "another_file.txt"], cwd=git_workspace_with_commit, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "second commit"],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )

        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        entry = next(b for b in res.json() if b["name"] == current_branch)
        assert entry["upstream"] is not None
        assert entry["ahead"] == 1


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


class TestCommitsBetween:
    """pull/push 後のトースト表示に使う _commits_between ヘルパーの挙動。"""

    def test_returns_empty_for_no_diff(self, git_workspace_with_commit):
        from api.routers.git_branches import _commits_between
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=git_workspace_with_commit,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        result = _commits_between(git_workspace_with_commit, f"{head}..HEAD")
        assert result == {"count": 0, "messages": []}

    def test_returns_count_and_recent_messages(self, git_workspace_with_commit):
        from api.routers.git_branches import _commits_between
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=git_workspace_with_commit,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        for i in range(4):
            (git_workspace_with_commit / f"f{i}.txt").write_text(f"x{i}\n", encoding="utf-8")
            subprocess.run(["git", "add", f"f{i}.txt"], cwd=git_workspace_with_commit, check=True, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", f"add f{i}"],
                cwd=git_workspace_with_commit, check=True, capture_output=True,
            )
        result = _commits_between(git_workspace_with_commit, f"{base}..HEAD")
        assert result["count"] == 4
        # 直近3件（新しい順）のみ返る
        assert result["messages"] == ["add f3", "add f2", "add f1"]

    def test_returns_empty_on_invalid_range(self, git_workspace_with_commit):
        from api.routers.git_branches import _commits_between
        result = _commits_between(git_workspace_with_commit, "deadbeef..HEAD")
        assert result == {"count": 0, "messages": []}


class TestParseUpstreamTrack:
    def test_gone(self):
        from api.routers.git_branches import _parse_upstream_track
        assert _parse_upstream_track("[gone]") == {"ahead": 0, "behind": 0, "gone": True}

    def test_behind(self):
        from api.routers.git_branches import _parse_upstream_track
        result = _parse_upstream_track("[behind 3]")
        assert result["behind"] == 3
        assert result["gone"] is False

    def test_ahead_and_behind(self):
        from api.routers.git_branches import _parse_upstream_track
        result = _parse_upstream_track("[ahead 2, behind 5]")
        assert result["ahead"] == 2
        assert result["behind"] == 5


class TestGitPullMocked:
    def test_pull_success_includes_commits(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        rev_result = {"status": "ok", "exit_code": 0, "stdout": "abc123\n", "stderr": "", "detail": ""}
        commits = {"count": 0, "messages": []}
        with mock.patch("api.routers.git_helpers.run_git_command", return_value=rev_result), \
             mock.patch("api.routers.git_branches._stash_if_dirty", return_value=False), \
             mock.patch("api.routers.git_branches.execute_git_action", return_value=ok), \
             mock.patch("api.routers.git_branches._commits_between", return_value=commits), \
             mock.patch("api.routers.git_branches.log_activity") as log:
            res = client.post("/workspaces/test-ws/pull", headers=AUTH)
        assert res.status_code == 200
        assert "commits" in res.json()
        log.assert_called_once_with("test-ws", "git_pull", from_commit="abc123", commit="abc123")


class TestGitPushMocked:
    def test_push_success_includes_commits(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        rev_result = {"status": "ok", "exit_code": 0, "stdout": "def456\n", "stderr": "", "detail": ""}
        commits = {"count": 1, "messages": ["feat: add"]}
        with mock.patch("api.routers.git_branches._commits_between", return_value=commits), \
             mock.patch("api.routers.git_branches.execute_git_action", return_value=ok), \
             mock.patch("api.routers.git_helpers.run_git_command", return_value=rev_result), \
             mock.patch("api.routers.git_branches.log_activity") as log:
            res = client.post("/workspaces/test-ws/push", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["commits"]["count"] == 1
        log.assert_called_once_with("test-ws", "git_push", from_commit="def456", commit="def456")


class TestCreateBranchWithBase:
    def test_base_branch_appended_to_args(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        with mock.patch("api.routers.git_branches.execute_git_action", return_value=ok) as exe:
            res = client.post(
                "/workspaces/test-ws/create-branch",
                headers=AUTH,
                json={"branch": "new-feat", "base_branch": "main"},
            )
        assert res.status_code == 200
        args = exe.call_args[0][1]
        assert "main" in args


class TestGitPushBranch:
    def test_push_branch_success(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        rev_result = {"status": "ok", "exit_code": 0, "stdout": "ghi789\n", "stderr": "", "detail": ""}
        commits = {"count": 0, "messages": []}
        with mock.patch("api.routers.git_branches._commits_between", return_value=commits), \
             mock.patch("api.routers.git_branches.execute_git_action", return_value=ok), \
             mock.patch("api.routers.git_helpers.run_git_command", return_value=rev_result), \
             mock.patch("api.routers.git_branches.log_activity") as log:
            res = client.post(
                "/workspaces/test-ws/push-branch",
                headers=AUTH,
                json={"branch": "feature-x"},
            )
        assert res.status_code == 200
        log.assert_called_once_with(
            "test-ws", "git_push", branch="feature-x", from_commit="ghi789", commit="ghi789",
        )


class TestGitSetUpstream:
    def test_set_upstream_invokes_git_action(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        with mock.patch("api.routers.git_branches.execute_git_action", return_value=ok) as exe, \
             mock.patch("api.routers.git_branches.log_activity") as log:
            res = client.post("/workspaces/test-ws/set-upstream", headers=AUTH)
        assert res.status_code == 200
        args = exe.call_args[0][1]
        assert "--set-upstream-to" in args
        log.assert_called_once_with("test-ws", "git_set_upstream", branch=mock.ANY)


class TestGitPushUpstream:
    def test_push_upstream_invokes_git_action(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        rev_result = {"status": "ok", "exit_code": 0, "stdout": "jkl012\n", "stderr": "", "detail": ""}
        with mock.patch("api.routers.git_branches.execute_git_action", return_value=ok) as exe, \
             mock.patch("api.routers.git_helpers.run_git_command", return_value=rev_result), \
             mock.patch("api.routers.git_branches.log_activity") as log:
            res = client.post("/workspaces/test-ws/push-upstream", headers=AUTH)
        assert res.status_code == 200
        args = exe.call_args[0][1]
        assert "-u" in args
        log.assert_called_once_with("test-ws", "git_push", commit="jkl012")


class TestGitFetch:
    def test_fetch_logs_activity(self, client, git_workspace_with_commit):
        from unittest import mock
        ok = {"status": "ok", "exit_code": 0, "stdout": "", "stderr": "", "detail": ""}
        with mock.patch("api.routers.git_branches.execute_git_action", return_value=ok), \
             mock.patch("api.routers.git_branches.log_activity") as log:
            res = client.post("/workspaces/test-ws/fetch", headers=AUTH)
        assert res.status_code == 200
        log.assert_called_once_with("test-ws", "git_fetch")
