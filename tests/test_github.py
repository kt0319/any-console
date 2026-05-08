"""GitHub連携エンドポイントのテスト。

`gh_utils` のヘルパーをモックし、各エンドポイントの正常系・エラー系を検証する。
"""

import json
import subprocess

import api.gh_utils as gh_utils

from conftest import AUTH


def _clear_caches():
    gh_utils._workspace_cache.invalidate_all()
    gh_utils._repos_cache.invalidate_all()


class TestGithubInfo:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = {"name": "test-repo", "owner": {"login": "user"}, "url": "https://github.com/user/test-repo"}
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: mock_data)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"]["name"] == "test-repo"

    def test_gh_failure(self, client, workspace, monkeypatch):
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: None)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "error"


class TestGithubIssues:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = [{"number": 1, "title": "Bug", "state": "OPEN"}]
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: mock_data)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/issues", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert len(data["data"]) == 1
        assert data["data"][0]["number"] == 1

    def test_gh_failure(self, client, workspace, monkeypatch):
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: None)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/issues", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "error"


class TestGithubPulls:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = [{"number": 10, "title": "Feature", "state": "OPEN", "isDraft": False}]
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: mock_data)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/pulls", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"][0]["title"] == "Feature"

    def test_gh_failure(self, client, workspace, monkeypatch):
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: None)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/pulls", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "error"


class TestGithubRuns:

    def test_success(self, client, workspace, monkeypatch):
        mock_data = [{"databaseId": 1, "displayTitle": "CI", "status": "completed", "conclusion": "success"}]
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: mock_data)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/runs", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["data"][0]["status"] == "completed"

    def test_gh_failure(self, client, workspace, monkeypatch):
        monkeypatch.setattr(gh_utils, "run_gh_json", lambda args, cwd=None: None)
        _clear_caches()

        res = client.get("/workspaces/test-ws/github/runs", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "error"


class TestGithubRepos:

    def test_success(self, client, monkeypatch):
        repo_json = json.dumps([{"nameWithOwner": "user/repo", "url": "https://github.com/user/repo", "description": "test"}])

        def fake_run_subprocess_safe(cmd, **kwargs):
            result = subprocess.CompletedProcess(cmd, 0)
            if cmd[0] == "gh" and cmd[1] == "repo":
                result.stdout = repo_json
                result.stderr = ""
            elif cmd[0] == "gh" and cmd[1] == "org":
                result.stdout = ""
                result.stderr = ""
                result.returncode = 1
            else:
                result.stdout = ""
                result.stderr = ""
            return result

        monkeypatch.setattr(gh_utils, "run_subprocess_safe", fake_run_subprocess_safe)
        _clear_caches()

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert len(data) == 1
        assert data[0]["nameWithOwner"] == "user/repo"

    def test_cached_response(self, client, monkeypatch):
        cached_data = [{"nameWithOwner": "cached/repo"}]
        gh_utils._repos_cache.set("repos", cached_data)

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 200
        assert res.json()[0]["nameWithOwner"] == "cached/repo"

        _clear_caches()

    def test_gh_not_installed(self, client, monkeypatch):
        monkeypatch.setattr(gh_utils, "run_subprocess_safe", lambda cmd, **kwargs: None)
        _clear_caches()

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 500
        assert "not found" in res.json()["detail"] or "failed" in res.json()["detail"]


class TestRunGh:
    """run_gh_json の単体テスト"""

    def test_timeout(self, monkeypatch):
        # run_subprocess_safe swallows TimeoutExpired and returns None
        monkeypatch.setattr(gh_utils, "run_subprocess_safe", lambda cmd, **kwargs: None)
        result = gh_utils.run_gh_json(["repo", "view"], cwd="/tmp")
        assert result is None

    def test_json_decode_error(self, monkeypatch):
        def return_bad_json(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 0, stdout="not json{{{", stderr="")

        monkeypatch.setattr(gh_utils, "run_subprocess_safe", return_bad_json)
        result = gh_utils.run_gh_json(["repo", "view"], cwd="/tmp")
        assert result is None

    def test_nonzero_exit_stderr(self, monkeypatch):
        def return_error(cmd, **kwargs):
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="auth required")

        monkeypatch.setattr(gh_utils, "run_subprocess_safe", return_error)
        result = gh_utils.run_gh_json(["repo", "view"], cwd="/tmp")
        assert result is None

    def test_file_not_found(self, monkeypatch):
        # FileNotFoundError is swallowed by run_subprocess_safe → returns None
        monkeypatch.setattr(gh_utils, "run_subprocess_safe", lambda cmd, **kwargs: None)
        result = gh_utils.run_gh_json(["repo", "view"], cwd="/tmp")
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
        # run_subprocess_safe swallows TimeoutExpired and returns None,
        # which the endpoint surfaces as a 500 "not found or failed"
        monkeypatch.setattr(gh_utils, "run_subprocess_safe", lambda cmd, **kwargs: None)
        _clear_caches()

        res = client.get("/github/repos", headers=AUTH)
        assert res.status_code == 500
