"""ターミナルセッションのエージェント状態の監視・配信。

tmux の可視ペイン内容を定期ポーリングし、ジョブ定義の state_patterns
（blocked / done の検知語句）と出力アクティビティから各セッションの状態を
判定して、変化のあったセッションだけ status stream の WebSocket 購読者へ
push する（routers/status_stream.py が git_watch と同じソケットに相乗せする）。

状態は 4 値:
- blocked: 画面が静止し、blocked 語句が可視ペインに出ている（承認待ち等）
- done:    画面が静止し、done 語句が可視ペインに出ている
- working: 前回ポーリングから出力が変化した
- idle:    画面が静止し、どの語句にも一致しない

git_watch と同じく購読者がいる間だけポーリングタスクが動き、購読者ゼロで
停止するため、クライアントが繋がっていないときのコストはゼロ。
"""

import asyncio
import logging
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

STATE_BLOCKED = "blocked"
STATE_DONE = "done"
STATE_WORKING = "working"
STATE_IDLE = "idle"


def _last_match_pos(text: str, phrases: list[str]) -> int:
    """text 中で最後に現れる語句の開始位置を返す（どれも無ければ -1）。"""
    pos = -1
    for phrase in phrases:
        if not phrase:
            continue
        found = text.rfind(phrase)
        if found > pos:
            pos = found
    return pos


def classify_agent_state(
    capture: str,
    prev_capture: str | None,
    patterns: dict[str, list[str]],
    watch_phrases: list[dict] | None = None,
) -> str:
    """可視ペインの内容からセッション状態を判定する純関数。

    - 前回ポーリングから出力が変化していれば working（スピナー等の動きも拾う）
    - watch_phrases がある場合（新方式）: マッチした語句のアイコン名を返す
    - watch_phrases が空の場合（旧方式）: state_patterns で blocked/done を返す
    - 画面が静止しているときだけ語句照合し、blocked と done の両方が出ている
      場合は後（画面の下方）に現れた方を勝たせる
    """
    if prev_capture is not None and capture != prev_capture:
        return STATE_WORKING
    if watch_phrases:
        best_pos = -1
        best_icon = STATE_IDLE
        for wp in watch_phrases:
            phrase = wp.get("phrase", "")
            icon = wp.get("icon", "")
            if not phrase or not icon:
                continue
            pos = capture.rfind(phrase)
            if pos > best_pos:
                best_pos = pos
                best_icon = icon
        return best_icon if best_pos >= 0 else STATE_IDLE
    blocked_pos = _last_match_pos(capture, patterns.get(STATE_BLOCKED, []))
    done_pos = _last_match_pos(capture, patterns.get(STATE_DONE, []))
    if blocked_pos >= 0 and blocked_pos >= done_pos:
        return STATE_BLOCKED
    if done_pos >= 0:
        return STATE_DONE
    return STATE_IDLE


def _list_session_ids() -> list[str]:
    result = _run_tmux_cmd("list-sessions", "-F", "#{session_name}")
    if result is None or result.returncode != 0:
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
    meta = load_tmux_metadata(TMUX_SESSION_PREFIX + session_id)
    return meta.get("TMUX_WORKSPACE"), meta.get("TMUX_JOB_NAME")


def _job_state_patterns(workspace: str | None, job_name: str | None) -> dict[str, list[str]]:
    """セッションを起動したジョブ定義から検知語句を引く（ジョブ無しは空 dict）。"""
    if not job_name:
        return {}
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        entry = get_workspace_jobs(workspace).get(job_name)
        if not entry:
            return {}
        return entry[0].state_patterns
    data = load_common_jobs_data()
    raw = data.get(job_name)
    if raw is None:
        return {}
    return entry_to_job_definition(job_name, raw).state_patterns


def _job_watch_phrases(workspace: str | None, job_name: str | None) -> list[dict]:
    """セッションを起動したジョブ定義から watch_phrases を引く（ジョブ無しは空リスト）。"""
    if not job_name:
        return []
    from .routers.jobs_common import (
        entry_to_job_definition,
        get_workspace_jobs,
        load_common_jobs_data,
    )
    if workspace:
        entry = get_workspace_jobs(workspace).get(job_name)
        if not entry:
            return []
        return entry[0].watch_phrases
    data = load_common_jobs_data()
    raw = data.get(job_name)
    if raw is None:
        return []
    return entry_to_job_definition(job_name, raw).watch_phrases


# ポーリング間の可視ペイン内容（アクティビティ判定用）。ポーリングタスクのみが触る。
_last_capture: dict[str, str] = {}
_subscribers: set[WebSocket] = set()
_poll_task: asyncio.Task | None = None
_last_states: dict[str, str] = {}


def collect_agent_states() -> dict[str, str]:
    """全ターミナルセッションの状態を判定して返す（executor スレッドで実行）。"""
    states: dict[str, str] = {}
    for session_id in _list_session_ids():
        capture = capture_visible_pane(TMUX_SESSION_PREFIX + session_id)
        if capture is None:
            continue
        workspace, job_name = _session_meta(session_id)
        watch_phrases = _job_watch_phrases(workspace, job_name)
        patterns = _job_state_patterns(workspace, job_name)
        states[session_id] = classify_agent_state(
            capture, _last_capture.get(session_id), patterns, watch_phrases,
        )
        _last_capture[session_id] = capture
    for stale in set(_last_capture) - set(states):
        del _last_capture[stale]
    return states


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
    """購読者がいる間、可視ペインをポーリングして状態変化を push する。"""
    try:
        while _subscribers:
            await asyncio.sleep(AGENT_WATCH_POLL_INTERVAL_SEC)
            if not _subscribers:
                break
            loop = asyncio.get_running_loop()
            states = await loop.run_in_executor(BACKGROUND_EXECUTOR, collect_agent_states)
            changed = diff_states(_last_states, states)
            _last_states.clear()
            _last_states.update(states)
            if changed:
                await _broadcast(states_payload(changed))
    except asyncio.CancelledError:
        pass
