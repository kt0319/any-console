import asyncio
import json
import logging
import threading

from fastapi import WebSocket

from .common import (
    TERMINAL_DEFAULT_COLS,
    TERMINAL_DEFAULT_ROWS,
    TMUX_SESSION_PREFIX,
)
from .errors import not_found, server_error
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
    detect_workspace_from_tmux,
    has_tmux_session,
    kill_tmux_by_name,
    load_tmux_metadata,
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
        "meta_incomplete",
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
        # tmux メタデータの読み込みが一時失敗のまま登録された印。
        # True の間は refresh_metadata_if_incomplete が成功するまで再試行する。
        self.meta_incomplete: bool = False

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
        # メタデータ読み込みの一時失敗（None）をそのまま workspace 無しとして
        # 復元すると、ワークスペースセッションが素のターミナルに化ける。
        # 1 回だけ再試行し、それでも失敗なら meta_incomplete を立てて登録し、
        # 以後の refresh_metadata_if_incomplete による自己回復に委ねる。
        meta = load_tmux_metadata(tmux_name)
        if meta is None:
            meta = load_tmux_metadata(tmux_name)
        incomplete = meta is None
        meta = meta or {}
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
        sess.meta_incomplete = incomplete
        return sess

    def refresh_metadata_if_incomplete(self) -> None:
        """メタデータ読み込み失敗のまま登録されたセッションを自己回復させる。

        レジストリにキャッシュされたセッションはサーバ再起動まで生き続けるため、
        workspace 無しのまま放置するとワークスペースセッションが素のターミナル
        として扱われ続ける。tmux 読み込みが成功するまで再試行し、成功した回で
        だけフラグを下ろす。ランタイムに設定済みの値（PUT /workspace 等）は
        上書きしない。
        """
        if not self.meta_incomplete:
            return
        meta = load_tmux_metadata(self.tmux_session_name)
        if meta is None:
            return
        workspace = meta.get("TMUX_WORKSPACE") or detect_workspace_from_tmux(self.tmux_session_name)
        with sessions_lock:
            if not self.meta_incomplete:
                return
            self.workspace = self.workspace or workspace
            self.icon = self.icon or meta.get("TMUX_ICON")
            self.icon_color = self.icon_color or meta.get("TMUX_ICON_COLOR")
            self.job_name = self.job_name or meta.get("TMUX_JOB_NAME")
            self.job_label = self.job_label or meta.get("TMUX_JOB_LABEL")
            self.detached = self.detached or bool(meta.get("TMUX_DETACHED"))
            self.meta_incomplete = False
        logger.info("metadata self-healed session=%s workspace=%s",
                    self.tmux_session_name, self.workspace or "(none)")

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
        session.refresh_metadata_if_incomplete()
        return session

    tmux_name = TMUX_SESSION_PREFIX + session_id
    exists = has_tmux_session(tmux_name)
    if exists is None:
        # tmux コマンド自体の失敗。「セッション不在」と誤判定して 404 を返すと
        # クライアントが生きているセッションを閉じてしまうため 500 で区別する。
        raise server_error("Failed to check tmux session")
    if not exists:
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

WS_CLOSE_CLIENT_DETACHED = 1011


def eof_close_code(base_session_exists: bool | None) -> int:
    """PTY EOF 時の WS close コードを決める。

    EOF は「シェル終了でベースセッションが消えた」以外に、attach クライアント
    プロセスだけが死んだ場合（macOS のスリープ復帰・tmux の一時不調・C-b d 等）
    にも起きる。ベースセッションの実在を確認せず 4001（session exited）を送ると、
    クライアントがタブを閉じて生きているセッションを失う（ADR 23 と同型の誤判定）。

    - False（確実に不在）→ 4001: 正当なセッション終了としてタブを閉じさせる
    - True / None（存在 or 不明）→ 1011: 再接続バックオフに乗せて attach し直させる
      （不明時に本当は不在だった場合は、再接続後の _ensure_tmux_session が
      セッションを再作成してタブが残る。稀なエッジだが破壊よりは安全側）
    """
    if base_session_exists is False:
        return WS_CLOSE_SESSION_EXITED
    return WS_CLOSE_CLIENT_DETACHED


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
            # シェル終了でベースセッションが消えるとアタッチ中のクライアントも EOF になるが、
            # attach クライアントだけが死んだ（セッションは生きている）場合もある。
            # ベースセッションの実在を確認してから close コードを選ぶ（eof_close_code 参照）。
            tmux_name = TMUX_SESSION_PREFIX + session_id
            exists = await loop.run_in_executor(PTY_EXECUTOR, has_tmux_session, tmux_name)
            code = eof_close_code(exists)
            reason = "session exited" if code == WS_CLOSE_SESSION_EXITED else "client detached"
            logger.info("PTY EOF detected session=%s exists=%s close=%d", session_id, exists, code)
            try:
                await websocket.close(code=code, reason=reason)
            except (RuntimeError, OSError):
                pass


def start_bridge_reader(session_id: str, websocket: WebSocket, bridge: ClientBridge) -> None:
    bridge.reader_task = asyncio.create_task(_bridge_reader(websocket, bridge, session_id))
