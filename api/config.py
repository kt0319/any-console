import json
import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from .common import (
    CONFIG_FILE,
    CONFIG_SCHEMA_VERSION,
    GLOBAL_CONFIG_KEY,
)
from .config_migrations import (
    _get_config_version,
    _migrate_config_version,
)
from .config_schema import normalize_loaded_config, validate_config_entry
from .errors import bad_request

logger = logging.getLogger(__name__)

_config_lock = threading.Lock()

_fcntl: Any
try:
    import fcntl as _fcntl
except ImportError:
    _fcntl = None


def iter_workspace_entries_from(cfg: dict) -> Iterator[tuple[str, dict]]:
    """`__global__` を除外し dict の workspace entry のみを yield する。"""
    for key, entry in cfg.items():
        if key == GLOBAL_CONFIG_KEY or not isinstance(entry, dict):
            continue
        yield key, entry


@contextmanager
def _file_lock(exclusive: bool):
    if _fcntl is None:
        yield
        return
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_path = CONFIG_FILE.with_suffix(".lock")
    flag = _fcntl.LOCK_EX if exclusive else _fcntl.LOCK_SH
    fp = open(lock_path, "a+")
    try:
        _fcntl.flock(fp.fileno(), flag)
        yield
    finally:
        try:
            _fcntl.flock(fp.fileno(), _fcntl.LOCK_UN)
        finally:
            fp.close()


@contextmanager
def _config_read():
    with _config_lock, _file_lock(exclusive=False):
        yield _read_config_unlocked()


@contextmanager
def _config_write():
    with _config_lock, _file_lock(exclusive=True):
        yield _read_config_unlocked()


def _try_restore_from_bak() -> dict[str, Any] | None:
    bak_path = CONFIG_FILE.with_suffix(".bak")
    if not bak_path.is_file():
        logger.error("config.json is broken and no .bak exists; starting empty")
        return None
    try:
        raw: Any = json.loads(bak_path.read_text(encoding="utf-8"))
        logger.warning("Restored config from %s", bak_path)
        return raw if isinstance(raw, dict) else None
    except (json.JSONDecodeError, OSError) as e:
        logger.error("config.bak is also unreadable: %s; starting empty", e)
        return None


def _read_config_unlocked() -> dict:
    restore_needed = False

    if CONFIG_FILE.is_file():
        try:
            raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            logger.error("config.json is invalid JSON: %s", e)
            raw = _try_restore_from_bak()
            if raw is None:
                return {}
            restore_needed = True
        except OSError as e:
            logger.warning("config read failed path=%s: %s", CONFIG_FILE, e)
            return {}
    else:
        raw = {}

    normalized, errors = normalize_loaded_config(raw, GLOBAL_CONFIG_KEY)
    for name, error in errors:
        logger.warning("config validation failed key=%s: %s", name, error)
    migrated, did_version_migrate = _migrate_config_version(normalized)
    if restore_needed or did_version_migrate:
        _write_config_unlocked(migrated)
    return migrated


def _write_config_unlocked(config: dict) -> None:
    normalized, errors = normalize_loaded_config(config, GLOBAL_CONFIG_KEY)
    if errors:
        name, error = errors[0]
        raise ValueError(f"Invalid config entry '{name}': {error}")
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    bak_path = CONFIG_FILE.with_suffix(".bak")
    if CONFIG_FILE.exists():
        CONFIG_FILE.replace(bak_path)
    tmp_path = CONFIG_FILE.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(CONFIG_FILE)


def load_all_config() -> dict[str, Any]:
    with _config_read() as cfg:
        return dict(cfg)


def save_all_config(config: dict) -> None:
    with _config_lock, _file_lock(exclusive=True):
        _write_config_unlocked(config)


def _find_workspace_key(cfg: dict, identifier: str) -> str | None:
    """ID または表示名（name フィールド）から workspace のキー（ID）を解決する。"""
    if identifier == GLOBAL_CONFIG_KEY:
        return None
    entry = cfg.get(identifier)
    if isinstance(entry, dict):
        return identifier
    for key, value in iter_workspace_entries_from(cfg):
        if value.get("name") == identifier:
            return str(key)
    return None


def resolve_workspace_id(identifier: str) -> str | None:
    """API パラメータで渡される workspace 識別子（ID または 表示名）を ID に解決する。"""
    if not identifier:
        return None
    with _config_read() as cfg:
        return _find_workspace_key(cfg, identifier)


def find_workspace_key(config: dict, identifier: str) -> str | None:
    """ロード済み config に対して同じ解決を行う公開ヘルパー。"""
    return _find_workspace_key(config, identifier)


def load_workspace_config(workspace_name: str) -> dict[str, Any]:
    with _config_read() as cfg:
        key = _find_workspace_key(cfg, workspace_name)
        if key is None:
            return {}
        entry = cfg.get(key, {})
        return dict(entry) if isinstance(entry, dict) else {}


def save_workspace_config(workspace_name: str, config: dict) -> None:
    with _config_write() as all_config:
        key = _find_workspace_key(all_config, workspace_name) or workspace_name
        existing = all_config.get(key, {}) if isinstance(all_config.get(key), dict) else {}
        merged = dict(config)
        if "name" not in merged and existing.get("name"):
            merged["name"] = existing["name"]
        all_config[key] = validate_config_entry(key, merged, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)


def load_workspace_config_section(workspace_name: str, key: str, default=None):
    with _config_read() as cfg:
        ws_key = _find_workspace_key(cfg, workspace_name)
        ws_config = cfg.get(ws_key, {}) if ws_key else {}
        return ws_config.get(key, default if default is not None else {})


def _update_config_section(all_config: dict, config_key: str, section_key: str, data) -> None:
    section = all_config.get(config_key, {})
    section[section_key] = data
    all_config[config_key] = validate_config_entry(config_key, section, GLOBAL_CONFIG_KEY)
    _write_config_unlocked(all_config)


def save_workspace_config_section(workspace_name: str, key: str, data) -> None:
    with _config_write() as all_config:
        ws_key = _find_workspace_key(all_config, workspace_name) or workspace_name
        _update_config_section(all_config, ws_key, key, data)


def delete_workspace_config(workspace_name: str) -> None:
    with _config_write() as all_config:
        ws_key = _find_workspace_key(all_config, workspace_name)
        if ws_key is None:
            return
        all_config.pop(ws_key, None)
        global_config = all_config.get(GLOBAL_CONFIG_KEY, {})
        order = global_config.get("workspace_order", [])
        if ws_key in order:
            order = [n for n in order if n != ws_key]
            global_config["workspace_order"] = order
            all_config[GLOBAL_CONFIG_KEY] = global_config
        _write_config_unlocked(all_config)


def check_config_health() -> dict[str, Any]:
    with _config_lock, _file_lock(exclusive=False):
        return _check_config_health_unlocked()


def _check_config_health_unlocked() -> dict[str, Any]:
    bak_path = CONFIG_FILE.with_suffix(".bak")

    if not CONFIG_FILE.is_file():
        return {"ok": True, "errors": [], "source": "empty"}

    try:
        raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        source = "config.json"
    except json.JSONDecodeError as json_err:
        if bak_path.is_file():
            try:
                raw = json.loads(bak_path.read_text(encoding="utf-8"))
                source = "config.bak"
            except (json.JSONDecodeError, OSError):
                msg = f"config.json is invalid JSON and backup is also broken: {json_err}"
                return {"ok": False, "errors": [{"key": "__root__", "message": msg}], "source": "broken"}
        else:
            return {
                "ok": False,
                "errors": [{"key": "__root__", "message": f"config.json is invalid JSON: {json_err}"}],
                "source": "broken",
            }
    except OSError as e:
        return {"ok": False, "errors": [{"key": "__root__", "message": str(e)}], "source": "broken"}

    _, errors = normalize_loaded_config(raw, GLOBAL_CONFIG_KEY)
    error_list = [{"key": name, "message": str(err)} for name, err in errors]

    config_version = _get_config_version(raw) if isinstance(raw, dict) else 0
    if config_version > CONFIG_SCHEMA_VERSION:
        error_list.append({
            "key": "__version__",
            "message": (
                f"config_version {config_version} is newer than this app supports "
                f"({CONFIG_SCHEMA_VERSION}). Update the app to avoid losing settings."
            ),
        })

    return {
        "ok": source == "config.json" and len(error_list) == 0,
        "errors": error_list,
        "source": source,
        "config_version": config_version,
        "supported_config_version": CONFIG_SCHEMA_VERSION,
    }


def list_workspace_entries() -> dict[str, dict]:
    with _config_read() as cfg:
        return dict(iter_workspace_entries_from(cfg))


def load_global_config_section(key: str, default=None):
    with _config_read() as cfg:
        global_config = cfg.get(GLOBAL_CONFIG_KEY, {})
        return global_config.get(key, default if default is not None else {})


def save_global_config_section(key: str, data) -> None:
    with _config_write() as all_config:
        _update_config_section(all_config, GLOBAL_CONFIG_KEY, key, data)


def compare_and_update_global_config_section(key: str, expected_current: Any, new_value: Any) -> Any:
    """expected_current を前提に算出した new_value を、排他ロック下で再検証してから書き戻す。

    呼び出し側は new_value をロックの外側で（重い処理・他のロックを取る処理を挟んでも
    よい）算出できる。ロック取得後に読み直した現在値が expected_current と一致しない
    場合は、他クライアントの更新（例: PUT による記録・ピン留め）と競合したとみなし、
    new_value を破棄してその時点の現在値をそのまま返す（read-modify-write の
    非アトミック性による lost update を防ぐ）。
    """
    with _config_write() as all_config:
        global_config = all_config.get(GLOBAL_CONFIG_KEY, {})
        current = global_config.get(key, {})
        if current != expected_current:
            return current
        if new_value != current:
            _update_config_section(all_config, GLOBAL_CONFIG_KEY, key, new_value)
        return new_value


def ensure_workspace_exists(workspace_name: str) -> dict:
    """Validate workspace exists and return its config. Raise 400 otherwise."""
    with _config_read() as cfg:
        key = _find_workspace_key(cfg, workspace_name)
        if key is None:
            raise bad_request(f"Workspace '{workspace_name}' not found")
        entry = cfg.get(key)
        if not isinstance(entry, dict):
            raise bad_request(f"Workspace '{workspace_name}' not found")
        return entry
