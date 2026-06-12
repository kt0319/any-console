"""dispatch エンドポイントのテスト。"""

import asyncio
import threading
import time

import pytest

from api.routers import dispatch as dispatch_mod
from conftest import AUTH


@pytest.fixture(autouse=True)
def _short_timeout(monkeypatch):
    monkeypatch.setattr(dispatch_mod, "DISPATCH_TIMEOUT_SEC", 0.3)
    dispatch_mod._PENDING.clear()
    dispatch_mod._SSE_QUEUES.clear()


@pytest.fixture(autouse=True)
def _mock_tmux(monkeypatch):
    created_sessions = []

    def fake_create(workspace_path, session_name):
        created_sessions.append(session_name)

    def fake_send_keys(name, text, *, enter=True):
        return True

    def fake_wait_ready(name, timeout_sec=2.0):
        return True

    def fake_exists(name):
        return name in created_sessions

    monkeypatch.setattr(dispatch_mod, "create_tmux_session", fake_create)
    monkeypatch.setattr(dispatch_mod, "send_keys_to_tmux", fake_send_keys)
    monkeypatch.setattr(dispatch_mod, "wait_pane_ready", fake_wait_ready)
    monkeypatch.setattr(dispatch_mod, "tmux_session_exists", fake_exists)
    return created_sessions


def _approve_in_background(client, approved=True):
    def runner():
        for _ in range(40):
            pending = list(dispatch_mod._PENDING.keys())
            if pending:
                client.post(
                    f"/dispatch/{pending[0]}/decision",
                    headers=AUTH,
                    json={"approved": approved},
                )
                return
            time.sleep(0.01)
    t = threading.Thread(target=runner, daemon=True)
    t.start()
    return t


class TestDispatchValidation:
    def test_unknown_workspace_rejects(self, client):
        res = client.post("/dispatch", headers=AUTH, json={"workspace": "missing"})
        assert res.status_code in {400, 404}

    def test_unknown_job_returns_400(self, client, workspace):
        res = client.post("/dispatch", headers=AUTH, json={"workspace": "test-ws", "job": "nope"})
        assert res.status_code == 400

    def test_missing_workspace_field(self, client):
        res = client.post("/dispatch", headers=AUTH, json={})
        assert res.status_code == 422


class TestDispatchApproval:
    def test_timeout_returns_503(self, client, workspace):
        res = client.post("/dispatch", headers=AUTH, json={"workspace": "test-ws", "text": "echo hi"})
        assert res.status_code == 503

    def test_approved_creates_session(self, client, workspace):
        _approve_in_background(client, approved=True)
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={"workspace": "test-ws", "text": "echo hi", "reuse": False},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["created"] is True
        assert data["workspace"] == "test-ws"
        assert data["session_id"]

    def test_rejected_returns_403(self, client, workspace):
        _approve_in_background(client, approved=False)
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={"workspace": "test-ws", "text": "echo hi", "reuse": False},
        )
        assert res.status_code == 403


class TestDispatchBranch:
    def test_missing_branch_without_create_fails(self, client, git_workspace_with_commit):
        _approve_in_background(client, approved=True)
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={
                "workspace": "test-ws",
                "text": "echo",
                "branch": "feature/new",
                "create_branch": False,
                "reuse": False,
            },
        )
        assert res.status_code == 400

    def test_create_branch_succeeds(self, client, git_workspace_with_commit):
        _approve_in_background(client, approved=True)
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={
                "workspace": "test-ws",
                "text": "echo",
                "branch": "feature/x",
                "create_branch": True,
                "reuse": False,
            },
        )
        assert res.status_code == 200, res.text

    def test_branch_status_in_payload(self, client, git_workspace_with_commit):
        captured = []

        def grab():
            for _ in range(40):
                if dispatch_mod._PENDING:
                    pid, rec = next(iter(dispatch_mod._PENDING.items()))
                    captured.append(rec["request"])
                    client.post(f"/dispatch/{pid}/decision", headers=AUTH, json={"approved": True})
                    return
                time.sleep(0.01)
        threading.Thread(target=grab, daemon=True).start()

        client.post(
            "/dispatch",
            headers=AUTH,
            json={
                "workspace": "test-ws",
                "branch": "feature/new",
                "create_branch": True,
                "reuse": False,
            },
        )
        assert captured
        assert captured[0].get("branch_status") == "missing"


class TestDispatchDecision:
    def test_unknown_id_returns_404(self, client):
        res = client.post("/dispatch/nonexistent/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 404


class TestReuseExisting:
    def test_reuse_finds_existing_session(self, client, workspace, _mock_tmux):
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        _mock_tmux.append("ac-test-ws-existing")
        sess = TerminalSession(
            workspace="test-ws",
            tmux_session_name="ac-test-ws-existing",
        )
        with sessions_lock:
            TERMINAL_SESSIONS["test-ws-existing"] = sess

        _approve_in_background(client, approved=True)
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={"workspace": "test-ws", "text": "echo reuse"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["created"] is False
        assert data["session_id"] == "test-ws-existing"


class TestBranchStatusHelper:
    def test_missing_branch(self, git_workspace_with_commit):
        from pathlib import Path
        status = dispatch_mod._branch_status(Path(git_workspace_with_commit), "definitely-not-here")
        assert status == "missing"

    def test_current_branch(self, git_workspace_with_commit):
        from pathlib import Path
        from api.git_utils import git_branch
        current = git_branch(Path(git_workspace_with_commit))
        assert dispatch_mod._branch_status(Path(git_workspace_with_commit), current) == "current"


class TestBroadcast:
    def test_broadcast_puts_to_queues(self):
        q1 = asyncio.Queue(maxsize=10)
        q2 = asyncio.Queue(maxsize=10)
        dispatch_mod._SSE_QUEUES.extend([q1, q2])
        try:
            dispatch_mod._broadcast({"type": "test", "v": 1})
            assert q1.get_nowait() == {"type": "test", "v": 1}
            assert q2.get_nowait() == {"type": "test", "v": 1}
        finally:
            dispatch_mod._SSE_QUEUES.clear()

    def test_broadcast_skips_full_queue(self):
        q = asyncio.Queue(maxsize=1)
        q.put_nowait("filler")
        dispatch_mod._SSE_QUEUES.append(q)
        try:
            dispatch_mod._broadcast({"type": "test"})  # should not raise
        finally:
            dispatch_mod._SSE_QUEUES.clear()
