"""エージェント状態の監視・配信（api/agent_watch.py）のテスト。"""

import asyncio

import pytest
from conftest import AUTH, TOKEN

from api import agent_watch
from api.agent_watch import (
    classify_agent_state,
    collect_agent_states,
    diff_states,
    phrase_notify_payload,
    states_payload,
)


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


class TestPhraseNotifyPayload:
    def test_payload_shape(self):
        payload = phrase_notify_payload("s1", "done!", "my-ws")
        assert payload == {
            "type": "phrase_notify",
            "session_id": "s1",
            "phrase": "done!",
            "workspace": "my-ws",
        }

    def test_workspace_none_is_preserved(self):
        payload = phrase_notify_payload("s1", "done!", None)
        assert payload["workspace"] is None


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
        monkeypatch.setattr(agent_watch, "PHRASE_NOTIFY_IDLE_GRACE_SEC", 0)

        self._setup_tmux(monkeypatch, ["ac-s1", "other"], {"ac-s1": "Session complete\n$ "})
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        # 初回検出のポーリングでは通知しない（フレーズ出現自体による画面変化を
        # 「反応」と誤検知しないよう、検出時刻の記録だけを行う）。
        states, notifications, _ = collect_agent_states()
        assert states == {"s1": "idle"}
        assert notifications == []

        # 画面が変わらないまま次のポーリング → 猶予(0)経過で通知される。
        states, notifications, _ = collect_agent_states()
        assert any(phrase == "Session complete" for _, phrase, *_ in notifications)

    def test_ws_notify_fires_immediately_without_grace_period(self, client, monkeypatch):
        """タブの通知マークは push と違い、猶予を待たず検出即時に一度だけ発火する。"""
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "Session complete",
        })
        job_name = res.json()["name"]
        # 猶予はデフォルトのまま（push側は通知されない）でも ws_notifications は即時発火する。
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Session complete\n$ "})
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        _, notifications, ws_notifications = collect_agent_states()
        assert notifications == []  # push は初検出のみでは飛ばない
        assert ws_notifications == [("s1", "Session complete", None)]

        # 同じフレーズが画面にある間は再送しない
        _, _, ws_notifications2 = collect_agent_states()
        assert ws_notifications2 == []

        # フレーズが消えたら次の出現でまた発火する
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "$ "})
        collect_agent_states()
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Session complete\n$ "})
        _, _, ws_notifications3 = collect_agent_states()
        assert ws_notifications3 == [("s1", "Session complete", None)]

    def test_notification_waits_for_idle_grace_period(self, client, monkeypatch):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "Done",
        })
        job_name = res.json()["name"]
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Done\n$ "})

        collect_agent_states()  # 初検出
        _, notifications, _ = collect_agent_states()  # 画面は静止だが猶予(デフォルト20秒)未経過
        assert notifications == []

    def test_activity_after_detection_suppresses_notification(self, client, monkeypatch):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "Done",
        })
        job_name = res.json()["name"]
        monkeypatch.setattr(agent_watch, "PHRASE_NOTIFY_IDLE_GRACE_SEC", 0)
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Done\n$ "})
        _, notifications, _ = collect_agent_states()
        assert notifications == []  # 初検出のみ

        # 検出直後に画面が動いた（ユーザーが反応した）→ このフレーズ出現では通知しない
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Done\n$ echo hi\nhi\n$ "})
        states, notifications, _ = collect_agent_states()
        assert notifications == []
        assert states == {"s1": "working"}

        # その後画面が変わらなくても、もう通知しない
        _, notifications, _ = collect_agent_states()
        assert notifications == []

    def test_notify_phrase_not_duplicated(self, client, monkeypatch):
        res = client.post("/common/jobs", headers=AUTH, json={
            "label": "agent",
            "command": "claude",
            "notify_phrase": "Done",
        })
        job_name = res.json()["name"]
        monkeypatch.setattr(agent_watch, "PHRASE_NOTIFY_IDLE_GRACE_SEC", 0)

        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "Done\n$ "})
        monkeypatch.setattr(
            agent_watch, "load_tmux_metadata",
            lambda name: {"TMUX_JOB_NAME": job_name},
        )

        collect_agent_states()  # 初検出
        _, notifications, _ = collect_agent_states()  # 画面静止・猶予経過 → 通知
        assert any(phrase == "Done" for _, phrase, *_ in notifications)

        # 同じフレーズが画面にある間は再通知しない
        _, notifications2, _ = collect_agent_states()
        assert notifications2 == []

    def test_activity_between_polls_is_working(self, client, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "output A"})
        monkeypatch.setattr(agent_watch, "load_tmux_metadata", lambda name: {})

        states, _, _ = collect_agent_states()
        assert states == {"s1": "idle"}

        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "output B"})
        states, _, _ = collect_agent_states()
        assert states == {"s1": "working"}

    def test_capture_failure_skips_session(self, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {})
        states, _, _ = collect_agent_states()
        assert states == {}

    def test_stale_captures_are_pruned(self, monkeypatch):
        self._setup_tmux(monkeypatch, ["ac-s1"], {"ac-s1": "text"})
        monkeypatch.setattr(agent_watch, "load_tmux_metadata", lambda name: {})
        collect_agent_states()
        assert "s1" in agent_watch._last_capture

        self._setup_tmux(monkeypatch, [], {})
        states, _, _ = collect_agent_states()
        assert states == {}
        assert agent_watch._last_capture == {}

    def test_tmux_unavailable_returns_none(self, monkeypatch):
        # tmux コマンド自体の失敗（result is None）は、正当な「セッション0件」と区別する。
        # None のまま呼び出し元（_poll_loop）に伝播させ、直前の状態を上書きさせないため。
        monkeypatch.setattr(agent_watch, "_run_tmux_cmd", lambda *args: None)
        states, notifications, _ = collect_agent_states()
        assert states is None
        assert notifications == []

    def test_tmux_zero_sessions_returns_empty(self, monkeypatch):
        monkeypatch.setattr(
            agent_watch, "_run_tmux_cmd",
            lambda *args: _FakeTmuxResult("", returncode=1),
        )
        states, _, _ = collect_agent_states()
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

        monkeypatch.setattr(agent_watch, "PHRASE_NOTIFY_IDLE_GRACE_SEC", 0)
        self._setup_tmux(monkeypatch, ["ac-s2"], {"ac-s2": "FINISHED\n$ "})
        states, notifications, _ = collect_agent_states()
        assert states == {"s2": "idle"}
        assert notifications == []  # 初検出のみ

        states, notifications, _ = collect_agent_states()
        assert states == {"s2": "idle"}
        assert any(phrase == "FINISHED" for _, phrase, *_ in notifications)


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
