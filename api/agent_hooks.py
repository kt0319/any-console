"""エージェント hooks によるセッション状態のイベント駆動更新。

Claude Code 等のエージェントの hooks（Notification / Stop / PreToolUse ...）から
`POST /agent-hooks/events` を叩いてもらい、セッション状態
（working / idle / blocked）をイベント駆動で更新する。screen manifest
（ADR 30）より正確・即時なため、イベントが新しい間
（AGENT_HOOK_STATE_TTL_SEC）は hook の状態を最優先で採用し、期限切れ・
未設定時は manifest → 画面差分へフォールバックする（ADR 33）。

セッションとの対応付け・認証には、any-console が tmux セッション生成時に
注入する環境変数を使う:

- ANY_CONSOLE_SESSION: tmux セッション名（送信側はそのまま返す）
- ANY_CONSOLE_HOOK_URL: このサーバの受信エンドポイント（loopback）
- ANY_CONSOLE_HOOK_TOKEN: hook 専用トークン（data/hook_token に永続化）

メインの Bearer トークンをセッション内の全プロセスへ晒さないため、hook
トークンは別に発行する（漏れても状態イベントの偽装しかできない）。
送信スクリプトは scripts/claude-code-hook.sh を参照。
"""

from __future__ import annotations

import logging
import secrets
import threading
import time

from .common import (
    AGENT_HOOK_STATE_TTL_SEC,
    DATA_DIR,
    TMUX_SESSION_PREFIX,
    connect_bind_host,
)

logger = logging.getLogger(__name__)

_HOOK_TOKEN_FILE = DATA_DIR / "hook_token"

# hook イベント名 → セッション状態。未知のイベントは無視する（forward 互換）。
# SubagentStop はメインエージェント継続中に発火するため状態を変えない。
EVENT_STATE_MAP = {
    "PreToolUse": "working",
    "PostToolUse": "working",
    "UserPromptSubmit": "working",
    "PreCompact": "working",
    "Notification": "blocked",
    "Stop": "idle",
}
# セッション終了系は状態を消す（以後は manifest / 画面差分に委ねる）
_CLEAR_EVENTS = frozenset({"SessionEnd"})

_lock = threading.Lock()
# session_id → (state, monotonic 時刻)。record は API スレッド、参照は
# agent_watch の executor スレッドから来るためロックで守る。
_hook_states: dict[str, tuple[str, float]] = {}


def get_hook_token() -> str:
    """hook 専用トークンを返す（無ければ生成して data/hook_token に保存）。"""
    try:
        token = _HOOK_TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            return token
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    try:
        _HOOK_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        _HOOK_TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
        _HOOK_TOKEN_FILE.chmod(0o600)
    except OSError as e:
        logger.warning("failed to persist hook token: %s", e)
    return token


def verify_hook_token(provided: str) -> bool:
    if not provided:
        return False
    return secrets.compare_digest(provided, get_hook_token())


def _session_id_from(session: str) -> str:
    """tmux セッション名（プレフィックス付き）または素の session_id を受け付ける。"""
    if session.startswith(TMUX_SESSION_PREFIX):
        return session[len(TMUX_SESSION_PREFIX):]
    return session


def record_event(session: str, event: str) -> bool:
    """hook イベントを状態へ反映する。既知イベントなら True。"""
    session_id = _session_id_from(session.strip())
    if not session_id:
        return False
    if event in _CLEAR_EVENTS:
        with _lock:
            _hook_states.pop(session_id, None)
        return True
    state = EVENT_STATE_MAP.get(event)
    if state is None:
        return False
    with _lock:
        _hook_states[session_id] = (state, time.monotonic())
    return True


def hook_state(session_id: str) -> str | None:
    """新鮮な（TTL 内の）hook 由来状態を返す。無ければ None。

    期限切れエントリはここで除去する（サーバが hook を受け損ねたまま
    状態が固着しないよう、以後は manifest / 画面差分へフォールバック）。
    """
    now = time.monotonic()
    with _lock:
        entry = _hook_states.get(session_id)
        if entry is None:
            return None
        state, recorded_at = entry
        if now - recorded_at > AGENT_HOOK_STATE_TTL_SEC:
            _hook_states.pop(session_id, None)
            return None
        return state


def clear_session(session_id: str) -> None:
    """セッション削除時の後始末（terminal router から呼ばれる）。"""
    with _lock:
        _hook_states.pop(session_id, None)


def hook_session_env(tmux_session_name: str) -> dict[str, str]:
    """tmux セッションへ注入する hook 用環境変数を返す。

    組み立てに失敗してもセッション生成を妨げない（空 dict を返す =
    そのセッションでは hooks が無効になるだけ）。
    """
    try:
        from .config import resolve_bind
        host, port = resolve_bind()
        host = connect_bind_host(host)
        return {
            "ANY_CONSOLE_SESSION": tmux_session_name,
            "ANY_CONSOLE_HOOK_URL": f"http://{host}:{port}/agent-hooks/events",
            "ANY_CONSOLE_HOOK_TOKEN": get_hook_token(),
        }
    except OSError as e:
        logger.warning("hook_session_env failed: %s", e)
        return {}
