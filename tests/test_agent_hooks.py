"""エージェント hooks（api/agent_hooks.py / routers/agent_hooks.py）のテスト。"""

import time

from conftest import AUTH

from api import agent_hooks
from api.agent_hooks import (
    get_hook_token,
    hook_session_env,
    hook_state,
    record_event,
    verify_hook_token,
)


class TestHookToken:
    def test_token_is_created_and_persisted(self, isolate_fs):
        token = get_hook_token()
        assert len(token) >= 32
        assert get_hook_token() == token  # 再読込でも同じ
        assert (isolate_fs["data"] / "hook_token").read_text().strip() == token

    def test_verify(self, isolate_fs):
        token = get_hook_token()
        assert verify_hook_token(token) is True
        assert verify_hook_token("wrong") is False
        assert verify_hook_token("") is False


class TestRecordEvent:
    def test_event_state_mapping(self):
        assert record_event("s1", "PreToolUse") is True
        assert hook_state("s1") == "working"
        record_event("s1", "Notification")
        assert hook_state("s1") == "blocked"
        record_event("s1", "Stop")
        assert hook_state("s1") == "idle"

    def test_tmux_prefix_is_stripped(self):
        from api.common import TMUX_SESSION_PREFIX
        record_event(TMUX_SESSION_PREFIX + "s2", "Notification")
        assert hook_state("s2") == "blocked"

    def test_unknown_event_is_ignored(self):
        assert record_event("s1", "SomeFutureEvent") is False
        assert hook_state("s1") is None

    def test_subagent_stop_does_not_change_state(self):
        record_event("s1", "PreToolUse")
        assert record_event("s1", "SubagentStop") is False
        assert hook_state("s1") == "working"

    def test_session_end_clears_state(self):
        record_event("s1", "Notification")
        assert record_event("s1", "SessionEnd") is True
        assert hook_state("s1") is None

    def test_empty_session_is_rejected(self):
        assert record_event("", "Stop") is False
        assert record_event("   ", "Stop") is False

    def test_state_expires_after_ttl(self, monkeypatch):
        record_event("s1", "Notification")
        assert hook_state("s1") == "blocked"
        real_monotonic = time.monotonic
        monkeypatch.setattr(
            agent_hooks.time, "monotonic",
            lambda: real_monotonic() + agent_hooks.AGENT_HOOK_STATE_TTL_SEC + 1)
        assert hook_state("s1") is None
        # 期限切れエントリは除去される
        assert "s1" not in agent_hooks._hook_states

    def test_clear_session(self):
        record_event("s1", "Notification")
        agent_hooks.clear_session("s1")
        assert hook_state("s1") is None


class TestHookSessionEnv:
    def test_env_contains_connection_info(self, isolate_fs):
        env = hook_session_env("ac-abc")
        assert env["ANY_CONSOLE_SESSION"] == "ac-abc"
        assert env["ANY_CONSOLE_HOOK_URL"].startswith("http://127.0.0.1:")
        assert env["ANY_CONSOLE_HOOK_URL"].endswith("/agent-hooks/events")
        assert env["ANY_CONSOLE_HOOK_TOKEN"] == get_hook_token()

    def test_configured_host_and_port(self, isolate_fs):
        import json
        isolate_fs["config_file"].write_text(json.dumps({
            "__global__": {"config_version": 1, "host": "100.64.0.5", "port": 9999},
        }))
        env = hook_session_env("ac-abc")
        assert env["ANY_CONSOLE_HOOK_URL"] == "http://100.64.0.5:9999/agent-hooks/events"

    def test_wildcard_bind_maps_to_loopback(self, isolate_fs):
        import json
        isolate_fs["config_file"].write_text(json.dumps({
            "__global__": {"config_version": 1, "host": "0.0.0.0", "port": 8888},
        }))
        env = hook_session_env("ac-abc")
        assert env["ANY_CONSOLE_HOOK_URL"] == "http://127.0.0.1:8888/agent-hooks/events"


class TestHookEndpoint:
    def test_rejects_missing_or_wrong_token(self, client):
        res = client.post("/agent-hooks/events", json={"session": "ac-s1", "event": "Stop"})
        assert res.status_code == 401
        res = client.post("/agent-hooks/events", json={"session": "ac-s1", "event": "Stop"},
                          headers={"X-Hook-Token": "wrong"})
        assert res.status_code == 401

    def test_accepts_valid_event(self, client):
        res = client.post("/agent-hooks/events", json={"session": "ac-s1", "event": "Notification"},
                          headers={"X-Hook-Token": get_hook_token()})
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "recognized": True}
        assert hook_state("s1") == "blocked"

    def test_unknown_event_is_reported_unrecognized(self, client):
        res = client.post("/agent-hooks/events", json={"session": "ac-s1", "event": "Nope"},
                          headers={"X-Hook-Token": get_hook_token()})
        assert res.status_code == 200
        assert res.json()["recognized"] is False

    def test_validation_rejects_oversized_fields(self, client):
        res = client.post("/agent-hooks/events", json={"session": "x" * 300, "event": "Stop"},
                          headers={"X-Hook-Token": get_hook_token()})
        assert res.status_code == 422

    def test_endpoint_skips_rate_limit(self, client):
        from api.rate_limiter import _SKIP_EXACT
        assert "/agent-hooks/events" in _SKIP_EXACT

    def test_main_token_does_not_work(self, client):
        # メイン Bearer とは独立した認証であること（誤って verify_token に流れない）
        res = client.post("/agent-hooks/events", json={"session": "s", "event": "Stop"},
                          headers=AUTH)
        assert res.status_code == 401
