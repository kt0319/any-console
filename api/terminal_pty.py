"""Low-level PTY I/O primitives. No asyncio or WebSocket dependencies."""
import fcntl
import logging
import os
import select
import signal
import struct
import termios
import time
from concurrent.futures import ThreadPoolExecutor

from .common import (
    PTY_READ_BUFFER_SIZE,
    PTY_READER_WORKERS,
)

logger = logging.getLogger(__name__)

PTY_NO_DATA = b"\x00"
PTY_EOF = b""

PTY_EXECUTOR = ThreadPoolExecutor(
    max_workers=PTY_READER_WORKERS, thread_name_prefix="pty-reader",
)

_SIGKILL_GRACE_SEC = 0.1


def read_pty(fd: int) -> bytes:
    try:
        r, _, _ = select.select([fd], [], [], 1.0)
        if not r:
            return PTY_NO_DATA
        return os.read(fd, PTY_READ_BUFFER_SIZE)
    except (OSError, ValueError):
        return PTY_EOF


def close_pty(fd: int | None, pid: int | None) -> None:
    if fd is not None:
        try:
            os.close(fd)
        except OSError as e:
            logger.debug("close fd=%d failed: %s", fd, e)
    if pid is None:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError) as e:
        logger.debug("SIGTERM pid=%d failed: %s", pid, e)
        return
    try:
        reaped, _ = os.waitpid(pid, os.WNOHANG)
        if reaped == 0:
            time.sleep(_SIGKILL_GRACE_SEC)
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, os.WNOHANG)
    except (ChildProcessError, ProcessLookupError, PermissionError, OSError) as e:
        logger.debug("cleanup pid=%d failed: %s", pid, e)


def resize_pty(fd: int | None, cols: int, rows: int) -> None:
    """PTY のウィンドウサイズのみを更新する。

    tmux は attach 中クライアントの PTY サイズ（ここで設定する値）にウィンドウを
    自動追従させるため、明示的な `tmux resize-window` は呼ばない（手動サイズモードに
    固定されてクライアント追従が壊れ、表示が崩れるのを避けるため）。
    """
    if fd is None:
        return
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass
