import json
import os

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
    import api.main as main_mod

    monkeypatch.setattr(common_mod, "WORK_DIR", work)
    monkeypatch.setattr(common_mod, "CONFIG_DIR", data)
    monkeypatch.setattr(common_mod, "CONFIG_FILE", config_file)
    monkeypatch.setattr(main_mod, "WORK_DIR", work)

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


# --- リンクCRUD ---


class TestLinksCRUD:
    def test_list_empty(self, workspace):
        res = client.get("/workspaces/test-ws/links", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == []

    def test_create_and_list(self, workspace):
        res = client.post("/workspaces/test-ws/links", headers=AUTH, json={
            "label": "Google",
            "url": "https://google.com",
        })
        assert res.status_code == 200
        links = client.get("/workspaces/test-ws/links", headers=AUTH).json()
        assert len(links) == 1
        assert links[0]["label"] == "Google"
        assert links[0]["url"] == "https://google.com"

    def test_url_normalization(self, workspace):
        client.post("/workspaces/test-ws/links", headers=AUTH, json={
            "url": "example.com",
        })
        links = client.get("/workspaces/test-ws/links", headers=AUTH).json()
        assert links[0]["url"] == "http://example.com"

    def test_update_link(self, workspace):
        client.post("/workspaces/test-ws/links", headers=AUTH, json={
            "label": "Old",
            "url": "https://old.com",
        })
        res = client.put("/workspaces/test-ws/links/0", headers=AUTH, json={
            "label": "New",
            "url": "https://new.com",
        })
        assert res.status_code == 200
        links = client.get("/workspaces/test-ws/links", headers=AUTH).json()
        assert links[0]["label"] == "New"

    def test_update_invalid_index(self, workspace):
        res = client.put("/workspaces/test-ws/links/99", headers=AUTH, json={
            "label": "x",
            "url": "https://x.com",
        })
        assert res.status_code == 404

    def test_delete_link(self, workspace):
        client.post("/workspaces/test-ws/links", headers=AUTH, json={
            "label": "Del",
            "url": "https://del.com",
        })
        res = client.delete("/workspaces/test-ws/links/0", headers=AUTH)
        assert res.status_code == 200
        links = client.get("/workspaces/test-ws/links", headers=AUTH).json()
        assert len(links) == 0

    def test_delete_invalid_index(self, workspace):
        res = client.delete("/workspaces/test-ws/links/0", headers=AUTH)
        assert res.status_code == 404


# --- ユーティリティ ---


class TestUtils:
    def test_validate_commit_hash_valid(self):
        from api.common import validate_commit_hash

        assert validate_commit_hash("abcd") == "abcd"
        assert validate_commit_hash("a" * 40) == "a" * 40

    def test_validate_commit_hash_invalid(self):
        from api.common import validate_commit_hash
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            validate_commit_hash("xyz")
        assert exc_info.value.status_code == 400

        with pytest.raises(HTTPException):
            validate_commit_hash("abc")

        with pytest.raises(HTTPException):
            validate_commit_hash("ABCD")

    def test_normalize_url(self):
        from api.routers.jobs import normalize_url

        assert normalize_url("https://example.com") == "https://example.com"
        assert normalize_url("http://example.com") == "http://example.com"
        assert normalize_url("example.com") == "http://example.com"
        assert normalize_url("  https://x.com  ") == "https://x.com"

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
