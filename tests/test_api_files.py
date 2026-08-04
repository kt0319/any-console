import os
import subprocess

import pytest

from conftest import AUTH


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

    @pytest.mark.skipif(os.geteuid() == 0, reason="root には chmod による書き込み禁止が効かないため")
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

    @pytest.mark.skipif(os.geteuid() == 0, reason="root には chmod による書き込み禁止が効かないため")
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

    def test_upload_creates_missing_subdir(self, client, workspace):
        # フォルダドロップアップロード: サブディレクトリが無ければ作成してから書き込む
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": "new/nested"},
            files={"file": ("note.txt", b"data", "text/plain")},
        )
        assert res.status_code == 200
        assert res.json()["path"] == "new/nested/note.txt"
        assert (workspace / "new" / "nested" / "note.txt").read_bytes() == b"data"

    def test_upload_path_exists_as_file_returns_400(self, client, workspace):
        (workspace / "notadir").write_text("x", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": "notadir"},
            files={"file": ("note.txt", b"data", "text/plain")},
        )
        assert res.status_code == 400

    def test_upload_existing_file_returns_409(self, client, workspace):
        (workspace / "exists.txt").write_text("old", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": ""},
            files={"file": ("exists.txt", b"new", "text/plain")},
        )
        assert res.status_code == 409

    def test_upload_overwrite_replaces_existing(self, client, workspace):
        (workspace / "exists.txt").write_text("old", encoding="utf-8")
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": "", "overwrite": "true"},
            files={"file": ("exists.txt", b"new", "text/plain")},
        )
        assert res.status_code == 200
        assert (workspace / "exists.txt").read_text(encoding="utf-8") == "new"

    def test_upload_overwrite_rejects_directory(self, client, workspace):
        (workspace / "exists").mkdir()
        res = client.post(
            "/workspaces/test-ws/upload",
            headers=AUTH,
            data={"path": "", "overwrite": "true"},
            files={"file": ("exists", b"new", "text/plain")},
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

    @pytest.mark.skipif(os.geteuid() == 0, reason="root には chmod による書き込み禁止が効かないため")
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
