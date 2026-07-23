"""dispatch エンドポイントのテスト。"""

import asyncio
import threading
import time

import pytest

from api.routers import dispatch as dispatch_mod
from conftest import AUTH


@pytest.fixture(autouse=True)
def _clear_pending():
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
    def test_pending_without_decision_does_not_resolve(self, client, workspace):
        """自動タイムアウトが無いことの確認。承認/却下されるまで解決しない。"""
        result_holder = {}

        def runner():
            result_holder["res"] = client.post(
                "/dispatch", headers=AUTH, json={"workspace": "test-ws", "text": "echo hi"},
            )
        t = threading.Thread(target=runner, daemon=True)
        t.start()

        pending = []
        for _ in range(40):
            pending = list(dispatch_mod._PENDING.keys())
            if pending:
                break
            time.sleep(0.01)
        assert pending

        # 承認待ちのままさらに待っても、自動タイムアウトでは解決しないこと。
        t.join(timeout=0.3)
        assert t.is_alive()
        assert "res" not in result_holder

        client.post(f"/dispatch/{pending[0]}/decision", headers=AUTH, json={"approved": True})
        t.join(timeout=2)
        assert not t.is_alive()

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
        """実行（ブランチ検証含む）は承認リクエスト側で行うため、検証エラーはそちらに出る。
        元の /dispatch 側は「承認されたが実行失敗」として 500 になる。"""
        decision_status = {}

        def approve_and_capture():
            for _ in range(40):
                pending = list(dispatch_mod._PENDING.keys())
                if pending:
                    res = client.post(f"/dispatch/{pending[0]}/decision", headers=AUTH, json={"approved": True})
                    decision_status["code"] = res.status_code
                    return
                time.sleep(0.01)
        threading.Thread(target=approve_and_capture, daemon=True).start()

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
        assert res.status_code == 500

        for _ in range(40):
            if "code" in decision_status:
                break
            time.sleep(0.01)
        assert decision_status.get("code") == 400

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


class TestDispatchQueueEndpoint:
    def test_empty_queue_returns_empty_list(self, client):
        res = client.get("/dispatch/queue", headers=AUTH)
        assert res.status_code == 200
        assert res.json() == {"items": []}

    def test_pending_item_is_listed(self, client, workspace):
        def runner():
            client.post("/dispatch", headers=AUTH, json={"workspace": "test-ws", "text": "echo hi"})
        t = threading.Thread(target=runner, daemon=True)
        t.start()

        pending_id = None
        for _ in range(40):
            pending = list(dispatch_mod._PENDING.keys())
            if pending:
                pending_id = pending[0]
                break
            time.sleep(0.01)
        assert pending_id

        res = client.get("/dispatch/queue", headers=AUTH)
        assert res.status_code == 200
        items = res.json()["items"]
        assert len(items) == 1
        assert items[0]["id"] == pending_id
        assert items[0]["request"]["workspace"] == "test-ws"

        client.post(f"/dispatch/{pending_id}/decision", headers=AUTH, json={"approved": False})
        t.join(timeout=2)

    def test_decided_item_is_not_listed(self, client, workspace):
        def runner():
            client.post("/dispatch", headers=AUTH, json={"workspace": "test-ws", "text": "echo hi"})
        t = threading.Thread(target=runner, daemon=True)
        t.start()

        pending_id = None
        for _ in range(40):
            pending = list(dispatch_mod._PENDING.keys())
            if pending:
                pending_id = pending[0]
                break
            time.sleep(0.01)
        assert pending_id

        client.post(f"/dispatch/{pending_id}/decision", headers=AUTH, json={"approved": False})
        t.join(timeout=2)

        res = client.get("/dispatch/queue", headers=AUTH)
        assert res.json() == {"items": []}

    def test_requires_auth(self, client):
        res = client.get("/dispatch/queue")
        assert res.status_code == 401


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


class TestApplyOverrides:
    def test_no_overrides_keeps_values(self):
        from api.routers.dispatch import DispatchRequest, _apply_overrides
        body = DispatchRequest(workspace="ws", branch="main", base_branch="dev", text="hi")
        _apply_overrides(body, None)
        assert body.branch == "main"
        assert body.base_branch == "dev"
        assert body.text == "hi"

    def test_overrides_replace_fields(self):
        from api.routers.dispatch import DispatchRequest, _apply_overrides
        body = DispatchRequest(workspace="ws", branch="main", text="x")
        _apply_overrides(body, {"branch": "feat/x", "base_branch": "develop", "text": "y"})
        assert body.branch == "feat/x"
        assert body.base_branch == "develop"
        assert body.text == "y"

    def test_overrides_empty_string_clears_branch(self):
        from api.routers.dispatch import DispatchRequest, _apply_overrides
        body = DispatchRequest(workspace="ws", branch="main")
        _apply_overrides(body, {"branch": ""})
        assert body.branch is None

    def test_overrides_none_value_is_skipped(self):
        from api.routers.dispatch import DispatchRequest, _apply_overrides
        body = DispatchRequest(workspace="ws", branch="main", text="hi")
        _apply_overrides(body, {"branch": None, "base_branch": None, "text": None})
        assert body.branch == "main"
        assert body.text == "hi"

    def test_workspace_override_replaces_workspace_and_clears_worktree(self):
        from api.routers.dispatch import DispatchRequest, _apply_overrides
        body = DispatchRequest(workspace="ws", worktree="feature/x")
        _apply_overrides(body, {"workspace": "other-ws"})
        assert body.workspace == "other-ws"
        assert body.worktree is None

    def test_workspace_override_empty_string_is_ignored(self):
        from api.routers.dispatch import DispatchRequest, _apply_overrides
        body = DispatchRequest(workspace="ws")
        _apply_overrides(body, {"workspace": ""})
        assert body.workspace == "ws"


class TestDecisionOverrides:
    def test_decision_with_overrides_applies(self, client, git_workspace_with_commit):
        """承認時に override を送ると、サーバ側で body.branch などが書き換わって git op が走る。"""
        import threading
        import time as _time

        def grab_and_approve_with_override():
            for _ in range(40):
                if dispatch_mod._PENDING:
                    pid = next(iter(dispatch_mod._PENDING.keys()))
                    client.post(
                        f"/dispatch/{pid}/decision",
                        headers=AUTH,
                        json={"approved": True, "branch": "feature/from-override", "base_branch": None, "text": None},
                    )
                    return
                _time.sleep(0.01)
        threading.Thread(target=grab_and_approve_with_override, daemon=True).start()

        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={
                "workspace": "test-ws",
                "text": "echo",
                "branch": "main",  # override で feature/from-override に置き換わる
                "create_branch": True,
            },
        )
        # branch override 経由でブランチ作成 → 成功
        assert res.status_code == 200, res.text

    def test_decision_with_workspace_override_creates_session_in_other_workspace(
        self, client, workspace, isolate_fs,
    ):
        other = isolate_fs["work"] / "other-ws"
        other.mkdir()
        client.post("/workspaces", headers=AUTH, json={"path": str(other), "name": "other-ws"})

        captured = {}

        def grab_and_approve_with_override():
            for _ in range(40):
                if dispatch_mod._PENDING:
                    pid = next(iter(dispatch_mod._PENDING.keys()))
                    res = client.post(
                        f"/dispatch/{pid}/decision",
                        headers=AUTH,
                        json={"approved": True, "workspace": "other-ws"},
                    )
                    captured["status"] = res.status_code
                    return
                time.sleep(0.01)
        threading.Thread(target=grab_and_approve_with_override, daemon=True).start()

        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={"workspace": "test-ws", "text": "echo hi"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["workspace"] == "other-ws"
        assert captured["status"] == 200


class TestConfirmSkip:
    def test_confirm_false_skips_approval(self, client, workspace):
        """confirm:false は UI 承認を待たずに即実行される。"""
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={"workspace": "test-ws", "text": "echo skip", "confirm": False},
        )
        assert res.status_code == 200
        assert res.json()["created"] is True


class TestWorktreeField:
    def test_effective_workspace_with_worktree(self):
        from api.routers.dispatch import DispatchRequest
        body = DispatchRequest(workspace="ws", worktree="feature/x")
        assert body.effective_workspace == "ws [feature/x]"

    def test_effective_workspace_without_worktree(self):
        from api.routers.dispatch import DispatchRequest
        body = DispatchRequest(workspace="ws")
        assert body.effective_workspace == "ws"


class TestPersistence:
    def test_persist_and_reload_pending(self):
        dispatch_mod._PENDING["abc"] = {
            "request": {"workspace": "test-ws", "text": "echo hi"},
            "event": asyncio.Event(),
            "approved": False,
            "overrides": None,
            "result": None,
        }
        dispatch_mod._persist_pending()
        dispatch_mod._PENDING.clear()

        dispatch_mod._load_persisted_pending()

        assert "abc" in dispatch_mod._PENDING
        assert dispatch_mod._PENDING["abc"]["request"]["workspace"] == "test-ws"

    def test_decided_entries_are_not_persisted(self):
        event = asyncio.Event()
        event.set()
        dispatch_mod._PENDING["done"] = {
            "request": {"workspace": "test-ws"},
            "event": event,
            "approved": True,
            "overrides": None,
            "result": {"status": "ok"},
        }
        dispatch_mod._persist_pending()
        dispatch_mod._PENDING.clear()

        dispatch_mod._load_persisted_pending()

        assert "done" not in dispatch_mod._PENDING


class TestDecisionExecutesIndependently:
    def test_decision_creates_session_without_original_waiter(self, client, workspace, _mock_tmux):
        """サーバ再起動などで元の /dispatch 呼び出しがもう無くても、
        Dispatch Queue からの承認だけでセッションが作られることを確認する。"""
        dispatch_mod._PENDING["orphan"] = {
            "request": {"workspace": "test-ws", "text": "echo hi"},
            "event": asyncio.Event(),
            "approved": False,
            "overrides": None,
            "result": None,
        }
        res = client.post("/dispatch/orphan/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200
        assert "orphan" not in dispatch_mod._PENDING


class TestFindExistingSession:
    def test_match_any_finds_any_workspace_session(self, _mock_tmux):
        from api.routers.dispatch import _find_existing_session
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        _mock_tmux.append("ac-test-ws-other")
        sess = TerminalSession(
            workspace="test-ws",
            tmux_session_name="ac-test-ws-other",
            job_name="other-job",
        )
        with sessions_lock:
            TERMINAL_SESSIONS["test-ws-other"] = sess
        sid, found = _find_existing_session("test-ws", "terminal", "any")
        assert sid == "test-ws-other"
        assert found is sess

    def test_match_job_skips_different_job(self, _mock_tmux):
        from api.routers.dispatch import _find_existing_session
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        _mock_tmux.append("ac-test-ws-other")
        sess = TerminalSession(
            workspace="test-ws",
            tmux_session_name="ac-test-ws-other",
            job_name="other-job",
        )
        with sessions_lock:
            TERMINAL_SESSIONS["test-ws-other"] = sess
        sid, found = _find_existing_session("test-ws", "terminal", "job")
        assert sid is None
        assert found is None
