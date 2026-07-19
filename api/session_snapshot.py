"""セッション一覧のサーバ側スナップショット（ADR 24）。

tmux を都度クエリする方式は、ポーリングクライアント数 × セッション数ぶんの
subprocess を発生させ、その一時失敗を呼び出し側ごとに tri-state・リトライ・
自己回復で防御する複雑さを生んでいた。本モジュールは一覧の読み取りを 1 箇所へ
集約し、

- TTL 内は同じスナップショットを返す（tmux 呼び出しがクライアント数に比例しない）
- 受動的読み取りの再構築に失敗した場合は最後に成功した一覧を返し続ける
  （last-known-good — 一時失敗が「セッション消滅」としてクライアントへ伝播しない）
- 変更操作（作成・削除・属性変更）後は前回値ごと破棄する（変更を跨いで
  変更前の一覧を正として配信しない）
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
# 最後の構築試行（成功・失敗とも）が完了した時刻。失敗も刻むことで、tmux が
# 詰まっている間にポーリング全員が 5 秒タイムアウトの構築を直列に繰り返して
# threadpool を食い潰すのを防ぐ（再試行は TTL ごとに 1 回）。
_attempt_at: float = 0.0
# invalidate のたびに進む世代。構築中に変更操作が入った場合、その構築結果は
# 変更前の tmux 状態を写した可能性があるため、世代が進んでいたらキャッシュしない。
_generation: int = 0
# 構築の直列化用。構築は最大 TMUX_CMD_TIMEOUT_SEC 待つため、変更操作を
# 待たせないよう invalidate はこのロックを取らない（_state_lock だけ取る）。
_build_lock = threading.Lock()
# _snapshot / _attempt_at / _generation の更新を守る短時間ロック。
_state_lock = threading.Lock()


def invalidate_sessions_snapshot() -> None:
    """セッションの作成・削除・属性変更後に呼び、次回読み取りで必ず再構築させる。

    前回値も破棄する: last-known-good は受動的読み取りの可用性のための機構で、
    変更を跨いで変更前の一覧を返すと「作りたてのタブが閉じられる／削除した
    タブが復活する」誤動作になる。破棄後に構築が失敗している間、一覧 API は
    500 を返し、クライアントはそのポーリングサイクルを skip する（安全側）。
    """
    global _snapshot, _attempt_at, _generation
    with _state_lock:
        _generation += 1
        _snapshot = None
        _attempt_at = 0.0


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

    最後の構築試行から TTL 内は前回結果（失敗中なら last-known-good、変更
    直後の失敗中なら None = 500）をそのまま返す。None は「一覧が不明」で、
    クライアントはタブ操作をせずそのサイクルを skip する。
    """
    global _snapshot, _attempt_at
    with _build_lock:
        with _state_lock:
            if time.monotonic() - _attempt_at < SESSIONS_SNAPSHOT_TTL_SEC:
                return _snapshot
            generation = _generation
        fresh = _build_snapshot()
        with _state_lock:
            if fresh is None:
                _attempt_at = time.monotonic()
                if _snapshot is not None:
                    logger.warning("sessions snapshot refresh failed; serving last-known-good")
                return _snapshot
            if _generation == generation:
                _snapshot = fresh
                _attempt_at = time.monotonic()
            # 世代が進んでいたら、この結果は変更前の状態かもしれないので
            # キャッシュしない（返すのは可 — 変更前の一瞬の読み取りと等価）。
            # _attempt_at も進めず、次の読み取りで即再構築させる。
            return fresh
