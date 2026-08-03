"""ローカル dev server のポート検出と検出結果ストア。

Linux では `ss -ltnp`、macOS では `lsof -iTCP -sTCP:LISTEN` で 127.0.0.1 /
0.0.0.0 を LISTEN しているポートを列挙する。セッションごとの紐付けは不要
（個人ツール前提）で、検出した全ポートを共通 "local" セッションとして扱う。
proxy URL は /preview/local/<port>/... になる。

セキュリティ:
- upstream host は 127.0.0.1 にハードコード（preview router 側）。
- 検出対象は loopback/wildcard でリッスンしているソケットのみ。
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
import ssl
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_IS_MACOS = platform.system() == "Darwin"

# preview proxy の TLS 終端に使う証明書。本体は Tailscale serve 経由で HTTPS 化される
# ため通常 SSL_CERTFILE は未設定。その場合は certs/<hostname>.crt/.key を探索する
# （`sudo tailscale cert` で発行したもの。`./any-console https-setup` と同じ置き場所）。
_CERT_DIR = Path(__file__).resolve().parent.parent / "certs"

SCAN_INTERVAL_SEC = 3.0
PORT_STALE_SEC = 8  # LISTEN が消えてから一覧から落とすまで（dev server再起動時の瞬断は許容しつつ、停止を早く反映する）
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


def _find_cert_pair() -> tuple[Path, Path] | None:
    env_cert = os.environ.get("SSL_CERTFILE")
    env_key = os.environ.get("SSL_KEYFILE")
    if env_cert and env_key and Path(env_cert).is_file() and Path(env_key).is_file():
        return Path(env_cert), Path(env_key)
    if _CERT_DIR.is_dir():
        for cert in sorted(_CERT_DIR.glob("*.crt")):
            key = cert.with_suffix(".key")
            if key.is_file():
                return cert, key
    return None


_ssl_ctx: ssl.SSLContext | None = None
_ssl_loaded = False


def preview_ssl_context() -> ssl.SSLContext | None:
    """preview proxy 用の TLS コンテキスト。証明書が無ければ None（平文 http）。"""
    global _ssl_ctx, _ssl_loaded
    if _ssl_loaded:
        return _ssl_ctx
    _ssl_loaded = True
    pair = _find_cert_pair()
    if pair is None:
        return None
    cert, key = pair
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))
        _ssl_ctx = ctx
        logger.info("preview TLS enabled cert=%s", cert.name)
    except (ssl.SSLError, OSError) as e:
        logger.warning("preview TLS disabled: cert load failed: %s", e)
    return _ssl_ctx


def preview_scheme() -> str:
    return "https" if preview_ssl_context() is not None else "http"


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
    # proxy の URL スキーム（"https"/"http"）。proxy が無ければ None。
    scheme: str | None = None
    # upstream が HTTP を喋るか。None=未判定 / True=HTTP / False=非HTTP（adb/RTSP/HTTPS 等）。
    http_ok: bool | None = None
    # 直近にプローブした時刻（epoch秒）。False 判定を一定間隔で再プローブするために使う
    # （dev server がポートを先に開けてからアプリ初期化する場合、起動直後のプローブが
    # 空振りして非HTTPと誤判定されたまま固定されるのを防ぐ）。
    http_probed_at: int = 0
    # プロセスの起動時カレントディレクトリ（取得できなければ None）。
    cwd: str | None = None
    # cwd から一致したワークスペース名（一致しなければ None）。
    workspace: str | None = None

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

# lsof -F pcn の "n" 行（アドレス）末尾からポート番号を抜く。
# 出力例: n127.0.0.1:5173 / n*:5173 / n[::1]:5173
_LSOF_ADDR_RE = re.compile(r":(\d{2,5})$")


def _label_from_cmdline_parts(parts: list[str]) -> str:
    """cmdline の各要素から表示用ラベルを組み立てる。

    通常は先頭要素の basename。node/python 等のランタイム経由の場合は
    実行スクリプト名を続けた "node vite" のような 2 語のラベルを返す。
    """
    if not parts:
        return ""
    # node の場合は実行スクリプト名（例: vite, next）が二番目以降に来る。
    if parts[0].endswith(("node", "python", "python3", "ruby", "bun")) and len(parts) >= 2:
        for p in parts[1:]:
            if not p.startswith("-"):
                base = p.rsplit("/", 1)[-1]
                return f"{parts[0].rsplit('/', 1)[-1]} {base}"
    return parts[0].rsplit("/", 1)[-1]


def _read_cmdline(pid: int) -> str:
    """プロセスの cmdline から表示用ラベルを取得する（_label_from_cmdline_parts 参照）。"""
    if _IS_MACOS:
        try:
            out = subprocess.run(
                ["ps", "-o", "command=", "-p", str(pid)],
                capture_output=True, text=True, timeout=1.0, check=False,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            return ""
        return _label_from_cmdline_parts(out.strip().split())
    try:
        raw = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\x00")  # noqa: SIM115
    except (OSError, ValueError):
        return ""
    parts = [p.decode("utf-8", "replace") for p in raw if p]
    return _label_from_cmdline_parts(parts)


def _read_cwd(pid: int) -> str | None:
    """プロセスの起動時カレントディレクトリを取得する（取得できなければ None）。"""
    if _IS_MACOS:
        try:
            out = subprocess.run(
                ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
                capture_output=True, text=True, timeout=1.0, check=False,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            return None
        for line in out.splitlines():
            if line.startswith("n"):
                return line[1:]
        return None
    try:
        return os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return None


def _match_workspace(cwd: str | None) -> str | None:
    """cwd を登録済みワークスペースのパスと前方一致させ、最長一致の名前を返す。"""
    if not cwd:
        return None
    from .config import list_workspace_entries
    best_name = None
    best_len = -1
    for key, entry in list_workspace_entries().items():
        path = (entry.get("path") or "").rstrip("/")
        if not path:
            continue
        if (cwd == path or cwd.startswith(path + "/")) and len(path) > best_len:
            best_len = len(path)
            best_name = entry.get("name") or key
    return best_name


def _proxy_listener_ports() -> set[int]:
    """現在 any-console が proxy listener として立てているポート集合。"""
    return {entry.proxy_port for entry in _DETECTED.values() if entry.proxy_port is not None}


def _scan_listening_ports_linux() -> dict[int, tuple[str, int | None]]:
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


def _parse_lsof_listeners(out: str) -> list[tuple[int, int, str]]:
    """lsof -F pcn の出力を (port, pid, command) のリストへ変換する。"""
    listeners: list[tuple[int, int, str]] = []
    pid: int | None = None
    command = ""
    for line in out.splitlines():
        if not line:
            continue
        tag, value = line[0], line[1:]
        if tag == "p":
            pid = int(value) if value.isdigit() else None
            command = ""
        elif tag == "c":
            command = value
        elif tag == "n" and pid is not None:
            addr_match = _LSOF_ADDR_RE.search(value)
            if addr_match:
                listeners.append((int(addr_match.group(1)), pid, command))
    return listeners


def _scan_listening_ports_macos() -> dict[int, tuple[str, int | None]]:
    try:
        out = subprocess.run(
            ["lsof", "-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"],
            capture_output=True, text=True, timeout=2.0, check=False,
        ).stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.warning("lsof failed: %s", e)
        return {}
    proxy_ports = _proxy_listener_ports()
    found: dict[int, tuple[str, int | None]] = {}
    for port, pid, command in _parse_lsof_listeners(out):
        if not (MIN_PORT <= port <= MAX_PORT) or port in proxy_ports:
            continue
        found[port] = (_read_cmdline(pid) or command, pid)
    return found


def _scan_listening_ports() -> dict[int, tuple[str, int | None]]:
    if _IS_MACOS:
        return _scan_listening_ports_macos()
    return _scan_listening_ports_linux()


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
            if existing.pid != pid:
                existing.pid = pid
                existing.cwd = _read_cwd(pid) if pid else None
                existing.workspace = _match_workspace(existing.cwd)
        else:
            cwd = _read_cwd(pid) if pid else None
            _DETECTED[port] = DetectedPort(
                session_id=SESSION_ID, port=port,
                proxy_port=proxy,
                process=proc, pid=pid,
                is_self=is_self,
                first_seen_at=now, last_seen_at=now,
                scheme=None if proxy is None else preview_scheme(),
                cwd=cwd,
                workspace=_match_workspace(cwd),
            )
    for port in list(_DETECTED.keys()):
        if port in live:
            continue
        if now - _DETECTED[port].last_seen_at > PORT_STALE_SEC:
            del _DETECTED[port]
    _reconcile_proxies()


def list_ports(session_id: str | None = None) -> list[dict]:
    # 自分自身は表示する（識別用、ボタンは UI で出さない）。
    # proxy が立たないポート、HTTP を喋らないと判定されたポート（adb/RTSP/HTTPS upstream 等）は除外する。
    items = [p for p in _DETECTED.values()
             if p.is_self or (p.proxy_port is not None and p.http_ok is not False)]
    if session_id and session_id != SESSION_ID:
        return []
    items.sort(key=lambda p: p.port)
    return [p.to_dict() for p in items]


_scan_task: asyncio.Task | None = None

# {target_port: asyncio.Server} — 各検出ポートに対する TCP proxy の listener。
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
    ctx = preview_ssl_context()
    try:
        server = await asyncio.start_server(
            _make_handler(target_port), host=PROXY_BIND_HOST, port=proxy_port, ssl=ctx,
        )
    except OSError as e:
        logger.warning("preview proxy bind failed proxy_port=%d: %s", proxy_port, e)
        return
    _PROXIES[target_port] = server
    logger.info("preview proxy started %s %s:%d -> 127.0.0.1:%d",
                preview_scheme(), PROXY_BIND_HOST, proxy_port, target_port)


HTTP_PROBE_TIMEOUT_SEC = 0.5
# HTTP プローブ実行中のターゲットポート（多重起動を防ぐ）。
_PROBING: set[int] = set()


async def _probe_http(target_port: int) -> bool:
    """upstream が HTTP 応答を返すか最小リクエストで確認する。

    adb / RTSP(go2rtc) / HTTPS upstream(home-dash) など HTTP を喋らないポートを
    preview 一覧から除外するために使う。応答の先頭が "HTTP/" なら True。
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", target_port), timeout=HTTP_PROBE_TIMEOUT_SEC,
        )
    except (OSError, asyncio.TimeoutError):
        return False
    try:
        writer.write(b"GET / HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        await asyncio.wait_for(writer.drain(), timeout=HTTP_PROBE_TIMEOUT_SEC)
        head = await asyncio.wait_for(reader.read(16), timeout=HTTP_PROBE_TIMEOUT_SEC)
        return head.startswith(b"HTTP/")
    except (OSError, asyncio.TimeoutError):
        return False
    finally:
        try:
            writer.close()
        except OSError:
            pass


HTTP_PROBE_RETRY_SEC = 30  # http_ok=False は誤判定の可能性があるため一定間隔で再プローブする
# dev server はポートを先に開けてからアプリ初期化するものが多く、検出直後にプローブすると
# 空振りしやすい。初回プローブは検出からこの秒数だけ待ってから行う。
INITIAL_PROBE_DELAY_SEC = 10


async def _probe_and_reconcile(target_port: int) -> None:
    ok = await _probe_http(target_port)
    entry = _DETECTED.get(target_port)
    if entry is not None:
        entry.http_ok = ok
        entry.http_probed_at = int(time.time())
        if not ok:
            logger.info("preview skip non-HTTP port=%d proc=%s", target_port, entry.process)
    _PROBING.discard(target_port)
    _reconcile_proxies()


def _needs_probe(entry: DetectedPort, now: int) -> bool:
    """未判定ポートは検出から INITIAL_PROBE_DELAY_SEC 待ってからプローブする（起動直後の
    空振り防止）。非HTTPと判定された後も HTTP_PROBE_RETRY_SEC 間隔で再プローブする
    （それでも空振りする遅い dev server 向けの安全網）。"""
    if entry.http_ok is None:
        return now - entry.first_seen_at >= INITIAL_PROBE_DELAY_SEC
    if entry.http_ok is False:
        return now - entry.http_probed_at >= HTTP_PROBE_RETRY_SEC
    return False


def _schedule_probes(loop: asyncio.AbstractEventLoop) -> None:
    now = int(time.time())
    for entry in _DETECTED.values():
        if entry.proxy_port is None or entry.port in _PROBING:
            continue
        if _needs_probe(entry, now):
            _PROBING.add(entry.port)
            loop.create_task(_probe_and_reconcile(entry.port))


def _reconcile_proxies() -> None:
    """検出ポートに合わせて proxy listener を増減する。"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # asyncio ループが回ってないコンテキスト（テストの sync 呼び出しなど）はスキップ
        return
    _schedule_probes(loop)
    needed: dict[int, int] = {}
    for entry in _DETECTED.values():
        if entry.proxy_port is not None and entry.http_ok is not False:
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
