"""git ステータスのリアルタイム監視・配信（status stream）。

watchfiles でワークスペースの作業ツリーと .git の要所（HEAD / index / refs 等）を
監視し、変更のあったワークスペースだけ git_info を再計算して WebSocket 購読者へ
push する。API 経由の git 操作は invalidate_git_info からの nudge_workspace で
FS イベントを待たずに即時 push される。

購読者がいる間だけ FS 監視と自動 fetch（behind 判定の更新用）が動き、
購読者ゼロで全て停止するため、クライアントが繋がっていないときのコストはゼロ。

watchfiles が未インストールの環境では FS 監視をスキップし、API 操作起点の push と
自動 fetch 起点の push のみに劣化する（クライアント側の既存ポーリングが下支えする）。
"""

import asyncio
import importlib.util
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, NamedTuple

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

from .common import (
    BACKGROUND_EXECUTOR,
    BACKGROUND_FETCH_TIMEOUT_SEC,
    GIT_AUTO_FETCH_INTERVAL_SEC,
    GIT_WATCH_DEBOUNCE_MS,
    GIT_WATCH_RETRY_SEC,
    GIT_WATCH_STEP_MS,
    run_subprocess_safe,
    safe_resolve_str,
)
from .config import list_workspace_entries
from .git_info import refresh_git_info
from .git_utils import git_is_repo, run_git_raw

logger = logging.getLogger(__name__)


class WatchTarget(NamedTuple):
    name: str
    path: Path
    # worktree の場合はベースワークスペースの表示名（ベースが未登録なら None）。
    base: str | None = None
    # linked worktree の専用 gitdir（<base>/.git/worktrees/<x>）。通常リポジトリは None。
    gitdir: Path | None = None
    # linked worktree が共有する本体の .git。通常リポジトリは None。
    common: Path | None = None


# watchfiles DefaultFilter 相当の無視リスト（.git は要所のみ通すため除外して個別処理）
_IGNORE_DIRS = frozenset({
    "__pycache__", ".hg", ".svn", ".tox", ".venv", "node_modules",
    ".idea", ".mypy_cache", ".pytest_cache", ".hypothesis", "site-packages",
})
# .git 配下で git 状態の変化を表すファイル（これ以外の .git 内部は無視する）
_GIT_WATCH_BASENAMES = frozenset({
    "HEAD", "ORIG_HEAD", "MERGE_HEAD", "FETCH_HEAD", "index", "packed-refs",
})
# エディタの一時ファイル等（watchfiles DefaultFilter 相当）
_IGNORE_ENTITY_RE = re.compile(r"\.py[cod]$|\.sw.$|~$|^\.#|^\.DS_Store$")

_GIT_SEG = f"{os.sep}.git{os.sep}"
_GIT_WORKTREES_SEG = f"{os.sep}.git{os.sep}worktrees{os.sep}"


def is_relevant_change(path_str: str) -> bool:
    """FS イベントのパスが git ステータスに影響しうるか判定する純関数。"""
    parts = Path(path_str).parts
    if not parts:
        return False
    if ".git" in parts:
        inner = parts[parts.index(".git") + 1:]
        if not inner:
            return False
        # refs/（ブランチ・リモート追跡）配下と、要所ファイルのみ通す
        return "refs" in inner or inner[-1] in _GIT_WATCH_BASENAMES
    if any(p in _IGNORE_DIRS for p in parts):
        return False
    return not _IGNORE_ENTITY_RE.search(parts[-1])


def _worktree_git_dirs(path: Path) -> tuple[Path, Path] | None:
    """path が linked worktree なら (専用 gitdir, 共有 .git) を返す。通常リポジトリは None。"""
    try:
        result = run_git_raw(["rev-parse", "--absolute-git-dir", "--git-common-dir"], path)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    lines = result.stdout.strip().splitlines()
    if len(lines) != 2:
        return None
    git_dir = Path(lines[0])
    common = Path(lines[1])
    if not common.is_absolute():
        common = (path / common).resolve()
    if safe_resolve_str(git_dir) == safe_resolve_str(common):
        return None
    return git_dir, common


def collect_watch_targets() -> list[WatchTarget]:
    """監視対象（登録済み git ワークスペース + 動的 worktree）を集める。

    /workspaces/statuses が返す集合と一致させる。登録済みワークスペース自体が
    linked worktree の場合は、git 状態の実体である専用 gitdir / 共有 .git も記録し、
    ベースが登録済みならその表示名を base に載せる（監視・マッピングに使う）。
    """
    # routers.workspaces は本モジュールを import するため、循環回避で遅延 import する
    from .routers.workspaces import _dynamic_worktree_entries
    registered: list[tuple[str, Path]] = []
    for ws_id, config in list_workspace_entries().items():
        p = Path(config.get("path", ""))
        if p.is_dir() and git_is_repo(p):
            registered.append((config.get("name") or ws_id, p))
    name_by_path = {safe_resolve_str(p): name for name, p in registered}

    targets = []
    for name, p in registered:
        dirs = _worktree_git_dirs(p)
        if dirs is None:
            targets.append(WatchTarget(name, p))
            continue
        gitdir, common = dirs
        base_name = name_by_path.get(safe_resolve_str(common.parent))
        targets.append(WatchTarget(name, p, base=base_name, gitdir=gitdir, common=common))
    for wt in _dynamic_worktree_entries():
        targets.append(WatchTarget(wt["name"], Path(wt["path"]), base=wt["worktree_base"]))
    return targets


def watch_roots(targets: list[WatchTarget]) -> list[Path]:
    """監視ルートの集合を組み立てる。

    作業ツリーに加え、作業ツリー群でカバーされない worktree の共有 .git / 専用
    gitdir（ベースが未登録のケース）も監視する。ネスト・重複は取り除く。
    """
    roots = [str(t.path) for t in targets]

    def covered(d: str, base: list[str]) -> bool:
        return any(d == r or d.startswith(r + os.sep) for r in base)

    extras: list[str] = []
    for t in targets:
        for d in (t.common, t.gitdir):  # gitdir は common 配下なので common を先に見る
            if d is None:
                continue
            s = str(d)
            if not covered(s, roots) and not covered(s, extras):
                extras.append(s)
    return [Path(r) for r in roots + extras]


def _names_for_hit(
    prefix: str, t: WatchTarget, kind: str, p: str, targets: list[WatchTarget],
) -> set[str]:
    """一致したプレフィックスの種別ごとに、再計算すべきワークスペース名を決める。"""
    if kind == "gitdir":
        # linked worktree の専用 gitdir（HEAD/index 等）はその worktree だけ
        return {t.name}
    if kind == "path":
        names = {t.name}
        # .git 配下（FETCH_HEAD・refs/remotes 等の共有 git 状態）の変更は、この
        # リポジトリをベースとする worktree の ahead/behind にも影響するため展開する
        if _GIT_SEG in p:
            names.update(c.name for c in targets if c.base == t.name)
        return names
    # kind == "common": 共有 .git の変更（FETCH_HEAD・refs 等）は、同じ .git を共有する
    # 全 worktree ＋ ベース本体 ＋ ベースに属する動的 worktree（common を持たない）へ展開する
    names = {c.name for c in targets if c.common is not None and str(c.common) == prefix}
    if t.base:
        names.add(t.base)
        names.update(c.name for c in targets if c.base == t.base)
    return names


def match_workspaces(changed_paths: set[str], targets: list[WatchTarget]) -> set[str]:
    """変更パス集合を、再計算すべきワークスペース名の集合へ対応付ける。

    - 最長プレフィックス一致で持ち主を決める（作業ツリー・専用 gitdir・共有 .git）
    - 展開の内訳は _names_for_hit を参照
    """
    candidates: list[tuple[str, WatchTarget, str]] = []
    for t in targets:
        candidates.append((str(t.path), t, "path"))
        if t.gitdir is not None:
            candidates.append((str(t.gitdir), t, "gitdir"))
        if t.common is not None:
            candidates.append((str(t.common), t, "common"))
    # 同一プレフィックス（共有 .git 等）が隣接するよう文字列でも整列する
    candidates.sort(key=lambda c: (-len(c[0]), c[0]))

    names: set[str] = set()
    for p in changed_paths:
        best: str | None = None
        for prefix, t, kind in candidates:
            if best is not None and prefix != best:
                break
            if p != prefix and not p.startswith(prefix + os.sep):
                continue
            best = prefix
            names.update(_names_for_hit(prefix, t, kind, p, targets))
    return names


_has_watchfiles: bool | None = None
# awatch が失敗している間 True（inotify 上限・ディレクトリ消失等）。
# 健全性が確認できる（イベントが届く）まで sticky に保ち、安全側＝ポーリング継続に倒す。
_watch_failed = False


def watch_available() -> bool:
    """FS 監視（watchfiles）が使えるか。"""
    global _has_watchfiles
    if _has_watchfiles is None:
        _has_watchfiles = importlib.util.find_spec("watchfiles") is not None
    return _has_watchfiles


def stream_watching() -> bool:
    """クライアントへ通知する「FS 監視が実効か」の現在値。

    False の間、クライアントはポーリングを継続する（hello メッセージで通知）。
    """
    return watch_available() and not _watch_failed


async def _set_watch_failed(failed: bool) -> None:
    """監視の失敗状態を更新し、変化があれば購読者へ hello を再送する。"""
    global _watch_failed
    if _watch_failed == failed:
        return
    _watch_failed = failed
    await _broadcast({"type": "hello", "watching": stream_watching()})


_subscribers: set[WebSocket] = set()
_loop: asyncio.AbstractEventLoop | None = None
_watch_task: asyncio.Task | None = None
_fetch_task: asyncio.Task | None = None
_restart_event: asyncio.Event | None = None
_targets: list[WatchTarget] = []
_last_sent: dict[str, dict[str, Any]] = {}


def subscriber_count() -> int:
    return len(_subscribers)


async def subscribe(websocket: WebSocket) -> None:
    """購読者を登録し、最初の購読者なら監視・自動 fetch タスクを起動する。"""
    global _loop
    _loop = asyncio.get_running_loop()
    _subscribers.add(websocket)
    _ensure_tasks()


def unsubscribe(websocket: WebSocket) -> None:
    """購読者を解除し、ゼロになったら全タスクを停止する。"""
    _subscribers.discard(websocket)
    if not _subscribers:
        _stop_tasks()


def _task_stale(task: asyncio.Task | None, loop: asyncio.AbstractEventLoop) -> bool:
    # テスト等でイベントループが作り直された場合、旧ループのタスクは無効
    return task is None or task.done() or task.get_loop() is not loop


def _ensure_tasks() -> None:
    global _watch_task, _fetch_task
    loop = asyncio.get_running_loop()
    if _task_stale(_watch_task, loop):
        _watch_task = loop.create_task(_watch_loop())
    if _task_stale(_fetch_task, loop):
        _fetch_task = loop.create_task(_auto_fetch_loop())


def _stop_tasks() -> None:
    global _watch_task, _fetch_task
    for task in (_watch_task, _fetch_task):
        if task is not None and not task.done():
            try:
                task.cancel()
            except RuntimeError:  # 属するループが既に閉じている
                pass
    _watch_task = None
    _fetch_task = None
    _last_sent.clear()


def shutdown() -> None:
    """アプリ終了時のクリーンアップ（lifespan から呼ばれる）。"""
    _subscribers.clear()
    _stop_tasks()


def notify_workspaces_changed() -> None:
    """ワークスペースの追加・削除・パス変更時に監視対象を再収集させる。

    ルーターのスレッドプールから呼ばれるためスレッドセーフにしてある。
    """
    loop = _loop
    if loop is None or loop.is_closed():
        return
    loop.call_soon_threadsafe(_set_restart)


def nudge_workspace(workspace_name: str) -> None:
    """API 経由の git 操作直後に該当ワークスペースの再計算・push を予約する。

    invalidate_git_info から呼ばれる。購読者がいなければ何もしない。
    スレッドセーフ。
    """
    loop = _loop
    if loop is None or loop.is_closed() or not _subscribers:
        return
    loop.call_soon_threadsafe(_schedule_push, workspace_name)


def _set_restart() -> None:
    if _restart_event is not None:
        _restart_event.set()


def _schedule_push(workspace_name: str) -> None:
    if _subscribers:
        asyncio.ensure_future(_push_by_name(workspace_name))


async def _push_by_name(workspace_name: str) -> None:
    target = next((t for t in _targets if t.name == workspace_name), None)
    if target is None:
        loop = asyncio.get_running_loop()
        targets = await loop.run_in_executor(BACKGROUND_EXECUTOR, collect_watch_targets)
        target = next((t for t in targets if t.name == workspace_name), None)
    if target is not None:
        await _push_status(target)


async def _push_status(target: WatchTarget) -> None:
    """git_info を再計算し、前回送信時から変化があれば購読者へ配信する。"""
    loop = asyncio.get_running_loop()
    status = await loop.run_in_executor(
        BACKGROUND_EXECUTOR, refresh_git_info, target.path, target.name,
    )
    if _last_sent.get(target.name) == status:
        return
    _last_sent[target.name] = status
    await _broadcast({"type": "statuses", "statuses": [status]})


async def _broadcast(payload: dict[str, Any]) -> None:
    dead = []
    for ws in list(_subscribers):
        try:
            await ws.send_json(payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            dead.append(ws)
    for ws in dead:
        unsubscribe(ws)


async def _refresh_targets() -> list[WatchTarget]:
    global _targets
    loop = asyncio.get_running_loop()
    _targets = await loop.run_in_executor(BACKGROUND_EXECUTOR, collect_watch_targets)
    return _targets


def _watch_filter(change: object, path: str) -> bool:
    return is_relevant_change(path)


async def _handle_changes(changes: set, targets: list[WatchTarget]) -> None:
    global _targets
    paths = {p for _, p in changes}
    names = match_workspaces(paths, targets)
    for target in targets:
        if target.name in names:
            await _push_status(target)
    # worktree の作成・削除は監視対象集合を変えるので再収集する。ただし worktree 内の
    # コミット等も .git/worktrees/ を触るため、無条件に再起動すると awatch の再構築中に
    # 直後のイベントを取りこぼす。集合が実際に変わったときだけ再起動する。
    if any(_GIT_WORKTREES_SEG in p for p in paths):
        loop = asyncio.get_running_loop()
        new_targets = await loop.run_in_executor(BACKGROUND_EXECUTOR, collect_watch_targets)
        if set(new_targets) != set(targets):
            _targets = new_targets
            _set_restart()


async def _watch_loop() -> None:  # pragma: no cover - OS の FS イベントに依存
    """watchfiles で FS を監視し、変更のあったワークスペースを push する。"""
    global _restart_event
    if not watch_available():
        logger.info("watchfiles not installed; realtime git status falls back to fetch/API triggers")
        return
    from watchfiles import awatch
    try:
        while _subscribers:
            targets = await _refresh_targets()
            _restart_event = asyncio.Event()
            if not targets:
                await _restart_event.wait()
                continue
            try:
                async for changes in awatch(
                    *watch_roots(targets),
                    watch_filter=_watch_filter,
                    debounce=GIT_WATCH_DEBOUNCE_MS,
                    step=GIT_WATCH_STEP_MS,
                    stop_event=_restart_event,
                ):
                    # イベントが届いた＝監視は健全。失敗状態から復帰していれば通知する
                    await _set_watch_failed(False)
                    await _handle_changes(changes, targets)
            except OSError as e:
                # inotify 上限やディレクトリ消失など。ポーリング再開をクライアントへ
                # 通知したうえで、少し待って対象を再収集・再試行する。
                logger.warning("git watch error (retrying): %s", e)
                await _set_watch_failed(True)
                await asyncio.sleep(GIT_WATCH_RETRY_SEC)
    except asyncio.CancelledError:
        pass


def _fetch_one(directory: Path) -> None:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    if run_subprocess_safe(
        ["git", "fetch", "--quiet"],
        timeout=BACKGROUND_FETCH_TIMEOUT_SEC, cwd=str(directory), env=env,
        log_label=f"auto fetch {directory.name}",
    ) is None:
        logger.debug("auto fetch failed dir=%s", directory.name)


async def _auto_fetch_loop() -> None:  # pragma: no cover - 実時間スリープに依存
    """購読者がいる間、定期的に git fetch して behind 判定を最新化する。

    fetch の結果 .git/FETCH_HEAD や refs が変わると FS 監視経由で push される。
    watchfiles が無い環境向けに、fetch 後は明示的に再計算・push も行う
    （変化がなければ _push_status 側の snapshot 比較で配信されない）。
    """
    try:
        while _subscribers:
            await asyncio.sleep(GIT_AUTO_FETCH_INTERVAL_SEC)
            if not _subscribers:
                break
            # watchfiles が無い環境でもワークスペースの増減へ追従できるよう毎回集め直す
            targets = await _refresh_targets()
            loop = asyncio.get_running_loop()
            for target in targets:
                if target.base is not None:
                    continue  # worktree は本体と remote/refs を共有するので本体のみ fetch
                await loop.run_in_executor(BACKGROUND_EXECUTOR, _fetch_one, target.path)
            for target in targets:
                await _push_status(target)
    except asyncio.CancelledError:
        pass
    except subprocess.SubprocessError as e:
        logger.warning("auto fetch loop stopped: %s", e)
