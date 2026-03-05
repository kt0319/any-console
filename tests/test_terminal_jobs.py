import pytest

from conftest import AUTH


class TestJobExecution:
    def test_run_nonexistent_job(self, client, workspace):
        res = client.post("/run", headers=AUTH, json={
            "job": "nonexistent",
            "workspace": "test-ws",
        })
        assert res.status_code == 400

    def test_run_job_without_workspace(self, client, workspace):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "echo",
            "command": "echo hello",
            "terminal": False,
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        res = client.post("/run", headers=AUTH, json={
            "job": job_name,
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["exit_code"] == 0
        assert "hello" in data["stdout"]


class TestTerminalSession:
    def test_create_terminal_session(self, client, workspace):
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "session_id" in data
        assert data["ws_url"].startswith("/terminal/ws/")

    def test_list_sessions(self, client, workspace):
        client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })

        res = client.get("/terminal/sessions", headers=AUTH)
        assert res.status_code == 200
        sessions = res.json()
        assert len(sessions) >= 1

    def test_delete_session(self, client, workspace):
        create_res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        session_id = create_res.json()["session_id"]

        res = client.delete(f"/terminal/sessions/{session_id}", headers=AUTH)
        assert res.status_code == 200

    def test_delete_nonexistent_session(self, client):
        res = client.delete("/terminal/sessions/nonexistent", headers=AUTH)
        assert res.status_code == 404


class TestSessionLimit:
    def test_session_limit_exceeded(self, client, workspace, monkeypatch):
        import api.common as common_mod
        monkeypatch.setattr(common_mod, "MAX_TERMINAL_SESSIONS", 2)

        import api.routers.jobs as jobs_mod
        monkeypatch.setattr(jobs_mod, "MAX_TERMINAL_SESSIONS", 2)

        for _ in range(2):
            res = client.post("/run", headers=AUTH, json={
                "job": "terminal",
                "workspace": "test-ws",
            })
            assert res.status_code == 200

        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        assert res.status_code == 429
