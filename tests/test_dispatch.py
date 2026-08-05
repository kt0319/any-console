"""dispatch エンドポイントのテスト。"""

import asyncio

import pytest

from api.routers import dispatch as dispatch_mod
from conftest import AUTH, TOKEN


@pytest.fixture(autouse=True)
def _clear_pending():
    dispatch_mod._PENDING.clear()
    dispatch_mod._RECENT.clear()
    dispatch_mod._subscribers.clear()
    # テストごとにイベントループが変わるため、前のループのワーカータスク参照を破棄する
    dispatch_mod._broadcast_task = None
    dispatch_mod._broadcast_pending = False
    yield
    dispatch_mod._PENDING.clear()
    dispatch_mod._RECENT.clear()
    dispatch_mod._subscribers.clear()
    dispatch_mod._broadcast_task = None
    dispatch_mod._broadcast_pending = False


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

    import api.terminal_session as terminal_session_mod
    monkeypatch.setattr(terminal_session_mod, "create_tmux_session", fake_create)
    monkeypatch.setattr(dispatch_mod, "send_keys_to_tmux", fake_send_keys)
    monkeypatch.setattr(dispatch_mod, "wait_pane_ready", fake_wait_ready)
    monkeypatch.setattr(dispatch_mod, "tmux_session_exists", fake_exists)
    return created_sessions


def _enqueue(client, **fields):
    """/dispatch を direct なし（既定でキュー行き）で呼び、202 を検証して dispatch_id を返す。"""
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
    def test_direct_default_false_returns_202_and_queues(self, client, workspace, _mock_tmux):
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

    def test_approved_item_kept_in_recent(self, client, workspace):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert dispatch_mod._RECENT[0]["id"] == dispatch_id
        assert dispatch_mod._RECENT[0]["decision"] == "approved"

    def test_rejected_item_kept_in_recent(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": False})
        assert dispatch_mod._RECENT[0]["id"] == dispatch_id
        assert dispatch_mod._RECENT[0]["decision"] == "rejected"

    def test_recent_kept_to_limit(self, client, workspace):
        for _ in range(dispatch_mod._RECENT_LIMIT + 2):
            dispatch_id = _enqueue(client, text="echo hi")
            client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert len(dispatch_mod._RECENT) == dispatch_mod._RECENT_LIMIT

    def test_failed_decision_not_kept_in_recent(self, client, git_workspace_with_commit):
        dispatch_id = _enqueue(client, text="echo", branch="missing-branch", create_branch=False)
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 400
        assert dispatch_mod._RECENT == []


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


class TestDispatchDirtyGuard:
    def test_dirty_workspace_blocks_branch_switch_and_stays_queued(self, client, git_workspace_with_commit):
        (git_workspace_with_commit / "untracked.txt").write_text("wip", encoding="utf-8")
        dispatch_id = _enqueue(client, text="echo", branch="feature/x", create_branch=True)
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 400
        assert "uncommitted changes" in res.json()["detail"]
        assert dispatch_id in dispatch_mod._PENDING

    def test_dirty_workspace_allows_switch_to_current_branch(self, client, git_workspace_with_commit):
        import subprocess
        (git_workspace_with_commit / "untracked.txt").write_text("wip", encoding="utf-8")
        current = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=git_workspace_with_commit, capture_output=True, text=True, check=True,
        ).stdout.strip()
        dispatch_id = _enqueue(client, text="echo", branch=current)
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text

    def test_clean_workspace_allows_branch_switch(self, client, git_workspace_with_commit):
        dispatch_id = _enqueue(client, text="echo", branch="feature/y", create_branch=True)
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text

    def test_dirty_workspace_without_branch_field_is_unaffected(self, client, git_workspace_with_commit):
        (git_workspace_with_commit / "untracked.txt").write_text("wip", encoding="utf-8")
        dispatch_id = _enqueue(client, text="echo")
        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text

    def test_has_uncommitted_changes_helper(self, git_workspace_with_commit):
        assert dispatch_mod._has_uncommitted_changes(git_workspace_with_commit) is False
        (git_workspace_with_commit / "untracked.txt").write_text("wip", encoding="utf-8")
        assert dispatch_mod._has_uncommitted_changes(git_workspace_with_commit) is True


class TestDispatchDecision:
    def test_unknown_id_returns_404(self, client):
        res = client.post("/dispatch/nonexistent/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 404


class TestDispatchRerun:
    def test_unknown_id_returns_404(self, client):
        res = client.post("/dispatch/nonexistent/rerun", headers=AUTH)
        assert res.status_code == 404

    def test_rerun_approved_item_requeues_with_new_id(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert dispatch_mod._RECENT[0]["decision"] == "approved"

        res = client.post(f"/dispatch/{dispatch_id}/rerun", headers=AUTH)
        assert res.status_code == 202, res.text
        new_id = res.json()["id"]
        assert new_id != dispatch_id
        assert new_id in dispatch_mod._PENDING
        assert dispatch_mod._PENDING[new_id]["text"] == "echo hi"
        assert dispatch_mod._PENDING[new_id]["workspace"] == "test-ws"

    def test_rerun_rejected_item_requeues(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": False})
        assert dispatch_mod._RECENT[0]["decision"] == "rejected"

        res = client.post(f"/dispatch/{dispatch_id}/rerun", headers=AUTH)
        assert res.status_code == 202, res.text
        assert res.json()["id"] in dispatch_mod._PENDING

    def test_rerun_does_not_execute_immediately(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        _mock_tmux.clear()

        client.post(f"/dispatch/{dispatch_id}/rerun", headers=AUTH)
        assert _mock_tmux == []

    def test_rerun_not_in_recent_returns_404(self, client, workspace, _mock_tmux):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        for _ in range(dispatch_mod._RECENT_LIMIT):
            other_id = _enqueue(client, text="echo other")
            client.post(f"/dispatch/{other_id}/decision", headers=AUTH, json={"approved": True})

        res = client.post(f"/dispatch/{dispatch_id}/rerun", headers=AUTH)
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
        self.closed = False

    async def send_json(self, payload):
        self.sent.append(payload)

    async def close(self):
        self.closed = True


class _DeadWS(_FakeWS):
    async def send_json(self, payload):
        raise RuntimeError("connection closed")


class TestQueueBroadcast:
    def test_subscribe_sends_snapshot_even_when_empty(self):
        ws = _FakeWS()

        async def run():
            await dispatch_mod.subscribe(ws)
            await dispatch_mod._broadcast_task

        asyncio.run(run())
        assert ws.sent == [{"type": "dispatch_queue", "items": [], "recent": []}]
        dispatch_mod.unsubscribe(ws)

    def test_subscribe_sends_pending_items(self):
        dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
        ws = _FakeWS()

        async def run():
            await dispatch_mod.subscribe(ws)
            await dispatch_mod._broadcast_task

        asyncio.run(run())
        assert ws.sent == [{
            "type": "dispatch_queue",
            "items": [{"id": "x1", "request": {"workspace": "test-ws"}}],
            "recent": [],
        }]

    def test_broadcast_reaches_all_subscribers(self):
        ws1, ws2 = _FakeWS(), _FakeWS()

        async def run():
            await dispatch_mod.subscribe(ws1)
            await dispatch_mod.subscribe(ws2)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            dispatch_mod._schedule_queue_broadcast()
            await dispatch_mod._broadcast_task

        asyncio.run(run())
        expected = {
            "type": "dispatch_queue",
            "items": [{"id": "x1", "request": {"workspace": "test-ws"}}],
            "recent": [],
        }
        assert ws1.sent[-1] == expected
        assert ws2.sent[-1] == expected

    def test_broadcast_drops_dead_subscriber(self):
        alive, dead = _FakeWS(), _DeadWS()

        async def run():
            dispatch_mod._subscribers.add(alive)
            dispatch_mod._subscribers.add(dead)
            await dispatch_mod._broadcast_queue()

        asyncio.run(run())
        assert dead not in dispatch_mod._subscribers
        assert alive in dispatch_mod._subscribers

    def test_broadcast_closes_and_drops_stuck_subscriber_after_timeout(self, monkeypatch):
        """読み取りが止まった購読者は送信タイムアウトで切り離され、他の購読者への
        配信は継続する。共有 WS 自体も閉じてクライアントの再接続に倒す
        （dispatch 購読だけ外すと OPEN のままの WS が再接続されず永続的に stale になる）。"""
        monkeypatch.setattr(dispatch_mod, "BROADCAST_SEND_TIMEOUT_SEC", 0.01)

        class _StuckWS(_FakeWS):
            async def send_json(self, payload):
                await asyncio.Event().wait()

        alive, stuck = _FakeWS(), _StuckWS()

        async def run():
            dispatch_mod._subscribers.add(stuck)
            dispatch_mod._subscribers.add(alive)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            await dispatch_mod._broadcast_queue()

        asyncio.run(run())
        assert stuck not in dispatch_mod._subscribers
        assert stuck.closed is True
        assert alive.closed is False
        assert alive.sent[-1]["items"][0]["id"] == "x1"

    def test_schedule_broadcast_decouples_from_caller(self):
        """_schedule_queue_broadcast は即座に返り、配信はバックグラウンドで完了する。"""
        ws = _FakeWS()

        async def run():
            await dispatch_mod.subscribe(ws)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            dispatch_mod._schedule_queue_broadcast()
            assert dispatch_mod._broadcast_task is not None
            await dispatch_mod._broadcast_task

        asyncio.run(run())
        assert ws.sent[-1] == {
            "type": "dispatch_queue",
            "items": [{"id": "x1", "request": {"workspace": "test-ws"}}],
            "recent": [],
        }

    def test_schedule_broadcast_coalesces_to_latest_snapshot(self):
        """初回スナップショットを含む複数回のスケジュールは 1 回の最新スナップ
        ショット配信へ合流し、古い状態が新しい状態の後に届くことはない。"""
        ws = _FakeWS()

        async def run():
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            await dispatch_mod.subscribe(ws)
            dispatch_mod._PENDING.pop("x1")
            dispatch_mod._schedule_queue_broadcast()
            dispatch_mod._PENDING["x2"] = {"workspace": "test-ws"}
            dispatch_mod._schedule_queue_broadcast()
            await dispatch_mod._broadcast_task

        asyncio.run(run())
        assert ws.sent == [
            {"type": "dispatch_queue", "items": [{"id": "x2", "request": {"workspace": "test-ws"}}], "recent": []},
        ]

    def test_schedule_during_send_rebroadcasts_latest(self):
        """送信中（await 中）に状態が変わって再スケジュールされた場合、ワーカーは
        完了後に最新スナップショットをもう一度配信する。"""
        sent = []

        class _SlowWS:
            async def send_json(self, payload):
                sent.append(payload)
                await asyncio.sleep(0)  # 送信中に他のコルーチンへ制御を渡す

        ws = _SlowWS()

        async def run():
            dispatch_mod._subscribers.add(ws)
            dispatch_mod._PENDING["x1"] = {"workspace": "test-ws"}
            dispatch_mod._schedule_queue_broadcast()
            await asyncio.sleep(0)  # ワーカーが x1 の送信に入るまで進める
            dispatch_mod._PENDING.pop("x1")
            dispatch_mod._schedule_queue_broadcast()  # 実行中ワーカーへ合流
            await dispatch_mod._broadcast_task

        asyncio.run(run())
        assert sent == [
            {"type": "dispatch_queue", "items": [{"id": "x1", "request": {"workspace": "test-ws"}}], "recent": []},
            {"type": "dispatch_queue", "items": [], "recent": []},
        ]


class TestPushNotificationBackground:
    def test_dispatch_sends_push_in_background(self, client, workspace, monkeypatch):
        """push 送信はスレッドプールで行われ、202 応答をブロックしない。"""
        import threading
        called = threading.Event()
        captured = {}

        def fake_push(**kwargs):
            captured.update(kwargs)
            called.set()

        monkeypatch.setattr(dispatch_mod, "send_push_notification", fake_push)
        _enqueue(client, text="echo hi")
        assert called.wait(timeout=2)
        assert captured["notif_type"] == "dispatch"

    def test_push_body_includes_branch_and_text(self, client, workspace, monkeypatch):
        """通知本文に branch と text（プレビュー）が含まれ、何の dispatch か分かる。"""
        import threading
        called = threading.Event()
        captured = {}

        def fake_push(**kwargs):
            captured.update(kwargs)
            called.set()

        monkeypatch.setattr(dispatch_mod, "send_push_notification", fake_push)
        _enqueue(client, branch="feature/x", text="echo hi")
        assert called.wait(timeout=2)
        assert captured["body"] == "test-ws\nfeature/x\necho hi"

    def test_push_body_truncates_long_text(self, client, workspace, monkeypatch):
        """text が長い場合は _PUSH_TEXT_PREVIEW_LEN で切り詰める。"""
        import threading
        called = threading.Event()
        captured = {}

        def fake_push(**kwargs):
            captured.update(kwargs)
            called.set()

        monkeypatch.setattr(dispatch_mod, "send_push_notification", fake_push)
        long_text = "x" * 500
        _enqueue(client, text=long_text)
        assert called.wait(timeout=2)
        expected = "test-ws\n" + long_text[:dispatch_mod._PUSH_TEXT_PREVIEW_LEN]
        assert captured["body"] == expected


class TestDispatchNotificationBody:
    def test_workspace_only(self):
        from api.job_models import TERMINAL_JOB
        body = dispatch_mod.DispatchRequest(workspace="test-ws")
        result = dispatch_mod._dispatch_notification_body("test-ws", body, TERMINAL_JOB)
        assert result == "test-ws"

    def test_non_terminal_job_includes_label(self):
        from api.job_models import JobDefinition
        body = dispatch_mod.DispatchRequest(workspace="test-ws", job="build")
        job_def = JobDefinition(command="npm run build", label="Build")
        result = dispatch_mod._dispatch_notification_body("test-ws", body, job_def)
        assert result == "test-ws\nBuild"


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


class TestDispatchTokenSessionIdIsolation:
    """dispatch トークンは queue-only の低信頼な外部連携用。session_id をそのまま
    許すと、承認モーダルには「New session」等が表示される一方、承認後は
    body.session_id が優先されるため、攻撃者が知っている無関係な既存セッションへ
    隠れてテキスト送信・ブランチ操作されうる（reviewer が見た内容と実際の実行対象が
    乖離する）。scoped token からのリクエストでは session_id を無視することを確認する。
    """

    def _create_dispatch_token(self, client):
        res = client.post("/api-tokens", headers=AUTH, json={"name": "ci"})
        assert res.status_code == 200, res.text
        return res.json()

    def _register_victim_session(self, _mock_tmux):
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        _mock_tmux.append("ac-victim")
        victim = TerminalSession(workspace="other-ws", tmux_session_name="ac-victim", job_name="other-job")
        with sessions_lock:
            TERMINAL_SESSIONS["victim-session"] = victim

    def test_dispatch_token_session_id_is_cleared_in_queue(self, client, workspace, _mock_tmux):
        self._register_victim_session(_mock_tmux)
        token = self._create_dispatch_token(client)
        res = client.post(
            "/dispatch",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"workspace": "test-ws", "text": "echo hi", "session_id": "victim-session"},
        )
        assert res.status_code == 202, res.text
        dispatch_id = res.json()["id"]
        assert dispatch_mod._PENDING[dispatch_id]["session_id"] is None

    def test_dispatch_token_session_id_cannot_hijack_approval(self, client, workspace, _mock_tmux):
        self._register_victim_session(_mock_tmux)
        token = self._create_dispatch_token(client)
        enqueue = client.post(
            "/dispatch",
            headers={"Authorization": f"Bearer {token['token']}"},
            json={"workspace": "test-ws", "text": "echo hi", "session_id": "victim-session"},
        )
        assert enqueue.status_code == 202, enqueue.text
        dispatch_id = enqueue.json()["id"]

        res = client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text
        data = res.json()
        # 攻撃者が指定した victim-session ではなく、test-ws 向けの新規セッションが
        # 作られる（既存セッション探索は workspace/job ベースのみに限定されるため）。
        assert data["session_id"] != "victim-session"
        assert data["created"] is True

    def test_main_token_session_id_still_honored(self, client, workspace, _mock_tmux):
        """メイントークンからの明示的な session_id 指定は従来通り機能する
        （制限が scoped token だけを対象にしていることの回帰）。"""
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        _mock_tmux.append("ac-test-ws-existing")
        sess = TerminalSession(workspace="test-ws", tmux_session_name="ac-test-ws-existing")
        with sessions_lock:
            TERMINAL_SESSIONS["test-ws-existing"] = sess

        dispatch_id = _enqueue(client, text="echo hi", session_id="test-ws-existing")
        assert dispatch_mod._PENDING[dispatch_id]["session_id"] == "test-ws-existing"


class TestDirectSkipsQueue:
    def test_direct_true_skips_approval(self, client, workspace):
        """direct:true は承認を待たず即座に実行される。"""
        res = client.post(
            "/dispatch",
            headers=AUTH,
            json={"workspace": "test-ws", "text": "echo skip", "direct": True},
        )
        assert res.status_code == 200
        assert res.json()["created"] is True
        assert dispatch_mod._PENDING == {}


class TestActivityLogging:
    """dispatch の承認待ち/承認/却下/実行を既存の activity ログ（api/activity.py）に記録する。"""

    def test_direct_true_logs_executed(self, client, workspace):
        from unittest import mock
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(
                "/dispatch", headers=AUTH,
                json={"workspace": "test-ws", "text": "echo hi", "direct": True},
            )
        assert res.status_code == 200
        data = res.json()
        log.assert_called_once_with(
            "test-ws", "dispatch_executed",
            job="terminal", session_id=data["session_id"], created=True, auth="main",
        )

    def test_direct_default_false_logs_pending(self, client, workspace):
        from unittest import mock
        with mock.patch("api.routers.dispatch.log_activity") as log:
            res = client.post(
                "/dispatch", headers=AUTH,
                json={"workspace": "test-ws", "text": "echo hi"},
            )
        assert res.status_code == 202
        log.assert_called_once_with("test-ws", "dispatch_pending", job="terminal", text="echo hi", auth="main")

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

    def test_recent_persists_across_decision_and_reload(self, client, workspace):
        dispatch_id = _enqueue(client, text="echo hi")
        client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})
        assert dispatch_mod.DISPATCH_RECENT_FILE.is_file()

        dispatch_mod._RECENT.clear()
        dispatch_mod._load_persisted_recent()

        assert len(dispatch_mod._RECENT) == 1
        assert dispatch_mod._RECENT[0]["id"] == dispatch_id
        assert dispatch_mod._RECENT[0]["decision"] == "approved"

    def test_recent_reload_respects_limit(self, client, workspace):
        for _ in range(dispatch_mod._RECENT_LIMIT + 3):
            dispatch_id = _enqueue(client, text="echo hi")
            client.post(f"/dispatch/{dispatch_id}/decision", headers=AUTH, json={"approved": True})

        dispatch_mod._RECENT.clear()
        dispatch_mod._load_persisted_recent()
        assert len(dispatch_mod._RECENT) == dispatch_mod._RECENT_LIMIT

    def test_recent_non_dict_entries_are_skipped(self):
        import json as json_mod
        dispatch_mod.DISPATCH_RECENT_FILE.write_text(
            json_mod.dumps({"items": [
                {"id": "ok", "request": {"workspace": "test-ws"}, "decision": "approved"},
                "not-a-dict",
                {"id": "bad-request", "request": "not-a-dict", "decision": "approved"},
            ]}),
            encoding="utf-8",
        )
        dispatch_mod._load_persisted_recent()
        ids = [r["id"] for r in dispatch_mod._RECENT]
        assert ids == ["ok"]


class TestDecisionExecutesIndependently:
    def test_decision_creates_session_without_original_request(self, client, workspace, _mock_tmux):
        """サーバ再起動などで /dispatch の記憶が失われても、永続化から復元した
        キュー項目の承認だけでセッションが作られることを確認する。"""
        dispatch_mod._PENDING["orphan"] = {"workspace": "test-ws", "text": "echo hi"}
        res = client.post("/dispatch/orphan/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200
        assert res.json()["created"] is True
        assert "orphan" not in dispatch_mod._PENDING


class TestDedupKey:
    def test_second_request_with_same_key_reuses_id_and_replaces_payload(self, client, workspace):
        """置き換え後も dispatch_id は最初の ID を引き継ぐ。初回 push 通知に埋め込んだ
        URL の dispatchId が、置き換え後もキュー上の実在項目を指し続けるようにするため
        （通知をタップした時に stale な ID を開いてしまわないように）。"""
        first_id = _enqueue(client, text="echo 1", dedup_key="ci-failure:test-ws:main")
        second_id = _enqueue(client, text="echo 2", dedup_key="ci-failure:test-ws:main")
        assert second_id == first_id
        assert first_id in dispatch_mod._PENDING
        assert dispatch_mod._PENDING[first_id]["text"] == "echo 2"
        assert len(dispatch_mod._PENDING) == 1

    def test_retry_count_increments_across_replacements(self, client, workspace):
        first_id = _enqueue(client, text="echo 1", dedup_key="k")
        second_id = _enqueue(client, text="echo 2", dedup_key="k")
        assert second_id == first_id
        assert dispatch_mod._PENDING[second_id]["retry_count"] == 2
        third_id = _enqueue(client, text="echo 3", dedup_key="k")
        assert third_id == first_id
        assert dispatch_mod._PENDING[third_id]["retry_count"] == 3

    def test_first_request_has_retry_count_one(self, client, workspace):
        first_id = _enqueue(client, text="echo 1", dedup_key="k")
        assert dispatch_mod._PENDING[first_id]["retry_count"] == 1

    def test_without_dedup_key_never_replaces(self, client, workspace):
        first_id = _enqueue(client, text="echo 1")
        second_id = _enqueue(client, text="echo 2")
        assert first_id in dispatch_mod._PENDING
        assert second_id in dispatch_mod._PENDING
        assert len(dispatch_mod._PENDING) == 2

    def test_different_dedup_keys_do_not_collide(self, client, workspace):
        first_id = _enqueue(client, text="echo 1", dedup_key="a")
        second_id = _enqueue(client, text="echo 2", dedup_key="b")
        assert first_id in dispatch_mod._PENDING
        assert second_id in dispatch_mod._PENDING

    def test_original_dispatch_id_stays_valid_after_supersede(self, client, workspace):
        """初回通知の URL に埋め込まれた dispatchId は、置き換えを経てもキュー上の
        項目として引き続き承認できる（stale なリンクにならない）。"""
        first_id = _enqueue(client, text="echo 1", dedup_key="k")
        _enqueue(client, text="echo 2", dedup_key="k")
        _enqueue(client, text="echo 3", dedup_key="k")
        res = client.post(f"/dispatch/{first_id}/decision", headers=AUTH, json={"approved": True})
        assert res.status_code == 200, res.text

    def test_push_notification_skipped_on_supersede(self, client, workspace, monkeypatch):
        import threading
        push_calls = []
        called = threading.Event()

        def fake_push(**kwargs):
            push_calls.append(kwargs)
            called.set()

        monkeypatch.setattr(dispatch_mod, "send_push_notification", fake_push)
        _enqueue(client, text="echo 1", dedup_key="k")
        assert called.wait(timeout=2)
        called.clear()

        _enqueue(client, text="echo 2", dedup_key="k")
        assert not called.wait(timeout=0.3)
        assert len(push_calls) == 1

    def test_supersede_logs_dispatch_superseded(self, client, workspace):
        from unittest import mock
        _enqueue(client, text="echo 1", dedup_key="k")
        with mock.patch("api.routers.dispatch.log_activity") as log:
            _enqueue(client, text="echo 2", dedup_key="k")
        log.assert_called_once_with("test-ws", "dispatch_superseded", job="terminal", text="echo 2", auth="main")

    def test_first_request_logs_dispatch_pending(self, client, workspace):
        from unittest import mock
        with mock.patch("api.routers.dispatch.log_activity") as log:
            _enqueue(client, text="echo 1", dedup_key="k")
        log.assert_called_once_with("test-ws", "dispatch_pending", job="terminal", text="echo 1", auth="main")

    def test_replaced_item_persists_with_retry_count(self, client, workspace):
        _enqueue(client, text="echo 1", dedup_key="k")
        second_id = _enqueue(client, text="echo 2", dedup_key="k")

        dispatch_mod._PENDING.clear()
        dispatch_mod._load_persisted_pending()

        assert list(dispatch_mod._PENDING.keys()) == [second_id]
        assert dispatch_mod._PENDING[second_id]["retry_count"] == 2


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
