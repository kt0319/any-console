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


class TestTerminalSessionMetadata:
    def test_session_metadata(self, client, workspace):
        """POST /run で作成後、GET /terminal/sessions にメタデータ反映"""
        res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
            "icon": "mdi-console",
            "icon_color": "#ff0000",
            "job_name": "my_job",
            "job_label": "My Job",
        })
        assert res.status_code == 200
        session_id = res.json()["session_id"]

        sessions_res = client.get("/terminal/sessions", headers=AUTH)
        assert sessions_res.status_code == 200
        sessions = sessions_res.json()
        matched = [s for s in sessions if s["session_id"] == session_id]
        assert len(matched) == 1
        assert matched[0]["workspace"] == "test-ws"
        assert matched[0]["icon"] == "mdi-console"
        assert matched[0]["icon_color"] == "#ff0000"
        assert matched[0]["job_name"] == "my_job"
        assert matched[0]["job_label"] == "My Job"

    def test_buffer_nonexistent(self, client):
        """存在しないセッション → 404"""
        res = client.get("/terminal/sessions/nonexistent-xxx/buffer", headers=AUTH)
        assert res.status_code == 404

    def test_buffer_success(self, client, workspace, monkeypatch):
        """正常系バッファ取得（tmux capture-pane モック）"""
        create_res = client.post("/run", headers=AUTH, json={
            "job": "terminal",
            "workspace": "test-ws",
        })
        session_id = create_res.json()["session_id"]

        import subprocess as sp
        original_run = sp.run

        def mock_run(cmd, **kwargs):
            if "capture-pane" in cmd:
                return sp.CompletedProcess(cmd, 0, stdout="hello terminal\n", stderr="")
            return original_run(cmd, **kwargs)

        monkeypatch.setattr(sp, "run", mock_run)

        res = client.get(f"/terminal/sessions/{session_id}/buffer", headers=AUTH)
        assert res.status_code == 200
        assert "hello terminal" in res.json()["content"]


class TestSessionState:
    def test_delete_with_pty_bridge(self, client, workspace, monkeypatch):
        """fd/pidセット済みセッション削除でdetach呼び出し"""
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock

        detached = []
        monkeypatch.setattr("api.terminal_session._detach_pty_bridge",
                            lambda s: detached.append(s.tmux_session_name))
        # _kill_tmux_session calls _detach_pty_bridge + subprocess, mock subprocess part
        import subprocess as sp
        original_run = sp.run
        def mock_run(cmd, **kwargs):
            if "kill-session" in cmd:
                return sp.CompletedProcess(cmd, 0)
            return original_run(cmd, **kwargs)
        monkeypatch.setattr(sp, "run", mock_run)

        session = TerminalSession(
            workspace="test-ws",
            tmux_session_name="ac-test-pty-bridge",
            fd=999,
            pid=12345,
        )
        with sessions_lock:
            TERMINAL_SESSIONS["pty-test"] = session

        res = client.delete("/terminal/sessions/pty-test", headers=AUTH)
        assert res.status_code == 200
        assert "ac-test-pty-bridge" in detached
