"""ターミナルセッションのエージェント状態の監視・配信。

tmux の可視ペイン内容を定期ポーリングし、出力アクティビティから各セッションの
状態を判定して、変化のあったセッションだけ status stream の WebSocket 購読者へ
push する（routers/status_stream.py が git_watch と同じソケットに相乗せする）。

状態は 2 値:
- working: 前回ポーリングから出力が変化した
- idle:    画面が静止している

ジョブ定義に notify_phrase が設定されている場合、可視ペインにその文字列が
現れたタイミングでプッシュ通知を送る（重複送信は抑制する）。

git_watch と同じく購読者がいる間だけポーリングタスクが動き、購読者ゼロで
停止するため、クライアントが繋がっていないときのコストはゼロ。
"""

import asyncio
import logging
import time
from typing import Any

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

from .common import (
    AGENT_WATCH_POLL_INTERVAL_SEC,
    BACKGROUND_EXECUTOR,
    TMUX_SESSION_PREFIX,
)
from .tmux import _run_tmux_cmd, capture_visible_pane, load_tmux_metadata

logger = logging.getLogger(__name__)

STATE_WORKING = "working"
STATE_IDLE = "idle"


def classify_agent_state(
    capture: str,
    prev_capture: str | None,
    working_enabled: bool = True,
) -> str:
    """可視ペインの内容からセッション状態を判定する純関数。

    - 前回ポーリングから出力が変化していれば working（スピナー等の動きも拾う）
    - 画面が静止していれば idle
    """
    if working_enabled and prev_capture is not None and capture != prev_capture:
        return STATE_WORKING
    return STATE_IDLE


def _list_session_ids() -> list[str] | None:
    """tmux のセッション一覧を返す。tmux コマンド自体が失敗した場合は None。

    result.returncode != 0（tmux サーバー未起動でセッション0件など）と、
    result is None（コマンド実行自体の失敗・タイムアウト）を区別する。
    前者は正当な「セッション0件」なので [] を返すが、後者を [] にすると
    呼び出し元が一時的な取得失敗を「セッション消滅」と誤認してしまう。
    """
    result = _run_tmux_cmd("list-sessions", "-F", "#{session_name}")
    if result is None:
        return None
    if result.returncode != 0:
        return []
    ids = []
    for line in result.stdout.strip().splitlines():
        name = line.strip()
        if name.startswith(TMUX_SESSION_PREFIX) and len(name) > len(TMUX_SESSION_PREFIX):
            ids.append(name[len(TMUX_SESSION_PREFIX):])
    return ids


def _session_meta(session_id: str) -> tuple[str | None, str | None]:
    """セッションの (workspace, job_name) を返す。キャッシュ優先・tmux env で補完。"""
    from .terminal_session import TERMINAL_SESSIONS, sessions_lock
    with sessions_lock:
        cached = TERMINAL_SESSIONS.get(session_id)
    if cached is not None:
        return cached.workspace, cached.job_name
    meta = load_tmux_metadata(TMUX_SESSION_PREFIX + session_id) or {}
    return meta.get("TMUX_WORKSPACE"), meta.get("TMUX_JOB_NAME")


def _job_notify_phrase(workspace: str | None, job_name: str | None) -> str:
    """セッションを起動したジョブ定義から notify_phrase を引く（ジョブ無しは空文字）。"""
    if not job_name:
        return ""
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        entry = get_workspace_jobs(workspace).get(job_name)
        return entry[0].notify_phrase if entry else ""
    data = load_common_jobs_data()
    raw = data.get(job_name)
    return entry_to_job_definition(job_name, raw).notify_phrase if raw is not None else ""


def _job_notify_delay(workspace: str | None, job_name: str | None) -> int:
    """セッションを起動したジョブ定義から notify_delay_min を引く（ジョブ無しは 0）。"""
    if not job_name:
        return 0
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        entry = get_workspace_jobs(workspace).get(job_name)
        return entry[0].notify_delay_min if entry else 0
    data = load_common_jobs_data()
    raw = data.get(job_name)
    return entry_to_job_definition(job_name, raw).notify_delay_min if raw is not None else 0


def _job_working_enabled(workspace: str | None, job_name: str | None) -> bool:
    """セッションを起動したジョブ定義から working_enabled を引く（ジョブ無しは True）。"""
    if not job_name:
        return True
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        entry = get_workspace_jobs(workspace).get(job_name)
        return entry[0].working_enabled if entry else True
    data = load_common_jobs_data()
    raw = data.get(job_name)
    return entry_to_job_definition(job_name, raw).working_enabled if raw is not None else True


# ポーリング間の可視ペイン内容（アクティビティ判定用）。ポーリングタスクのみが触る。
_last_capture: dict[str, str] = {}
# フレーズ初検出時刻（monotonic）。キー不在 = 未検出、None = 通知送信済み。
_phrase_detected_at: dict[str, float | None] = {}

_subscribers: set[WebSocket] = set()
_poll_task: asyncio.Task | None = None
_last_states: dict[str, str] = {}


def reset_last_capture(session_id: str) -> None:
    """リサイズ後など、次回ポーリングで working を誤検知しないよう比較基準をクリアする。

    _last_states の stale な "working" も除去する。status stream WS が再接続時に
    スナップショットを送る際に古い "working" が届かないようにするため。
    """
    _last_capture.pop(session_id, None)
    if _last_states.get(session_id) == STATE_WORKING:
        _last_states.pop(session_id, None)


def collect_agent_states() -> tuple[dict[str, str] | None, list[tuple[str, str, str | None]]]:
    """全ターミナルセッションの状態を判定して返す（executor スレッドで実行）。

    Returns:
        (states, notifications): states は session_id→state の辞書。
        tmux コマンド自体が失敗した場合は states が None（呼び出し元は
        直前のスナップショットを保持し、空で上書きしない）。
        notifications はプッシュ通知すべき (session_id, phrase, workspace) のリスト。
    """
    session_ids = _list_session_ids()
    if session_ids is None:
        return None, []
    states: dict[str, str] = {}
    notifications: list[tuple[str, str, str | None]] = []
    now = time.monotonic()
    for session_id in session_ids:
        capture = capture_visible_pane(TMUX_SESSION_PREFIX + session_id)
        if capture is None:
            continue
        workspace, job_name = _session_meta(session_id)
        notify_phrase = _job_notify_phrase(workspace, job_name)
        working_enabled = _job_working_enabled(workspace, job_name)
        new_state = classify_agent_state(capture, _last_capture.get(session_id), working_enabled)
        states[session_id] = new_state
        if notify_phrase and notify_phrase in capture:
            if session_id not in _phrase_detected_at:
                # 初検出: 検出時刻を記録
                _phrase_detected_at[session_id] = now
            detected_at = _phrase_detected_at[session_id]
            if detected_at is not None:
                delay_sec = _job_notify_delay(workspace, job_name) * 60
                if now - detected_at >= delay_sec:
                    notifications.append((session_id, notify_phrase, workspace))
                    _phrase_detected_at[session_id] = None  # 送信済みマーク
        else:
            _phrase_detected_at.pop(session_id, None)
        _last_capture[session_id] = capture
    for stale in set(_last_capture) - set(states):
        del _last_capture[stale]
    for stale in set(_phrase_detected_at) - set(states):
        del _phrase_detected_at[stale]
    return states, notifications


def subscriber_count() -> int:
    return len(_subscribers)


def states_payload(states: dict[str, str]) -> dict[str, Any]:
    return {
        "type": "agent_states",
        "states": [
            {"session_id": session_id, "state": state}
            for session_id, state in states.items()
        ],
    }


async def subscribe(websocket: WebSocket) -> None:
    """購読者を登録し、最初の購読者ならポーリングタスクを起動する。

    既知の状態スナップショットを即時送信して、再接続時にポーリング 1 周期分の
    空白が生まれないようにする。
    """
    _subscribers.add(websocket)
    _ensure_task()
    if _last_states:
        try:
            await websocket.send_json(states_payload(_last_states))
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass


def unsubscribe(websocket: WebSocket) -> None:
    """購読者を解除し、ゼロになったらポーリングを停止する。"""
    _subscribers.discard(websocket)
    if not _subscribers:
        _stop_task()


def _task_stale(task: asyncio.Task | None, loop: asyncio.AbstractEventLoop) -> bool:
    # テスト等でイベントループが作り直された場合、旧ループのタスクは無効
    return task is None or task.done() or task.get_loop() is not loop


def _ensure_task() -> None:
    global _poll_task
    loop = asyncio.get_running_loop()
    if _task_stale(_poll_task, loop):
        _poll_task = loop.create_task(_poll_loop())


def ensure_phrase_task() -> None:
    """push subscription が存在する場合にポーリングタスクを起動する。

    ブラウザが背景に行き WS 購読者がいなくても phrase 検出を継続するために呼ぶ。
    イベントループが動いていない場合（サーバ起動前など）は無視する。
    """
    global _poll_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _task_stale(_poll_task, loop):
        _poll_task = loop.create_task(_poll_loop())


def _stop_task() -> None:
    global _poll_task
    if _poll_task is not None and not _poll_task.done():
        try:
            _poll_task.cancel()
        except RuntimeError:  # 属するループが既に閉じている
            pass
    _poll_task = None
    _last_states.clear()
    _last_capture.clear()
    _phrase_detected_at.clear()


def shutdown() -> None:
    """アプリ終了時のクリーンアップ（lifespan から呼ばれる）。"""
    _subscribers.clear()
    _stop_task()


def diff_states(previous: dict[str, str], current: dict[str, str]) -> dict[str, str]:
    """前回配信から状態が変わったセッションだけを取り出す純関数。"""
    return {
        session_id: state
        for session_id, state in current.items()
        if previous.get(session_id) != state
    }


async def _broadcast(payload: dict[str, Any]) -> None:
    dead = []
    for ws in list(_subscribers):
        try:
            await ws.send_json(payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            dead.append(ws)
    for ws in dead:
        unsubscribe(ws)


async def _poll_loop() -> None:  # pragma: no cover - 実時間スリープに依存
    """購読者がいる間、または push subscription がある間、可視ペインをポーリングする。

    WS 購読者がいない場合でも push subscription が登録されていれば phrase 検出を継続し、
    バックグラウンド時の通知を可能にする。
    """
    from .push import has_subscriptions, send_push_notification
    try:
        while _subscribers or has_subscriptions():
            await asyncio.sleep(AGENT_WATCH_POLL_INTERVAL_SEC)
            if not _subscribers and not has_subscriptions():
                break
            loop = asyncio.get_running_loop()
            states, notifications = await loop.run_in_executor(BACKGROUND_EXECUTOR, collect_agent_states)
            if states is None:
                # tmux コマンド自体が一時的に失敗。直前のスナップショットを保持して
                # 次の周期に委ね、状態を空で上書きしない（誤って working/idle が消えるのを防ぐ）。
                continue
            changed = diff_states(_last_states, states)
            _last_states.clear()
            _last_states.update(states)
            if changed:
                await _broadcast(states_payload(changed))
            for session_id, phrase, workspace in notifications:
                send_push_notification(
                    title="Phrase detected",
                    body=f"{workspace}: {phrase}" if workspace else phrase,
                    url=f"/?session={session_id}",
                    notif_type="phrase",
                )
    except asyncio.CancelledError:
        pass
