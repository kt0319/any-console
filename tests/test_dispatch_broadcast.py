"""dispatch キューWS配信インフラのテスト（承認フローのビジネスロジックとは独立）。

購読管理・スナップショット配信・coalescing・stuck subscriber切断といった配信
インフラ自体の挙動を検証する。承認フロー本体のテストは test_dispatch.py 側。
"""

import asyncio

import pytest

from api.routers import dispatch as dispatch_mod


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
