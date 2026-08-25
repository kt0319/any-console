//! config.json エントリの検証・正規化。
//!
//! かつては Python 実装（Pydantic モデル）との互換のため lax な型変換や
//! `exclude_defaults` 相当のデフォルト値省略を再現していたが、Rust 移行完了に
//! 伴い撤去した。現在の仕様:
//!
//! - 宣言フィールドは厳格に型検証する（bool は JSON の bool、int は JSON の
//!   整数のみ。文字列からの変換はしない）
//! - null 値のフィールド（宣言・extra とも）は「未設定」として落とす
//! - 未宣言（extra）フィールドはそのまま保持する
//! - グローバルセクションは検証エラーの該当箇所だけを取り除いて残りを救済する
//!
//! 旧実装がデフォルト値を省略して書いた既存の config.json は、フィールドが
//! 無いだけなのでそのまま読める（ラウンドトリップはテストで担保する）。

use serde_json::{Map, Value};

fn coerce_str(v: &Value) -> Result<String, String> {
    match v {
        Value::String(s) => Ok(s.clone()),
        _ => Err("expected string".to_string()),
    }
}

fn coerce_bool(v: &Value) -> Result<bool, String> {
    match v {
        Value::Bool(b) => Ok(*b),
        _ => Err("expected bool".to_string()),
    }
}

fn coerce_int(v: &Value) -> Result<i64, String> {
    match v {
        Value::Number(n) => n.as_i64().ok_or_else(|| "expected int".to_string()),
        _ => Err("expected int".to_string()),
    }
}

/// 宣言フィールドの仕様: (キー, 検証・正規化)。
struct FieldSpec {
    key: &'static str,
    kind: FieldKind,
}

enum FieldKind {
    Str,
    Bool,
    Int,
    StrList,
    /// dict[str, JobConfig]
    JobsDict,
    /// list[SnippetConfig]
    SnippetList,
    /// list[RecentJobConfig]
    RecentJobList,
}

fn validate_field(kind: &FieldKind, v: &Value) -> Result<Value, String> {
    match kind {
        FieldKind::Str => coerce_str(v).map(Value::String),
        FieldKind::Bool => coerce_bool(v).map(Value::Bool),
        FieldKind::Int => coerce_int(v).map(|n| Value::Number(n.into())),
        FieldKind::StrList => {
            let arr = v.as_array().ok_or("expected list")?;
            let mut out = Vec::with_capacity(arr.len());
            for item in arr {
                out.push(Value::String(coerce_str(item)?));
            }
            Ok(Value::Array(out))
        }
        FieldKind::JobsDict => {
            let obj = v.as_object().ok_or("expected object")?;
            let mut out = Map::new();
            for (name, job) in obj {
                out.insert(name.clone(), validate_job_config(job)?);
            }
            Ok(Value::Object(out))
        }
        FieldKind::SnippetList => {
            let arr = v.as_array().ok_or("expected list")?;
            arr.iter()
                .map(validate_snippet)
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        FieldKind::RecentJobList => {
            let arr = v.as_array().ok_or("expected list")?;
            arr.iter()
                .map(validate_recent_job)
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
    }
}

/// モデル共通の dump: 宣言フィールドは型検証してそのまま残し、null は落とし、
/// extra フィールドは保持する。
fn dump_model(data: &Value, specs: &[FieldSpec]) -> Result<Map<String, Value>, String> {
    let obj = data.as_object().ok_or("expected object")?;
    let mut out = Map::new();
    for (key, value) in obj {
        if value.is_null() {
            continue; // null は「未設定」として落とす
        }
        match specs.iter().find(|s| s.key == key) {
            Some(spec) => {
                let normalized =
                    validate_field(&spec.kind, value).map_err(|e| format!("{key}: {e}"))?;
                out.insert(key.clone(), normalized);
            }
            None => {
                out.insert(key.clone(), value.clone()); // extra は保持
            }
        }
    }
    Ok(out)
}

// ─── ネストモデル ────────────────────────────────────────────────────────────

fn validate_snippet(data: &Value) -> Result<Value, String> {
    let obj = data.as_object().ok_or("expected object")?;
    if !obj.contains_key("command") {
        return Err("command: field required".to_string());
    }
    let specs = [
        FieldSpec {
            key: "label",
            kind: FieldKind::Str,
        },
        FieldSpec {
            key: "command",
            kind: FieldKind::Str,
        },
    ];
    dump_model(data, &specs).map(Value::Object)
}

fn validate_recent_job(data: &Value) -> Result<Value, String> {
    let obj = data.as_object().ok_or("expected object")?;
    if !obj.contains_key("key") {
        return Err("key: field required".to_string());
    }
    let s = |k: &'static str| FieldSpec {
        key: k,
        kind: FieldKind::Str,
    };
    let b = |k: &'static str| FieldSpec {
        key: k,
        kind: FieldKind::Bool,
    };
    let specs = [
        s("key"),
        s("workspace"),
        s("wsIcon"),
        s("wsIconColor"),
        s("jobName"),
        s("jobLabel"),
        s("jobIcon"),
        s("jobIconColor"),
        s("jobCommand"),
        b("jobConfirm"),
        b("jobDetached"),
        b("pinned"),
    ];
    dump_model(data, &specs).map(Value::Object)
}

fn validate_job_config(data: &Value) -> Result<Value, String> {
    let s = |k: &'static str| FieldSpec {
        key: k,
        kind: FieldKind::Str,
    };
    let specs = [
        s("command"),
        s("label"),
        s("icon"),
        s("icon_color"),
        FieldSpec {
            key: "confirm",
            kind: FieldKind::Bool,
        },
        FieldSpec {
            key: "detached",
            kind: FieldKind::Bool,
        },
    ];
    let out = dump_model(data, &specs)?;
    // command は必須（空文字も不可）
    let get_str = |m: &Map<String, Value>, k: &str| {
        m.get(k).and_then(Value::as_str).unwrap_or("").to_string()
    };
    if get_str(&out, "command").is_empty() {
        return Err("command is required".to_string());
    }
    Ok(Value::Object(out))
}

// ─── workspace / global ─────────────────────────────────────────────────────

fn workspace_specs() -> Vec<FieldSpec> {
    let s = |k: &'static str| FieldSpec {
        key: k,
        kind: FieldKind::Str,
    };
    vec![
        s("name"),
        s("path"),
        s("icon"),
        s("icon_color"),
        FieldSpec {
            key: "hidden",
            kind: FieldKind::Bool,
        },
        FieldSpec {
            key: "jobs",
            kind: FieldKind::JobsDict,
        },
        FieldSpec {
            key: "worktree",
            kind: FieldKind::Bool,
        },
        s("worktree_base"),
        s("worktree_branch"),
    ]
}

fn global_specs() -> Vec<FieldSpec> {
    vec![
        FieldSpec {
            key: "snippets",
            kind: FieldKind::SnippetList,
        },
        FieldSpec {
            key: "recent_jobs",
            kind: FieldKind::RecentJobList,
        },
        FieldSpec {
            key: "workspace_order",
            kind: FieldKind::StrList,
        },
        FieldSpec {
            key: "jobs",
            kind: FieldKind::JobsDict,
        },
        FieldSpec {
            key: "host",
            kind: FieldKind::Str,
        },
        FieldSpec {
            key: "port",
            kind: FieldKind::Int,
        },
    ]
}

pub fn validate_workspace_config(data: &Value) -> Result<Map<String, Value>, String> {
    dump_model(data, &workspace_specs())
}

/// グローバルセクションの検証。検証エラーになった該当箇所だけを取り除く。
/// jobs は該当ジョブのみ、snippets / recent_jobs は該当インデックスのみを落とし、
/// 宣言スカラーはキーごと削除してデフォルトに委ね、extra フィールドは触らない。
pub fn validate_global_config(data: &Value) -> Result<Map<String, Value>, String> {
    let obj = data.as_object().ok_or("expected object")?;
    let specs = global_specs();
    let mut out = Map::new();
    let mut dropped: Vec<String> = Vec::new();
    for (key, value) in obj {
        if value.is_null() {
            continue;
        }
        let Some(spec) = specs.iter().find(|s| s.key == key.as_str()) else {
            out.insert(key.clone(), value.clone());
            continue;
        };
        // コレクションは要素単位で救済する
        let repaired: Option<Value> = match (&spec.kind, value) {
            (FieldKind::JobsDict, Value::Object(jobs)) => {
                let mut kept = Map::new();
                for (name, job) in jobs {
                    match validate_job_config(job) {
                        Ok(v) => {
                            kept.insert(name.clone(), v);
                        }
                        Err(_) => dropped.push(format!("jobs.{name}")),
                    }
                }
                Some(Value::Object(kept))
            }
            (FieldKind::SnippetList, Value::Array(items)) => Some(Value::Array(
                items
                    .iter()
                    .filter_map(|i| {
                        validate_snippet(i)
                            .map_err(|_| dropped.push("snippets".into()))
                            .ok()
                    })
                    .collect(),
            )),
            (FieldKind::RecentJobList, Value::Array(items)) => Some(Value::Array(
                items
                    .iter()
                    .filter_map(|i| {
                        validate_recent_job(i)
                            .map_err(|_| dropped.push("recent_jobs".into()))
                            .ok()
                    })
                    .collect(),
            )),
            _ => match validate_field(&spec.kind, value) {
                Ok(v) => Some(v),
                Err(_) => {
                    dropped.push(key.clone());
                    None // キーごと削除 → デフォルトへ
                }
            },
        };
        if let Some(v) = repaired {
            out.insert(key.clone(), v);
        }
    }
    if !dropped.is_empty() {
        tracing::warn!(
            "global config had invalid entries; dropped fields={:?} (other settings preserved)",
            dropped
        );
    }
    Ok(out)
}

pub fn validate_config_entry(
    name: &str,
    data: &Value,
    global_config_key: &str,
) -> Result<Map<String, Value>, String> {
    if name == global_config_key {
        validate_global_config(data)
    } else {
        validate_workspace_config(data)
    }
}

/// config 全体の正規化。不正なエントリは (キー, エラー) として集めて落とす。
pub fn normalize_loaded_config(
    raw: &Value,
    global_config_key: &str,
) -> (Map<String, Value>, Vec<(String, String)>) {
    if raw.is_null() {
        return (Map::new(), vec![]);
    }
    let Some(obj) = raw.as_object() else {
        return (
            Map::new(),
            vec![(
                "__root__".to_string(),
                "top-level config must be an object".to_string(),
            )],
        );
    };
    let mut normalized = Map::new();
    let mut errors = Vec::new();
    for (name, entry) in obj {
        match validate_config_entry(name, entry, global_config_key) {
            Ok(v) => {
                normalized.insert(name.clone(), Value::Object(v));
            }
            Err(e) => errors.push((name.clone(), e)),
        }
    }
    (normalized, errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn workspace_declared_fields_and_extras_are_kept() {
        let data = json!({
            "name": "proj", "path": "~/proj",
            "icon": "", "hidden": false, "jobs": {},
            "group_id": "ws_abc", "unknown_extra": 42,
        });
        let out = validate_workspace_config(&data).unwrap();
        assert_eq!(out.get("name"), Some(&json!("proj")));
        assert_eq!(
            out.get("icon"),
            Some(&json!("")),
            "宣言フィールドは常に残す"
        );
        assert_eq!(out.get("hidden"), Some(&json!(false)));
        assert_eq!(out.get("jobs"), Some(&json!({})));
        assert_eq!(out.get("group_id"), Some(&json!("ws_abc")), "extra は保持");
        assert_eq!(out.get("unknown_extra"), Some(&json!(42)));
    }

    #[test]
    fn null_fields_are_dropped() {
        let data = json!({"name": "p", "group_id": null});
        let out = validate_workspace_config(&data).unwrap();
        assert!(!out.contains_key("group_id"));
    }

    /// 型検証は厳格（JSON ネイティブ型のみ）。旧 Pydantic 互換の lax coercion
    /// （"yes" → true、"9000.0" → 9000 等）は受け付けない。
    #[test]
    fn bool_and_int_require_native_json_types() {
        assert_eq!(coerce_bool(&json!(true)), Ok(true));
        assert_eq!(coerce_bool(&json!(false)), Ok(false));
        for v in [json!("true"), json!("yes"), json!("1"), json!(1), json!(0)] {
            assert!(coerce_bool(&v).is_err(), "{v}");
        }
        assert_eq!(coerce_int(&json!(9000)), Ok(9000));
        assert_eq!(coerce_int(&json!(-1)), Ok(-1));
        for v in [json!("9000"), json!("9000.0"), json!(9000.5), json!(true)] {
            assert!(coerce_int(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn job_requires_command() {
        assert!(validate_job_config(&json!({"command": "npm test"})).is_ok());
        assert!(validate_job_config(&json!({"label": "no command"})).is_err());
        // confirm は明示されていれば true/false どちらもそのまま残る
        let out = validate_job_config(&json!({"command": "x", "confirm": true})).unwrap();
        assert_eq!(out["confirm"], json!(true));
        let out = validate_job_config(&json!({"command": "x", "confirm": false})).unwrap();
        assert_eq!(out["confirm"], json!(false));
    }

    #[test]
    fn global_repair_drops_only_broken_parts() {
        let data = json!({
            "port": "9000",
            "jobs": {"good": {"command": "ls"}, "bad": {"label": "x"}},
            "snippets": [{"command": "ok"}, {"label": "no-command"}],
            "circle_keypad": {"keys": []},
        });
        let out = validate_global_config(&data).unwrap();
        assert!(
            !out.contains_key("port"),
            "文字列 port は不正としてキーごと削除"
        );
        assert!(out["jobs"].as_object().unwrap().contains_key("good"));
        assert!(!out["jobs"].as_object().unwrap().contains_key("bad"));
        assert_eq!(out["snippets"].as_array().unwrap().len(), 1);
        assert!(
            out.contains_key("circle_keypad"),
            "extra は巻き添えにしない"
        );
    }

    #[test]
    fn normalize_collects_entry_errors() {
        let raw = json!({
            "__global__": {"port": 8888},
            "ws_ok": {"name": "a", "path": "/tmp"},
            "ws_bad": "not-an-object",
        });
        let (normalized, errors) = normalize_loaded_config(&raw, "__global__");
        assert!(normalized.contains_key("ws_ok"));
        assert!(!normalized.contains_key("ws_bad"));
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, "ws_bad");
        assert_eq!(normalized["__global__"]["port"], json!(8888));
    }

    #[test]
    fn existing_normalized_config_roundtrips_unchanged() {
        // 旧実装（デフォルト値省略済み）が書いた実形を入れても変化しないこと
        let raw = json!({
            "__global__": {
                "config_version": 3,
                "workspace_order": ["ws_a"],
                "snippets": [{"label": "l", "command": "c"}],
                "groups": [{"id": "ws_g1", "name": "G"}],
                "info_pills": {"branch": false, "order": ["files"]},
            },
            "ws_a": {"name": "a", "path": "~/a", "group_id": "ws_g1"},
        });
        let (normalized, errors) = normalize_loaded_config(&raw, "__global__");
        assert!(errors.is_empty());
        assert_eq!(Value::Object(normalized), raw);
    }
}
