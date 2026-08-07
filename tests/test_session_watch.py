"""session_watch（ターミナルセッション作成・削除のWS配信）のテスト。"""

import asyncio

import pytest

from api import session_watch


@pytest.fixture(autouse=True)
def _clear_state():
    session_watch._subscribers.clear()
    session_watch._loop = None
    yield
    session_watch._subscribers.clear()
    session_watch._loop = None


class _FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


class _DeadWS(_FakeWS):
    async def send_json(self, payload):
        raise RuntimeError("connection closed")


async def _wait_for(predicate, timeout=2.5):
    elapsed = 0.0
    step = 0.05
    while not predicate():
        if elapsed >= timeout:
            raise AssertionError("timed out waiting for condition")
        await asyncio.sleep(step)
        elapsed += step


class TestSubscribe:
    def test_subscribe_registers_and_unsubscribe_removes(self):
        async def run():
            ws = _FakeWS()
            await session_watch.subscribe(ws)
            assert session_watch.subscriber_count() == 1
            session_watch.unsubscribe(ws)
            assert session_watch.subscriber_count() == 0

        asyncio.run(run())


class TestNotify:
    def test_notify_without_loop_is_noop(self):
        session_watch._loop = None
        session_watch.notify_session_created("s1")  # 例外にならないこと
        session_watch.notify_session_removed("s1")

    def test_notify_without_subscribers_is_noop(self):
        async def run():
            session_watch._loop = asyncio.get_running_loop()
            session_watch.notify_session_created("s1")  # 例外にならないこと
            await asyncio.sleep(0.05)

        asyncio.run(run())

    def test_notify_session_created_reaches_subscriber(self):
        async def run():
            ws = _FakeWS()
            await session_watch.subscribe(ws)
            session_watch.notify_session_created("s1")
            await _wait_for(lambda: bool(ws.sent))
            assert ws.sent[-1] == {"type": "session_created", "session_id": "s1"}

        asyncio.run(run())

    def test_notify_session_removed_reaches_subscriber(self):
        async def run():
            ws = _FakeWS()
            await session_watch.subscribe(ws)
            session_watch.notify_session_removed("s1")
            await _wait_for(lambda: bool(ws.sent))
            assert ws.sent[-1] == {"type": "session_removed", "session_id": "s1"}

        asyncio.run(run())

    def test_notify_session_workspace_bound_reaches_subscriber(self):
        async def run():
            ws = _FakeWS()
            await session_watch.subscribe(ws)
            session_watch.notify_session_workspace_bound("s1", "proj")
            await _wait_for(lambda: bool(ws.sent))
            assert ws.sent[-1] == {"type": "session_workspace_bound", "session_id": "s1", "workspace": "proj"}

        asyncio.run(run())

    def test_notify_session_job_bound_reaches_subscriber(self):
        async def run():
            ws = _FakeWS()
            await session_watch.subscribe(ws)
            session_watch.notify_session_job_bound("s1", "job_x", "My Job")
            await _wait_for(lambda: bool(ws.sent))
            assert ws.sent[-1] == {"type": "session_job_bound", "session_id": "s1", "job_name": "job_x", "job_label": "My Job"}

        asyncio.run(run())

    def test_notify_reaches_all_subscribers(self):
        async def run():
            ws1, ws2 = _FakeWS(), _FakeWS()
            await session_watch.subscribe(ws1)
            await session_watch.subscribe(ws2)
            session_watch.notify_session_created("s1")
            await _wait_for(lambda: bool(ws1.sent) and bool(ws2.sent))
            assert ws1.sent[-1]["session_id"] == "s1"
            assert ws2.sent[-1]["session_id"] == "s1"

        asyncio.run(run())

    def test_notify_drops_dead_subscriber(self):
        async def run():
            alive, dead = _FakeWS(), _DeadWS()
            await session_watch.subscribe(alive)
            await session_watch.subscribe(dead)
            session_watch.notify_session_created("s1")
            await _wait_for(lambda: bool(alive.sent))
            await asyncio.sleep(0.05)  # dead側の後片付け完了を待つ
            assert dead not in session_watch._subscribers
            assert alive in session_watch._subscribers

        asyncio.run(run())
