import logging
import os
import subprocess

from .common import (
    TERMINAL_DEFAULT_COLS,
    TERMINAL_DEFAULT_ROWS,
    TERMINAL_TERM_TYPE,
    TMUX_CMD_TIMEOUT_SEC,
    TMUX_META_ENV_NAMES,
)

logger = logging.getLogger(__name__)


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
            ";", "set-option", "-t", session_name, "history-limit", "0",
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
        except Exception:  # noqa: S110
            pass
        os._exit(1)
    if cols > 0 and rows > 0:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    return fd, pid


def tmux_session_exists(name: str) -> bool:
    try:
        result = subprocess.run(
            ["tmux", "has-session", "-t", name],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def kill_tmux_by_name(name: str) -> None:
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", name],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.debug("kill tmux session %s failed: %s", name, e)


def load_tmux_metadata(tmux_name: str) -> dict:
    try:
        result = subprocess.run(
            ["tmux", "show-environment", "-t", tmux_name],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
    except (subprocess.TimeoutExpired, OSError):
        return {}
    if result.returncode != 0:
        return {}
    meta = {}
    for line in result.stdout.strip().splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key in TMUX_META_ENV_NAMES:
            meta[key] = value
    return meta


def detect_workspace_from_tmux(tmux_name: str) -> str | None:
    try:
        result = subprocess.run(
            ["tmux", "display-message", "-t", tmux_name, "-p", "#{pane_current_path}"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            pane_path = result.stdout.strip()
            from .config import list_workspace_entries
            entries = list_workspace_entries()
            for name, config in entries.items():
                ws_path = config.get("path", "")
                if ws_path and (pane_path == ws_path or pane_path.startswith(ws_path + "/")):
                    return name
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


def get_tmux_created(tmux_name: str) -> int | None:
    try:
        result = subprocess.run(
            ["tmux", "display-message", "-t", tmux_name, "-p", "#{session_created}"],
            timeout=TMUX_CMD_TIMEOUT_SEC,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return int(result.stdout.strip())
    except (subprocess.TimeoutExpired, OSError, ValueError):
        pass
    return None
