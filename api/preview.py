"""ローカル dev server のポート検出と検出結果ストア。

`ss -ltn` で 127.0.0.1 / 0.0.0.0 を LISTEN しているポートを列挙する。
セッションごとの紐付けは不要（個人ツール前提）で、検出した全ポートを共通
"local" セッションとして扱う。proxy URL は /preview/local/<port>/... になる。

セキュリティ:
- upstream host は 127.0.0.1 にハードコード（preview router 側）。
- 検出対象は loopback/wildcard でリッスンしているソケットのみ。
"""

from __future__ import annotations

import asyncio
import logging
import re
import subprocess
import time
from dataclasses import asdict, dataclass

logger = logging.getLogger(__name__)

SCAN_INTERVAL_SEC = 3.0
PORT_STALE_SEC = 30  # LISTEN が消えてから一覧から落とすまで
# /preview/ports へのアクセスからこの秒数を過ぎたら background scan を休止する。
# パネルを閉じている間は ss を回さない（既存 proxy は維持する）。
PREVIEW_IDLE_SEC = 60.0
MIN_PORT = 1024
MAX_PORT = 65535
SESSION_ID = "local"

# 自分自身（any-console）のポートは preview にしない。
# bind() しているポートを動的に取れないので、起動時の DEFAULT_PORT を起動側で渡す。
_SELF_PORTS: set[int] = set()


def set_self_ports(ports: list[int]) -> None:
    _SELF_PORTS.clear()
    _SELF_PORTS.update(ports)


PROXY_OFFSET = 20000
PROXY_MIN_TARGET = 1024
PROXY_MAX_TARGET = 9999  # 10000 以上は +20000 が衝突するのでプロキシ立てない
PROXY_BIND_HOST = "0.0.0.0"  # noqa: S104


def proxy_port_for(target: int) -> int | None:
    if PROXY_MIN_TARGET <= target <= PROXY_MAX_TARGET:
        return target + PROXY_OFFSET
    return None


@dataclass
class DetectedPort:
    session_id: str
    port: int
    proxy_port: int | None
    process: str
    pid: int | None
    is_self: bool
    first_seen_at: int
    last_seen_at: int

    def to_dict(self) -> dict:
        return asdict(self)


_DETECTED: dict[int, DetectedPort] = {}

# 直近に /preview/ports がアクセスされた monotonic 時刻。None は未アクセス（=休止）。
# 0.0 を sentinel に使うと time.monotonic() の起点（boot 直後）と区別できないため避ける。
_last_access: float | None = None


def touch_access() -> None:
    """preview が使われたことを記録し、background scan を起こす。"""
    global _last_access
    _last_access = time.monotonic()


def _should_scan_now() -> bool:
    """直近アクセスから PREVIEW_IDLE_SEC 以内なら background scan する。"""
    if _last_access is None:
        return False
    return time.monotonic() - _last_access <= PREVIEW_IDLE_SEC

# ss -ltnp の各行から「LISTEN行のローカルポート」と「最初の (\"proc\",pid=N) 」を抜く。
# 出力例:
#   LISTEN 0 511   0.0.0.0:5173  0.0.0.0:*  users:(("node",pid=1942930,fd=21))
_SS_PORT_RE = re.compile(r"(?:127\.0\.0\.1|0\.0\.0\.0|\*|\[?::\]?):(\d{2,5})\b")
_SS_PROC_RE = re.compile(r'users:\(\("([^"]+)",pid=(\d+),')


def _read_cmdline(pid: int) -> str:
    """より具体的な実行コマンドを /proc/<pid>/cmdline から取得（先頭の basename を返す）。"""
    try:
        raw = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\x00")  # noqa: SIM115
    except (OSError, ValueError):
        return ""
    parts = [p.decode("utf-8", "replace") for p in raw if p]
    if not parts:
        return ""
    # node の場合は実行スクリプト名（例: vite, next）が二番目以降に来る。
    if parts[0].endswith(("node", "python", "python3", "ruby", "bun")) and len(parts) >= 2:
        for p in parts[1:]:
            if not p.startswith("-"):
                base = p.rsplit("/", 1)[-1]
                return f"{parts[0].rsplit('/', 1)[-1]} {base}"
    return parts[0].rsplit("/", 1)[-1]


def _proxy_listener_ports() -> set[int]:
    """現在 any-console が proxy listener として立てているポート集合。"""
    return {entry.proxy_port for entry in _DETECTED.values() if entry.proxy_port is not None}


def _scan_listening_ports() -> dict[int, tuple[str, int | None]]:
    try:
        out = subprocess.run(
            ["ss", "-ltnp"], capture_output=True, text=True, timeout=2.0, check=False,
        ).stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.warning("ss failed: %s", e)
        return {}
    proxy_ports = _proxy_listener_ports()
    found: dict[int, tuple[str, int | None]] = {}
    for line in out.splitlines():
        if not line.startswith("LISTEN"):
            continue
        port_match = _SS_PORT_RE.search(line)
        if not port_match:
            continue
        try:
            port = int(port_match.group(1))
        except ValueError:
            continue
        if not (MIN_PORT <= port <= MAX_PORT) or port in proxy_ports:
            continue
        proc_match = _SS_PROC_RE.search(line)
        if not proc_match:
            # 他ユーザ所有のプロセス（権限不足で名前取れない）。dev server として
            # preview したいケースはほぼない（postgres / system daemons）ので除外。
            continue
        proc_name = proc_match.group(1)
        pid = int(proc_match.group(2))
        label = _read_cmdline(pid) or proc_name
        found[port] = (label, pid)
    return found


def scan_once() -> None:
    now = int(time.time())
    live = _scan_listening_ports()
    for port, (proc, pid) in live.items():
        is_self = port in _SELF_PORTS
        # 自分自身は proxy を立てない（proxy_port=None）→ UI で open ボタン非表示。
        proxy = None if is_self else proxy_port_for(port)
        existing = _DETECTED.get(port)
        if existing:
            existing.last_seen_at = now
            existing.process = proc
            existing.pid = pid
        else:
            _DETECTED[port] = DetectedPort(
                session_id=SESSION_ID, port=port,
                proxy_port=proxy,
                process=proc, pid=pid,
                is_self=is_self,
                first_seen_at=now, last_seen_at=now,
            )
    for port in list(_DETECTED.keys()):
        if port in live:
            continue
        if now - _DETECTED[port].last_seen_at > PORT_STALE_SEC:
            del _DETECTED[port]
    _reconcile_proxies()


def list_ports(session_id: str | None = None) -> list[dict]:
    # 自分自身は表示する（識別用、ボタンは UI で出さない）。
    # その他は proxy が立たないポートを除外する。
    items = [p for p in _DETECTED.values() if p.is_self or p.proxy_port is not None]
    if session_id and session_id != SESSION_ID:
        return []
    items.sort(key=lambda p: p.port)
    return [p.to_dict() for p in items]


_scan_task: asyncio.Task | None = None

# {target_port: (asyncio.Server, asyncio.Task)} — 各検出ポートに対する TCP proxy。
_PROXIES: dict[int, asyncio.base_events.Server] = {}


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, OSError):
        pass
    finally:
        try:
            writer.close()
        except OSError:
            pass


def _make_handler(target_port: int):
    async def handler(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
        try:
            upstream_reader, upstream_writer = await asyncio.open_connection("127.0.0.1", target_port)
        except OSError as e:
            logger.warning("preview proxy upstream connect failed port=%d: %s", target_port, e)
            client_writer.close()
            return
        await asyncio.gather(
            _pipe(client_reader, upstream_writer),
            _pipe(upstream_reader, client_writer),
        )
    return handler


async def _start_proxy(target_port: int, proxy_port: int) -> None:
    try:
        server = await asyncio.start_server(_make_handler(target_port), host=PROXY_BIND_HOST, port=proxy_port)
    except OSError as e:
        logger.warning("preview proxy bind failed proxy_port=%d: %s", proxy_port, e)
        return
    _PROXIES[target_port] = server
    logger.info("preview proxy started %s:%d -> 127.0.0.1:%d", PROXY_BIND_HOST, proxy_port, target_port)


def _reconcile_proxies() -> None:
    """検出ポートに合わせて proxy listener を増減する。"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # asyncio ループが回ってないコンテキスト（テストの sync 呼び出しなど）はスキップ
        return
    needed: dict[int, int] = {}
    for entry in _DETECTED.values():
        if entry.proxy_port is not None:
            needed[entry.port] = entry.proxy_port
    # 不要な proxy を閉じる
    for target_port in list(_PROXIES.keys()):
        if target_port not in needed:
            server = _PROXIES.pop(target_port)
            server.close()
            logger.info("preview proxy stopped target=%d", target_port)
    # 足りないものを起こす
    for target_port, proxy_port in needed.items():
        if target_port not in _PROXIES:
            loop.create_task(_start_proxy(target_port, proxy_port))


async def _scan_loop() -> None:
    while True:
        try:
            # preview が最近使われた時だけスキャンする（常時 ss を回さない）。
            # ss は数百バイトで数十ms。proxy reconcile が asyncio.create_task を呼ぶため
            # メインループ上で同期実行する。executor に逃がすと get_event_loop が失敗する。
            if _should_scan_now():
                scan_once()
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as e:
            logger.warning("preview scan failed: %s", e)
        await asyncio.sleep(SCAN_INTERVAL_SEC)


def start_scanner() -> None:
    global _scan_task
    if _scan_task and not _scan_task.done():
        return
    loop = asyncio.get_event_loop()
    _scan_task = loop.create_task(_scan_loop())


def stop_scanner() -> None:
    global _scan_task
    if _scan_task and not _scan_task.done():
        _scan_task.cancel()
    _scan_task = None
