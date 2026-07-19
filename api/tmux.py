import logging
import os
import subprocess
import time

from .common import (
    TERMINAL_DEFAULT_COLS,
    TERMINAL_DEFAULT_ROWS,
    TERMINAL_TERM_TYPE,
    TMUX_CMD_TIMEOUT_SEC,
    TMUX_META_ENV_NAMES,
    TMUX_PANE_POLL_INTERVAL_SEC,
    TMUX_PANE_READY_TIMEOUT_SEC,
    run_subprocess_safe,
)

logger = logging.getLogger(__name__)


def _run_tmux_cmd(*args: str) -> subprocess.CompletedProcess | None:
    return run_subprocess_safe(["tmux", *args], timeout=TMUX_CMD_TIMEOUT_SEC, log_label="tmux")


def run_outside_cgroup(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    uid = os.getuid()
    env = kwargs.get("env") or os.environ.copy()
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{uid}/bus")
    kwargs_with_env = {**kwargs, "env": env}
    try:
        return subprocess.run(
            ["systemd-run", "--user", "--scope", "--quiet", *cmd],
            **kwargs_with_env,
        )
    except (subprocess.CalledProcessError, OSError):
        return subprocess.run(cmd, **kwargs)


def create_tmux_session(workspace_path: str | None, session_name: str) -> None:
    user_shell = os.environ.get("SHELL", "/bin/zsh")
    cwd = workspace_path if workspace_path and os.path.isdir(workspace_path) else os.environ.get("HOME", "/")
    env = os.environ.copy()
    env["TERM"] = TERMINAL_TERM_TYPE
    env.setdefault("DISPLAY", ":0")
    if workspace_path:
        env["WORKSPACE"] = workspace_path

    display = env.get("DISPLAY", ":0")
    run_outside_cgroup(
        [
            "tmux", "new-session", "-d", "-s", session_name,
            "-e", f"DISPLAY={display}",
            "-x", str(TERMINAL_DEFAULT_COLS), "-y", str(TERMINAL_DEFAULT_ROWS), user_shell,
            ";", "set-option", "-t", session_name, "status", "off",
            ";", "set-option", "-t", session_name, "mouse", "off",
            ";", "set-option", "-t", session_name, "history-limit", "100000",
            ";", "set-option", "-t", session_name, "set-clipboard", "on",
            # 各 WS クライアントはこのベースセッションへ独立した tmux クライアントとして
            # アタッチする。ウィンドウは直近にアクティブだったクライアントのサイズに
            # 追従させる（端末をまたいだ操作の引き継ぎで自然なリサイズになる）。アプリは
            # resize-window を叩かず、この window-size ポリシー + クライアント PTY の
            # winsize だけに委ねる。
            ";", "set-option", "-t", session_name, "window-size", "latest",
        ],
        cwd=cwd,
        env=env,
        timeout=TMUX_CMD_TIMEOUT_SEC,
        check=True,
        capture_output=True,
    )


def attach_tmux_session(session_name: str, cols: int = 0, rows: int = 0) -> tuple[int, int]:
    import fcntl
    import pty
    import struct
    import termios

    env = {
        "TERM": TERMINAL_TERM_TYPE,
        "HOME": os.environ.get("HOME", "/"),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
    }
    pid, fd = pty.fork()
    if pid == 0:
        if cols > 0 and rows > 0:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(0, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass
        try:
            os.execvpe("tmux", ["tmux", "attach-session", "-t", session_name], env)  # noqa: S606
        except OSError:  # noqa: S110
            pass
        os._exit(1)
    if cols > 0 and rows > 0:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    return fd, pid


def has_tmux_session(name: str) -> bool | None:
    """セッションの存在を tri-state で返す。

    tmux コマンド自体の失敗（タイムアウト/OSError）を「セッション無し」と
    区別しないと、一時的な tmux の遅延だけでクライアントが生きているセッションを
    閉じてしまう（terminal_ws / get_terminal_session 参照）。
    True=存在 / False=不在（tmux が正常応答） / None=不明（tmux コマンド失敗）。
    """
    result = _run_tmux_cmd("has-session", "-t", name)
    if result is None:
        return None
    return result.returncode == 0


def tmux_session_exists(name: str) -> bool:
    return has_tmux_session(name) is True


def kill_tmux_by_name(name: str) -> None:
    _run_tmux_cmd("kill-session", "-t", name)


def send_keys_to_tmux(session_name: str, text: str, *, enter: bool = True) -> bool:
    """tmux セッションへ文字列を送り込む（任意で続けて Enter を送る）。

    WebSocket 接続の有無に関わらずサーバ側からセッションへ入力できる。
    `--` で text 以降をオプション扱いしないようにし、Enter は別コマンドで送る。
    送信成功で True、tmux 不在やタイムアウト時は False を返す。
    """
    result = _run_tmux_cmd("send-keys", "-t", session_name, "--", text)
    if result is None or result.returncode != 0:
        return False
    if enter:
        enter_result = _run_tmux_cmd("send-keys", "-t", session_name, "Enter")
        if enter_result is None or enter_result.returncode != 0:
            return False
    return True


def wait_pane_ready(
    session_name: str,
    timeout_sec: float = TMUX_PANE_READY_TIMEOUT_SEC,
) -> bool:
    """ペインのシェルが起動するまで短時間ポーリングする（ベストエフォート）。

    `send-keys` 直後の取りこぼし（シェル生成が遅延しているケース）を避けるため、
    フォアグラウンドプロセスが立ち上がる＝`pane_current_command` が得られる
    までを待つ。tty のタイプアヘッドにより以後の入力はバッファされる。
    準備確認できれば True、timeout なら False（呼び出し側は送信を続行してよい）。
    """
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        result = _run_tmux_cmd(
            "display-message", "-t", session_name, "-p", "#{pane_current_command}",
        )
        if result is not None and result.returncode == 0 and result.stdout.strip():
            return True
        time.sleep(TMUX_PANE_POLL_INTERVAL_SEC)
    return False


def load_tmux_metadata(tmux_name: str) -> dict | None:
    """セッション環境変数からメタデータを読み込む（tri-state）。

    tmux コマンドの一時失敗（タイムアウト/OSError/非ゼロ終了）を「メタデータ無し」
    （空 dict）と区別しないと、ワークスペースセッションを素のターミナルとして
    復元してしまう（has_tmux_session と同型の誤判定）。
    dict=成功（空含む） / None=不明（tmux コマンド失敗）。
    """
    result = _run_tmux_cmd("show-environment", "-t", tmux_name)
    if not result or result.returncode != 0:
        return None
    meta = {}
    for line in result.stdout.strip().splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key in TMUX_META_ENV_NAMES:
            meta[key] = value
    return meta


def capture_visible_pane(tmux_name: str) -> str | None:
    """可視ペインの内容をプレーンテキストで返す（失敗時は None）。

    スクロールバックは含めない。agent_watch が「いま画面に出ているもの」だけを
    検知語句と照合するために使う。
    """
    result = _run_tmux_cmd("capture-pane", "-p", "-t", tmux_name)
    if result is None or result.returncode != 0:
        return None
    return str(result.stdout)


def get_session_cwd(tmux_name: str) -> str | None:
    """tmux セッションのカレントディレクトリを返す。"""
    result = _run_tmux_cmd("display-message", "-t", tmux_name, "-p", "#{pane_current_path}")
    if result and result.returncode == 0:
        return result.stdout.strip() or None
    return None


def detect_workspace_from_tmux(tmux_name: str) -> str | None:
    """ペインのカレントディレクトリからワークスペース ID を推定して返す。"""
    result = _run_tmux_cmd("display-message", "-t", tmux_name, "-p", "#{pane_current_path}")
    if not result or result.returncode != 0:
        return None
    pane_path = result.stdout.strip()
    if not pane_path:
        return None
    from .config import list_workspace_entries
    entries = list_workspace_entries()
    for ws_id, config in entries.items():
        raw_path = config.get("path", "")
        if not raw_path:
            continue
        # config の path は `~` やシンボリックリンクを含みうる一方、
        # pane_current_path はカーネルが解決した実パスで返るため、
        # 展開・解決の両方で比較しないとワークスペース検出を取りこぼす。
        expanded = os.path.expanduser(raw_path)
        for ws_path in {expanded, os.path.realpath(expanded)}:
            if pane_path == ws_path or pane_path.startswith(ws_path + "/"):
                return ws_id
    return None


def get_window_width(tmux_name: str) -> int | None:
    result = _run_tmux_cmd("display-message", "-t", tmux_name, "-p", "#{window_width}")
    if result and result.returncode == 0:
        try:
            return int(result.stdout.strip())
        except ValueError:
            pass
    return None


def get_tmux_created(tmux_name: str) -> int | None:
    result = _run_tmux_cmd("display-message", "-t", tmux_name, "-p", "#{session_created}")
    if result and result.returncode == 0:
        try:
            return int(result.stdout.strip())
        except ValueError:
            pass
    return None
