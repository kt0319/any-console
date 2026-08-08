"""screen manifest のリモート更新（herdr の manifest_update.rs に対応）。

herdr.dev のカタログ（`index.toml`: schema_version = 1 と [[agents]] id/path）を
取得し、エージェントごとのマニフェスト TOML を検証してから
`data/agent-detection/remote/<id>.toml` へ保存する。検証は herdr と同じ:

- id がカタログのエージェントと一致し、version（ドット区切り数値）と
  min_engine_version が必須。エンジンバージョン超過は拒否
- キャッシュ済みより古い version は拒否。同一 version で内容が変わっていたら
  拒否（version bump なしの差し替えを防ぐ）
- カタログの path は相対パスのみ（`://`・先頭 `/`・`..` を含むものは拒否）

結果は `data/agent-detection/status.json` に記録する（最終確認時刻・結果・
エージェントごとのキャッシュ版数とエラー）。確認は起動から
AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC 後に開始し、以後
AGENT_MANIFEST_UPDATE_INTERVAL_SEC ごと。`config.json` の
`__global__.agent_detection.remote_update` を false にすると無効化できる。
カタログ URL は環境変数 ANY_CONSOLE_MANIFEST_CATALOG_URL で差し替え可能
（テスト・自前ミラー用）。
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import tomllib
from pathlib import Path
from typing import Any, Callable

import httpx

from . import screen_manifest
from .common import (
    AGENT_MANIFEST_FETCH_TIMEOUT_SEC,
    AGENT_MANIFEST_MAX_FETCH_BYTES,
    AGENT_MANIFEST_UPDATE_INTERVAL_SEC,
    AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC,
    BACKGROUND_FETCH_EXECUTOR,
    cancel_task_quietly,
    load_json_file,
    save_json_file,
    save_text_file,
    task_stale,
)
from .screen_manifest import (
    compare_manifest_versions,
    invalidate_manifest_cache,
    load_manifests,
    parse_manifest_text,
    parse_manifest_version,
)

logger = logging.getLogger(__name__)

DEFAULT_CATALOG_URL = "https://herdr.dev/agent-detection/index.toml"
CATALOG_URL_ENV = "ANY_CONSOLE_MANIFEST_CATALOG_URL"

FetchFn = Callable[[str], str]


class ManifestUpdateError(Exception):
    """カタログ・マニフェストの取得/検証エラー。"""


def _status_path() -> Path:
    return screen_manifest.REMOTE_DIR.parent / "status.json"


def load_status() -> dict[str, Any]:
    data = load_json_file(_status_path(), {})
    return data if isinstance(data, dict) else {}


def _save_status(status: dict[str, Any]) -> None:
    try:
        save_json_file(_status_path(), status)
    except OSError as e:
        logger.warning("failed to save manifest update status: %s", e)


def catalog_url() -> str:
    return os.environ.get(CATALOG_URL_ENV) or DEFAULT_CATALOG_URL


def _base_url(url: str) -> str:
    if "/" not in url.rsplit("://", 1)[-1]:
        raise ManifestUpdateError(f"catalog url {url!r} has no path")
    return url.rsplit("/", 1)[0]


def fetch_text(url: str) -> str:
    """URL からテキストを取得する（サイズ上限・タイムアウト付き）。"""
    try:
        with httpx.Client(
            timeout=AGENT_MANIFEST_FETCH_TIMEOUT_SEC, follow_redirects=True,
        ) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                chunks = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > AGENT_MANIFEST_MAX_FETCH_BYTES:
                        raise ManifestUpdateError(f"response for {url} exceeds size limit")
                    chunks.append(chunk)
        return b"".join(chunks).decode("utf-8")
    except (httpx.HTTPError, UnicodeDecodeError) as e:
        raise ManifestUpdateError(f"fetch failed for {url}: {e}") from e


def parse_catalog(content: str) -> list[tuple[str, str]]:
    """カタログ TOML をパースして (agent_id, 相対 path) のリストを返す。"""
    try:
        raw = tomllib.loads(content)
    except tomllib.TOMLDecodeError as e:
        raise ManifestUpdateError(f"failed to parse catalog TOML: {e}") from e
    if raw.get("schema_version") != 1:
        raise ManifestUpdateError(
            f"unsupported catalog schema_version {raw.get('schema_version')!r}")
    known_ids = {m.id for m in load_manifests()}
    seen = set()
    agents = []
    for entry in raw.get("agents", []):
        if not isinstance(entry, dict):
            raise ManifestUpdateError("catalog entry is not a table")
        agent_id = str(entry.get("id", "")).strip()
        path = str(entry.get("path", "")).strip()
        if agent_id not in known_ids:
            # 同梱マニフェストの無いエージェントは認識対象外（herdr と同じく skip）
            logger.info("skipping unknown remote manifest agent %s", agent_id)
            continue
        if not path:
            raise ManifestUpdateError(f"catalog entry {agent_id} has an empty path")
        if "://" in path or path.startswith("/") or ".." in path.split("/"):
            raise ManifestUpdateError(f"catalog entry {agent_id} has an unsafe path {path}")
        if agent_id in seen:
            raise ManifestUpdateError(f"catalog contains duplicate agent {agent_id}")
        seen.add(agent_id)
        agents.append((agent_id, path))
    return agents


def _cached_remote_version(agent_id: str) -> tuple[int, ...] | None:
    path = screen_manifest.remote_manifest_path(agent_id)
    if not path.is_file():
        return None
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
        version = raw.get("version")
        return parse_manifest_version(str(version)) if version is not None else None
    except (OSError, tomllib.TOMLDecodeError, ValueError):
        return None


def process_agent_manifest(agent_id: str, content: str) -> bool:
    """取得したマニフェストを検証してコミットする。更新があれば True。

    検証失敗・バージョン後退・version bump なしの内容変更は ManifestUpdateError。
    """
    try:
        manifest = parse_manifest_text(content, source="remote", require_remote_fields=True)
    except (tomllib.TOMLDecodeError, re.error, ValueError, TypeError) as e:
        raise ManifestUpdateError(f"invalid manifest for {agent_id}: {e}") from e
    if manifest.id != agent_id:
        raise ManifestUpdateError(
            f"manifest id {manifest.id!r} does not match catalog agent {agent_id!r}")
    if manifest.version is None:  # require_remote_fields で到達しないが型を絞る
        raise ManifestUpdateError(f"manifest for {agent_id} is missing version")

    cached = _cached_remote_version(agent_id)
    if cached is not None:
        cmp = compare_manifest_versions(manifest.version, cached)
        if cmp < 0:
            raise ManifestUpdateError(
                f"remote version for {agent_id} is older than cached")
        if cmp == 0:
            committed = ""
            try:
                committed = screen_manifest.remote_manifest_path(agent_id).read_text(
                    encoding="utf-8")
            except OSError:
                pass
            if committed != content:
                raise ManifestUpdateError(
                    f"remote manifest {agent_id} changed content without a version bump")
            return False

    try:
        save_text_file(screen_manifest.remote_manifest_path(agent_id), content)
    except OSError as e:
        raise ManifestUpdateError(f"failed to store manifest for {agent_id}: {e}") from e
    return True


def check_and_update(fetch: FetchFn = fetch_text) -> dict[str, Any]:
    """カタログを確認し、更新があればコミットして status を返す（同期処理）。

    エージェント単位のエラーは status に記録して続行する。カタログ自体の
    取得・解釈失敗は last_result に記録する。
    """
    status = load_status()
    status["last_check_unix"] = int(time.time())
    agents_status = status.setdefault("agents", {})
    updated = False
    try:
        catalog = parse_catalog(fetch(catalog_url()))
        base = _base_url(catalog_url())
        for agent_id, path in catalog:
            entry: dict[str, Any] = {}
            try:
                changed = process_agent_manifest(agent_id, fetch(f"{base}/{path}"))
                updated = updated or changed
                entry["last_result"] = "updated" if changed else "unchanged"
            except ManifestUpdateError as e:
                entry["last_result"] = "failed"
                entry["last_error"] = str(e)
                logger.warning("manifest update failed agent=%s: %s", agent_id, e)
            cached = _cached_remote_version(agent_id)
            entry["cached_version"] = ".".join(map(str, cached)) if cached else None
            agents_status[agent_id] = entry
        status["last_result"] = "checked"
    except ManifestUpdateError as e:
        status["last_result"] = f"failed: {e}"
        logger.warning("manifest catalog check failed: %s", e)
    _save_status(status)
    if updated:
        invalidate_manifest_cache()
        logger.info("remote screen manifests updated")
    return status


def remote_update_enabled() -> bool:
    from .config import load_global_config_section
    raw = load_global_config_section("agent_detection", {})
    if not isinstance(raw, dict):
        return True
    return bool(raw.get("remote_update", True))


_update_task: asyncio.Task | None = None


async def _update_loop() -> None:  # pragma: no cover - 実時間スリープに依存
    await asyncio.sleep(AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC)
    while True:
        if remote_update_enabled():
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(BACKGROUND_FETCH_EXECUTOR, check_and_update)
            except RuntimeError:  # executor が shutdown 済み（終了処理中）
                return
        await asyncio.sleep(AGENT_MANIFEST_UPDATE_INTERVAL_SEC)


def start_updater() -> None:
    """lifespan から呼ぶ。リモート更新の定期確認タスクを起動する。"""
    global _update_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if task_stale(_update_task, loop):
        _update_task = loop.create_task(_update_loop())


def stop_updater() -> None:
    global _update_task
    cancel_task_quietly(_update_task)
    _update_task = None
