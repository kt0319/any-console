"""git ステータスのリアルタイム監視・配信（api/git_watch.py）のテスト。"""

import asyncio
import subprocess
from pathlib import Path

import pytest
from starlette.websockets import WebSocketDisconnect

from api import git_watch
from api.git_info import invalidate_git_info, refresh_git_info
from api.git_watch import (
    WatchTarget,
    collect_watch_targets,
    is_relevant_change,
    match_workspaces,
)
from conftest import TOKEN


@pytest.fixture(autouse=True)
def _reset_git_watch_state():
    yield
    git_watch._subscribers.clear()
    git_watch._stop_tasks()
    git_watch._loop = None
    git_watch._targets = []
    git_watch._restart_event = None


class TestIsRelevantChange:
    def test_working_tree_file_is_relevant(self):
        assert is_relevant_change("/ws/src/main.py") is True

    def test_untracked_new_file_is_relevant(self):
        assert is_relevant_change("/ws/new-file.txt") is True

    @pytest.mark.parametrize("ignored", [
        "/ws/node_modules/pkg/index.js",
        "/ws/.venv/lib/python3.11/site.py",
        "/ws/src/__pycache__/mod.cpython-311.pyc",
        "/ws/.mypy_cache/3.11/mod.json",
        "/ws/.pytest_cache/v/cache/lastfailed",
    ])
    def test_dependency_and_cache_dirs_are_ignored(self, ignored):
        assert is_relevant_change(ignored) is False

    @pytest.mark.parametrize("junk", [
        "/ws/.DS_Store",
        "/ws/src/.main.py.swp",
        "/ws/src/main.py~",
        "/ws/src/mod.pyc",
    ])
    def test_editor_junk_is_ignored(self, junk):
        assert is_relevant_change(junk) is False

    @pytest.mark.parametrize("git_path", [
        "/ws/.git/HEAD",
        "/ws/.git/index",
        "/ws/.git/FETCH_HEAD",
        "/ws/.git/MERGE_HEAD",
        "/ws/.git/ORIG_HEAD",
        "/ws/.git/packed-refs",
        "/ws/.git/refs/heads/main",
        "/ws/.git/refs/remotes/origin/main",
        "/ws/.git/worktrees/wt1/HEAD",
        "/ws/.git/worktrees/wt1/index",
    ])
    def test_git_state_files_are_relevant(self, git_path):
        assert is_relevant_change(git_path) is True

    @pytest.mark.parametrize("git_internal", [
        "/ws/.git",
        "/ws/.git/objects/ab/cdef0123",
        "/ws/.git/index.lock",
        "/ws/.git/COMMIT_EDITMSG",
        "/ws/.git/hooks/pre-commit",
    ])
    def test_other_git_internals_are_ignored(self, git_internal):
        assert is_relevant_change(git_internal) is False

    def test_empty_path_is_ignored(self):
        assert is_relevant_change("") is False


class TestMatchWorkspaces:
    def _targets(self):
        return [
            WatchTarget("main", Path("/repos/main")),
            WatchTarget("nested", Path("/repos/main/vendor/nested")),
            WatchTarget("main [feat]", Path("/repos/main-feat"), base="main"),
        ]

    def test_longest_prefix_wins(self):
        names = match_workspaces({"/repos/main/vendor/nested/a.txt"}, self._targets())
        assert names == {"nested"}

    def test_plain_change_maps_to_owner(self):
        names = match_workspaces({"/repos/main/src/a.py"}, self._targets())
        assert names == {"main"}

    def test_unmatched_path_is_dropped(self):
        assert match_workspaces({"/elsewhere/file"}, self._targets()) == set()

    def test_worktree_gitdir_change_includes_worktree_workspaces(self):
        # linked worktree の git 状態は本体の .git/worktrees/ 配下にあるため、
        # そこの変更で worktree 側ワークスペースも再計算対象になる
        names = match_workspaces({"/repos/main/.git/worktrees/feat/HEAD"}, self._targets())
        assert names == {"main", "main [feat]"}

    def test_prefix_match_requires_separator(self):
        targets = [WatchTarget("main", Path("/repos/main"))]
        assert match_workspaces({"/repos/main-other/file"}, targets) == set()


class TestCollectWatchTargets:
    def test_git_workspace_is_collected(self, git_workspace_with_commit):
        targets = collect_watch_targets()
        assert [t.name for t in targets] == ["test-ws"]
        assert targets[0].base is None

    def test_non_git_workspace_is_skipped(self, workspace):
        assert collect_watch_targets() == []

    def test_dynamic_worktree_is_collected_with_base(self, git_workspace_with_commit):
        wt_path = git_workspace_with_commit.parent / "test-ws-feat"
        subprocess.run(
            ["git", "worktree", "add", str(wt_path), "-b", "feat"],
            cwd=git_workspace_with_commit, check=True, capture_output=True,
        )
        targets = collect_watch_targets()
        names = {t.name for t in targets}
        assert "test-ws" in names
        wt = next(t for t in targets if t.name != "test-ws")
        assert wt.base == "test-ws"
        assert wt.path == wt_path


class FakeWS:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    async def send_json(self, payload):
        if self.fail:
            raise WebSocketDisconnect(1006)
        self.sent.append(payload)


class TestBroadcastAndPush:
    def test_push_status_broadcasts_and_dedupes(self, git_workspace_with_commit):
        async def run():
            fake = FakeWS()
            git_watch._subscribers.add(fake)
            target = WatchTarget("test-ws", git_workspace_with_commit)
            await git_watch._push_status(target)
            assert len(fake.sent) == 1
            msg = fake.sent[0]
            assert msg["type"] == "statuses"
            assert msg["statuses"][0]["name"] == "test-ws"
            assert msg["statuses"][0]["clean"] is True
            # 変化がなければ再送されない
            await git_watch._push_status(target)
            assert len(fake.sent) == 1
            # 変化があれば再送される
            (git_workspace_with_commit / "dirty.txt").write_text("x\n", encoding="utf-8")
            await git_watch._push_status(target)
            assert len(fake.sent) == 2
            assert fake.sent[1]["statuses"][0]["clean"] is False

        asyncio.run(run())

    def test_broadcast_drops_dead_subscriber(self):
        async def run():
            dead = FakeWS(fail=True)
            alive = FakeWS()
            git_watch._subscribers.update({dead, alive})
            await git_watch._broadcast({"type": "statuses", "statuses": []})
            assert dead not in git_watch._subscribers
            assert alive.sent

        asyncio.run(run())

    def test_push_by_name_resolves_target_without_cache(self, git_workspace_with_commit):
        async def run():
            fake = FakeWS()
            git_watch._subscribers.add(fake)
            git_watch._targets = []
            await git_watch._push_by_name("test-ws")
            assert fake.sent and fake.sent[0]["statuses"][0]["name"] == "test-ws"
            # 未知のワークスペース名は無視される
            await git_watch._push_by_name("no-such-ws")
            assert len(fake.sent) == 1

        asyncio.run(run())


class TestHandleChanges:
    def test_worktrees_change_triggers_restart(self, git_workspace_with_commit):
        async def run():
            git_watch._restart_event = asyncio.Event()
            targets = [WatchTarget("test-ws", git_workspace_with_commit)]
            gitdir = str(git_workspace_with_commit / ".git" / "worktrees" / "feat" / "HEAD")
            await git_watch._handle_changes({(1, gitdir)}, targets)
            assert git_watch._restart_event.is_set()

        asyncio.run(run())

    def test_change_pushes_matched_workspace(self, git_workspace_with_commit):
        async def run():
            fake = FakeWS()
            git_watch._subscribers.add(fake)
            targets = [WatchTarget("test-ws", git_workspace_with_commit)]
            changed = str(git_workspace_with_commit / "README.md")
            await git_watch._handle_changes({(2, changed)}, targets)
            assert fake.sent and fake.sent[0]["statuses"][0]["name"] == "test-ws"

        asyncio.run(run())


class TestLifecycle:
    def test_subscribe_starts_and_unsubscribe_stops_tasks(self):
        async def run():
            fake = FakeWS()
            await git_watch.subscribe(fake)
            assert git_watch.subscriber_count() == 1
            assert git_watch._watch_task is not None
            assert git_watch._fetch_task is not None
            git_watch.unsubscribe(fake)
            assert git_watch.subscriber_count() == 0
            assert git_watch._watch_task is None
            assert git_watch._last_sent == {}

        asyncio.run(run())

    def test_nudge_without_loop_is_noop(self):
        git_watch._loop = None
        git_watch.nudge_workspace("test-ws")  # 例外にならないこと

    def test_notify_without_loop_is_noop(self):
        git_watch._loop = None
        git_watch.notify_workspaces_changed()  # 例外にならないこと

    def test_nudge_schedules_push(self, git_workspace_with_commit):
        async def run():
            fake = FakeWS()
            await git_watch.subscribe(fake)
            git_watch._stop_tasks()  # 監視ループは止めて nudge 経路だけ検証する
            git_watch.nudge_workspace("test-ws")
            for _ in range(50):
                if fake.sent:
                    break
                await asyncio.sleep(0.05)
            git_watch.unsubscribe(fake)
            assert fake.sent and fake.sent[0]["statuses"][0]["name"] == "test-ws"

        asyncio.run(run())

    def test_notify_sets_restart_event(self):
        async def run():
            git_watch._loop = asyncio.get_running_loop()
            git_watch._restart_event = asyncio.Event()
            git_watch.notify_workspaces_changed()
            await asyncio.sleep(0.05)
            assert git_watch._restart_event.is_set()

        asyncio.run(run())

    def test_shutdown_clears_subscribers(self):
        git_watch._subscribers.add(FakeWS())
        git_watch.shutdown()
        assert git_watch.subscriber_count() == 0


class TestRefreshGitInfo:
    def test_refresh_bypasses_ttl_cache(self, git_workspace_with_commit):
        first = refresh_git_info(git_workspace_with_commit, "test-ws")
        assert first["clean"] is True
        (git_workspace_with_commit / "dirty.txt").write_text("x\n", encoding="utf-8")
        # refresh はキャッシュを破棄してから再計算するため直ちに変化が見える
        second = refresh_git_info(git_workspace_with_commit, "test-ws")
        assert second["clean"] is False

    def test_invalidate_nudges_stream(self, git_workspace_with_commit, monkeypatch):
        nudged = []
        monkeypatch.setattr(git_watch, "nudge_workspace", lambda name: nudged.append(name))
        invalidate_git_info("test-ws")
        assert nudged == ["test-ws"]


class TestStatusStreamWebSocket:
    def test_ws_rejects_invalid_token(self, client):
        with pytest.raises((WebSocketDisconnect, Exception)) as exc_info:
            with client.websocket_connect("/workspaces/statuses/ws?token=invalid") as ws:
                ws.receive_json()
        exc = exc_info.value
        if isinstance(exc, WebSocketDisconnect):
            assert exc.code == 1008

    def test_ws_accepts_valid_token_and_subscribes(self, client, git_workspace_with_commit):
        with client.websocket_connect(f"/workspaces/statuses/ws?token={TOKEN}"):
            assert git_watch.subscriber_count() == 1
        # 切断後は購読解除される（タスク停止は _reset_git_watch_state が担保）
        assert git_watch.subscriber_count() == 0
