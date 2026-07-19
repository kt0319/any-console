"""api/session_snapshot.py のテスト。

セッション一覧の読み取り集約（TTL / last-known-good / 発見時登録）が
「tmux 一時失敗がセッション消滅としてクライアントへ伝播しない」ことを担保する。
"""
import subprocess
from unittest.mock import patch

import pytest


def _listing(stdout: str) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")


@pytest.fixture()
def registry_cleanup():
    yield
    from api.terminal_session import TERMINAL_SESSIONS, sessions_lock
    with sessions_lock:
        for sid in [s for s in TERMINAL_SESSIONS if s.startswith("snap-")]:
            TERMINAL_SESSIONS.pop(sid, None)


def _get(meta=None):
    from api.session_snapshot import get_sessions_snapshot
    with patch("api.terminal_session.load_tmux_metadata", return_value=meta or {}), \
         patch("api.terminal_session.detect_workspace_from_tmux", return_value=None):
        return get_sessions_snapshot()


class TestSnapshotTtl:
    def test_within_ttl_serves_cached_without_tmux_call(self, registry_cleanup):
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")) as run:
            first = _get()
            second = _get()
        assert run.call_count == 1
        assert second is first

    def test_invalidate_forces_rebuild(self, registry_cleanup):
        from api.session_snapshot import invalidate_sessions_snapshot
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")) as run:
            _get()
            invalidate_sessions_snapshot()
            _get()
        assert run.call_count == 2


class TestLastKnownGood:
    def test_serves_previous_snapshot_on_transient_failure(self, registry_cleanup):
        from api.session_snapshot import invalidate_sessions_snapshot
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")):
            first = _get()
        assert [s["session_id"] for s in first] == ["snap-a"]
        invalidate_sessions_snapshot()
        with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
            again = _get()
        assert [s["session_id"] for s in again] == ["snap-a"]

    def test_returns_none_when_never_succeeded(self):
        with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
            assert _get() is None

    def test_recovers_after_failure(self, registry_cleanup):
        from api.session_snapshot import invalidate_sessions_snapshot
        with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
            assert _get() is None
        invalidate_sessions_snapshot()
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")):
            assert [s["session_id"] for s in _get()] == ["snap-a"]


class TestBuildSnapshot:
    def test_nonzero_returncode_is_legit_empty(self):
        no_server = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="no server running")
        with patch("api.session_snapshot._run_tmux_cmd", return_value=no_server):
            assert _get() == []

    def test_filters_external_sessions_and_sorts_by_created(self, registry_cleanup):
        stdout = "external\t50\nac-snap-b\t200\nac-snap-a\t100\nac-\t10\n"
        with patch("api.session_snapshot._run_tmux_cmd", return_value=_listing(stdout)):
            snap = _get()
        assert [s["session_id"] for s in snap] == ["snap-a", "snap-b"]
        assert [s["created_at"] for s in snap] == [100, 200]

    def test_invalid_created_becomes_none(self, registry_cleanup):
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\tgarbage\n")):
            snap = _get()
        assert snap[0]["created_at"] is None

    def test_discovery_registers_session_with_metadata(self, registry_cleanup):
        from api.terminal_session import TERMINAL_SESSIONS, sessions_lock
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")):
            snap = _get(meta={"TMUX_WORKSPACE": "ws1"})
        assert snap[0]["workspace"] == "ws1"
        with sessions_lock:
            registered = TERMINAL_SESSIONS.get("snap-a")
        assert registered is not None
        assert registered.workspace == "ws1"

    def test_cached_registry_entry_is_reused(self, registry_cleanup):
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(workspace="ws-cached", tmux_session_name="ac-snap-a")
        with sessions_lock:
            TERMINAL_SESSIONS["snap-a"] = session
        from api.session_snapshot import get_sessions_snapshot
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")), \
             patch("api.terminal_session.load_tmux_metadata") as load:
            snap = get_sessions_snapshot()
        assert snap[0]["workspace"] == "ws-cached"
        load.assert_not_called()

    def test_incomplete_cached_entry_self_heals(self, registry_cleanup):
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(workspace=None, tmux_session_name="ac-snap-a")
        session.meta_incomplete = True
        with sessions_lock:
            TERMINAL_SESSIONS["snap-a"] = session
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")):
            snap = _get(meta={"TMUX_WORKSPACE": "ws1"})
        assert snap[0]["workspace"] == "ws1"
        assert session.meta_incomplete is False
