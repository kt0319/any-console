//! config.json のスキーマバージョン管理。
//!
//! ファイル I/O やロックは持たず、config dict を受け取って変換後の dict を返す
//! 純粋関数のみを置く。

use serde_json::{Map, Value};

use crate::config::GLOBAL_CONFIG_KEY;

pub const CONFIG_SCHEMA_VERSION: i64 = 4;

/// config に保存されたスキーマバージョンを返す。未設定/不正なら 0（旧版）。
pub fn get_config_version(config: &Map<String, Value>) -> i64 {
    config
        .get(GLOBAL_CONFIG_KEY)
        .and_then(Value::as_object)
        .and_then(|g| g.get("config_version"))
        .and_then(|v| if v.is_boolean() { None } else { v.as_i64() })
        .filter(|&v| v >= 0)
        .unwrap_or(0)
}

fn set_config_version(mut config: Map<String, Value>, version: i64) -> Map<String, Value> {
    let mut global = config
        .get(GLOBAL_CONFIG_KEY)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    global.insert("config_version".to_string(), Value::Number(version.into()));
    config.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(global));
    config
}

/// config の config_version を CONFIG_SCHEMA_VERSION に揃える。
/// v4 未満からのキー変換（radial / pinned_jobs / detached_tab）は打ち切ったため、
/// 旧バージョンの config はバージョンだけ付け直し、旧キーの設定は引き継がない。
/// 戻り値の bool は書き戻しが必要かどうか。
pub fn migrate_config_version(config: Map<String, Value>) -> (Map<String, Value>, bool) {
    if config.is_empty() {
        return (config, false);
    }
    let current = get_config_version(&config);
    if current > CONFIG_SCHEMA_VERSION {
        tracing::warn!(
            "config_version {} is newer than supported {}; running in best-effort compatibility mode",
            current,
            CONFIG_SCHEMA_VERSION
        );
        return (config, false);
    }
    if current == CONFIG_SCHEMA_VERSION {
        return (config, false);
    }
    if current > 0 {
        tracing::warn!(
            "config_version {} is no longer migrated; settings stored under pre-v{} keys are ignored",
            current,
            CONFIG_SCHEMA_VERSION
        );
    }
    (set_config_version(config, CONFIG_SCHEMA_VERSION), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn as_map(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn version_detection() {
        assert_eq!(get_config_version(&Map::new()), 0);
        assert_eq!(
            get_config_version(&as_map(json!({"__global__": {"config_version": 3}}))),
            3
        );
        assert_eq!(
            get_config_version(&as_map(json!({"__global__": {"config_version": true}}))),
            0
        );
        assert_eq!(
            get_config_version(&as_map(json!({"__global__": {"config_version": -1}}))),
            0
        );
    }

    #[test]
    fn empty_config_untouched() {
        let (out, migrated) = migrate_config_version(Map::new());
        assert!(out.is_empty());
        assert!(!migrated);
    }

    #[test]
    fn old_version_is_stamped_without_converting_legacy_keys() {
        let cfg = as_map(json!({
            "__global__": {"config_version": 2, "pinned_jobs": [{"key": "k1"}]},
        }));
        let (out, migrated) = migrate_config_version(cfg);
        assert!(migrated);
        let global = out["__global__"].as_object().unwrap();
        assert_eq!(global["config_version"], json!(CONFIG_SCHEMA_VERSION));
        assert!(!global.contains_key("recent_jobs"));
    }

    #[test]
    fn newer_version_left_untouched() {
        let cfg = as_map(json!({"__global__": {"config_version": 99, "future_field": 1}}));
        let (out, migrated) = migrate_config_version(cfg.clone());
        assert!(!migrated);
        assert_eq!(out, cfg);
    }

    #[test]
    fn current_version_no_write() {
        let cfg = as_map(json!({"__global__": {"config_version": 4}}));
        let (_, migrated) = migrate_config_version(cfg);
        assert!(!migrated);
    }
}
