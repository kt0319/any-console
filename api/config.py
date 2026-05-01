import json
import logging
import threading
from typing import Any

from .common import CONFIG_FILE, GLOBAL_CONFIG_KEY, default_workspace_dir
from .config_schema import normalize_loaded_config, validate_config_entry

logger = logging.getLogger(__name__)

_config_lock = threading.Lock()


def _migrate_workspace_paths(config: dict) -> bool:
    changed = False
    for name, entry in list(config.items()):
        if name == GLOBAL_CONFIG_KEY:
            continue
        if not isinstance(entry, dict):
            continue
        if not entry.get("path"):
            entry["path"] = str(default_workspace_dir() / name)
            changed = True
    return changed


def _try_restore_from_bak() -> dict | None:
    bak_path = CONFIG_FILE.with_suffix(".bak")
    if not bak_path.is_file():
        logger.error("config.json is broken and no .bak exists; starting empty")
        return None
    try:
        raw = json.loads(bak_path.read_text(encoding="utf-8"))
        logger.warning("Restored config from %s", bak_path)
        return raw
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
    if _migrate_workspace_paths(normalized) or restore_needed:
        _write_config_unlocked(normalized)
    return normalized


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


def load_all_config() -> dict:
    with _config_lock:
        return _read_config_unlocked()


def save_all_config(config: dict) -> None:
    with _config_lock:
        _write_config_unlocked(config)


def load_workspace_config(workspace_name: str) -> dict:
    with _config_lock:
        return _read_config_unlocked().get(workspace_name, {})


def save_workspace_config(workspace_name: str, config: dict) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        all_config[workspace_name] = validate_config_entry(workspace_name, config, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)


def load_workspace_config_section(workspace_name: str, key: str, default=None):
    with _config_lock:
        ws_config = _read_config_unlocked().get(workspace_name, {})
        return ws_config.get(key, default if default is not None else {})


def save_workspace_config_section(workspace_name: str, key: str, data) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        ws_config = all_config.get(workspace_name, {})
        ws_config[key] = data
        all_config[workspace_name] = validate_config_entry(workspace_name, ws_config, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)


def delete_workspace_config(workspace_name: str) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        all_config.pop(workspace_name, None)
        global_config = all_config.get(GLOBAL_CONFIG_KEY, {})
        order = global_config.get("workspace_order", [])
        if workspace_name in order:
            order = [n for n in order if n != workspace_name]
            global_config["workspace_order"] = order
            all_config[GLOBAL_CONFIG_KEY] = global_config
        _write_config_unlocked(all_config)


def check_config_health() -> dict[str, Any]:
    with _config_lock:
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
    return {
        "ok": source == "config.json" and len(error_list) == 0,
        "errors": error_list,
        "source": source,
    }


def list_workspace_entries() -> dict[str, dict]:
    with _config_lock:
        all_config = _read_config_unlocked()
        return {
            name: entry for name, entry in all_config.items()
            if name != GLOBAL_CONFIG_KEY and isinstance(entry, dict)
        }


def load_global_config_section(key: str, default=None):
    with _config_lock:
        global_config = _read_config_unlocked().get(GLOBAL_CONFIG_KEY, {})
        return global_config.get(key, default if default is not None else {})


def save_global_config_section(key: str, data) -> None:
    with _config_lock:
        all_config = _read_config_unlocked()
        global_config = all_config.get(GLOBAL_CONFIG_KEY, {})
        global_config[key] = data
        all_config[GLOBAL_CONFIG_KEY] = validate_config_entry(GLOBAL_CONFIG_KEY, global_config, GLOBAL_CONFIG_KEY)
        _write_config_unlocked(all_config)
