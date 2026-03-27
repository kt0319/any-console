"""GitHub連携エンドポイントのテスト。

_run_gh をモックし、各エンドポイントの正常系・エラー系を検証する。
"""

import json
import subprocess

from conftest import AUTH


class TestGithubInfo:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = {"name": "test-repo", "owner": {"login": "user"}, "url": "https://github.com/user/test-repo"}

        def fake_run_gh(args, cwd):
            return mock_data

        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", fake_run_gh)

        res = client.get("/workspaces/test-ws/github/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"]["name"] == "test-repo"

    def test_gh_failure(self, client, workspace, monkeypatch):
        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: None)

        res = client.get("/workspaces/test-ws/github/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "error"


class TestGithubIssues:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = [{"number": 1, "title": "Bug", "state": "OPEN"}]

        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: mock_data)

        res = client.get("/workspaces/test-ws/github/issues", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert len(data["data"]) == 1
        assert data["data"][0]["number"] == 1

    def test_gh_failure(self, client, workspace, monkeypatch):
        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: None)

        res = client.get("/workspaces/test-ws/github/issues", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "error"


class TestGithubPulls:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = [{"number": 10, "title": "Feature", "state": "OPEN", "isDraft": False}]

        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: mock_data)

        res = client.get("/workspaces/test-ws/github/pulls", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"][0]["title"] == "Feature"

    def test_gh_failure(self, client, workspace, monkeypatch):
        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: None)

        res = client.get("/workspaces/test-ws/github/pulls", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "error"


class TestGithubRuns:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = [{"databaseId": 1, "displayTitle": "CI", "status": "completed", "conclusion": "success"}]

        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: mock_data)

        res = client.get("/workspaces/test-ws/github/runs", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"][0]["status"] == "completed"

    def test_gh_failure(self, client, workspace, monkeypatch):
        import api.routers.github as github_mod
        monkeypatch.setattr(github_mod, "_run_gh", lambda args, cwd: None)

        res = client.get("/workspaces/test-ws/github/runs", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "error"


class TestGithubRepos:

    def test_success(self, client, monkeypatch):
        repo_json = json.dumps([{"nameWithOwner": "user/repo", "url": "https://github.com/user/repo", "description": "test"}])

        def fake_subprocess_run(cmd, **kwargs):
            result = subprocess.CompletedProcess(cmd, 0)
            if cmd[1] == "repo":
                result.stdout = repo_json
                result.stderr = ""
            elif cmd[1] == "org":
                result.stdout = ""
                result.stderr = ""
                result.returncode = 1
            return result

        import api.routers.workspaces as ws_mod
        monkeypatch.setattr(ws_mod.subprocess, "run", fake_subprocess_run)
        ws_mod._github_repos_cache.invalidate("repos")

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["nameWithOwner"] == "user/repo"

    def test_cached_response(self, client, monkeypatch):
        cached_data = [{"nameWithOwner": "cached/repo"}]

        import api.routers.workspaces as ws_mod
        ws_mod._github_repos_cache.set("repos", cached_data)

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 200
        assert res.json()[0]["nameWithOwner"] == "cached/repo"

        ws_mod._github_repos_cache.invalidate("repos")

    def test_gh_not_installed(self, client, monkeypatch):
        def raise_fnf(cmd, **kwargs):
            raise FileNotFoundError("gh not found")

        import api.routers.workspaces as ws_mod
        monkeypatch.setattr(ws_mod.subprocess, "run", raise_fnf)
        ws_mod._github_repos_cache.invalidate("repos")

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 500
        assert "not found" in res.json()["detail"]


class TestRunGh:
    """_run_gh の単体テスト"""

    def test_timeout(self, monkeypatch):
        import subprocess as sp
        import api.routers.github as github_mod

        def raise_timeout(cmd, **kwargs):
            raise sp.TimeoutExpired(cmd, 30)

        monkeypatch.setattr(sp, "run", raise_timeout)
        result = github_mod._run_gh(["repo", "view"], cwd="/tmp")
        assert result is None

    def test_json_decode_error(self, monkeypatch):
        import subprocess as sp
        import api.routers.github as github_mod

        def return_bad_json(cmd, **kwargs):
            return sp.CompletedProcess(cmd, 0, stdout="not json{{{", stderr="")

        monkeypatch.setattr(sp, "run", return_bad_json)
        result = github_mod._run_gh(["repo", "view"], cwd="/tmp")
        assert result is None

    def test_nonzero_exit_stderr(self, monkeypatch):
        import subprocess as sp
        import api.routers.github as github_mod

        def return_error(cmd, **kwargs):
            return sp.CompletedProcess(cmd, 1, stdout="", stderr="auth required")

        monkeypatch.setattr(sp, "run", return_error)
        result = github_mod._run_gh(["repo", "view"], cwd="/tmp")
        assert result is None

    def test_file_not_found(self, monkeypatch):
        import subprocess as sp
        import api.routers.github as github_mod

        def raise_fnf(cmd, **kwargs):
            raise FileNotFoundError("gh not found")

        monkeypatch.setattr(sp, "run", raise_fnf)
        result = github_mod._run_gh(["repo", "view"], cwd="/tmp")
        assert result is None


class TestParseGithubUrl:
    """_parse_github_url の単体テスト"""

    def test_https_url(self):
        from api.git_utils import _parse_github_url
        result = _parse_github_url("https://github.com/user/repo.git")
        assert result == "https://github.com/user/repo"

    def test_ssh_url(self):
        from api.git_utils import _parse_github_url
        result = _parse_github_url("git@github.com:user/repo.git")
        assert result == "https://github.com/user/repo"

    def test_non_github(self):
        from api.git_utils import _parse_github_url
        result = _parse_github_url("https://gitlab.com/user/repo.git")
        assert result is None

    def test_without_dot_git(self):
        from api.git_utils import _parse_github_url
        result = _parse_github_url("https://github.com/user/repo")
        assert result == "https://github.com/user/repo"

    def test_empty_string(self):
        from api.git_utils import _parse_github_url
        result = _parse_github_url("")
        assert result is None


class TestGithubReposTimeout:

    def test_timeout(self, client, monkeypatch):
        import subprocess as sp
        import api.routers.workspaces as ws_mod

        def raise_timeout(cmd, **kwargs):
            raise sp.TimeoutExpired(cmd, 30)

        monkeypatch.setattr(ws_mod.subprocess, "run", raise_timeout)
        ws_mod._github_repos_cache.invalidate("repos")

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 504
