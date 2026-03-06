import subprocess

import pytest

from conftest import AUTH


def _git_commit(workspace, filename="file.txt", content="hello\n", message="commit"):
    """ワークスペースにファイルを作成してコミットし、ハッシュを返す"""
    (workspace / filename).write_text(content, encoding="utf-8")
    subprocess.run(["git", "add", filename], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", message], cwd=workspace, check=True, capture_output=True)
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=workspace, check=True, capture_output=True, text=True,
    ).stdout.strip()


class TestResetSoft:
    def test_reset_soft(self, client, git_workspace):
        first = _git_commit(git_workspace, "a.txt", "a", "first")
        _git_commit(git_workspace, "b.txt", "b", "second")

        res = client.post("/workspaces/test-ws/reset", headers=AUTH, json={
            "commit_hash": first,
            "mode": "soft",
        })
        assert res.status_code == 200

        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout.strip()
        assert head == first
        assert (git_workspace / "b.txt").exists()


class TestResetHard:
    def test_reset_hard(self, client, git_workspace):
        first = _git_commit(git_workspace, "a.txt", "a", "first")
        _git_commit(git_workspace, "b.txt", "b", "second")

        res = client.post("/workspaces/test-ws/reset", headers=AUTH, json={
            "commit_hash": first,
            "mode": "hard",
        })
        assert res.status_code == 200

        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout.strip()
        assert head == first
        assert not (git_workspace / "b.txt").exists()


class TestDeleteBranch:
    def test_delete_local_branch(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        subprocess.run(
            ["git", "branch", "feature-x"], cwd=git_workspace, check=True, capture_output=True,
        )

        res = client.post("/workspaces/test-ws/delete-branch", headers=AUTH, json={
            "branch": "feature-x",
        })
        assert res.status_code == 200

        branches = subprocess.run(
            ["git", "branch", "--list"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout
        assert "feature-x" not in branches

    def test_delete_current_branch_fails(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        current = subprocess.run(
            ["git", "branch", "--show-current"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout.strip()

        res = client.post("/workspaces/test-ws/delete-branch", headers=AUTH, json={
            "branch": current,
        })
        assert res.status_code != 200


class TestCherryPick:
    def test_cherry_pick(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=git_workspace, check=True, capture_output=True,
        )
        cherry_hash = _git_commit(git_workspace, "b.txt", "cherry", "cherry commit")
        subprocess.run(
            ["git", "checkout", "master"],
            cwd=git_workspace, capture_output=True,
        )
        result = subprocess.run(
            ["git", "checkout", "main"],
            cwd=git_workspace, capture_output=True,
        )
        if result.returncode != 0:
            subprocess.run(
                ["git", "checkout", "master"], cwd=git_workspace, check=True, capture_output=True,
            )

        res = client.post("/workspaces/test-ws/cherry-pick", headers=AUTH, json={
            "commit_hash": cherry_hash,
        })
        assert res.status_code == 200
        assert (git_workspace / "b.txt").exists()


class TestMerge:
    def test_merge(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        subprocess.run(
            ["git", "checkout", "-b", "feature"], cwd=git_workspace, check=True, capture_output=True,
        )
        _git_commit(git_workspace, "b.txt", "merge-content", "feature commit")
        subprocess.run(
            ["git", "checkout", "master"],
            cwd=git_workspace, capture_output=True,
        )
        result = subprocess.run(
            ["git", "checkout", "main"],
            cwd=git_workspace, capture_output=True,
        )
        if result.returncode != 0:
            subprocess.run(
                ["git", "checkout", "master"], cwd=git_workspace, check=True, capture_output=True,
            )

        res = client.post("/workspaces/test-ws/merge", headers=AUTH, json={
            "branch": "feature",
        })
        assert res.status_code == 200
        assert (git_workspace / "b.txt").exists()
        assert (git_workspace / "b.txt").read_text() == "merge-content"

    def test_merge_invalid_branch(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/merge", headers=AUTH, json={
            "branch": "invalid branch!",
        })
        assert res.status_code == 400


class TestRevert:
    def test_revert(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        target = _git_commit(git_workspace, "b.txt", "b", "add b")

        res = client.post("/workspaces/test-ws/revert", headers=AUTH, json={
            "commit_hash": target,
        })
        assert res.status_code == 200
        assert not (git_workspace / "b.txt").exists()


class TestInvalidInputs:
    def test_invalid_commit_hash(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/reset", headers=AUTH, json={
            "commit_hash": "INVALID",
            "mode": "soft",
        })
        assert res.status_code == 400

    def test_invalid_branch_name(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/delete-branch", headers=AUTH, json={
            "branch": "invalid branch name!",
        })
        assert res.status_code == 400

    def test_short_commit_hash(self, client, git_workspace):
        res = client.post("/workspaces/test-ws/cherry-pick", headers=AUTH, json={
            "commit_hash": "ab",
        })
        assert res.status_code == 400
