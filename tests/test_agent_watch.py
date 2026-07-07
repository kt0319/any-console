"""エージェント状態の監視・配信（api/agent_watch.py）のテスト。"""

import asyncio

import pytest

from api import agent_watch
from api.agent_watch import (
    classify_agent_state,
    collect_agent_states,
    diff_states,
    states_payload,
)
from conftest import AUTH, TOKEN


@pytest.fixture(autouse=True)
def _reset_agent_watch_state():
    yield
    agent_watch._subscribers.clear()
    agent_watch._stop_task()


class TestClassifyAgentState:
    def test_output_change_is_working(self):
        assert classify_agent_state("spinner /", "spinner -") == "working"

    def test_static_screen_is_idle(self):
        text = "$ ls\nREADME.md\n$ "
        assert classify_agent_state(text, text) == "idle"

    def test_first_poll_is_idle(self):
        assert classify_agent_state("anything", None) == "idle"

    def test_working_disabled_is_always_idle(self):
        assert classify_agent_state("abc", "abd", working_enabled=False) == "idle"


class TestDiffStates:
    def test_only_changed_entries_are_returned(self):
        prev = {"a": "working", "b": "idle"}
        cur = {"a": "working", "b": "working", "c": "idle"}
        assert diff_states(prev, cur) == {"b": "working", "c": "idle"}

    def test_removed_sessions_are_not_reported(self):
        assert diff_states({"a": "working"}, {}) == {}


class TestStatesPayload:
    def test_payload_shape(self):
        payload = states_payload({"s1": "idle"})
        assert payload == {
            "type": "agent_states",
            "states": [{"session_id": "s1", "state": "idle"}],
        }


class _FakeTmuxResult:
    def __init__(self, stdout: str, returncode: int = 0):
        self.stdout = stdout
        self.returncode = returncode


class TestCollectAgentStates:
    def _setup_tmux(self, monkeypatch, sessions: list[str], captures: dict[str, str]):
        monkeypatch.setattr(
            agent_watch, "_run_tmux_cmd",
            lambda *args: _FakeTmuxResult("\n".join(sessions) + "\n"),
        )
        monkeypatch.setattr(
            agent_watch, "capture_visible_pane",
            lambda name: captures.get(name),
        )

    def test_notify_phrase_triggers_notification(self, client, monkeypatch):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "Session complete",
        })
        job_name = res.json()["name"]

        self._setup_tmux(monkeypatch, ["ac-s1", "other"], {"ac-s1": "Session complete\n$ "})
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        states, notifications = collect_agent_states()
        assert states == {"s1": "idle"}
        assert "Session complete" in notifications

    def test_notify_phrase_not_duplicated(self, client, monkeypatch):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "Done",
        })
        job_name = res.json()["name"]

        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Done\n$ "})
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        _, notifications = collect_agent_states()
        assert "Done" in notifications

        # 同じフレーズが画面にある間は再通知しない
        _, notifications2 = collect_agent_states()
        assert notifications2 == []

    def test_activity_between_polls_is_working(self, client, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "output A"})
        monkeypatch.setattr(agent_watch, "load_tmux_metadata", lambda name: {})

        states, _ = collect_agent_states()
        assert states == {"s1": "idle"}

        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "output B"})
        states, _ = collect_agent_states()
        assert states == {"s1": "working"}

    def test_capture_failure_skips_session(self, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {})
        states, _ = collect_agent_states()
        assert states == {}

    def test_stale_captures_are_pruned(self, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "text"})
        monkeypatch.setattr(agent_watch, "load_tmux_metadata", lambda name: {})
        collect_agent_states()
        assert "s1" in agent_watch._last_capture

        self._setup_tmux(monkeypatch, [], {})
        states, _ = collect_agent_states()
        assert states == {}
        assert agent_watch._last_capture == {}

    def test_tmux_unavailable_returns_empty(self, monkeypatch):
        monkeypatch.setattr(agent_watch, "_run_tmux_cmd", lambda *args: None)
        states, _ = collect_agent_states()
        assert states == {}

    def test_cached_session_meta_is_used(self, client, workspace, monkeypatch):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "FINISHED",
        })
        job_name = res.json()["name"]

        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(
            workspace="test-ws", tmux_session_name="ac-s2", job_name=job_name,
        )
        with sessions_lock:
            TERMINAL_SESSIONS["s2"] = session

        self._setup_tmux(monkeypatch, ["ac-s2"], {"ac-s2": "FINISHED\n$ "})
        states, notifications = collect_agent_states()
        assert states == {"s2": "idle"}
        assert "FINISHED" in notifications


class _FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


class TestSubscribeLifecycle:
    def test_subscribe_sends_snapshot_and_manages_task(self):
        async def run():
            ws = _FakeWebSocket()
            agent_watch._last_states["s1"] = "idle"
            await agent_watch.subscribe(ws)
            assert agent_watch.subscriber_count() == 1
            assert agent_watch._poll_task is not None
            assert ws.sent == [states_payload({"s1": "idle"})]

            agent_watch.unsubscribe(ws)
            assert agent_watch.subscriber_count() == 0
            assert agent_watch._poll_task is None
            assert agent_watch._last_states == {}

        asyncio.run(run())

    def test_subscribe_without_known_states_sends_nothing(self):
        async def run():
            ws = _FakeWebSocket()
            await agent_watch.subscribe(ws)
            assert ws.sent == []
            agent_watch.unsubscribe(ws)

        asyncio.run(run())

    def test_broadcast_drops_dead_subscribers(self):
        class DeadWS(_FakeWebSocket):
            async def send_json(self, payload):
                raise RuntimeError("closed")

        async def run():
            alive, dead = _FakeWebSocket(), DeadWS()
            await agent_watch.subscribe(alive)
            await agent_watch.subscribe(dead)
            await agent_watch._broadcast(states_payload({"s1": "idle"}))
            assert alive.sent == [states_payload({"s1": "idle"})]
            assert dead not in agent_watch._subscribers
            agent_watch.unsubscribe(alive)

        asyncio.run(run())


class TestStatusStreamWs:
    def test_snapshot_delivered_on_connect(self, client):
        agent_watch._last_states["s9"] = "idle"
        with client.websocket_connect(f"/workspaces/statuses/ws?token={TOKEN}") as ws:
            msg = ws.receive_json()
            assert msg == states_payload({"s9": "idle"})


class TestNotifyPhraseApi:
    def test_roundtrip_via_common_jobs(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "  Session complete  ",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        jobs = client.get("/common/jobs", headers=AUTH).json()
        assert jobs[job_name]["notify_phrase"] == "Session complete"

    def test_too_long_phrase_is_rejected(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "x" * 201,
        })
        assert res.status_code == 422

    def test_browser_job_ignores_notify_phrase(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "docs",
            "type": "browser",
            "url": "https://example.com",
            "notify_phrase": "never",
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        jobs = client.get("/common/jobs", headers=AUTH).json()
        assert jobs[job_name].get("notify_phrase", "") == ""
