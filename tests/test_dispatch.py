"""dispatch エンドポイントのテスト。"""

import asyncio

import pytest

from api.routers import dispatch as dispatch_mod
from conftest import AUTH, TOKEN


@pytest.fixture(autouse=True)
def _clear_pending():
    dispatch_mod._PENDING.clear()
    dispatch_mod._subscribers.clear()
    yield
    dispatch_mod._PENDING.clear()
    dispatch_mod._subscribers.clear()
    dispatch_mod._broadcast_tasks.clear()


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


def _enqueue(client, **fields):
    """/dispatch を confirm あり（既定）で呼び、202 を検証して dispatch_id を返す。"""
    res = client.post("/dispatch", headers=AUTH, json={"workspace": "test-ws", **fields})
    assert res.status_code == 202, res.text
    data = res.json()
    assert data["status"] == "pending"
    return data["id"]


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


class TestDispatchEnqueue:
    def test_confirm_default_returns_202_and_queues(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        assert dispatch_id in dispatch_mod._PENDING
        # 承認前は実行されない
        assert _mock_tmux == []

    def test_validation_failure_does_not_queue(self, client, workspace):
        client.post("/dispatch", headers=AUTH, json={"workspace": "test-ws", "job": "nope"})
        assert dispatch_mod._PENDING == {}


class TestDispatchApproval:
    def test_approved_creates_session_and_returns_result(self, client, workspace):
        dispatch_id = _enqueue(client, text="echo hi")
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["created"] is True
        assert data["workspace"] == "test-ws"
        assert data["session_id"]
        assert dispatch_id not in dispatch_mod._PENDING

    def test_rejected_removes_without_executing(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": False})
        assert res.status_code == 200
        assert dispatch_id not in dispatch_mod._PENDING
        assert _mock_tmux == []


class TestDispatchBranch:
    def test_missing_branch_without_create_fails_and_stays_queued(self, client, git_workspace_with_commit):
        """実行（ブランチ検証含む）は承認時に行うため、検証エラーは decision に出る。
        失敗した項目はキューに残り、再承認・却下をやり直せる。"""
        dispatch_id = _enqueue(client, text="echo", branch="feature/new", create_branch=False)
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 400
        assert dispatch_id in dispatch_mod._PENDING

    def test_create_branch_succeeds(self, client, git_workspace_with_commit):
        dispatch_id = _enqueue(client, text="echo", branch="feature/x", create_branch=True)
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text

    def test_branch_status_in_payload(self, client, git_workspace_with_commit):
        dispatch_id = _enqueue(client, branch="feature/new", create_branch=True)
        assert dispatch_mod._PENDING[dispatch_id].get("branch_status") == "missing"


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
        dispatch_id = _enqueue(client, text="echo hi")
        res = client.get("/dispatch/queue", headers=AUTH)
        assert res.status_code == 200
        items = res.json()["items"]
        assert len(items) == 1
        assert items[0]["id"] == dispatch_id
        assert items[0]["request"]["workspace"] == "test-ws"

    def test_decided_item_is_not_listed(self, client, workspace):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": False})
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

        dispatch_id = _enqueue(client, text="echo reuse")
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
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


class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


class _DeadWS:
    async def send_json(self, payload):
        raise RuntimeError("connection closed")


class TestQueueBroadcast:
    def test_subscribe_sends_snapshot_even_when_empty(self):
        ws = _FakeWS()
        asyncio.run(dispatch_mod.subscribe(ws))
        assert ws.sent == [{"type": "dispatch_queue", "items": []}]
        dispatch_mod.unsubscribe(ws)

    def test_subscribe_sends_pending_items(self):
        dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
        ws = _FakeWS()
        asyncio.run(dispatch_mod.subscribe(ws))
        assert ws.sent == [{
            "type": "dispatch_queue",
            "items": [{"id": "x1", "request": {"workspace": "test-ws"}}],
        }]

    def test_broadcast_reaches_all_subscribers(self):
        ws1, ws2 = _FakeWS(), _FakeWS()

        async def run():
            await dispatch_mod.subscribe(ws1)
            await dispatch_mod.subscribe(ws2)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            await dispatch_mod._broadcast_queue()

        asyncio.run(run())
        expected = {
            "type": "dispatch_queue",
            "items": [{"id": "x1", "request": {"workspace": "test-ws"}}],
        }
        assert ws1.sent[-1] == expected
        assert ws2.sent[-1] == expected

    def test_broadcast_drops_dead_subscriber(self):
        alive, dead = _FakeWS(), _DeadWS()

        async def run():
            await dispatch_mod.subscribe(alive)
            dispatch_mod._subscribers.add(dead)
            await dispatch_mod._broadcast_queue()

        asyncio.run(run())
        assert dead not in dispatch_mod._subscribers
        assert alive in dispatch_mod._subscribers

    def test_broadcast_drops_stuck_subscriber_after_timeout(self, monkeypatch):
        """読み取りが止まった購読者は送信タイムアウトで切り離され、
        他の購読者への配信は継続する。"""
        monkeypatch.setattr(dispatch_mod, "BROADCAST_SEND_TIMEOUT_SEC", 0.01)

        class _StuckWS:
            async def send_json(self, payload):
                await asyncio.Event().wait()

        alive, stuck = _FakeWS(), _StuckWS()

        async def run():
            dispatch_mod._subscribers.add(stuck)
            await dispatch_mod.subscribe(alive)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            await dispatch_mod._broadcast_queue()

        asyncio.run(run())
        assert stuck not in dispatch_mod._subscribers
        assert alive.sent[-1]["items"][0]["id"] == "x1"

    def test_schedule_broadcast_decouples_from_caller(self):
        """_schedule_queue_broadcast は即座に返り、配信はバックグラウンドで完了する。"""
        ws = _FakeWS()

        async def run():
            await dispatch_mod.subscribe(ws)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            dispatch_mod._schedule_queue_broadcast()
            assert dispatch_mod._broadcast_tasks
            await asyncio.gather(*dispatch_mod._broadcast_tasks)

        asyncio.run(run())
        assert ws.sent[-1] == {
            "type": "dispatch_queue",
            "items": [{"id": "x1", "request": {"workspace": "test-ws"}}],
        }
        assert not dispatch_mod._broadcast_tasks


class TestStatusStreamSnapshot:
    def test_dispatch_queue_snapshot_on_connect(self, client, workspace):
        """ステータスストリーム WS 接続時に承認待ちキューの全量が届く。"""
        dispatch_id = _enqueue(client, text="echo hi")
        with client.websocket_connect(f"/workspaces/statuses/ws?token={TOKEN}") as ws:
            # git 購読はスナップショットを送らず、agent 状態も空のため
            # 最初の数メッセージ内に dispatch_queue が含まれる。
            msg = None
            for _ in range(3):
                msg = ws.receive_json()
                if msg.get("type") == "dispatch_queue":
                    break
            assert msg is not None
            assert msg["type"] == "dispatch_queue"
            assert [item["id"] for item in msg["items"]] == [dispatch_id]


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
        dispatch_id = _enqueue(client, text="echo", branch="main", create_branch=True)
        res = client.post(
            f"/dispatch/{dispatch_id}/decision",
            headers=AUTH,
            json={"approved": True, "branch": "feature/from-override", "base_branch": None, "text": None},
        )
        # branch override 経由でブランチ作成 → 成功
        assert res.status_code == 200, res.text

    def test_decision_with_workspace_override_creates_session_in_other_workspace(
        self, client, workspace, isolate_fs,
    ):
        other = isolate_fs["work"] / "other-ws"
        other.mkdir()
        client.post("/workspaces", headers=AUTH, json={"path": str(other), "name": "other-ws"})

        dispatch_id = _enqueue(client, text="echo hi")
        res = client.post(
            f"/dispatch/{dispatch_id}/decision",
            headers=AUTH,
            json={"approved": True, "workspace": "other-ws"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["workspace"] == "other-ws"


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
        assert dispatch_mod._PENDING == {}


class TestActivityLogging:
    """dispatch の承認待ち/承認/却下/実行を既存の activity ログ（api/activity.py）に記録する。"""

    def test_confirm_false_logs_executed(self, client, workspace):
        from unittest import mock
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(
                "/dispatch", headers=AUTH,
                json={"workspace": "test-ws", "text": "echo hi", "confirm": False},
            )
        assert res.status_code == 200
        data = res.json()
        log.assert_called_once_with(
            "test-ws", "dispatch_executed",
            job="terminal", session_id=data["session_id"], created=True,
        )

    def test_confirm_true_logs_pending(self, client, workspace):
        from unittest import mock
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(
                "/dispatch", headers=AUTH,
                json={"workspace": "test-ws", "text": "echo hi"},
            )
        assert res.status_code == 202
        log.assert_called_once_with("test-ws", "dispatch_pending", job="terminal", text="echo hi")

    def test_approved_logs_dispatch_approved(self, client, workspace):
        from unittest import mock
        dispatch_id = _enqueue(client, text="echo hi")
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200
        data = res.json()
        log.assert_called_once_with(
            "test-ws", "dispatch_approved",
            job="terminal", session_id=data["session_id"], created=True,
        )

    def test_rejected_logs_dispatch_rejected(self, client, workspace):
        from unittest import mock
        dispatch_id = _enqueue(client, text="echo hi")
        with mock.patch("api.routers.dispatch.log_activity") as log:
            client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": False})
        log.assert_called_once_with("test-ws", "dispatch_rejected")

    def test_decision_execution_failure_logs_dispatch_failed(self, client, git_workspace_with_commit):
        from unittest import mock
        dispatch_id = _enqueue(client, text="echo", branch="feature/missing", create_branch=False)
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 400
        calls = [c for c in log.call_args_list if c.args[1] == "dispatch_failed"]
        assert len(calls) == 1
        assert calls[0].args[0] == "test-ws"


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
        dispatch_mod._PENDING["abc"] = {"workspace": "test-ws", "text": "echo hi"}
        dispatch_mod._persist_pending()
        dispatch_mod._PENDING.clear()

        dispatch_mod._load_persisted_pending()

        assert dispatch_mod._PENDING == {"abc": {"workspace": "test-ws", "text": "echo hi"}}

    def test_decided_item_removed_from_persisted_file(self, client, workspace):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": False})

        dispatch_mod._PENDING.clear()
        dispatch_mod._load_persisted_pending()
        assert dispatch_id not in dispatch_mod._PENDING

    def test_non_dict_entries_are_skipped(self):
        import json as json_mod
        DISPATCH_QUEUE_FILE = dispatch_mod.DISPATCH_QUEUE_FILE
        DISPATCH_QUEUE_FILE.write_text(
            json_mod.dumps({"items": {"ok": {"workspace": "test-ws"}, "bad": "not-a-dict"}}),
            encoding="utf-8",
        )
        dispatch_mod._load_persisted_pending()
        assert "ok" in dispatch_mod._PENDING
        assert "bad" not in dispatch_mod._PENDING


class TestDecisionExecutesIndependently:
    def test_decision_creates_session_without_original_request(self, client, workspace, _mock_tmux):
        """サーバ再起動などで /dispatch の記憶が失われても、永続化から復元した
        キュー項目の承認だけでセッションが作られることを確認する。"""
        dispatch_mod._PENDING["orphan"] = {"workspace": "test-ws", "text": "echo hi"}
        res = client.post("/dispatch/orphan/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200
        assert res.json()["created"] is True
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
