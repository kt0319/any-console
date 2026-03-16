import subprocess

import pytest

from conftest import AUTH


def _git_commit(workspace, filename="file.txt", content="hello\n", message="commit"):
    (workspace / filename).write_text(content, encoding="utf-8")
    subprocess.run(["git", "add", filename], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", message], cwd=workspace, check=True, capture_output=True)
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=workspace, check=True, capture_output=True, text=True,
    ).stdout.strip()


def _current_branch(workspace):
    return subprocess.run(
        ["git", "branch", "--show-current"], cwd=workspace, check=True, capture_output=True, text=True,
    ).stdout.strip()


class TestCheckout:
    def test_checkout_existing_branch(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        subprocess.run(["git", "branch", "feature"], cwd=git_workspace, check=True, capture_output=True)

        res = client.post("/workspaces/test-ws/checkout", headers=AUTH, json={"branch": "feature"})
        assert res.status_code == 200
        assert _current_branch(git_workspace) == "feature"

    def test_checkout_nonexistent_branch_fails(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/checkout", headers=AUTH, json={"branch": "no-such-branch"})
        data = res.json()
        assert data["exit_code"] != 0

    def test_checkout_invalid_branch_name(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/checkout", headers=AUTH, json={"branch": "bad branch!"})
        assert res.status_code == 400


class TestCreateBranch:
    def test_create_branch(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/create-branch", headers=AUTH, json={"branch": "new-feature"})
        assert res.status_code == 200
        assert _current_branch(git_workspace) == "new-feature"

    def test_create_branch_already_exists(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        subprocess.run(["git", "branch", "existing"], cwd=git_workspace, check=True, capture_output=True)

        res = client.post("/workspaces/test-ws/create-branch", headers=AUTH, json={"branch": "existing"})
        data = res.json()
        assert data["exit_code"] != 0

    def test_create_branch_invalid_name(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/create-branch", headers=AUTH, json={"branch": "bad name!"})
        assert res.status_code == 400

    def test_create_branch_from_start_point(self, client, git_workspace):
        first_hash = _git_commit(git_workspace, "a.txt", "a", "first")
        _git_commit(git_workspace, "b.txt", "b", "second")

        res = client.post("/workspaces/test-ws/create-branch", headers=AUTH, json={
            "branch": "from-past",
            "start_point": first_hash,
        })
        assert res.status_code == 200
        assert _current_branch(git_workspace) == "from-past"
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout.strip()
        assert head == first_hash

    def test_create_branch_invalid_start_point(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/create-branch", headers=AUTH, json={
            "branch": "new-branch",
            "start_point": "invalid_hash!",
        })
        assert res.status_code == 400


class TestCommit:
    def test_commit_with_changes(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        (git_workspace / "b.txt").write_text("new file", encoding="utf-8")

        res = client.post("/workspaces/test-ws/commit", headers=AUTH, json={"message": "add b"})
        assert res.status_code == 200
        data = res.json()
        assert data["exit_code"] == 0

        log = subprocess.run(
            ["git", "log", "--oneline", "-1"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout
        assert "add b" in log

    def test_commit_empty_message_rejected(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/commit", headers=AUTH, json={"message": "  "})
        assert res.status_code == 400

    def test_commit_nothing_to_commit(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/commit", headers=AUTH, json={"message": "empty"})
        data = res.json()
        assert data["exit_code"] != 0


class TestStash:
    def test_stash_and_pop(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        (git_workspace / "a.txt").write_text("modified", encoding="utf-8")

        res = client.post("/workspaces/test-ws/stash", headers=AUTH, json={})
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0
        assert (git_workspace / "a.txt").read_text() == "a"

        res = client.post("/workspaces/test-ws/stash-pop", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0
        assert (git_workspace / "a.txt").read_text() == "modified"

    def test_stash_with_untracked(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        (git_workspace / "untracked.txt").write_text("new", encoding="utf-8")

        res = client.post("/workspaces/test-ws/stash", headers=AUTH, json={"include_untracked": True})
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0
        assert not (git_workspace / "untracked.txt").exists()

    def test_stash_list(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        (git_workspace / "a.txt").write_text("mod", encoding="utf-8")
        subprocess.run(["git", "stash"], cwd=git_workspace, check=True, capture_output=True)

        res = client.get("/workspaces/test-ws/stash-list", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert len(data["entries"]) == 1
        assert "ref" in data["entries"][0]
        assert "message" in data["entries"][0]

    def test_stash_list_empty(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.get("/workspaces/test-ws/stash-list", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["entries"] == []

    def test_stash_drop(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        (git_workspace / "a.txt").write_text("mod", encoding="utf-8")
        subprocess.run(["git", "stash"], cwd=git_workspace, check=True, capture_output=True)

        res = client.post("/workspaces/test-ws/stash-drop", headers=AUTH, json={"stash_ref": "stash@{0}"})
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0

        stash_list = subprocess.run(
            ["git", "stash", "list"], cwd=git_workspace, check=True, capture_output=True, text=True,
        ).stdout
        assert stash_list.strip() == ""

    def test_stash_pop_ref(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")
        (git_workspace / "a.txt").write_text("first", encoding="utf-8")
        subprocess.run(["git", "stash"], cwd=git_workspace, check=True, capture_output=True)
        (git_workspace / "a.txt").write_text("second", encoding="utf-8")
        subprocess.run(["git", "stash"], cwd=git_workspace, check=True, capture_output=True)

        res = client.post("/workspaces/test-ws/stash-pop-ref", headers=AUTH, json={"stash_ref": "stash@{1}"})
        assert res.status_code == 200
        assert res.json()["exit_code"] == 0
        assert (git_workspace / "a.txt").read_text() == "first"

    def test_stash_pop_no_stash(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/stash-pop", headers=AUTH)
        data = res.json()
        assert data["exit_code"] != 0

    def test_stash_drop_invalid_ref(self, client, git_workspace):
        res = client.post("/workspaces/test-ws/stash-drop", headers=AUTH, json={"stash_ref": "invalid"})
        assert res.status_code == 400

    def test_stash_nothing_to_stash(self, client, git_workspace):
        _git_commit(git_workspace, "a.txt", "a", "init")

        res = client.post("/workspaces/test-ws/stash", headers=AUTH, json={})
        data = res.json()
        assert "No local changes" in data.get("stdout", "") or "nothing" in data.get("stderr", "").lower() or data["exit_code"] != 0
