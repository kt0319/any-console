"""config.json のスキーマ・マイグレーション（純粋な dict 変換）。

ファイル I/O やロックは持たず、config dict を受け取って変換後の dict を返す
純粋関数のみを置く。config.py（I/O 層）から呼び出される一方向依存とする。

2系統のマイグレーションがある:
- workspace キーの ID 化（旧形式: キー=表示名 → 新形式: キー=ID）
- スキーマバージョンの段階適用（__global__.config_version を基準）
"""

import logging
from collections.abc import Callable
from typing import Any

from .common import (
    CONFIG_SCHEMA_VERSION,
    GLOBAL_CONFIG_KEY,
    generate_workspace_id,
    is_workspace_id,
)

logger = logging.getLogger(__name__)


def _rebuild_workspace_keys(config: dict) -> tuple[dict, dict[str, str]]:
    """workspace entry のキーを ID 化し、旧名→新ID の対応表を返す。"""
    name_to_id: dict[str, str] = {}
    new_config: dict[str, Any] = {}
    for key, entry in config.items():
        if key == GLOBAL_CONFIG_KEY or not isinstance(entry, dict) or is_workspace_id(key):
            new_config[key] = entry
            continue
        new_id = generate_workspace_id()
        while new_id in config or new_id in new_config:
            new_id = generate_workspace_id()
        name_to_id[key] = new_id
        new_entry = dict(entry)
        new_entry.setdefault("name", key)
        new_config[new_id] = new_entry
    return new_config, name_to_id


def _remap_global_references(global_section: dict, name_to_id: dict[str, str]) -> dict:
    """__global__ 配下の workspace_order / recent_jobs を旧名→新IDに置き換える。"""
    global_section = dict(global_section)
    order = global_section.get("workspace_order")
    if isinstance(order, list):
        global_section["workspace_order"] = [name_to_id.get(n, n) for n in order]
    recent = global_section.get("recent_jobs")
    if isinstance(recent, list):
        new_recent = []
        for r in recent:
            if isinstance(r, dict):
                r = dict(r)
                old_ws = r.get("workspace")
                if isinstance(old_ws, str) and old_ws in name_to_id:
                    r["workspace"] = name_to_id[old_ws]
            new_recent.append(r)
        global_section["recent_jobs"] = new_recent
    return global_section


def _migrate_workspace_keys_to_ids(config: dict) -> tuple[dict, bool]:
    """旧形式（キー=表示名）を新形式（キー=ID）に変換し、参照箇所も更新。"""
    new_config, name_to_id = _rebuild_workspace_keys(config)
    if not name_to_id:
        return new_config, False
    global_section = new_config.get(GLOBAL_CONFIG_KEY)
    if isinstance(global_section, dict):
        new_config[GLOBAL_CONFIG_KEY] = _remap_global_references(global_section, name_to_id)
    logger.info("migrated %d workspace key(s) to id", len(name_to_id))
    return new_config, True


def _get_config_version(config: dict) -> int:
    """config に保存されたスキーマバージョンを返す。未設定/不正なら 0（旧版）。"""
    global_section = config.get(GLOBAL_CONFIG_KEY)
    if isinstance(global_section, dict):
        version = global_section.get("config_version")
        if isinstance(version, int) and not isinstance(version, bool) and version >= 0:
            return version
    return 0


def _set_config_version(config: dict, version: int) -> dict:
    """__global__.config_version を書き込んだ新しい config を返す。"""
    global_section = config.get(GLOBAL_CONFIG_KEY)
    global_section = dict(global_section) if isinstance(global_section, dict) else {}
    global_section["config_version"] = version
    new_config = dict(config)
    new_config[GLOBAL_CONFIG_KEY] = global_section
    return new_config


# 旧バージョン -> 次バージョンへの変換関数。キー N の関数は version N の config を
# version N+1 に変換する。破壊的なスキーマ変更を入れる際にここへ追加する。
# 各関数は config dict を受け取り、変換後の dict を返す（元を破壊しないこと）。
_CONFIG_MIGRATIONS: dict[int, Callable[[dict], dict]] = {}


def _migrate_config_version(config: dict) -> tuple[dict, bool]:
    """config を CONFIG_SCHEMA_VERSION まで段階的にマイグレーションする。

    - 空 config（初回起動）は何もしない。
    - 旧版はマイグレーションを順次適用し、バージョンを刻んで返す。
    - コードより新しいバージョンの config は破壊を避けるため変換も再書き込みも
      せず、警告のみ出してそのまま返す（best-effort 互換動作）。
    """
    if not config:
        return config, False

    current = _get_config_version(config)
    if current > CONFIG_SCHEMA_VERSION:
        logger.warning(
            "config_version %d is newer than supported %d; "
            "running in best-effort compatibility mode",
            current, CONFIG_SCHEMA_VERSION,
        )
        return config, False
    if current == CONFIG_SCHEMA_VERSION:
        return config, False

    migrated = config
    version = current
    while version < CONFIG_SCHEMA_VERSION:
        migrate = _CONFIG_MIGRATIONS.get(version)
        if migrate is not None:
            migrated = migrate(migrated)
        version += 1
    migrated = _set_config_version(migrated, CONFIG_SCHEMA_VERSION)
    logger.info("migrated config schema v%d -> v%d", current, CONFIG_SCHEMA_VERSION)
    return migrated, True
