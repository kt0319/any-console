"""api/session_snapshot.py のテスト。

セッション一覧の読み取り集約（TTL / last-known-good / 変更時破棄 / 世代ガード /
発見時登録）が「tmux 一時失敗がセッション消滅としてクライアントへ伝播しない」
「変更前の一覧を変更後に正として配信しない」ことを担保する。
"""
import subprocess
from unittest.mock import patch

import pytest


def _listing(stdout: str) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")


# TTL を 0 にして毎回再構築させる（invalidate と違い前回値 = last-known-good は残る）。
def _no_ttl():
    return patch("api.session_snapshot.SESSIONS_SNAPSHOT_TTL_SEC", 0.0)


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


class TestAttemptThrottle:
    def test_within_ttl_serves_cached_without_tmux_call(self, registry_cleanup):
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")) as run:
            first = _get()
            second = _get()
        assert run.call_count == 1
        assert second is first

    def test_failed_attempt_is_not_retried_within_ttl(self):
        # tmux が詰まっている間、ポーリング全員が構築（最大 5 秒のタイムアウト）を
        # 直列に繰り返すと threadpool を食い潰す。失敗も試行として TTL で間引く。
        with patch("api.session_snapshot._run_tmux_cmd", return_value=None) as run:
            assert _get() is None
            assert _get() is None
        assert run.call_count == 1

    def test_invalidate_forces_rebuild(self, registry_cleanup):
        from api.session_snapshot import invalidate_sessions_snapshot
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")) as run:
            _get()
            invalidate_sessions_snapshot()
            _get()
        assert run.call_count == 2


class TestLastKnownGood:
    def test_passive_refresh_failure_serves_previous_snapshot(self, registry_cleanup):
        # TTL 失効による受動的な再構築の失敗では、最後に成功した一覧を返し続ける。
        with _no_ttl():
            with patch("api.session_snapshot._run_tmux_cmd",
                       return_value=_listing("ac-snap-a\t100\n")):
                first = _get()
            assert [s["session_id"] for s in first] == ["snap-a"]
            with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
                again = _get()
        assert again is first

    def test_mutation_discards_previous_snapshot(self, registry_cleanup):
        # 変更操作後の失敗では変更前の一覧を返さない（None = 500）。
        # 古い一覧を正として返すと、作りたてのタブが閉じられる／削除した
        # タブが復活する。
        from api.session_snapshot import invalidate_sessions_snapshot
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")):
            assert _get() is not None
        invalidate_sessions_snapshot()
        with _no_ttl(), patch("api.session_snapshot._run_tmux_cmd", return_value=None):
            assert _get() is None

    def test_returns_none_when_never_succeeded(self):
        with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
            assert _get() is None

    def test_recovers_after_failure(self, registry_cleanup):
        with _no_ttl():
            with patch("api.session_snapshot._run_tmux_cmd", return_value=None):
                assert _get() is None
            with patch("api.session_snapshot._run_tmux_cmd",
                       return_value=_listing("ac-snap-a\t100\n")):
                assert [s["session_id"] for s in _get()] == ["snap-a"]


class TestGenerationGuard:
    def test_invalidate_during_build_prevents_caching(self, registry_cleanup):
        # 構築中に変更操作（invalidate）が入ったら、その構築結果は変更前の
        # 状態かもしれないのでキャッシュせず、次の読み取りで再構築する。
        from api.session_snapshot import invalidate_sessions_snapshot

        def run_and_mutate(*args):
            invalidate_sessions_snapshot()  # 構築中の変更操作をシミュレート
            return _listing("ac-snap-a\t100\n")

        with patch("api.session_snapshot._run_tmux_cmd", side_effect=run_and_mutate) as run:
            first = _get()
        assert [s["session_id"] for s in first] == ["snap-a"]
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")) as run2:
            _get()
        assert run2.call_count == 1  # キャッシュされていないので TTL 内でも再構築


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
        from api.session_snapshot import get_sessions_snapshot
        from api.terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
        session = TerminalSession(workspace="ws-cached", tmux_session_name="ac-snap-a")
        with sessions_lock:
            TERMINAL_SESSIONS["snap-a"] = session
        with patch("api.session_snapshot._run_tmux_cmd",
                   return_value=_listing("ac-snap-a\t100\n")), \
             patch("api.terminal_session.load_tmux_metadata") as load:
            snap = get_sessions_snapshot()
        assert snap[0]["workspace"] == "ws-cached"
        load.assert_not_called()

    def test_metadata_failure_during_discovery_keeps_last_known_good(self, registry_cleanup):
        # 未登録セッションのメタデータが読めない間は、不完全な一覧を配信せず
        # ビルドごと失敗させて前回の正常値を返す（素のターミナル化の防止）。
        from api.session_snapshot import get_sessions_snapshot
        from api.terminal_session import TERMINAL_SESSIONS, sessions_lock
        with _no_ttl():
            with patch("api.session_snapshot._run_tmux_cmd",
                       return_value=_listing("ac-snap-a\t100\n")):
                first = _get(meta={"TMUX_WORKSPACE": "ws1"})
            assert first[0]["workspace"] == "ws1"
            with sessions_lock:
                TERMINAL_SESSIONS.pop("snap-a", None)  # 未登録状態を再現
            with patch("api.session_snapshot._run_tmux_cmd",
                       return_value=_listing("ac-snap-a\t100\n")), \
                 patch("api.terminal_session.load_tmux_metadata", return_value=None):
                again = get_sessions_snapshot()
        assert again is first
        with sessions_lock:
            assert "snap-a" not in TERMINAL_SESSIONS  # 不完全な登録をしていない
