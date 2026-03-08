"""主要エンドポイントのレスポンス構造テスト。

レスポンスに期待するキーが含まれることを検証し、
APIの破壊的変更を検出する。
"""

import subprocess

from conftest import AUTH


class TestWorkspacesContract:
    def test_workspaces_list_structure(self, client, workspace):
        res = client.get("/workspaces", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        ws = data[0]
        assert "name" in ws
        assert "is_git_repo" in ws

    def test_workspaces_statuses_structure(self, client, workspace):
        res = client.get("/workspaces/statuses", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, dict)
        assert "statuses" in data


class TestGitStatusContract:
    def test_status_response_keys(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/status", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        expected_keys = {"name", "is_git_repo", "branch", "clean"}
        assert expected_keys.issubset(data.keys()), f"Missing keys: {expected_keys - data.keys()}"

    def test_branches_response_is_list(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/branches", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        assert len(data) >= 1


class TestGitLogContract:
    def test_git_log_response_structure(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/git-log", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "stdout" in data

    def test_git_log_with_limit(self, client, git_workspace_with_commit):
        res = client.get("/workspaces/test-ws/git-log", headers=AUTH, params={"limit": 1})
        assert res.status_code == 200
        assert res.json()["status"] == "ok"


class TestDiffContract:
    def test_working_tree_diff_structure(self, client, git_workspace_with_commit):
        (git_workspace_with_commit / "new.txt").write_text("new\n", encoding="utf-8")
        res = client.get("/workspaces/test-ws/diff", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "files" in data
        assert "diff" in data

    def test_commit_diff_structure(self, client, git_workspace_with_commit):
        (git_workspace_with_commit / "extra.txt").write_text("extra\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=git_workspace_with_commit, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "second"], cwd=git_workspace_with_commit, check=True, capture_output=True)
        commit_hash = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=git_workspace_with_commit, check=True, capture_output=True, text=True,
        ).stdout.strip()
        res = client.get(f"/workspaces/test-ws/diff/{commit_hash}", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "files" in data


class TestSystemInfoContract:
    def test_system_info_keys(self, client):
        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        expected_keys = {"hostname", "ip", "os", "memory"}
        assert expected_keys.issubset(data.keys()), f"Missing keys: {expected_keys - data.keys()}"


class TestAuthCheckContract:
    def test_auth_check_keys(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "hostname" in data


class TestJobsContract:
    def test_jobs_list_is_dict(self, client, workspace):
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        assert isinstance(res.json(), dict)

    def test_created_job_has_required_fields(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "test job",
            "command": "echo test",
        })
        assert res.status_code == 200
        data = res.json()
        assert "name" in data

        jobs = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        job = jobs[data["name"]]
        for key in ("command", "label", "confirm", "terminal"):
            assert key in job, f"Missing key: {key}"


class TestRunContract:
    def test_run_non_terminal_response_keys(self, client, workspace):
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "echo",
            "command": "echo contract",
            "terminal": False,
        })
        job_name = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        name = list(job_name.keys())[0]

        res = client.post("/run", headers=AUTH, json={
            "job": name,
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        data = res.json()
        for key in ("status", "exit_code", "stdout", "stderr"):
            assert key in data, f"Missing key: {key}"

    def test_run_terminal_response_keys(self, client, workspace):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        data = res.json()
        for key in ("status", "session_id", "ws_url"):
            assert key in data, f"Missing key: {key}"


class TestSettingsExportContract:
    def test_export_returns_dict(self, client):
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert isinstance(res.json(), dict)


class TestSnippetsContract:
    def test_snippets_returns_dict_with_list(self, client):
        res = client.get("/snippets", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "snippets" in data
        assert isinstance(data["snippets"], list)

    def test_save_and_get_snippets(self, client):
        client.put("/snippets", headers=AUTH, json={
            "snippets": [{"label": "test", "command": "echo test"}],
        })
        res = client.get("/snippets", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert len(data["snippets"]) == 1
        assert data["snippets"][0]["command"] == "echo test"


class TestFilesContract:
    def test_files_list_structure(self, client, workspace):
        (workspace / "file.txt").write_text("x", encoding="utf-8")
        res = client.get("/workspaces/test-ws/files", headers=AUTH, params={"path": ""})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "entries" in data
        entry = data["entries"][0]
        assert "name" in entry
        assert "type" in entry

    def test_file_content_text_structure(self, client, workspace):
        (workspace / "hello.txt").write_text("hello", encoding="utf-8")
        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "hello.txt"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "content" in data
        assert "size" in data
