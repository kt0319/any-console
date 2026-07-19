"""セッション一覧のサーバ側スナップショット（ADR 24）。

tmux を都度クエリする方式は、ポーリングクライアント数 × セッション数ぶんの
subprocess を発生させ、その一時失敗を呼び出し側ごとに tri-state・リトライ・
自己回復で防御する複雑さを生んでいた。本モジュールは一覧の読み取りを 1 箇所へ
集約し、

- TTL 内は同じスナップショットを返す（tmux 呼び出しがクライアント数に比例しない）
- 再構築に失敗した場合は最後に成功したスナップショットを返し続ける
  （last-known-good — 一時失敗が「セッション消滅」としてクライアントへ伝播しない）
- 発見したセッションはその場でレジストリへ登録する（メタデータ読み取りは
  セッションごとに一度きり）

ことで、防御を呼び出し側に分散させる必要をなくす。
"""

import logging
import threading
import time

from .common import SESSIONS_SNAPSHOT_TTL_SEC, TMUX_SESSION_PREFIX
from .terminal_session import TERMINAL_SESSIONS, TerminalSession, sessions_lock
from .tmux import _run_tmux_cmd

logger = logging.getLogger(__name__)

_snapshot: list[dict] | None = None
_snapshot_at: float = 0.0
_build_lock = threading.Lock()


def invalidate_sessions_snapshot() -> None:
    """セッションの作成・削除・属性変更後に呼び、次回読み取りで必ず再構築させる。

    TTL 待ちにすると「作成直後のポーリングが古い一覧を受け取り、作りたての
    タブを閉じてしまう」競合が生まれるため、変更操作は即時 invalidate する。
    """
    global _snapshot_at
    _snapshot_at = 0.0


def reset_sessions_snapshot() -> None:
    """スナップショットを完全に破棄する（テストの隔離用）。"""
    global _snapshot, _snapshot_at
    _snapshot = None
    _snapshot_at = 0.0


def _parse_list_output(stdout: str) -> list[tuple[str, int | None]]:
    """`list-sessions -F "#{session_name}\t#{session_created}"` の出力を分解する。"""
    rows: list[tuple[str, int | None]] = []
    for line in stdout.strip().splitlines():
        name, _, created_raw = line.strip().partition("\t")
        if not name:
            continue
        try:
            created: int | None = int(created_raw)
        except ValueError:
            created = None
        rows.append((name, created))
    return rows


def _resolve_session(session_id: str, tmux_name: str) -> TerminalSession | None:
    """レジストリからセッションを引く。未登録なら発見として登録する。

    メタデータが読めない（None）場合は登録せず None を返し、スナップショット
    構築ごと失敗させる（呼び出し側が last-known-good を返す）。不完全な
    メタデータで登録・配信すると、ワークスペースセッションが素のターミナル
    として固定されるため。
    """
    with sessions_lock:
        cached = TERMINAL_SESSIONS.get(session_id)
    if cached is not None:
        return cached
    discovered = TerminalSession.from_tmux(tmux_name)
    if discovered is None:
        return None
    with sessions_lock:
        cached = TERMINAL_SESSIONS.setdefault(session_id, discovered)
    if cached is discovered:
        logger.info("discovered tmux session=%s workspace=%s",
                    session_id, cached.workspace or "(none)")
    return cached


def _build_snapshot() -> list[dict] | None:
    """tmux から一覧を構築する。tmux コマンド自体の失敗は None（不明）。"""
    result = _run_tmux_cmd("list-sessions", "-F", "#{session_name}\t#{session_created}")
    if result is None:
        return None
    if result.returncode != 0:
        # tmux が正常応答した上での「セッション無し」（サーバ未起動含む）は正当な空。
        return []
    sessions = []
    for name, created in _parse_list_output(result.stdout):
        if not name.startswith(TMUX_SESSION_PREFIX):
            continue
        session_id = name[len(TMUX_SESSION_PREFIX):]
        if not session_id:
            continue
        session = _resolve_session(session_id, name)
        if session is None:
            return None
        md = session.metadata_dict()
        sessions.append({
            "session_id": session_id,
            "workspace": md["workspace"],
            "ws_url": f"/terminal/ws/{session_id}",
            "icon": md["icon"],
            "icon_color": md["icon_color"],
            "job_name": md["job_name"],
            "job_label": md["job_label"],
            "created_at": created,
            "detached": session.detached,
        })
    sessions.sort(key=lambda s: s.get("created_at") or 0)
    return sessions


def get_sessions_snapshot() -> list[dict] | None:
    """セッション一覧を返す。

    TTL 内は前回のスナップショットをそのまま返す。再構築に失敗した場合も
    最後に成功したスナップショット（last-known-good）を返し、一度も成功して
    いない場合だけ None を返す（呼び出し側は 500 で「不明」を区別する）。
    """
    global _snapshot, _snapshot_at
    with _build_lock:
        if _snapshot is not None and time.monotonic() - _snapshot_at < SESSIONS_SNAPSHOT_TTL_SEC:
            return _snapshot
        fresh = _build_snapshot()
        if fresh is not None:
            _snapshot = fresh
            _snapshot_at = time.monotonic()
        elif _snapshot is not None:
            logger.warning("sessions snapshot refresh failed; serving last-known-good")
        return _snapshot
