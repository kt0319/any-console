"""ws_broadcast.broadcast_to（WS fan-out 共通実装）の単体テスト。

各購読モジュール経由の結合的な挙動は test_dispatch_broadcast.py /
test_git_watch.py / test_agent_watch.py 側でも担保されている。
"""

import asyncio

from api.ws_broadcast import broadcast_to


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


class _StuckWS(_FakeWS):
    async def send_json(self, payload):
        await asyncio.Event().wait()


class TestBroadcastTo:
    def test_sends_payload_to_all_subscribers(self):
        ws1, ws2 = _FakeWS(), _FakeWS()
        subscribers = {ws1, ws2}

        asyncio.run(broadcast_to(subscribers, {"type": "x"}, on_dead=subscribers.discard))

        assert ws1.sent == [{"type": "x"}]
        assert ws2.sent == [{"type": "x"}]
        assert subscribers == {ws1, ws2}

    def test_dead_subscriber_is_passed_to_on_dead(self):
        alive, dead = _FakeWS(), _DeadWS()
        subscribers = {alive, dead}

        asyncio.run(broadcast_to(subscribers, {"type": "x"}, on_dead=subscribers.discard))

        assert subscribers == {alive}
        assert alive.sent == [{"type": "x"}]
        # send_timeout なしでは失敗した接続を close はしない（呼び出し側の従来挙動）
        assert dead.closed is False

    def test_on_dead_callback_receives_each_dead_ws(self):
        dead1, dead2 = _DeadWS(), _DeadWS()
        removed = []

        asyncio.run(broadcast_to([dead1, dead2], {"type": "x"}, on_dead=removed.append))

        assert set(removed) == {dead1, dead2}

    def test_stuck_subscriber_times_out_and_is_closed(self):
        alive, stuck = _FakeWS(), _StuckWS()
        subscribers = {alive, stuck}

        asyncio.run(broadcast_to(
            subscribers, {"type": "x"}, on_dead=subscribers.discard, send_timeout=0.01,
        ))

        assert subscribers == {alive}
        assert stuck.closed is True
        assert alive.closed is False
        assert alive.sent == [{"type": "x"}]

    def test_close_failure_after_timeout_is_swallowed(self):
        class _StuckWsBrokenClose(_StuckWS):
            async def close(self):
                raise OSError("already gone")

        stuck = _StuckWsBrokenClose()
        removed = []

        asyncio.run(broadcast_to([stuck], {"type": "x"}, on_dead=removed.append, send_timeout=0.01))

        assert removed == [stuck]
