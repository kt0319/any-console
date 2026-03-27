import json
import subprocess

import pytest

from conftest import AUTH


# --- 認証 ---


class TestAuth:
    def test_valid_token(self, client):
        res = client.get("/auth/check", headers=AUTH)
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

    def test_missing_token(self, client):
        res = client.get("/auth/check")
        assert res.status_code == 401

    def test_invalid_token(self, client):
        res = client.get("/auth/check", headers={"Authorization": "Bearer wrong"})
        assert res.status_code == 401


# --- 設定エクスポート/インポート ---


class TestSettings:
    def test_export_empty(self, client):
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_export_filters_existing_workspaces(self, client, workspace, isolate_fs):
        config = {"test-ws": {"icon": "star"}, "nonexistent": {"icon": "x"}}
        isolate_fs["config_file"].write_text(json.dumps(config))
        res = client.get("/settings/export", headers=AUTH)
        data = res.json()
        assert "test-ws" in data
        assert "nonexistent" not in data

    def test_import_settings(self, client, workspace, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"icon": "rocket"}})
        assert res.status_code == 200
        config = json.loads(isolate_fs["config_file"].read_text())
        assert config["test-ws"]["icon"] == "rocket"

    def test_import_invalid_json(self, client):
        res = client.post(
            "/settings/import",
            headers={**AUTH, "Content-Type": "application/json"},
            content="not json",
        )
        assert res.status_code == 400

    def test_import_non_dict(self, client):
        res = client.post("/settings/import", headers=AUTH, json=[1, 2, 3])
        assert res.status_code == 400

    def test_import_ignores_nonexistent_workspace(self, client, isolate_fs):
        res = client.post("/settings/import", headers=AUTH, json={"ghost": {"icon": "x"}})
        assert res.status_code == 200
        if isolate_fs["config_file"].exists():
            config = json.loads(isolate_fs["config_file"].read_text())
            assert "ghost" not in config

    def test_import_rejects_invalid_workspace_schema(self, client, workspace):
        res = client.post("/settings/import", headers=AUTH, json={"test-ws": {"jobs": {"bad": {}}}})
        assert res.status_code == 400

    def test_export_skips_invalid_workspace_config(self, client, workspace, isolate_fs):
        isolate_fs["config_file"].write_text(json.dumps({"test-ws": {"jobs": {"bad": {}}}}))
        res = client.get("/settings/export", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}


# --- ジョブCRUD ---


class TestJobsCRUD:
    def test_list_all_workspace_jobs(self, client, workspace, isolate_fs):
        second = isolate_fs["work"] / "second-ws"
        second.mkdir()
        config = json.loads(isolate_fs["config_file"].read_text(encoding="utf-8"))
        config["second-ws"] = {"path": str(second)}
        isolate_fs["config_file"].write_text(json.dumps(config), encoding="utf-8")

        first_job = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "hello",
            "command": "echo hello",
        }).json()["name"]
        second_job = client.post("/workspaces/second-ws/jobs", headers=AUTH, json={
            "label": "bye",
            "command": "echo bye",
            "terminal": False,
        }).json()["name"]

        res = client.get("/jobs/workspaces", headers=AUTH)

        assert res.status_code == 200
        data = res.json()
        assert data["test-ws"][first_job]["command"] == "echo hello"
        assert data["second-ws"][second_job]["command"] == "echo bye"
        assert data["second-ws"][second_job]["terminal"] is False

    def test_list_empty(self, client, workspace):
        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_create_and_list(self, client, workspace):
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

    def test_create_requires_label(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "command": "echo 1",
        })
        assert res.status_code == 422

    def test_create_empty_label(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "  ",
            "command": "echo x",
        })
        assert res.status_code == 400

    def test_create_empty_command(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "empty",
            "command": "  ",
        })
        assert res.status_code == 400

    def test_update_job(self, client, workspace):
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

    def test_update_nonexistent(self, client, workspace):
        res = client.put("/workspaces/test-ws/jobs/ghost", headers=AUTH, json={
            "label": "ghost",
            "command": "echo x",
        })
        assert res.status_code == 404

    def test_delete_job(self, client, workspace):
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

    def test_delete_nonexistent(self, client, workspace):
        res = client.delete("/workspaces/test-ws/jobs/ghost", headers=AUTH)
        assert res.status_code == 404

    def test_reorder_jobs(self, client, workspace):
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

    def test_reorder_jobs_rejects_missing_items(self, client, workspace):
        first = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        })

        res = client.put("/workspaces/test-ws/job-order", headers=AUTH, json={
            "order": [first],
        })
        assert res.status_code == 400

    def test_create_with_icon(self, client, workspace):
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

    def test_nonexistent_workspace(self, client):
        res = client.get("/workspaces/no-such-ws/jobs", headers=AUTH)
        assert res.status_code == 400


class TestGlobalJobsCRUD:
    def test_list_empty(self, client):
        res = client.get("/global/jobs", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {}

    def test_create_and_list(self, client):
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "hello",
            "command": "echo hello",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        assert job_name.startswith("job_")

        res = client.get("/global/jobs", headers=AUTH)
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["command"] == "echo hello"
        assert jobs[job_name]["label"] == "hello"

    def test_create_requires_label(self, client):
        res = client.post("/global/jobs", headers=AUTH, json={
            "command": "echo 1",
        })
        assert res.status_code == 422

    def test_create_empty_label(self, client):
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "  ",
            "command": "echo x",
        })
        assert res.status_code == 400

    def test_create_empty_command(self, client):
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "empty",
            "command": "  ",
        })
        assert res.status_code == 400

    def test_update_job(self, client):
        create_res = client.post("/global/jobs", headers=AUTH, json={
            "label": "upd",
            "command": "echo old",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.put(f"/global/jobs/{job_name}", headers=AUTH, json={
            "label": "upd",
            "command": "echo new",
        })
        assert res.status_code == 200

        res = client.get("/global/jobs", headers=AUTH)
        assert res.json()[job_name]["command"] == "echo new"

    def test_update_nonexistent(self, client):
        res = client.put("/global/jobs/ghost", headers=AUTH, json={
            "label": "ghost",
            "command": "echo x",
        })
        assert res.status_code == 404

    def test_delete_job(self, client):
        create_res = client.post("/global/jobs", headers=AUTH, json={
            "label": "del",
            "command": "echo del",
        })
        assert create_res.status_code == 200
        job_name = create_res.json()["name"]

        res = client.delete(f"/global/jobs/{job_name}", headers=AUTH)
        assert res.status_code == 200

        res = client.get("/global/jobs", headers=AUTH)
        assert job_name not in res.json()

    def test_delete_nonexistent(self, client):
        res = client.delete("/global/jobs/ghost", headers=AUTH)
        assert res.status_code == 404

    def test_reorder_jobs(self, client):
        first = client.post("/global/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        second = client.post("/global/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        }).json()["name"]
        third = client.post("/global/jobs", headers=AUTH, json={
            "label": "third",
            "command": "echo third",
        }).json()["name"]

        res = client.put("/global/job-order", headers=AUTH, json={
            "order": [third, first, second],
        })
        assert res.status_code == 200

        jobs = client.get("/global/jobs", headers=AUTH).json()
        assert list(jobs.keys()) == [third, first, second]

    def test_reorder_rejects_missing_items(self, client):
        first = client.post("/global/jobs", headers=AUTH, json={
            "label": "first",
            "command": "echo first",
        }).json()["name"]
        client.post("/global/jobs", headers=AUTH, json={
            "label": "second",
            "command": "echo second",
        })

        res = client.put("/global/job-order", headers=AUTH, json={
            "order": [first],
        })
        assert res.status_code == 400

    def test_create_with_icon(self, client):
        res = client.post("/global/jobs", headers=AUTH, json={
            "label": "iconic",
            "command": "echo x",
            "icon": "mdi-star",
            "icon_color": "#ff0000",
            "confirm": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        jobs = client.get("/global/jobs", headers=AUTH).json()
        assert jobs[job_name]["icon"] == "mdi-star"
        assert jobs[job_name]["icon_color"] == "#ff0000"
        assert jobs[job_name]["confirm"] is False

    def test_global_jobs_appear_in_workspace(self, client, workspace):
        create_res = client.post("/global/jobs", headers=AUTH, json={
            "label": "global task",
            "command": "echo global",
        })
        job_name = create_res.json()["name"]

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        assert res.status_code == 200
        jobs = res.json()
        assert job_name in jobs
        assert jobs[job_name]["command"] == "echo global"
        assert jobs[job_name]["global"] is True

    def test_workspace_job_overrides_global(self, client, workspace, isolate_fs):
        global_res = client.post("/global/jobs", headers=AUTH, json={
            "label": "shared",
            "command": "echo global",
        })
        global_job_name = global_res.json()["name"]

        config = json.loads(isolate_fs["config_file"].read_text(encoding="utf-8"))
        config["test-ws"].setdefault("jobs", {})[global_job_name] = {
            "label": "shared",
            "command": "echo workspace",
        }
        isolate_fs["config_file"].write_text(json.dumps(config), encoding="utf-8")

        res = client.get("/workspaces/test-ws/jobs", headers=AUTH)
        jobs = res.json()
        assert jobs[global_job_name]["command"] == "echo workspace"
        assert jobs[global_job_name]["global"] is False

    def test_all_workspace_jobs_includes_global(self, client, workspace):
        create_res = client.post("/global/jobs", headers=AUTH, json={
            "label": "global for all",
            "command": "echo global",
        })
        job_name = create_res.json()["name"]

        res = client.get("/jobs/workspaces", headers=AUTH)
        assert res.status_code == 200
        data = res.json()
        assert "test-ws" in data
        assert job_name in data["test-ws"]
        assert data["test-ws"][job_name]["global"] is True


class TestFileContent:
    def test_image_file_returns_data_url(self, client, workspace):
        img = workspace / "icon.png"
        img.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00")

        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "icon.png"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["image"] is True
        assert data["data_url"].startswith("data:image/png;base64,")

    def test_large_image_returns_too_large(self, client, workspace):
        large = workspace / "large.png"
        large.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024))

        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "large.png"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["image"] is True
        assert data["too_large"] is True

    def test_non_image_binary_returns_binary_flag(self, client, workspace):
        binary = workspace / "archive.zip"
        binary.write_bytes(b"PK\x03\x04\x00\x00")

        res = client.get("/workspaces/test-ws/file-content", headers=AUTH, params={"path": "archive.zip"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["binary"] is True

    def test_file_content_can_read_past_commit(self, client, workspace):
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
    def test_list_includes_symlink(self, client, workspace):
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

    def test_list_can_read_past_commit_tree(self, client, workspace):
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


class TestFileOperations:
    def test_rename_file(self, client, workspace):
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

    def test_rename_to_existing_returns_409(self, client, workspace):
        (workspace / "a.txt").write_text("a", encoding="utf-8")
        (workspace / "b.txt").write_text("b", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "a.txt", "dest": "b.txt"},
        )
        assert res.status_code == 409

    def test_rename_nonexistent_returns_404(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/rename",
            headers=AUTH,
            json={"src": "missing.txt", "dest": "new.txt"},
        )
        assert res.status_code == 404

    def test_move_file_to_subdir(self, client, workspace):
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

    def test_rename_directory(self, client, workspace):
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

    def test_delete_file(self, client, workspace):
        (workspace / "delete-me.txt").write_text("bye", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "delete-me.txt"},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert not (workspace / "delete-me.txt").exists()

    def test_delete_nonexistent_returns_404(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/delete-file",
            headers=AUTH,
            json={"path": "no-such.txt"},
        )
        assert res.status_code == 404

    def test_delete_directory(self, client, workspace):
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

    def test_rename_permission_denied_returns_403(self, client, workspace):
        readonly = workspace / "locked"
        readonly.mkdir()
        (readonly / "a.txt").write_text("a", encoding="utf-8")
        readonly.chmod(0o555)
        try:
            res = client.post(
                "/workspaces/test-ws/rename",
                headers=AUTH,
                json={"src": "locked/a.txt", "dest": "locked/b.txt"},
            )
            assert res.status_code == 403
        finally:
            readonly.chmod(0o755)

    def test_delete_permission_denied_returns_403(self, client, workspace):
        readonly = workspace / "locked2"
        readonly.mkdir()
        (readonly / "a.txt").write_text("a", encoding="utf-8")
        readonly.chmod(0o555)
        try:
            res = client.post(
                "/workspaces/test-ws/delete-file",
                headers=AUTH,
                json={"path": "locked2/a.txt"},
            )
            assert res.status_code == 403
        finally:
            readonly.chmod(0o755)


class TestFileUpload:
    def test_upload_success(self, client, workspace):
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": ""},
            files={"file": ("hello.txt", b"hello world", "text/plain")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["path"] == "hello.txt"
        assert data["size"] == 11
        assert (workspace / "hello.txt").read_bytes() == b"hello world"

    def test_upload_to_subdir(self, client, workspace):
        sub = workspace / "docs"
        sub.mkdir()
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": "docs"},
            files={"file": ("note.txt", b"data", "text/plain")},
        )
        assert res.status_code == 200
        assert res.json()["path"] == "docs/note.txt"
        assert (sub / "note.txt").read_bytes() == b"data"

    def test_upload_existing_file_returns_409(self, client, workspace):
        (workspace / "exists.txt").write_text("old", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": ""},
            files={"file": ("exists.txt", b"new", "text/plain")},
        )
        assert res.status_code == 409

    @pytest.mark.parametrize("filename", [".", "..", "a/b", "a\\b"])
    def test_upload_invalid_filename_returns_400(self, client, workspace, filename):
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": ""},
            files={"file": (filename, b"data", "text/plain")},
        )
        assert res.status_code == 400

    def test_upload_too_large_returns_413(self, client, workspace, monkeypatch):
        import api.routers.git_files as git_files_mod
        monkeypatch.setattr(git_files_mod, "MAX_UPLOAD_SIZE", 10)
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": ""},
            files={"file": ("big.txt", b"x" * 20, "text/plain")},
        )
        assert res.status_code == 413

    def test_upload_permission_denied_returns_403(self, client, workspace):
        readonly = workspace / "locked"
        readonly.mkdir()
        readonly.chmod(0o555)
        try:
            res = client.post(
                "/workspaces/test-ws/upload",
                headers=AUTH,
                data={"path": "locked"},
                files={"file": ("new.txt", b"data", "text/plain")},
            )
            assert res.status_code == 403
        finally:
            readonly.chmod(0o755)


class TestFileDownload:
    def test_download_success(self, client, workspace):
        (workspace / "dl.txt").write_text("content", encoding="utf-8")
        res = client.get(
            "/workspaces/test-ws/download",
            headers=AUTH,
            params={"path": "dl.txt"},
        )
        assert res.status_code == 200
        assert res.content == b"content"
        assert "dl.txt" in res.headers.get("content-disposition", "")

    def test_download_nonexistent_returns_404(self, client, workspace):
        res = client.get(
            "/workspaces/test-ws/download",
            headers=AUTH,
            params={"path": "missing.txt"},
        )
        assert res.status_code == 404

    def test_download_directory_returns_404(self, client, workspace):
        (workspace / "subdir").mkdir()
        res = client.get(
            "/workspaces/test-ws/download",
            headers=AUTH,
            params={"path": "subdir"},
        )
        assert res.status_code == 404


# --- ユーティリティ ---


class TestUtils:
    def test_validate_commit_hash_valid(self):
        from api.validators import validate_commit_hash

        assert validate_commit_hash("abcd") == "abcd"
        assert validate_commit_hash("a" * 40) == "a" * 40

    def test_validate_commit_hash_invalid(self):
        from api.validators import validate_commit_hash
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
