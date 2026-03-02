import json
import os
import subprocess

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("PI_CONSOLE_TOKEN", "test-token")

from api.main import app

TOKEN = os.environ["PI_CONSOLE_TOKEN"]
AUTH = {"Authorization": f"Bearer {TOKEN}"}

client = TestClient(app)


# --- fixtures ---


@pytest.fixture(autouse=True)
def isolate_fs(tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    data = tmp_path / "data"
    data.mkdir()
    config_file = data / "config.json"

    import api.common as common_mod
    import api.config as config_mod
    import api.main as main_mod
    import api.routers.settings as settings_mod

    monkeypatch.setattr(common_mod, "WORK_DIR", work)
    monkeypatch.setattr(common_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(config_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(main_mod, "WORK_DIR", work)
    monkeypatch.setattr(settings_mod, "WORK_DIR", work)

    return {"work": work, "data": data, "config_file": config_file}


@pytest.fixture()
def workspace(isolate_fs):
    ws = isolate_fs["work"] / "test-ws"
    ws.mkdir()
    return ws


# --- 認証 ---


class TestAuth:
    def test_valid_token(self):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["ok"] is True

    def test_missing_token(self):
        res = client.get("/auth/check")
        assert res.status_code == 401

    def test_invalid_token(self):
        res = client.get("/auth/check", headers={"Authorization": "Bearer wrong"})
        assert res.status_code == 401


# --- 設定エクスポート/インポート ---


class TestSettings:
    def test_export_empty(self):
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_export_filters_existing_workspaces(self, workspace, isolate_fs):
        config = {"test-ws": {"icon": "star"}, "nonexistent": {"icon": "x"}}
        isolate_fs["config_file"].write_text(json.dumps(config))
        res = client.get("/settings/export", headers=AUTH)
        data = res.json()
        assert "test-ws" in data
        assert "nonexistent" not in data

    def test_import_settings(self, workspace, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"icon": "rocket"}})
        assert res.status_code == 200
        config = json.loads(isolate_fs["config_file"].read_text())
        assert config["test-ws"]["icon"] == "rocket"

    def test_import_invalid_json(self):
        res = client.post(
            "/settings/import",
            headers={**AUTH, "Content-Type": "application/json"},
            content="not json",
        )
        assert res.status_code == 400

    def test_import_non_dict(self):
        res = client.post("/settings/import", headers=AUTH, json=[1, 2, 3])
        assert res.status_code == 400

    def test_import_ignores_nonexistent_workspace(self, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"ghost": {"icon": "x"}})
        assert res.status_code == 200
        if isolate_fs["config_file"].exists():
            config = json.loads(isolate_fs["config_file"].read_text())
            assert "ghost" not in config

    def test_import_rejects_invalid_workspace_schema(self, workspace):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"jobs": {"bad": {}}}})
        assert res.status_code == 400

    def test_export_skips_invalid_workspace_config(self, workspace, isolate_fs):
        isolate_fs["config_file"].write_text(json.dumps({"test-ws": {"jobs": {"bad": {}}}}))
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}


# --- ジョブCRUD ---


class TestJobsCRUD:
    def test_list_empty(self, workspace):
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_create_and_list(self, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "hello",
            "command": "echo hello",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        assert job_name.startswith("job_")

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["command"] == "echo hello"
        assert jobs[job_name]["label"] == "hello"

    def test_create_requires_label(self, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "command": "echo 1",
        })
        assert res.status_code == 422

    def test_create_empty_label(self, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "  ",
            "command": "echo x",
        })
        assert res.status_code == 400

    def test_create_empty_command(self, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "empty",
            "command": "  ",
        })
        assert res.status_code == 400

    def test_update_job(self, workspace):
        create_res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "upd",
            "command": "echo old",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.put(f"/workspaces/test-ws/jobs/{job_name}", headers=AUTH, json={
            "label": "upd",
            "command": "echo new",
        })
        assert res.status_code == 200

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.json()[job_name]["command"] == "echo new"

    def test_update_nonexistent(self, workspace):
        res = client.put("/workspaces/test-ws/jobs/ghost", headers=AUTH, json={
            "label": "ghost",
            "command": "echo x",
        })
        assert res.status_code == 404

    def test_delete_job(self, workspace):
        create_res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "del",
            "command": "echo del",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.delete(f"/workspaces/test-ws/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert job_name not in res.json()

    def test_delete_nonexistent(self, workspace):
        res = client.delete("/workspaces/test-ws/jobs/ghost", headers=AUTH)
        assert res.status_code == 404

    def test_reorder_jobs(self, workspace):
        first = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        second = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        }).json()["name"]
        third = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "third",
            "command": "echo third",
        }).json()["name"]

        res = client.put("/workspaces/test-ws/job-order", headers=AUTH, json={
            "order": [third, first, second],
        })
        assert res.status_code == 200

        jobs = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        assert list(jobs.keys()) == [third, first, second]

    def test_reorder_jobs_rejects_missing_items(self, workspace):
        first = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        second = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        }).json()["name"]

        res = client.put("/workspaces/test-ws/job-order", headers=AUTH, json={
            "order": [first],
        })
        assert res.status_code == 400

    def test_create_with_icon(self, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "iconic",
            "command": "echo x",
            "icon": "mdi-star",
            "icon_color": "#ff0000",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        jobs = client.get("/workspaces/test-ws/jobs", headers=AUTH).json()
        assert jobs[job_name]["icon"] == "mdi-star"
        assert jobs[job_name]["icon_color"] == "#ff0000"
        assert jobs[job_name]["confirm"] is False

    def test_nonexistent_workspace(self):
        res = client.get("/workspaces/no-such-ws/jobs", headers=AUTH)
        assert res.status_code == 400

class TestFileContent:
    def test_image_file_returns_data_url(self, workspace):
        img = workspace / "icon.png"
        img.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00")

        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "icon.png"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["image"] is True
        assert data["data_url"].startswith("data:image/png;base64,")

    def test_large_image_returns_too_large(self, workspace):
        large = workspace / "large.png"
        large.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024))

        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "large.png"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["image"] is True
        assert data["too_large"] is True

    def test_non_image_binary_returns_binary_flag(self, workspace):
        binary = workspace / "archive.zip"
        binary.write_bytes(b"PK\x03\x04\x00\x00")

        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "archive.zip"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["binary"] is True

    def test_file_content_can_read_past_commit(self, workspace):
        subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True, text=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=workspace, check=True, capture_output=True, text=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=workspace, check=True, capture_output=True, text=True)
        target = workspace / "note.txt"
        target.write_text("old\n", encoding="utf-8")
        subprocess.run(["git", "add", "note.txt"], cwd=workspace, check=True, capture_output=True, text=True)
        subprocess.run(["git", "commit", "-m", "first"], cwd=workspace, check=True, capture_output=True, text=True)
        first_hash = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=workspace, check=True, capture_output=True, text=True,
        ).stdout.strip()

        target.write_text("new\n", encoding="utf-8")

        res = client.get(
            "/workspaces/test-ws/file-content",
            headers=AUTH,
            params={"path": "note.txt", "ref": first_hash},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["content"] == "old\n"


class TestFilesList:
    def test_list_includes_symlink(self, workspace):
        target = workspace / "target.txt"
        target.write_text("hello", encoding="utf-8")
        link = workspace / "target-link.txt"
        try:
            link.symlink_to(target)
        except (NotImplementedError, OSError):
            pytest.skip("symlink is not supported in this environment")

        res = client.get("/workspaces/test-ws/files", headers=AUTH, params={"path": ""})
        assert res.status_code == 200
        data = res.json()
        entries = {e["name"]: e for e in data["entries"]}
        assert "target-link.txt" in entries
        link_entry = entries["target-link.txt"]
        assert link_entry["type"] == "symlink"
        assert link_entry["target_type"] == "file"
        assert link_entry["target_path"] == "target.txt"

    def test_list_can_read_past_commit_tree(self, workspace):
        subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True, text=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=workspace, check=True, capture_output=True, text=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=workspace, check=True, capture_output=True, text=True)
        subdir = workspace / "docs"
        subdir.mkdir()
        (subdir / "a.txt").write_text("hello\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=workspace, check=True, capture_output=True, text=True)
        subprocess.run(["git", "commit", "-m", "first"], cwd=workspace, check=True, capture_output=True, text=True)
        first_hash = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=workspace, check=True, capture_output=True, text=True,
        ).stdout.strip()

        res = client.get("/workspaces/test-ws/files", headers=AUTH, params={"path": "", "ref": first_hash})
        assert res.status_code == 200
        data = res.json()
        entries = {e["name"]: e for e in data["entries"]}
        assert entries["docs"]["type"] == "dir"


class TestRenameFile:
    def test_rename_file(self, workspace):
        (workspace / "old.txt").write_text("hello", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "old.txt", "dest": "new.txt"},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert not (workspace / "old.txt").exists()
        assert (workspace / "new.txt").read_text(encoding="utf-8") == "hello"

    def test_rename_to_existing_returns_409(self, workspace):
        (workspace / "a.txt").write_text("a", encoding="utf-8")
        (workspace / "b.txt").write_text("b", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "a.txt", "dest": "b.txt"},
        )
        assert res.status_code == 409

    def test_rename_nonexistent_returns_404(self, workspace):
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "missing.txt", "dest": "new.txt"},
        )
        assert res.status_code == 404

    def test_move_file_to_subdir(self, workspace):
        (workspace / "file.txt").write_text("data", encoding="utf-8")
        sub = workspace / "sub"
        sub.mkdir()
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "file.txt", "dest": "sub/file.txt"},
        )
        assert res.status_code == 200
        assert (sub / "file.txt").read_text(encoding="utf-8") == "data"

    def test_rename_directory(self, workspace):
        d = workspace / "olddir"
        d.mkdir()
        (d / "f.txt").write_text("x", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "olddir", "dest": "newdir"},
        )
        assert res.status_code == 200
        assert (workspace / "newdir" / "f.txt").exists()

    def test_delete_file(self, workspace):
        (workspace / "delete-me.txt").write_text("bye", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "delete-me.txt"},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert not (workspace / "delete-me.txt").exists()

    def test_delete_nonexistent_returns_404(self, workspace):
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "no-such.txt"},
        )
        assert res.status_code == 404

    def test_delete_directory(self, workspace):
        d = workspace / "rmdir"
        d.mkdir()
        (d / "f.txt").write_text("x", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "rmdir"},
        )
        assert res.status_code == 200
        assert not d.exists()


# --- ユーティリティ ---


class TestUtils:
    def test_validate_commit_hash_valid(self):
        from api.git_utils import validate_commit_hash

        assert validate_commit_hash("abcd") == "abcd"
        assert validate_commit_hash("a" * 40) == "a" * 40

    def test_validate_commit_hash_invalid(self):
        from api.git_utils import validate_commit_hash
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            validate_commit_hash("xyz")
        assert exc_info.value.status_code == 400

        with pytest.raises(HTTPException):
            validate_commit_hash("abc")

        with pytest.raises(HTTPException):
            validate_commit_hash("ABCD")

    def test_resolve_workspace_path_invalid(self):
        from api.common import resolve_workspace_path
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("../etc")
        assert exc_info.value.status_code == 400

    def test_resolve_workspace_path_not_found(self):
        from api.common import resolve_workspace_path
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            resolve_workspace_path("nonexistent")
        assert exc_info.value.status_code == 400

    def test_resolve_workspace_path_none(self):
        from api.common import resolve_workspace_path

        assert resolve_workspace_path(None) is None
        assert resolve_workspace_path("") is None
