"""config.json のスキーマ・マイグレーション（純粋な dict 変換）。

ファイル I/O やロックは持たず、config dict を受け取って変換後の dict を返す
純粋関数のみを置く。config.py（I/O 層）から呼び出される一方向依存とする。

マイグレーションはスキーマバージョンの段階適用（__global__.config_version を基準）
のみ。破壊的なスキーマ変更は `_CONFIG_MIGRATIONS` に変換関数を登録して行う。
"""

import logging
from collections.abc import Callable

from .common import (
    CONFIG_SCHEMA_VERSION,
    GLOBAL_CONFIG_KEY,
)

logger = logging.getLogger(__name__)


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
