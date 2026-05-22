"""カバレッジ補強：薄く広く未到達分岐を埋めるテスト群"""

import subprocess
import threading
from unittest.mock import MagicMock, patch

import pytest

from api.runner import run_job
from api.git_lock import workspace_write_lock
from api.validators import validate_workspace_name, validate_git_ref
from api.routers.git_branches import (
    _parse_upstream_track,
    _branch_tracking_info,
    _commits_between,
    _stash_if_dirty,
    _unstash,
)
from api.routers.git_helpers import run_raw_git
from api.routers.job_runner import _validate_job_args
from api.job_models import JobDefinition, ArgOption


class TestRunJobExtras:
    def _make_completed(self):
        r = MagicMock(spec=subprocess.CompletedProcess)
        r.returncode = 0
        r.stdout = ""
        r.stderr = ""
        return r

    def test_extends_args_when_provided(self):
        job = JobDefinition(command="echo", label="t", description="")
        with patch("api.runner.subprocess.run", return_value=self._make_completed()) as mock_run:
            run_job(job, ["a", "b"])
            args, _ = mock_run.call_args
            assert args[0] == ["echo", "a", "b"]

    def test_applies_extra_env(self):
        job = JobDefinition(command="echo hi", label="t", description="")
        with patch("api.runner.subprocess.run", return_value=self._make_completed()) as mock_run:
            run_job(job, [], extra_env={"FOO": "bar"})
            _, kwargs = mock_run.call_args
            assert kwargs["env"].get("FOO") == "bar"


class TestWorkspaceWriteLockTimeout:
    def test_raises_when_already_held(self):
        # Hold the lock from another thread, then attempt to acquire with a short timeout.
        with workspace_write_lock("ws-x", timeout=10.0):
            holder_done = threading.Event()

            def hog():
                with workspace_write_lock("ws-y", timeout=10.0):
                    holder_done.wait()

            # Acquire and hold ws-z from a background thread
            release = threading.Event()

            def background():
                with workspace_write_lock("ws-z", timeout=10.0):
                    release.wait()

            t = threading.Thread(target=background)
            t.start()
            # Give thread time to grab the lock
            import time
            time.sleep(0.05)
            from fastapi import HTTPException
            with pytest.raises(HTTPException):
                with workspace_write_lock("ws-z", timeout=0.05):
                    pass
            release.set()
            t.join()
            holder_done.set()


class TestValidatorsExtras:
    def test_workspace_name_empty_raises(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            validate_workspace_name("")
        with pytest.raises(HTTPException):
            validate_workspace_name("   ")

    def test_git_ref_accepts_stash_ref(self):
        assert validate_git_ref("stash@{0}") == "stash@{0}"

    def test_git_ref_returns_none_for_empty(self):
        assert validate_git_ref("") is None
        assert validate_git_ref(None) is None
        assert validate_git_ref("   ") is None


class TestParseUpstreamTrack:
    def test_empty_returns_zero(self):
        assert _parse_upstream_track("") == {"ahead": 0, "behind": 0, "gone": False}
        assert _parse_upstream_track("[]") == {"ahead": 0, "behind": 0, "gone": False}

    def test_gone(self):
        assert _parse_upstream_track("[gone]") == {"ahead": 0, "behind": 0, "gone": True}

    def test_ahead_only(self):
        r = _parse_upstream_track("[ahead 3]")
        assert r["ahead"] == 3
        assert r["behind"] == 0
        assert r["gone"] is False

    def test_behind_only(self):
        r = _parse_upstream_track("[behind 2]")
        assert r["ahead"] == 0
        assert r["behind"] == 2

    def test_ahead_and_behind(self):
        r = _parse_upstream_track("[ahead 1, behind 4]")
        assert r["ahead"] == 1
        assert r["behind"] == 4

    def test_invalid_numbers_default_to_zero(self):
        r = _parse_upstream_track("[ahead abc, behind xyz]")
        assert r == {"ahead": 0, "behind": 0, "gone": False}


class TestBranchTrackingInfo:
    def test_returns_empty_on_failure(self):
        with patch(
            "api.routers.git_branches.run_git_command",
            return_value={"exit_code": 1, "stdout": "", "stderr": "err"},
        ):
            assert _branch_tracking_info("/path") == {}

    def test_parses_lines(self):
        stdout = "\n".join([
            "main|origin/main|[ahead 2]",
            "feature|origin/feature|[behind 1]",
            "local-only||",
            "malformed-line",
        ])
        with patch(
            "api.routers.git_branches.run_git_command",
            return_value={"exit_code": 0, "stdout": stdout, "stderr": ""},
        ):
            info = _branch_tracking_info("/path")
        assert info["main"] == {"upstream": "origin/main", "ahead": 2, "behind": 0, "gone": False}
        assert info["feature"]["behind"] == 1
        assert info["local-only"]["upstream"] is None
        assert "malformed-line" not in info


class TestCommitsBetween:
    def test_parses_count_and_messages(self):
        # call order: log (messages) first, then rev-list --count
        responses = iter([
            {"exit_code": 0, "stdout": "feat: a\nfix: b\nrefactor: c\n", "stderr": ""},
            {"exit_code": 0, "stdout": "5\n", "stderr": ""},
        ])
        with patch(
            "api.routers.git_branches.run_git_command",
            side_effect=lambda *args, **kwargs: next(responses),
        ):
            result = _commits_between("/path", "A..B")
        assert result == {"count": 5, "messages": ["feat: a", "fix: b", "refactor: c"]}

    def test_non_numeric_count_falls_back_to_zero(self):
        responses = iter([
            {"exit_code": 0, "stdout": "", "stderr": ""},
            {"exit_code": 0, "stdout": "not-a-number\n", "stderr": ""},
        ])
        with patch(
            "api.routers.git_branches.run_git_command",
            side_effect=lambda *args, **kwargs: next(responses),
        ):
            result = _commits_between("/path", "A..B")
        assert result["count"] == 0
        assert result["messages"] == []

    def test_returns_zero_on_command_failure(self):
        responses = iter([
            {"exit_code": 1, "stdout": "", "stderr": "fatal"},
            {"exit_code": 0, "stdout": "1\n", "stderr": ""},
        ])
        with patch(
            "api.routers.git_branches.run_git_command",
            side_effect=lambda *args, **kwargs: next(responses),
        ):
            result = _commits_between("/path", "A..B")
        assert result == {"count": 0, "messages": []}


class TestStashIfDirty:
    def test_clean_returns_false(self):
        with patch(
            "api.routers.git_branches.run_git_command",
            return_value={"exit_code": 0, "stdout": "", "stderr": ""},
        ):
            assert _stash_if_dirty("/path", {}) is False

    def test_dirty_stashes_and_returns_true(self):
        responses = iter([
            {"exit_code": 0, "stdout": " M foo.py", "stderr": ""},  # status --porcelain
            {"exit_code": 0, "stdout": "stashed", "stderr": ""},     # stash
        ])
        with patch(
            "api.routers.git_branches.run_git_command",
            side_effect=lambda *args, **kwargs: next(responses),
        ):
            assert _stash_if_dirty("/path", {}) is True

    def test_dirty_stash_failure_returns_false(self):
        responses = iter([
            {"exit_code": 0, "stdout": " M foo.py", "stderr": ""},
            {"exit_code": 1, "stdout": "", "stderr": "nope"},
        ])
        with patch(
            "api.routers.git_branches.run_git_command",
            side_effect=lambda *args, **kwargs: next(responses),
        ):
            assert _stash_if_dirty("/path", {}) is False


class TestUnstash:
    def test_failure_appends_warning(self):
        result = {"stderr": "before"}
        with patch(
            "api.routers.git_branches.run_git_command",
            return_value={"exit_code": 1, "stdout": "", "stderr": "boom"},
        ):
            _unstash("/path", {}, result)
        assert "stash pop failed" in result["stderr"]
        assert "boom" in result["stderr"]

    def test_success_leaves_stderr_unchanged(self):
        result = {"stderr": "before"}
        with patch(
            "api.routers.git_branches.run_git_command",
            return_value={"exit_code": 0, "stdout": "", "stderr": ""},
        ):
            _unstash("/path", {}, result)
        assert result["stderr"] == "before"


class TestGitHelpersErrors:
    def test_run_raw_git_timeout(self):
        from fastapi import HTTPException
        with patch(
            "api.routers.git_helpers.run_git_raw",
            side_effect=subprocess.TimeoutExpired(cmd=["git"], timeout=1),
        ):
            with pytest.raises(HTTPException):
                run_raw_git(["status"], "/p")

    def test_run_raw_git_os_error(self):
        from fastapi import HTTPException
        with patch(
            "api.routers.git_helpers.run_git_raw",
            side_effect=OSError("boom"),
        ):
            with pytest.raises(HTTPException):
                run_raw_git(["status"], "/p")


class TestValidateJobArgs:
    def test_missing_required_raises(self):
        from fastapi import HTTPException
        job = JobDefinition(
            command="echo",
            label="t",
            description="",
            args=[ArgOption(name="x", values=[], required=True)],
        )
        with pytest.raises(HTTPException):
            _validate_job_args(job, {}, None)

    def test_missing_optional_skipped(self):
        job = JobDefinition(
            command="echo",
            label="t",
            description="",
            args=[ArgOption(name="x", values=["a", "b"], required=False)],
        )
        assert _validate_job_args(job, {}, None) == []

    def test_invalid_value_rejected(self):
        from fastapi import HTTPException
        job = JobDefinition(
            command="echo",
            label="t",
            description="",
            args=[ArgOption(name="x", values=["a", "b"], required=True)],
        )
        with pytest.raises(HTTPException):
            _validate_job_args(job, {"x": "c"}, None)

    def test_control_characters_rejected(self):
        from fastapi import HTTPException
        job = JobDefinition(
            command="echo",
            label="t",
            description="",
            args=[ArgOption(name="x", values=[], required=True)],
        )
        with pytest.raises(HTTPException):
            _validate_job_args(job, {"x": "ok\x00bad"}, None)

    def test_dynamic_branches_requires_workspace(self):
        from fastapi import HTTPException
        job = JobDefinition(
            command="echo",
            label="t",
            description="",
            args=[ArgOption(name="b", values=[], required=True, dynamic="branches")],
        )
        with pytest.raises(HTTPException):
            _validate_job_args(job, {"b": "main"}, None)

    def test_valid_value_appended(self):
        job = JobDefinition(
            command="echo",
            label="t",
            description="",
            args=[ArgOption(name="x", values=["a", "b"], required=True)],
        )
        assert _validate_job_args(job, {"x": "a"}, None) == ["a"]


class TestResolveSuggestBase:
    from pathlib import Path as _P
    from api.routers.workspaces import _resolve_suggest_base

    def test_empty_returns_home(self):
        from pathlib import Path
        from api.routers.workspaces import _resolve_suggest_base
        base, flt = _resolve_suggest_base("")
        assert base == Path.home()
        assert flt == ""

    def test_existing_dir_returns_self(self, tmp_path):
        from api.routers.workspaces import _resolve_suggest_base
        d = tmp_path / "sub"
        d.mkdir()
        base, flt = _resolve_suggest_base(str(d))
        assert base == d
        assert flt == ""

    def test_partial_path_returns_parent_and_filter(self, tmp_path):
        from api.routers.workspaces import _resolve_suggest_base
        d = tmp_path / "sub"
        d.mkdir()
        partial = str(d / "fea")
        base, flt = _resolve_suggest_base(partial)
        assert base == d
        assert flt == "fea"


class TestWorkspaceEndpoints:
    def test_workspace_order_endpoint(self, client, workspace):
        from conftest import AUTH
        res = client.put("/workspace-order", headers=AUTH, json={"order": ["test-ws"]})
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

    def test_add_workspace_empty_path_rejected(self, client):
        from conftest import AUTH
        res = client.post("/workspaces", headers=AUTH, json={"path": "  "})
        assert res.status_code == 400

    def test_add_workspace_nonexistent_path_rejected(self, client, tmp_path):
        from conftest import AUTH
        res = client.post("/workspaces", headers=AUTH, json={"path": str(tmp_path / "missing")})
        assert res.status_code == 400

    def test_add_workspace_succeeds(self, client, tmp_path):
        from conftest import AUTH
        new_dir = tmp_path / "myproj"
        new_dir.mkdir()
        res = client.post("/workspaces", headers=AUTH, json={"path": str(new_dir)})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["name"] == "myproj"

    def test_add_workspace_duplicate_name_rejected(self, client, tmp_path, workspace):
        from conftest import AUTH
        new_dir = tmp_path / "test-ws"
        new_dir.mkdir(exist_ok=True)
        res = client.post(
            "/workspaces", headers=AUTH,
            json={"path": str(new_dir), "name": "test-ws"},
        )
        assert res.status_code == 409

    def test_delete_workspace(self, client, workspace):
        from conftest import AUTH
        res = client.delete("/workspaces/test-ws", headers=AUTH)
        assert res.status_code == 200

    def test_delete_unknown_workspace_rejected(self, client):
        from conftest import AUTH
        res = client.delete("/workspaces/nonexistent", headers=AUTH)
        # ensure_workspace_exists raises bad_request when missing
        assert res.status_code in (400, 404)

    def test_suggest_endpoint_returns_entries(self, client, tmp_path):
        from conftest import AUTH
        (tmp_path / "alpha").mkdir()
        (tmp_path / "beta").mkdir()
        res = client.get(f"/workspaces/suggest?path={tmp_path}", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        names = [e["name"] for e in data["entries"]]
        assert "alpha" in names
        assert "beta" in names

    def test_suggest_endpoint_nonexistent_returns_empty(self, client, tmp_path):
        from conftest import AUTH
        missing = tmp_path / "nope" / "deeper"
        res = client.get(f"/workspaces/suggest?path={missing}", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["entries"] == []

    def test_update_workspace_config(self, client, workspace):
        from conftest import AUTH
        res = client.put(
            "/workspaces/test-ws/config", headers=AUTH,
            json={"icon": "mdi-folder", "icon_color": "#fff", "hidden": True},
        )
        assert res.status_code == 200

    def test_update_workspace_rename(self, client, workspace, tmp_path):
        from conftest import AUTH
        res = client.put(
            "/workspaces/test-ws/config", headers=AUTH,
            json={"icon": "", "icon_color": "", "hidden": False, "name": "renamed"},
        )
        assert res.status_code == 200

    def test_update_workspace_invalid_path_rejected(self, client, workspace):
        from conftest import AUTH
        res = client.put(
            "/workspaces/test-ws/config", headers=AUTH,
            json={"icon": "", "icon_color": "", "hidden": False, "path": "/no/such/dir"},
        )
        assert res.status_code == 400


class TestSettingsImport:
    def test_invalid_json_rejected(self, client):
        from conftest import AUTH
        res = client.post(
            "/settings/import", headers={**AUTH, "Content-Type": "application/json"},
            content=b"not json",
        )
        assert res.status_code == 400

    def test_non_object_rejected(self, client):
        from conftest import AUTH
        res = client.post(
            "/settings/import", headers={**AUTH, "Content-Type": "application/json"},
            content=b'["not", "object"]',
        )
        assert res.status_code == 400

    def test_empty_object_accepted(self, client):
        from conftest import AUTH
        res = client.post(
            "/settings/import", headers={**AUTH, "Content-Type": "application/json"},
            content=b"{}",
        )
        assert res.status_code == 200

    def test_global_section_merged(self, client):
        from conftest import AUTH
        body = b'{"__global__": {"workspace_order": ["a", "b"]}}'
        res = client.post(
            "/settings/import", headers={**AUTH, "Content-Type": "application/json"},
            content=body,
        )
        assert res.status_code == 200


class TestRecentJobsEndpoint:
    def test_get_empty(self, client):
        from conftest import AUTH
        res = client.get("/recent-jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"jobs": []}

    def test_post_and_retrieve(self, client):
        from conftest import AUTH
        item = {
            "key": "k1", "workspace": "ws", "wsIcon": "", "wsIconColor": "",
            "jobName": "j1", "jobLabel": "", "jobIcon": "", "jobIconColor": "",
            "jobCommand": "echo hi", "jobConfirm": False, "jobHiddenTab": False,
        }
        res = client.post("/recent-jobs", headers=AUTH, json=item)
        assert res.status_code == 200
        assert res.json()["jobs"][0]["key"] == "k1"

    def test_post_deduplicates_same_key(self, client):
        from conftest import AUTH
        item = {
            "key": "k1", "workspace": "ws", "wsIcon": "", "wsIconColor": "",
            "jobName": "j1", "jobLabel": "", "jobIcon": "", "jobIconColor": "",
            "jobCommand": "echo hi", "jobConfirm": False, "jobHiddenTab": False,
        }
        client.post("/recent-jobs", headers=AUTH, json=item)
        client.post("/recent-jobs", headers=AUTH, json=item)
        res = client.get("/recent-jobs", headers=AUTH)
        assert len([j for j in res.json()["jobs"] if j["key"] == "k1"]) == 1


class TestSnippetsEndpoint:
    def test_get_empty(self, client):
        from conftest import AUTH
        res = client.get("/snippets", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"snippets": []}

    def test_put_persists_snippets(self, client):
        from conftest import AUTH
        body = {"snippets": [{"label": "ls", "command": "ls -la"}]}
        res = client.put("/snippets", headers=AUTH, json=body)
        assert res.status_code == 200
        assert res.json()["snippets"][0]["command"] == "ls -la"

    def test_put_drops_blank_commands(self, client):
        from conftest import AUTH
        body = {"snippets": [{"label": "x", "command": "   "}, {"label": "y", "command": "echo y"}]}
        res = client.put("/snippets", headers=AUTH, json=body)
        assert res.status_code == 200
        assert len(res.json()["snippets"]) == 1
        assert res.json()["snippets"][0]["command"] == "echo y"

    def test_put_uses_command_preview_when_label_missing(self, client):
        from conftest import AUTH
        body = {"snippets": [{"label": "", "command": "long_command_text_here"}]}
        res = client.put("/snippets", headers=AUTH, json=body)
        assert res.status_code == 200
        assert res.json()["snippets"][0]["label"]


class TestJobsEndpoints:
    def test_get_unknown_workspace_job_404(self, client, workspace):
        from conftest import AUTH
        res = client.get("/workspaces/test-ws/jobs/nonexistent", headers=AUTH)
        assert res.status_code == 404


class TestSystemInfoEndpoint:
    def test_returns_minimal_info(self, client):
        from conftest import AUTH
        res = client.get("/system/info", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "hostname" in data
        assert "user" in data
        assert "work_dir" in data


class TestWorkspaceConfigUpdateConflicts:
    def test_rename_to_existing_name_conflicts(self, client, tmp_path, workspace):
        from conftest import AUTH
        # Register a second workspace
        other = tmp_path / "other"
        other.mkdir()
        client.post("/workspaces", headers=AUTH, json={"path": str(other), "name": "other"})
        # Attempt to rename test-ws to "other"
        res = client.put(
            "/workspaces/test-ws/config", headers=AUTH,
            json={"icon": "", "icon_color": "", "hidden": False, "name": "other"},
        )
        assert res.status_code == 409

    def test_change_path_to_used_path_conflicts(self, client, tmp_path, workspace):
        from conftest import AUTH
        other = tmp_path / "other"
        other.mkdir()
        client.post("/workspaces", headers=AUTH, json={"path": str(other), "name": "other"})
        res = client.put(
            "/workspaces/test-ws/config", headers=AUTH,
            json={"icon": "", "icon_color": "", "hidden": False, "path": str(other)},
        )
        assert res.status_code == 409

    def test_update_with_empty_path_rejected(self, client, workspace):
        from conftest import AUTH
        res = client.put(
            "/workspaces/test-ws/config", headers=AUTH,
            json={"icon": "", "icon_color": "", "hidden": False, "path": "   "},
        )
        assert res.status_code == 400


class TestSettingsAuthEndpoint:
    def test_enabled_without_token_rejected(self, client):
        from conftest import AUTH
        res = client.put("/settings/auth", headers=AUTH, json={"enabled": True, "token": ""})
        assert res.status_code == 400

    def test_get_auth_status(self, client):
        from conftest import AUTH
        res = client.get("/settings/auth", headers=AUTH)
        assert res.status_code == 200
        assert "auth_required" in res.json()
