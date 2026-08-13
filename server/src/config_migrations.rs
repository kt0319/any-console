//! config.json のスキーマ・マイグレーション（Python 側 `api/config_migrations.py` の移植）。
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

/// v1 -> v2: サークルキーパッド設定の旧セクション名 radial を circle_keypad へ改名。
/// circle_keypad に既に設定がある場合はそちらを正とし、radial は破棄する。
fn migrate_radial_to_circle_keypad(mut config: Map<String, Value>) -> Map<String, Value> {
    let Some(global) = config.get(GLOBAL_CONFIG_KEY).and_then(Value::as_object) else {
        return config;
    };
    if !global.contains_key("radial") {
        return config;
    }
    let mut global = global.clone();
    let legacy = global.remove("radial").unwrap_or(Value::Null);
    let current_empty = global
        .get("circle_keypad")
        .and_then(Value::as_object)
        .is_none_or(|o| o.is_empty());
    if current_empty {
        if let Some(legacy_obj) = legacy.as_object() {
            if !legacy_obj.is_empty() {
                global.insert("circle_keypad".to_string(), legacy);
            }
        }
    }
    config.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(global));
    config
}

/// v2 -> v3: pinned_jobs を recent_jobs へ統合（pinned=true を付与）。
fn migrate_pinned_jobs_to_recent_jobs(mut config: Map<String, Value>) -> Map<String, Value> {
    let Some(global) = config.get(GLOBAL_CONFIG_KEY).and_then(Value::as_object) else {
        return config;
    };
    if !global.contains_key("pinned_jobs") {
        return config;
    }
    let mut global = global.clone();
    let legacy = global.remove("pinned_jobs").unwrap_or(Value::Null);
    let recent_jobs: Vec<Value> = legacy
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    if obj
                        .get("key")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .is_empty()
                    {
                        return None;
                    }
                    let mut merged = obj.clone();
                    merged.insert("pinned".to_string(), Value::Bool(true));
                    Some(Value::Object(merged))
                })
                .collect()
        })
        .unwrap_or_default();
    global.insert("recent_jobs".to_string(), Value::Array(recent_jobs));
    config.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(global));
    config
}

/// v3 -> v4: ジョブ定義の `detached_tab` を `detached` へ、recent_jobs の
/// `jobDetachedTab` を `jobDetached` へ改名する（セッション状態側の `detached` と
/// 用語を統一するため）。両キーが併存する場合は新キー側を正とする。
fn migrate_detached_tab_to_detached(mut config: Map<String, Value>) -> Map<String, Value> {
    fn rename_key(obj: &mut Map<String, Value>, old: &str, new: &str) {
        if let Some(v) = obj.remove(old) {
            obj.entry(new).or_insert(v);
        }
    }
    fn rename_jobs(jobs: &mut Map<String, Value>) {
        for job in jobs.values_mut() {
            if let Some(obj) = job.as_object_mut() {
                rename_key(obj, "detached_tab", "detached");
            }
        }
    }
    for (key, entry) in config.iter_mut() {
        if key == GLOBAL_CONFIG_KEY {
            continue;
        }
        if let Some(jobs) = entry
            .as_object_mut()
            .and_then(|e| e.get_mut("jobs"))
            .and_then(Value::as_object_mut)
        {
            rename_jobs(jobs);
        }
    }
    if let Some(global) = config
        .get_mut(GLOBAL_CONFIG_KEY)
        .and_then(Value::as_object_mut)
    {
        if let Some(jobs) = global.get_mut("jobs").and_then(Value::as_object_mut) {
            rename_jobs(jobs);
        }
        if let Some(items) = global.get_mut("recent_jobs").and_then(Value::as_array_mut) {
            for item in items {
                if let Some(obj) = item.as_object_mut() {
                    rename_key(obj, "jobDetachedTab", "jobDetached");
                }
            }
        }
    }
    config
}

/// config を CONFIG_SCHEMA_VERSION まで段階的にマイグレーションする。
/// 戻り値の bool はマイグレーションを行った（書き戻しが必要）かどうか。
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
    let mut migrated = config;
    let mut version = current;
    while version < CONFIG_SCHEMA_VERSION {
        migrated = match version {
            1 => migrate_radial_to_circle_keypad(migrated),
            2 => migrate_pinned_jobs_to_recent_jobs(migrated),
            3 => migrate_detached_tab_to_detached(migrated),
            _ => migrated,
        };
        version += 1;
    }
    migrated = set_config_version(migrated, CONFIG_SCHEMA_VERSION);
    tracing::info!(
        "migrated config schema v{} -> v{}",
        current,
        CONFIG_SCHEMA_VERSION
    );
    (migrated, true)
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
    fn old_config_migrates_stepwise() {
        // v0: radial + pinned_jobs の両方を持つ
        let cfg = as_map(json!({
            "__global__": {
                "radial": {"keys": [{"key": "a"}]},
                "pinned_jobs": [{"key": "k1", "jobName": "j"}, {"no_key": true}],
            }
        }));
        let (out, migrated) = migrate_config_version(cfg);
        assert!(migrated);
        let global = out["__global__"].as_object().unwrap();
        assert_eq!(global["config_version"], json!(4));
        assert!(!global.contains_key("radial"));
        assert!(!global.contains_key("pinned_jobs"));
        assert_eq!(global["circle_keypad"], json!({"keys": [{"key": "a"}]}));
        assert_eq!(
            global["recent_jobs"],
            json!([{"key": "k1", "jobName": "j", "pinned": true}])
        );
    }

    #[test]
    fn detached_tab_renamed_to_detached() {
        let cfg = as_map(json!({
            "__global__": {
                "config_version": 3,
                "jobs": {"build": {"command": "make", "detached_tab": true}},
                "recent_jobs": [
                    {"key": "k1", "jobDetachedTab": true},
                    // 新旧併存時は新キー側を正とする
                    {"key": "k2", "jobDetachedTab": true, "jobDetached": false},
                ],
            },
            "ws_a": {
                "path": "/tmp/a",
                "jobs": {
                    "dev": {"command": "npm run dev", "detached_tab": true},
                    "test": {"command": "npm test"},
                },
            },
        }));
        let (out, migrated) = migrate_config_version(cfg);
        assert!(migrated);
        let global = out["__global__"].as_object().unwrap();
        assert_eq!(global["config_version"], json!(4));
        assert_eq!(
            global["jobs"]["build"],
            json!({"command": "make", "detached": true})
        );
        assert_eq!(
            global["recent_jobs"],
            json!([
                {"key": "k1", "jobDetached": true},
                {"key": "k2", "jobDetached": false},
            ])
        );
        let ws_jobs = out["ws_a"]["jobs"].as_object().unwrap();
        assert_eq!(
            ws_jobs["dev"],
            json!({"command": "npm run dev", "detached": true})
        );
        assert_eq!(ws_jobs["test"], json!({"command": "npm test"}));
    }

    #[test]
    fn existing_circle_keypad_wins_over_radial() {
        let cfg = as_map(json!({
            "__global__": {
                "config_version": 1,
                "radial": {"keys": ["legacy"]},
                "circle_keypad": {"keys": ["current"]},
            }
        }));
        let (out, _) = migrate_config_version(cfg);
        assert_eq!(
            out["__global__"]["circle_keypad"],
            json!({"keys": ["current"]})
        );
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
