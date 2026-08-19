//! config.json.example が現行スキーマから乖離していないことの回帰テスト。
//!
//! example は利用者が手書き設定の雛形としてコピーするファイルだが、スキーマ
//! 変更時に更新が漏れて実装と乖離した実績がある（表示名キー・古い
//! config_version・廃止済みフィールドの残留）。スキーマ版を上げたら
//! このテストが落ちて example の更新漏れに気付けるようにする。

use serde_json::{Map, Value};

use any_console_server::config::GLOBAL_CONFIG_KEY;
use any_console_server::config_migrations::{
    get_config_version, migrate_config_version, CONFIG_SCHEMA_VERSION,
};
use any_console_server::config_schema::normalize_loaded_config;

fn load_example() -> Map<String, Value> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../config.json.example");
    let text = std::fs::read_to_string(path).expect("config.json.example should exist");
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => m,
        other => panic!("config.json.example must be a JSON object, got: {other:?}"),
    }
}

#[test]
fn example_is_at_current_schema_version() {
    let example = load_example();
    assert_eq!(
        get_config_version(&example),
        CONFIG_SCHEMA_VERSION,
        "config.json.example の config_version が CONFIG_SCHEMA_VERSION と一致しない — \
         スキーマ版を上げたら example も更新すること"
    );
}

#[test]
fn example_needs_no_migration() {
    let example = load_example();
    let (migrated, changed) = migrate_config_version(example.clone());
    assert!(
        !changed,
        "config.json.example がマイグレーションで書き換わった — 現行スキーマへ更新すること"
    );
    assert_eq!(migrated, example);
}

#[test]
fn example_entries_all_validate() {
    let example = load_example();
    let (normalized, errors) =
        normalize_loaded_config(&Value::Object(example.clone()), GLOBAL_CONFIG_KEY);
    assert!(
        errors.is_empty(),
        "config.json.example に検証エラーのエントリがある: {errors:?}"
    );
    assert_eq!(normalized.len(), example.len());
    // ワークスペースキーは現行の ID 形式（ws_ + 12hex）。表示名キーは旧形式
    for key in example.keys().filter(|k| *k != GLOBAL_CONFIG_KEY) {
        assert!(
            key.starts_with("ws_"),
            "workspace key {key:?} が ID 形式（ws_...）ではない"
        );
    }
}
