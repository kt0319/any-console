import asyncio
import json
import logging
import re
import secrets
import subprocess
import threading

from fastapi import WebSocket

from .common import (
    MAX_TERMINAL_SESSIONS,
    TERMINAL_DEFAULT_COLS,
    TERMINAL_DEFAULT_ROWS,
    TMUX_SESSION_PREFIX,
)
from .errors import not_found, server_error, too_many_requests
from .git_utils import worktree_base_of
from .terminal_pty import (
    PTY_EOF,
    PTY_EXECUTOR,
    PTY_NO_DATA,
    close_pty,
    read_pty,
    resize_client_pty,
)
from .tmux import (
    _run_tmux_cmd,
    attach_tmux_session,
    create_tmux_session,
    detect_workspace_from_tmux,
    kill_tmux_by_name,
    load_tmux_metadata,
    tmux_session_exists,
)

logger = logging.getLogger(__name__)

WS_CLOSE_SESSION_EXITED = 4001


# ─── Session model ───────────────────────────────────────────────────────────

_TMUX_ATTR_MAP = {
    "TMUX_WORKSPACE": "workspace",
    "TMUX_ICON": "icon",
    "TMUX_ICON_COLOR": "icon_color",
    "TMUX_JOB_NAME": "job_name",
    "TMUX_JOB_LABEL": "job_label",
}


class ClientBridge:
    """1 つの WebSocket クライアント専用の tmux アタッチ。

    各クライアントはベースセッションに PTY で独立した tmux クライアントとして
    アタッチし、自分の (fd, pid) と reader タスクを持つ。サイズは自分の PTY
    winsize だけで決まり、tmux の `window-size latest` ポリシーで直近にアクティブ
    だったクライアントにウィンドウが追従する。
    """

    __slots__ = ("fd", "pid", "reader_task", "applied_size")

    def __init__(self, fd: int | None, pid: int | None):
        self.fd = fd
        self.pid = pid
        self.reader_task: asyncio.Task | None = None
        self.applied_size: tuple[int, int] | None = None


class TerminalSession:
    """1 つの tmux ベースセッション（＝1 シェル）と、それに紐づくクライアント群。

    ベースセッション（`tmux_session_name`）はシェルとスクロールバックの保持役で、
    各 WebSocket クライアントは `bridges` に `ClientBridge` として登録され、その
    ベースセッションへ別個の tmux クライアントとして独立アタッチする。
    """

    __slots__ = (
        "workspace",
        "icon", "icon_color", "job_name", "job_label",
        "tmux_session_name",
        "bridges",
        "pending_text", "pending_enter",
        "detached",
    )

    def __init__(self, workspace: str | None,
                 tmux_session_name: str,
                 icon: str | None = None, icon_color: str | None = None,
                 job_name: str | None = None, job_label: str | None = None):
        self.workspace = workspace
        self.icon = icon
        self.icon_color = icon_color
        self.job_name = job_name
        self.job_label = job_label
        self.tmux_session_name = tmux_session_name
        self.bridges: dict[WebSocket, ClientBridge] = {}
        self.pending_text: str | None = None
        self.pending_enter: bool = True
        # detached セッションは dispatch のターゲット候補から除外する。
        # ユーザが意図的に切り離した枠に勝手に入力が流れるのを防ぐ。
        self.detached: bool = False

    def save_metadata(self) -> None:
        pairs = [
            (env_key, getattr(self, attr))
            for env_key, attr in _TMUX_ATTR_MAP.items()
            if getattr(self, attr)
        ]
        if not pairs:
            return
        args: list[str] = []
        for i, (env_key, value) in enumerate(pairs):
            if i > 0:
                args.append(";")
            args.extend(["set-environment", "-t", self.tmux_session_name, env_key, value])
        result = _run_tmux_cmd(*args)
        if result is None:
            logger.error("save metadata error session=%s", self.tmux_session_name)
        elif result.returncode != 0:
            logger.warning("save metadata failed session=%s: %s",
                           self.tmux_session_name, result.stderr)

    def save_detached(self) -> None:
        """tmux のセッション環境変数に detached 状態を保存する（永続化）。
        False のときは env を unset して残骸を残さない。"""
        if self.detached:
            args = ["set-environment", "-t", self.tmux_session_name, "TMUX_DETACHED", "1"]
        else:
            args = ["set-environment", "-u", "-t", self.tmux_session_name, "TMUX_DETACHED"]
        if _run_tmux_cmd(*args) is None:
            logger.warning("save_detached failed session=%s", self.tmux_session_name)

    def save_workspace(self) -> None:
        """tmux のセッション環境変数に workspace 名を保存する（永続化）。
        None のときは env を unset して残骸を残さない。"""
        if self.workspace:
            args = ["set-environment", "-t", self.tmux_session_name, "TMUX_WORKSPACE", self.workspace]
        else:
            args = ["set-environment", "-u", "-t", self.tmux_session_name, "TMUX_WORKSPACE"]
        if _run_tmux_cmd(*args) is None:
            logger.warning("save_workspace failed session=%s", self.tmux_session_name)

    @classmethod
    def from_tmux(cls, tmux_name: str) -> "TerminalSession":
        meta = load_tmux_metadata(tmux_name)
        workspace = meta.get("TMUX_WORKSPACE") or detect_workspace_from_tmux(tmux_name)
        sess = cls(
            workspace=workspace,
            tmux_session_name=tmux_name,
            icon=meta.get("TMUX_ICON"),
            icon_color=meta.get("TMUX_ICON_COLOR"),
            job_name=meta.get("TMUX_JOB_NAME"),
            job_label=meta.get("TMUX_JOB_LABEL"),
        )
        sess.detached = bool(meta.get("TMUX_DETACHED"))
        return sess

    def metadata_dict(self) -> dict:
        return {
            "workspace": self.workspace,
            "icon": self.icon,
            "icon_color": self.icon_color,
            "job_name": self.job_name,
            "job_label": self.job_label,
        }


# ─── Session registry ────────────────────────────────────────────────────────

TERMINAL_SESSIONS: dict[str, TerminalSession] = {}
sessions_lock = threading.Lock()


def create_registered_session(
    ws_path,
    *,
    workspace: str | None,
    icon: str | None = None,
    icon_color: str | None = None,
    job_name: str | None = None,
    job_label: str | None = None,
) -> tuple[str, TerminalSession]:
    """tmux セッションを作成して registry へ登録し (session_id, session) を返す。

    /run と /dispatch のセッション作成手順（容量チェック → ID 生成 →
    tmux 作成 → 登録 → メタデータ保存）を共通化したもの。
    """
    with sessions_lock:
        if len(TERMINAL_SESSIONS) >= MAX_TERMINAL_SESSIONS:
            raise too_many_requests(
                f"Maximum number of terminal sessions reached ({MAX_TERMINAL_SESSIONS})",
            )
    short_id = secrets.token_urlsafe(6)
    if workspace:
        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", worktree_base_of(workspace))
        session_id = f"{safe_name}-{short_id}"
    else:
        session_id = short_id
    tmux_name = f"{TMUX_SESSION_PREFIX}{session_id}"
    try:
        create_tmux_session(str(ws_path) if ws_path else None, tmux_name)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        logger.error("tmux session creation failed: %s", e)
        raise server_error(f"Failed to create terminal: {e}") from None
    session = TerminalSession(
        workspace=workspace,
        tmux_session_name=tmux_name,
        icon=icon,
        icon_color=icon_color,
        job_name=job_name,
        job_label=job_label,
    )
    with sessions_lock:
        TERMINAL_SESSIONS[session_id] = session
    session.save_metadata()
    return session_id, session


def _register_tmux_session(session_id: str, tmux_name: str) -> TerminalSession:
    session = TerminalSession.from_tmux(tmux_name)
    with sessions_lock:
        TERMINAL_SESSIONS[session_id] = session
    logger.info("on-demand registered tmux session=%s workspace=%s",
                session_id, session.workspace or "(none)")
    return session


def get_terminal_session(session_id: str) -> TerminalSession:
    with sessions_lock:
        session = TERMINAL_SESSIONS.get(session_id)
        if session:
            return session

    tmux_name = TMUX_SESSION_PREFIX + session_id
    if not tmux_session_exists(tmux_name):
        raise not_found("Terminal session not found")

    return _register_tmux_session(session_id, tmux_name)


# ─── Per-client PTY bridge lifecycle ─────────────────────────────────────────

def _close_bridge(bridge: ClientBridge) -> None:
    """1 つのブリッジを完全に閉じる（reader 停止・PTY 解放）。

    PTY（＝`tmux attach` プロセス）を閉じると、その tmux クライアントは
    ベースセッションから自動的に detach する。ベースセッションは残る。
    """
    if bridge.reader_task is not None and not bridge.reader_task.done():
        bridge.reader_task.cancel()
    bridge.reader_task = None
    close_pty(bridge.fd, bridge.pid)
    bridge.fd = None
    bridge.pid = None


def _detach_pty_bridge(session: TerminalSession) -> None:
    """セッションの全クライアントブリッジを切断する（ベースセッションは残す）。"""
    for bridge in list(session.bridges.values()):
        _close_bridge(bridge)
    session.bridges.clear()


def _kill_tmux_session(session: TerminalSession) -> None:
    _detach_pty_bridge(session)
    kill_tmux_by_name(session.tmux_session_name)


def attach_client_bridge(session: TerminalSession, cols: int, rows: int) -> ClientBridge:
    """この接続専用の PTY でベースセッションに独立アタッチする。

    各 WS クライアントはベースセッションへ別個の tmux クライアントとして
    アタッチする。サイズは各クライアントの PTY winsize に閉じ、tmux が
    `window-size latest` でウィンドウを直近アクティブなクライアントに追従させる
    （アプリから `tmux resize-window` は叩かない）。tmux / pty.fork の失敗は
    `OSError`（または subprocess 例外）として送出する。
    """
    effective_cols = cols if cols > 0 else TERMINAL_DEFAULT_COLS
    effective_rows = rows if rows > 0 else TERMINAL_DEFAULT_ROWS
    fd, pid = attach_tmux_session(session.tmux_session_name, effective_cols, effective_rows)
    bridge = ClientBridge(fd=fd, pid=pid)
    bridge.applied_size = (effective_cols, effective_rows)
    return bridge


def register_bridge(session: TerminalSession, websocket: WebSocket, bridge: ClientBridge) -> None:
    session.bridges[websocket] = bridge


def detach_client_bridge(session: TerminalSession, websocket: WebSocket) -> None:
    bridge = session.bridges.pop(websocket, None)
    if bridge is None:
        return
    _close_bridge(bridge)


# ─── Resize ──────────────────────────────────────────────────────────────────

def _apply_bridge_size(bridge: ClientBridge, cols: int, rows: int) -> None:
    """ブリッジ（クライアント PTY）のサイズを更新する（実際に変化した時だけ）。

    フロントは入力のたびに resize を送るため、同一サイズでの ioctl 連打を避けて
    冪等にする。サイズ反映は各クライアントの PTY winsize に閉じており、tmux が
    `window-size latest` でウィンドウを追従させる。
    """
    if cols <= 0 or rows <= 0:
        return
    if bridge.fd is None:
        return
    if bridge.applied_size == (cols, rows):
        return
    bridge.applied_size = (cols, rows)
    resize_client_pty(bridge.fd, cols, rows)


def _handle_resize(bridge: ClientBridge, payload: bytes, session_id: str) -> None:
    try:
        size = json.loads(payload)
        cols = size.get("cols", TERMINAL_DEFAULT_COLS)
        rows = size.get("rows", TERMINAL_DEFAULT_ROWS)
        _apply_bridge_size(bridge, cols, rows)
        from .agent_watch import reset_last_capture
        reset_last_capture(session_id)
    except (json.JSONDecodeError, OSError, KeyError):
        pass


# ─── Per-client reader loop ──────────────────────────────────────────────────

async def _bridge_reader(websocket: WebSocket, bridge: ClientBridge, session_id: str) -> None:
    loop = asyncio.get_event_loop()
    pty_eof = False
    try:
        while True:
            if bridge.fd is None:
                break
            data = await loop.run_in_executor(PTY_EXECUTOR, read_pty, bridge.fd)
            if data == PTY_EOF:
                pty_eof = True
                break
            if data == PTY_NO_DATA:
                continue
            try:
                await websocket.send_bytes(data)
            except (RuntimeError, OSError):
                break
    except asyncio.CancelledError:
        pass
    except (OSError, RuntimeError) as e:
        logger.debug("bridge reader ended session=%s: %s", session_id, e)
    finally:
        bridge.reader_task = None
        if pty_eof:
            # シェル終了でベースセッションが消えるとアタッチ中のクライアントも EOF になる。
            # このクライアントを閉じて、フロントにセッション終了を伝える。
            logger.info("PTY EOF detected, closing client session=%s", session_id)
            try:
                await websocket.close(code=WS_CLOSE_SESSION_EXITED, reason="session exited")
            except (RuntimeError, OSError):
                pass


def start_bridge_reader(session_id: str, websocket: WebSocket, bridge: ClientBridge) -> None:
    bridge.reader_task = asyncio.create_task(_bridge_reader(websocket, bridge, session_id))
