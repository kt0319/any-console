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
    PATTERNS = {"blocked": ["Do you want to", "esc to interrupt"], "done": ["Session complete"]}

    def test_output_change_is_working(self):
        assert classify_agent_state("spinner /", "spinner -", self.PATTERNS) == "working"

    def test_static_screen_with_blocked_phrase(self):
        text = "...\nDo you want to proceed?\n> "
        assert classify_agent_state(text, text, self.PATTERNS) == "blocked"

    def test_static_screen_with_done_phrase(self):
        text = "...\nSession complete\n$ "
        assert classify_agent_state(text, text, self.PATTERNS) == "done"

    def test_later_phrase_wins_blocked_after_done(self):
        text = "Session complete\n...\nDo you want to commit?\n"
        assert classify_agent_state(text, text, self.PATTERNS) == "blocked"

    def test_later_phrase_wins_done_after_blocked(self):
        text = "Do you want to proceed?\n...\nSession complete\n"
        assert classify_agent_state(text, text, self.PATTERNS) == "done"

    def test_static_screen_without_match_is_idle(self):
        text = "$ ls\nREADME.md\n$ "
        assert classify_agent_state(text, text, self.PATTERNS) == "idle"

    def test_first_poll_matches_phrases_without_activity(self):
        # 初回（prev なし）はアクティビティ判定をスキップして語句照合する
        text = "Do you want to proceed?\n"
        assert classify_agent_state(text, None, self.PATTERNS) == "blocked"

    def test_no_patterns_is_idle_or_working(self):
        assert classify_agent_state("abc", "abc", {}) == "idle"
        assert classify_agent_state("abc", "abd", {}) == "working"

    def test_empty_phrase_is_ignored(self):
        text = "anything"
        assert classify_agent_state(text, text, {"blocked": [""]}) == "idle"


class TestDiffStates:
    def test_only_changed_entries_are_returned(self):
        prev = {"a": "working", "b": "blocked"}
        cur = {"a": "working", "b": "done", "c": "idle"}
        assert diff_states(prev, cur) == {"b": "done", "c": "idle"}

    def test_removed_sessions_are_not_reported(self):
        assert diff_states({"a": "working"}, {}) == {}


class TestStatesPayload:
    def test_payload_shape(self):
        payload = states_payload({"s1": "blocked"})
        assert payload == {
            "type": "agent_states",
            "states": [{"session_id": "s1", "state": "blocked"}],
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

    def test_states_by_job_patterns(self, client, monkeypatch):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "state_patterns": {"blocked": ["Do you want to"], "done": ["All done"]},
        })
        job_name = res.json()["name"]

        self._setup_tmux(monkeypatch, ["ac-s1", "other"], {"ac-s1": "Do you want to proceed?\n"})
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        assert collect_agent_states() == {"s1": "blocked"}

    def test_activity_between_polls_is_working(self, client, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "output A"})
        monkeypatch.setattr(agent_watch, "load_tmux_metadata", lambda name: {})

        assert collect_agent_states() == {"s1": "idle"}

        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "output B"})
        assert collect_agent_states() == {"s1": "working"}

    def test_capture_failure_skips_session(self, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {})
        assert collect_agent_states() == {}

    def test_stale_captures_are_pruned(self, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "text"})
        monkeypatch.setattr(agent_watch, "load_tmux_metadata", lambda name: {})
        collect_agent_states()
        assert "s1" in agent_watch._last_capture

        self._setup_tmux(monkeypatch, [], {})
        assert collect_agent_states() == {}
        assert agent_watch._last_capture == {}

    def test_tmux_unavailable_returns_empty(self, monkeypatch):
        monkeypatch.setattr(agent_watch, "_run_tmux_cmd", lambda *args: None)
        assert collect_agent_states() == {}

    def test_cached_session_meta_is_used(self, client, workspace, monkeypatch):
        res = client.post("/workspaces/test-ws/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "state_patterns": {"done": ["FINISHED"]},
        })
        job_name = res.json()["name"]

        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(
            workspace="test-ws", tmux_session_name="ac-s2", job_name=job_name,
        )
        with sessions_lock:
            TERMINAL_SESSIONS["s2"] = session

        self._setup_tmux(monkeypatch, ["ac-s2"], {"ac-s2": "FINISHED\n$ "})
        assert collect_agent_states() == {"s2": "done"}


class _FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


class TestSubscribeLifecycle:
    def test_subscribe_sends_snapshot_and_manages_task(self):
        async def run():
            ws = _FakeWebSocket()
            agent_watch._last_states["s1"] = "blocked"
            await agent_watch.subscribe(ws)
            assert agent_watch.subscriber_count() == 1
            assert agent_watch._poll_task is not None
            assert ws.sent == [states_payload({"s1": "blocked"})]

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
            await agent_watch._broadcast(states_payload({"s1": "done"}))
            assert alive.sent == [states_payload({"s1": "done"})]
            assert dead not in agent_watch._subscribers
            agent_watch.unsubscribe(alive)

        asyncio.run(run())


class TestStatusStreamWs:
    def test_snapshot_delivered_on_connect(self, client):
        agent_watch._last_states["s9"] = "blocked"
        with client.websocket_connect(f"/workspaces/statuses/ws?token={TOKEN}") as ws:
            msg = ws.receive_json()
            assert msg == states_payload({"s9": "blocked"})


class TestJobStatePatternsApi:
    def test_roundtrip_via_common_jobs(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "state_patterns": {"blocked": [" Do you want to ", ""], "done": []},
        })
        assert res.status_code == 200
        job_name = res.json()["name"]

        jobs = client.get("/common/jobs", headers=AUTH).json()
        # 語句は trim され、空行・空の状態キーは保存されない
        assert jobs[job_name]["state_patterns"] == {"blocked": ["Do you want to"]}

    def test_unknown_state_key_is_rejected(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "state_patterns": {"running": ["x"]},
        })
        assert res.status_code == 400
        assert "Unknown state pattern key" in res.json()["detail"]

    def test_too_long_phrase_is_rejected(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "state_patterns": {"blocked": ["x" * 201]},
        })
        assert res.status_code == 400

    def test_too_many_phrases_are_rejected(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "state_patterns": {"blocked": ["p"] * 21},
        })
        assert res.status_code == 400

    def test_browser_job_ignores_patterns(self, client):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "docs",
            "type": "browser",
            "url": "https://example.com",
            "state_patterns": {"blocked": ["never"]},
        })
        assert res.status_code == 200
        job_name = res.json()["name"]
        jobs = client.get("/common/jobs", headers=AUTH).json()
        assert jobs[job_name]["state_patterns"] == {}
