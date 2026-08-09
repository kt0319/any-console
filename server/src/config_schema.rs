//! config.json エントリの検証・正規化（Python 側 `api/config_schema.py` の移植）。
//!
//! Pydantic モデル（extra="allow" + `model_dump(exclude_defaults=True,
//! exclude_none=True)`）と同じ振る舞いを再現する:
//!
//! - 宣言フィールドは型検証し、**デフォルト値と等しいものは出力から落とす**
//! - null 値のフィールド（宣言・extra とも）は落とす
//! - 未宣言（extra）フィールドはそのまま保持する
//! - グローバルセクションは検証エラーの該当箇所だけを取り除いて残りを救済する
//!
//! 移行期間中は Python と Rust の両プロセスが同じ config.json を正規化して
//! 書き戻すため、この正規化結果が Python と一致しないと相互に書き換え合いが
//! 発生する。ラウンドトリップ互換はテストで担保する。

use serde_json::{Map, Value};

/// Pydantic の lax な型変換のうち、実データで起こりうる範囲を再現する。
fn coerce_str(v: &Value) -> Result<String, String> {
    match v {
        Value::String(s) => Ok(s.clone()),
        _ => Err("expected string".to_string()),
    }
}

/// Pydantic v2 の bool lax coercion（大文字小文字を区別しない）が受け付ける文字列。
/// https://docs.pydantic.dev/latest/concepts/conversion_table/ の bool 列を参照。
const BOOL_TRUE_STRS: &[&str] = &["true", "yes", "on", "y", "t", "1"];
const BOOL_FALSE_STRS: &[&str] = &["false", "no", "off", "n", "f", "0"];

fn coerce_bool(v: &Value) -> Result<bool, String> {
    match v {
        Value::Bool(b) => Ok(*b),
        // int/float の 0/1 のみ有効（pydantic は 2 や 0.5 等は拒否する）。
        Value::Number(n) => match n.as_f64() {
            Some(0.0) => Ok(false),
            Some(1.0) => Ok(true),
            _ => Err("expected bool".to_string()),
        },
        Value::String(s) => {
            let lower = s.to_ascii_lowercase();
            if BOOL_TRUE_STRS.contains(&lower.as_str()) {
                Ok(true)
            } else if BOOL_FALSE_STRS.contains(&lower.as_str()) {
                Ok(false)
            } else {
                Err("expected bool".to_string())
            }
        }
        _ => Err("expected bool".to_string()),
    }
}

fn coerce_int(v: &Value) -> Result<i64, String> {
    match v {
        Value::Bool(_) => Err("expected int".to_string()),
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64))
            .ok_or_else(|| "expected int".to_string()),
        Value::String(s) => {
            let t = s.trim();
            // pydantic は "9000" だけでなく小数部が 0 の "9000.0" のような文字列も
            // 整数として受け付ける（例: __global__.port を文字列で設定した場合）。
            t.parse::<i64>().or_else(|_| {
                t.parse::<f64>()
                    .ok()
                    .filter(|f| f.fract() == 0.0)
                    .map(|f| f as i64)
                    .ok_or_else(|| "expected int".to_string())
            })
        }
        _ => Err("expected int".to_string()),
    }
}

/// 宣言フィールドの仕様: (キー, 検証・正規化, デフォルト値)。
struct FieldSpec {
    key: &'static str,
    default: Value,
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

/// モデル共通の dump: 宣言フィールドは検証してデフォルトと違うときだけ残し、
/// null は落とし、extra フィールドは保持する。
fn dump_model(data: &Value, specs: &[FieldSpec]) -> Result<Map<String, Value>, String> {
    let obj = data.as_object().ok_or("expected object")?;
    let mut out = Map::new();
    for (key, value) in obj {
        if value.is_null() {
            continue; // exclude_none
        }
        match specs.iter().find(|s| s.key == key) {
            Some(spec) => {
                let normalized =
                    validate_field(&spec.kind, value).map_err(|e| format!("{key}: {e}"))?;
                if normalized != spec.default {
                    out.insert(key.clone(), normalized);
                }
            }
            None => {
                out.insert(key.clone(), value.clone()); // extra="allow"
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
            default: Value::String(String::new()),
            kind: FieldKind::Str,
        },
        // required フィールドはデフォルト無し（常に出力に残す）ため default に到達不能値を置く
        FieldSpec {
            key: "command",
            default: Value::Null,
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
        default: Value::String(String::new()),
        kind: FieldKind::Str,
    };
    let b = |k: &'static str| FieldSpec {
        key: k,
        default: Value::Bool(false),
        kind: FieldKind::Bool,
    };
    let specs = [
        FieldSpec {
            key: "key",
            default: Value::Null,
            kind: FieldKind::Str,
        },
        s("workspace"),
        s("wsIcon"),
        s("wsIconColor"),
        s("jobName"),
        s("jobLabel"),
        s("jobIcon"),
        s("jobIconColor"),
        s("jobCommand"),
        s("jobUrl"),
        FieldSpec {
            key: "jobType",
            default: Value::String("command".into()),
            kind: FieldKind::Str,
        },
        // jobConfirm: bool | None = None — null は exclude_none で落ち、bool は常に残す
        FieldSpec {
            key: "jobConfirm",
            default: Value::Null,
            kind: FieldKind::Bool,
        },
        b("jobDetachedTab"),
        b("pinned"),
    ];
    dump_model(data, &specs).map(Value::Object)
}

fn validate_job_config(data: &Value) -> Result<Value, String> {
    let s = |k: &'static str| FieldSpec {
        key: k,
        default: Value::String(String::new()),
        kind: FieldKind::Str,
    };
    let specs = [
        s("command"),
        s("url"),
        FieldSpec {
            key: "type",
            default: Value::String("command".into()),
            kind: FieldKind::Str,
        },
        s("label"),
        s("icon"),
        s("icon_color"),
        FieldSpec {
            key: "confirm",
            default: Value::Bool(true),
            kind: FieldKind::Bool,
        },
        FieldSpec {
            key: "detached_tab",
            default: Value::Bool(false),
            kind: FieldKind::Bool,
        },
    ];
    let out = dump_model(data, &specs)?;
    // Python JobConfig の model_validator: browser 型は url 必須、それ以外は command 必須
    let get_str = |m: &Map<String, Value>, k: &str| {
        m.get(k).and_then(Value::as_str).unwrap_or("").to_string()
    };
    let job_type = if out.contains_key("type") {
        get_str(&out, "type")
    } else {
        "command".to_string()
    };
    if job_type == "browser" {
        if get_str(&out, "url").is_empty() {
            return Err("url is required for browser type".to_string());
        }
    } else if get_str(&out, "command").is_empty() {
        return Err("command is required".to_string());
    }
    Ok(Value::Object(out))
}

// ─── workspace / global ─────────────────────────────────────────────────────

fn workspace_specs() -> Vec<FieldSpec> {
    let s = |k: &'static str| FieldSpec {
        key: k,
        default: Value::String(String::new()),
        kind: FieldKind::Str,
    };
    vec![
        s("name"),
        s("path"),
        s("icon"),
        s("icon_color"),
        FieldSpec {
            key: "hidden",
            default: Value::Bool(false),
            kind: FieldKind::Bool,
        },
        FieldSpec {
            key: "jobs",
            default: Value::Object(Map::new()),
            kind: FieldKind::JobsDict,
        },
        FieldSpec {
            key: "worktree",
            default: Value::Bool(false),
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
            default: Value::Array(vec![]),
            kind: FieldKind::SnippetList,
        },
        FieldSpec {
            key: "recent_jobs",
            default: Value::Array(vec![]),
            kind: FieldKind::RecentJobList,
        },
        FieldSpec {
            key: "workspace_order",
            default: Value::Array(vec![]),
            kind: FieldKind::StrList,
        },
        FieldSpec {
            key: "jobs",
            default: Value::Object(Map::new()),
            kind: FieldKind::JobsDict,
        },
        FieldSpec {
            key: "host",
            default: Value::String(String::new()),
            kind: FieldKind::Str,
        },
        FieldSpec {
            key: "port",
            default: Value::Number(0.into()),
            kind: FieldKind::Int,
        },
        FieldSpec {
            key: "trust_tailscale_auth",
            default: Value::Bool(false),
            kind: FieldKind::Bool,
        },
    ]
}

pub fn validate_workspace_config(data: &Value) -> Result<Map<String, Value>, String> {
    dump_model(data, &workspace_specs())
}

/// グローバルセクションの検証。検証エラーになった該当箇所だけを取り除く
/// （Python `validate_global_config` の repair 挙動と等価）。
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
            if v != spec.default {
                out.insert(key.clone(), v);
            }
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

/// config 全体の正規化。不正なエントリは (キー, エラー) として集めて落とす
/// （Python `normalize_loaded_config` と等価）。
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
    fn workspace_defaults_are_dropped_and_extras_kept() {
        let data = json!({
            "name": "proj", "path": "~/proj",
            "icon": "", "hidden": false, "jobs": {},
            "group_id": "ws_abc", "unknown_extra": 42,
        });
        let out = validate_workspace_config(&data).unwrap();
        assert_eq!(out.get("name"), Some(&json!("proj")));
        assert!(!out.contains_key("icon"), "デフォルト値は落ちる");
        assert!(!out.contains_key("hidden"));
        assert!(!out.contains_key("jobs"));
        assert_eq!(out.get("group_id"), Some(&json!("ws_abc")), "extra は保持");
        assert_eq!(out.get("unknown_extra"), Some(&json!(42)));
    }

    #[test]
    fn null_fields_are_dropped() {
        let data = json!({"name": "p", "group_id": null});
        let out = validate_workspace_config(&data).unwrap();
        assert!(!out.contains_key("group_id"));
    }

    /// Pydantic v2 lax bool coercion のスペリング一致（Codex レビュー指摘: "yes"/
    /// "on"/"y"/"t" 等を拒否すると workspace フィールドが丸ごと落ちる／global 設定が
    /// リセットされてしまう）。
    #[test]
    fn coerce_bool_matches_pydantic_lax_spellings() {
        for s in [
            "true", "True", "TRUE", "yes", "Yes", "YES", "on", "On", "ON", "y", "Y", "t", "T", "1",
        ] {
            assert_eq!(coerce_bool(&json!(s)), Ok(true), "{s}");
        }
        for s in [
            "false", "False", "FALSE", "no", "No", "NO", "off", "Off", "OFF", "n", "N", "f", "F",
            "0",
        ] {
            assert_eq!(coerce_bool(&json!(s)), Ok(false), "{s}");
        }
        assert!(coerce_bool(&json!("2")).is_err());
        assert!(coerce_bool(&json!(" true ")).is_err());
        assert!(coerce_bool(&json!("")).is_err());
        assert_eq!(coerce_bool(&json!(0)), Ok(false));
        assert_eq!(coerce_bool(&json!(1)), Ok(true));
        assert_eq!(coerce_bool(&json!(0.0)), Ok(false));
        assert_eq!(coerce_bool(&json!(1.0)), Ok(true));
        assert!(coerce_bool(&json!(2)).is_err());
        assert!(coerce_bool(&json!(0.5)).is_err());
    }

    /// "9000.0" のような小数部ゼロの文字列も int として受け付ける（Codex レビュー
    /// 指摘: 拒否すると __global__.port がキーごと落ちてデフォルトポートに化ける）。
    #[test]
    fn coerce_int_accepts_pydantic_lax_numeric_strings() {
        assert_eq!(coerce_int(&json!("9000")), Ok(9000));
        assert_eq!(coerce_int(&json!("9000.0")), Ok(9000));
        assert_eq!(coerce_int(&json!(" 9000 ")), Ok(9000));
        assert_eq!(coerce_int(&json!("-1")), Ok(-1));
        assert!(coerce_int(&json!("9000.5")).is_err());
        assert!(coerce_int(&json!("not-a-number")).is_err());
    }

    #[test]
    fn job_requires_command_or_url() {
        assert!(validate_job_config(&json!({"command": "npm test"})).is_ok());
        assert!(validate_job_config(&json!({"type": "browser", "url": "http://x"})).is_ok());
        assert!(validate_job_config(&json!({"type": "browser"})).is_err());
        assert!(validate_job_config(&json!({"label": "no command"})).is_err());
        // confirm: true はデフォルトなので落ちる
        let out = validate_job_config(&json!({"command": "x", "confirm": true})).unwrap();
        assert!(!out.as_object().unwrap().contains_key("confirm"));
        let out = validate_job_config(&json!({"command": "x", "confirm": false})).unwrap();
        assert_eq!(out["confirm"], json!(false));
    }

    #[test]
    fn global_repair_drops_only_broken_parts() {
        let data = json!({
            "port": "not-a-number",
            "jobs": {"good": {"command": "ls"}, "bad": {"label": "x"}},
            "snippets": [{"command": "ok"}, {"label": "no-command"}],
            "circle_keypad": {"keys": []},
        });
        let out = validate_global_config(&data).unwrap();
        assert!(!out.contains_key("port"), "不正スカラーはキーごと削除");
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
    fn python_normalized_config_roundtrips_unchanged() {
        // Python が正規化済みの実形（デフォルト除去済み）を入れても変化しないこと
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
