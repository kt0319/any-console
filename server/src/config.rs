//! config.json の読み書きエンジン（Python 側 `api/config.py` の移植）。
//!
//! `config.lock` への fcntl flock（読み取り SH / 書き込み EX）で read-modify-write
//! を直列化する（旧 Python 実装と同じロックファイルに参加する方式を維持 —
//! CLI 等の別プロセスが同じ規約で参加すれば lost update を防げる）。
//!
//! 読み書きの挙動は Python と同一:
//! - 読み込み: 壊れていれば .bak から復旧、正規化、バージョンマイグレーション。
//!   復旧・マイグレーションが起きた場合はその場で書き戻す
//! - 書き込み: 正規化（エラーがあれば拒否）→ .bak ローテーション → tmp+rename

use std::io::Write;
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::config_migrations::{get_config_version, migrate_config_version, CONFIG_SCHEMA_VERSION};
use crate::config_schema::{normalize_loaded_config, validate_config_entry};
use crate::errors::{server_error, ApiError};

pub const GLOBAL_CONFIG_KEY: &str = "__global__";
pub const DEFAULT_BIND_HOST: &str = "0.0.0.0";
pub const DEFAULT_BIND_PORT: u16 = 8888;

/// workspace / group 共通の永続IDプレフィックス（保存済み config 互換のため変更しない）。
pub const ENTITY_ID_PREFIX: &str = "ws_";

pub fn generate_entity_id() -> String {
    format!("{ENTITY_ID_PREFIX}{}", crate::util::token_hex(6))
}

#[derive(Debug, Clone)]
pub struct ConfigStore {
    pub config_file: PathBuf,
}

/// flock を保持したままにするためのガード（drop で unlock）。
struct FileLock(#[allow(dead_code)] std::fs::File);

impl ConfigStore {
    pub fn new(config_file: PathBuf) -> Self {
        Self { config_file }
    }

    /// Python `_file_lock` と同じ `config.lock` を flock する。
    fn file_lock(&self, exclusive: bool) -> Option<FileLock> {
        let lock_path = self.config_file.with_extension("lock");
        if let Some(parent) = lock_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&lock_path)
            .ok()?;
        let ok = if exclusive {
            file.lock().is_ok()
        } else {
            file.lock_shared().is_ok()
        };
        ok.then_some(FileLock(file))
    }

    fn try_restore_from_bak(&self) -> Option<Map<String, Value>> {
        let bak = self.config_file.with_extension("bak");
        let text = std::fs::read_to_string(&bak)
            .map_err(|_| {
                tracing::error!("config.json is broken and no .bak exists; starting empty")
            })
            .ok()?;
        match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(m)) => {
                tracing::warn!("Restored config from {}", bak.display());
                Some(m)
            }
            _ => {
                tracing::error!("config.bak is also unreadable; starting empty");
                None
            }
        }
    }

    /// Python `_read_config_unlocked` と同一の復旧・正規化・マイグレーション。
    /// ロックの取得・書き戻しは呼び出し側の責務（`load_all`/`with_exclusive` 等）。
    /// 戻り値の bool は「.bak からの復旧・バージョンマイグレーションが起きたため
    /// 書き戻しが必要」を示す。
    fn read_core(&self) -> (Map<String, Value>, bool) {
        let mut restore_needed = false;
        let raw: Map<String, Value> = if self.config_file.is_file() {
            match std::fs::read_to_string(&self.config_file) {
                Ok(text) => match serde_json::from_str::<Value>(&text) {
                    Ok(v) => match v {
                        Value::Object(m) => m,
                        _ => Map::new(),
                    },
                    Err(e) => {
                        tracing::error!("config.json is invalid JSON: {e}");
                        match self.try_restore_from_bak() {
                            Some(m) => {
                                restore_needed = true;
                                m
                            }
                            None => return (Map::new(), false),
                        }
                    }
                },
                Err(e) => {
                    tracing::warn!(
                        "config read failed path={}: {e}",
                        self.config_file.display()
                    );
                    return (Map::new(), false);
                }
            }
        } else {
            Map::new()
        };

        let (normalized, errors) = normalize_loaded_config(&Value::Object(raw), GLOBAL_CONFIG_KEY);
        for (name, error) in errors {
            tracing::warn!("config validation failed key={name}: {error}");
        }
        let (migrated, did_migrate) = migrate_config_version(normalized);
        (migrated, restore_needed || did_migrate)
    }

    /// 現在保持しているロック下で読み込む（書き戻しは行わない）。既に排他ロックを
    /// 取得済みの呼び出し元（`save_all`/`with_exclusive` 等）はこちらを使う —
    /// どのみち直後に `write_unlocked` するため、復旧/マイグレーションの書き戻しは
    /// その1回に含まれる。
    fn read_unlocked(&self) -> Map<String, Value> {
        self.read_core().0
    }

    /// Python `_write_config_unlocked` と同一: 正規化（エラーは拒否）→ .bak
    /// ローテーション → tmp 書き込み → rename。末尾改行付き・2スペースインデント。
    fn write_unlocked(&self, config: &Map<String, Value>) -> Result<(), String> {
        let (normalized, errors) =
            normalize_loaded_config(&Value::Object(config.clone()), GLOBAL_CONFIG_KEY);
        if let Some((name, error)) = errors.first() {
            return Err(format!("Invalid config entry '{name}': {error}"));
        }
        let parent = self
            .config_file
            .parent()
            .ok_or_else(|| "config path has no parent".to_string())?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let bak = self.config_file.with_extension("bak");
        if self.config_file.exists() {
            std::fs::rename(&self.config_file, &bak).map_err(|e| e.to_string())?;
        }
        let tmp = self.config_file.with_extension("tmp");
        let text =
            serde_json::to_string_pretty(&Value::Object(normalized)).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        f.write_all(b"\n").map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&tmp, &self.config_file).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_all(&self) -> Map<String, Value> {
        let (config, needs_writeback) = {
            let _lock = self.file_lock(false);
            self.read_core()
        };
        if !needs_writeback {
            return config;
        }
        // .bak からの復旧・バージョンマイグレーションの書き戻しは config.bak/config.tmp
        // を触るため、共有ロックのままでは他の読み手の書き戻しと競合しうる。
        // 排他ロックへ昇格し、その下で読み直してから書く（他プロセスが既に
        // 書き戻し済みなら再度の書き戻しは不要）。ロック自体が取得できない
        // 場合（lock ファイルの権限問題・ENOLCK 等）は書き戻しを諦めて読み込み
        // 結果のみ返す（Read パスなので致命的にはしない — 書き込み系は
        // `with_exclusive`/`save_all` 側でロック失敗を伝播させる）。
        let Some(_lock) = self.file_lock(true) else {
            tracing::warn!(
                "config.lock の排他ロックが取得できず、復旧/マイグレーションの書き戻しを見送ります"
            );
            return config;
        };
        let (config, needs_writeback) = self.read_core();
        if needs_writeback {
            if let Err(e) = self.write_unlocked(&config) {
                tracing::warn!("config write-back after restore/migration failed: {e}");
            }
        }
        config
    }

    pub fn save_all(&self, config: &Map<String, Value>) -> Result<(), String> {
        let _lock = self
            .file_lock(true)
            .ok_or_else(|| "Failed to acquire config.lock".to_string())?;
        self.write_unlocked(config)
    }

    /// 排他ロックを1回だけ取得し、その中で読み込み→変更→書き込みを行う
    /// （read-modify-write を1トランザクションにまとめ、concurrent writer 間の
    /// lost update を防ぐ）。`mutate` が `Err` を返した場合は書き込みを行わない。
    ///
    /// ロック自体が取得できない場合（lock ファイルの権限問題・ENOLCK な
    /// ファイルシステム等）は、ロック無しで read-modify-write を進めてしまうと
    /// 同時書き込みが素通しになり得るため、書き込まずにエラーを返す
    /// （Codex レビュー指摘）。
    pub fn with_exclusive<T>(
        &self,
        mutate: impl FnOnce(&mut Map<String, Value>) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let _lock = self
            .file_lock(true)
            .ok_or_else(|| server_error("Failed to acquire config lock"))?;
        let mut config = self.read_unlocked();
        let result = mutate(&mut config)?;
        self.write_unlocked(&config).map_err(server_error)?;
        Ok(result)
    }

    /// `__global__.<key>` へ値をマージする（`__global__` の他フィールドは保持する）。
    /// 純粋な in-memory 操作 — ロック・読み込み・書き込みは呼び出し側
    /// （`with_exclusive` 等）が担う。
    pub fn merge_global_section(config: &mut Map<String, Value>, key: &str, value: Value) {
        let mut global = config
            .get(GLOBAL_CONFIG_KEY)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        global.insert(key.to_string(), value);
        config.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(global));
    }

    /// `__global__` を除外した workspace エントリのみを返す。
    pub fn list_workspace_entries(&self) -> Map<String, Value> {
        self.load_all()
            .into_iter()
            .filter(|(k, v)| k != GLOBAL_CONFIG_KEY && v.is_object())
            .collect()
    }

    /// ID または表示名（name フィールド）から workspace のキー（ID）を解決する。
    pub fn find_workspace_key(config: &Map<String, Value>, identifier: &str) -> Option<String> {
        if identifier == GLOBAL_CONFIG_KEY {
            return None;
        }
        if config.get(identifier).is_some_and(Value::is_object) {
            return Some(identifier.to_string());
        }
        for (key, entry) in config {
            if key == GLOBAL_CONFIG_KEY || !entry.is_object() {
                continue;
            }
            if entry.get("name").and_then(Value::as_str) == Some(identifier) {
                return Some(key.clone());
            }
        }
        None
    }

    /// workspace のエントリ dict を返す（見つからなければ空 — Python
    /// `load_workspace_config` 相当）。
    pub fn load_workspace_config(&self, identifier: &str) -> Map<String, Value> {
        let cfg = self.load_all();
        Self::find_workspace_key(&cfg, identifier)
            .and_then(|key| cfg.get(&key).and_then(Value::as_object).cloned())
            .unwrap_or_default()
    }

    /// Python `save_workspace_config` と同一: EX ロック下で read-modify-write。
    /// 渡された config に name が無ければ既存エントリの name を引き継ぐ。
    pub fn save_workspace_config(
        &self,
        identifier: &str,
        config: Map<String, Value>,
    ) -> Result<(), String> {
        let _lock = self
            .file_lock(true)
            .ok_or_else(|| "Failed to acquire config.lock".to_string())?;
        let mut all = self.read_unlocked();
        let key =
            Self::find_workspace_key(&all, identifier).unwrap_or_else(|| identifier.to_string());
        let mut merged = config;
        if !merged.contains_key("name") {
            let existing_name = all
                .get(&key)
                .and_then(Value::as_object)
                .and_then(|e| e.get("name"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            if let Some(name) = existing_name {
                merged.insert("name".to_string(), Value::String(name.to_string()));
            }
        }
        let validated = validate_config_entry(&key, &Value::Object(merged), GLOBAL_CONFIG_KEY)?;
        all.insert(key, Value::Object(validated));
        self.write_unlocked(&all)
    }

    /// Python `delete_workspace_config` と同一: エントリを削除し、
    /// `__global__.workspace_order` からも取り除く。存在しなければ何もしない。
    pub fn delete_workspace_config(&self, identifier: &str) -> Result<(), String> {
        let _lock = self
            .file_lock(true)
            .ok_or_else(|| "Failed to acquire config.lock".to_string())?;
        let mut all = self.read_unlocked();
        let Some(key) = Self::find_workspace_key(&all, identifier) else {
            return Ok(());
        };
        all.remove(&key);
        let mut global = all
            .get(GLOBAL_CONFIG_KEY)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let order = global
            .get("workspace_order")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if order.iter().any(|v| v.as_str() == Some(key.as_str())) {
            let filtered: Vec<Value> = order
                .into_iter()
                .filter(|v| v.as_str() != Some(key.as_str()))
                .collect();
            global.insert("workspace_order".to_string(), Value::Array(filtered));
            all.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(global));
        }
        self.write_unlocked(&all)
    }

    /// パスを登録済みワークスペースのパスと前方一致させ、最長一致の表示名を返す
    /// （Python `match_workspace_by_path` 相当）。`path` は展開済みの絶対パス
    /// （tmux/lsof 等の出力）を渡すこと — config 側の `~/...` は expand してから比較する。
    pub fn match_workspace_by_path(&self, path: &str) -> Option<String> {
        if path.is_empty() {
            return None;
        }
        let mut best_name: Option<String> = None;
        let mut best_len: i64 = -1;
        for (key, entry) in self.list_workspace_entries() {
            let raw_path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            if raw_path.is_empty() {
                continue;
            }
            let ws_path = crate::paths::expand_user_path(raw_path);
            let ws_path_str = ws_path.to_string_lossy();
            let ws_path_str = ws_path_str.trim_end_matches('/');
            if ws_path_str.is_empty() {
                continue;
            }
            let matches = path == ws_path_str || path.starts_with(&format!("{ws_path_str}/"));
            if matches && ws_path_str.len() as i64 > best_len {
                best_len = ws_path_str.len() as i64;
                best_name = Some(
                    entry
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .unwrap_or(key),
                );
            }
        }
        best_name
    }

    pub fn resolve_workspace_id(&self, identifier: &str) -> Option<String> {
        if identifier.is_empty() {
            return None;
        }
        let cfg = self.load_all();
        Self::find_workspace_key(&cfg, identifier)
    }

    pub fn load_global_section(&self, key: &str) -> Option<Value> {
        self.load_all()
            .get(GLOBAL_CONFIG_KEY)?
            .as_object()?
            .get(key)
            .cloned()
    }

    /// Python `save_global_config_section` と同一（EX ロック下で read-modify-write）。
    pub fn save_global_section(&self, key: &str, data: Value) -> Result<(), String> {
        let _lock = self
            .file_lock(true)
            .ok_or_else(|| "Failed to acquire config.lock".to_string())?;
        let mut all = self.read_unlocked();
        let mut global = all
            .get(GLOBAL_CONFIG_KEY)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        global.insert(key.to_string(), data);
        let validated =
            validate_config_entry(GLOBAL_CONFIG_KEY, &Value::Object(global), GLOBAL_CONFIG_KEY)?;
        all.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(validated));
        self.write_unlocked(&all)
    }

    /// expected_current を前提に算出した new_value を、排他ロック下で再検証してから
    /// 書き戻す（Python `compare_and_update_global_config_section` 相当）。
    /// ロック取得後の現在値が expected と一致しなければ new_value を破棄して
    /// その時点の現在値を返す（lost update 防止）。
    pub fn compare_and_update_global_section(
        &self,
        key: &str,
        expected_current: &Value,
        new_value: Value,
    ) -> Result<Value, String> {
        let _lock = self
            .file_lock(true)
            .ok_or_else(|| "Failed to acquire config.lock".to_string())?;
        let mut all = self.read_unlocked();
        let mut global = all
            .get(GLOBAL_CONFIG_KEY)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let current = global
            .get(key)
            .cloned()
            .unwrap_or(Value::Object(Map::new()));
        if &current != expected_current {
            return Ok(current);
        }
        if new_value != current {
            global.insert(key.to_string(), new_value.clone());
            let validated = validate_config_entry(
                GLOBAL_CONFIG_KEY,
                &Value::Object(global),
                GLOBAL_CONFIG_KEY,
            )?;
            all.insert(GLOBAL_CONFIG_KEY.to_string(), Value::Object(validated));
            self.write_unlocked(&all)?;
        }
        Ok(new_value)
    }

    /// Python `check_config_health` と同一の判定。
    pub fn check_health(&self) -> Value {
        let _lock = self.file_lock(false);
        let bak = self.config_file.with_extension("bak");

        if !self.config_file.is_file() {
            return serde_json::json!({"ok": true, "errors": [], "source": "empty"});
        }
        let parse = |path: &PathBuf| -> Result<Value, String> {
            let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())
        };
        let (raw, source) = match parse(&self.config_file) {
            Ok(v) => (v, "config.json"),
            Err(json_err) => {
                if bak.is_file() {
                    match parse(&bak) {
                        Ok(v) => (v, "config.bak"),
                        Err(_) => {
                            let msg = format!(
                                "config.json is invalid JSON and backup is also broken: {json_err}"
                            );
                            return serde_json::json!({
                                "ok": false,
                                "errors": [{"key": "__root__", "message": msg}],
                                "source": "broken",
                            });
                        }
                    }
                } else {
                    return serde_json::json!({
                        "ok": false,
                        "errors": [{"key": "__root__", "message": format!("config.json is invalid JSON: {json_err}")}],
                        "source": "broken",
                    });
                }
            }
        };

        let (_, errors) = normalize_loaded_config(&raw, GLOBAL_CONFIG_KEY);
        let mut error_list: Vec<Value> = errors
            .into_iter()
            .map(|(key, message)| serde_json::json!({"key": key, "message": message}))
            .collect();

        let config_version = raw.as_object().map(get_config_version).unwrap_or(0);
        if config_version > CONFIG_SCHEMA_VERSION {
            error_list.push(serde_json::json!({
                "key": "__version__",
                "message": format!(
                    "config_version {config_version} is newer than this app supports ({CONFIG_SCHEMA_VERSION}). Update the app to avoid losing settings."
                ),
            }));
        }

        serde_json::json!({
            "ok": source == "config.json" && error_list.is_empty(),
            "errors": error_list,
            "source": source,
            "config_version": config_version,
            "supported_config_version": CONFIG_SCHEMA_VERSION,
        })
    }

    // ─── 起動時ヘルパー（Phase 0 から継続）──────────────────────────────────

    /// `__global__.host` / `__global__.port`（未設定はデフォルト）。
    pub fn resolve_bind(&self) -> (String, u16) {
        let host = match self.load_global_section("host") {
            Some(Value::String(s)) if !s.is_empty() => s,
            _ => DEFAULT_BIND_HOST.to_string(),
        };
        let port = match self.load_global_section("port") {
            Some(Value::Number(n)) => n
                .as_u64()
                .filter(|&p| p > 0 && p <= u16::MAX as u64)
                .map(|p| p as u16)
                .unwrap_or(DEFAULT_BIND_PORT),
            Some(Value::String(s)) => s
                .parse::<u16>()
                .ok()
                .filter(|&p| p > 0)
                .unwrap_or(DEFAULT_BIND_PORT),
            _ => DEFAULT_BIND_PORT,
        };
        (host, port)
    }

    /// 認証無効化フラグ（環境変数が優先）。
    #[allow(dead_code)]
    pub fn auth_disabled(&self) -> bool {
        if std::env::var("ANY_CONSOLE_DISABLE_AUTH")
            .map(|v| v.trim() == "1")
            .unwrap_or(false)
        {
            return true;
        }
        matches!(
            self.load_global_section("auth_disabled"),
            Some(Value::Bool(true))
        )
    }

    /// Tailscale ヘッダ信頼の opt-in（環境変数が優先）。
    pub fn trust_tailscale_auth(&self) -> bool {
        if std::env::var("ANY_CONSOLE_TRUST_TAILSCALE_AUTH")
            .map(|v| v.trim() == "1")
            .unwrap_or(false)
        {
            return true;
        }
        matches!(
            self.load_global_section("trust_tailscale_auth"),
            Some(Value::Bool(true))
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store(dir: &tempfile::TempDir) -> ConfigStore {
        ConfigStore::new(dir.path().join("config.json"))
    }

    fn write_file(dir: &tempfile::TempDir, name: &str, content: &str) {
        std::fs::write(dir.path().join(name), content).unwrap();
    }

    #[test]
    fn missing_config_uses_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        assert_eq!(
            s.resolve_bind(),
            (DEFAULT_BIND_HOST.to_string(), DEFAULT_BIND_PORT)
        );
        assert!(s.load_all().is_empty());
    }

    #[test]
    fn reads_global_bind() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir,
            "config.json",
            r#"{"__global__": {"host": "127.0.0.1", "port": 9000, "config_version": 3}}"#,
        );
        assert_eq!(store(&dir).resolve_bind(), ("127.0.0.1".to_string(), 9000));
    }

    #[test]
    fn broken_config_falls_back_to_bak_and_restores() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir,
            "config.bak",
            r#"{"__global__": {"port": 9100, "config_version": 3}}"#,
        );
        write_file(&dir, "config.json", "{broken");
        let s = store(&dir);
        assert_eq!(s.resolve_bind().1, 9100);
        // 復旧が書き戻されている（Python と同じ挙動）
        let text = std::fs::read_to_string(dir.path().join("config.json")).unwrap();
        assert!(text.contains("9100"));
    }

    #[test]
    fn save_and_load_roundtrip_with_python_format() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut cfg = Map::new();
        cfg.insert(
            GLOBAL_CONFIG_KEY.to_string(),
            json!({"config_version": 3, "workspace_order": ["ws_a"], "snippets": [{"command": "ls", "label": ""}]}),
        );
        cfg.insert(
            "ws_a".to_string(),
            json!({"name": "proj", "path": "~/proj", "icon": ""}),
        );
        s.save_all(&cfg).unwrap();

        let text = std::fs::read_to_string(dir.path().join("config.json")).unwrap();
        assert!(text.ends_with('\n'), "Python と同じ末尾改行");
        assert!(text.contains("  \"__global__\""), "2スペースインデント");
        // 正規化でデフォルト値（空 label / 空 icon）が落ちている
        let loaded = s.load_all();
        assert_eq!(loaded["ws_a"], json!({"name": "proj", "path": "~/proj"}));
        assert_eq!(
            loaded[GLOBAL_CONFIG_KEY]["snippets"],
            json!([{"command": "ls"}])
        );
    }

    /// lock ファイルが開けない（ここでは同名のディレクトリにして `open()` を
    /// 失敗させる）場合、ロック無しで read-modify-write を進めてしまわず、
    /// 書き込みをせずにエラーを返すこと（Codex レビュー指摘）。
    #[test]
    fn with_exclusive_fails_when_lock_cannot_be_acquired() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        std::fs::create_dir(dir.path().join("config.lock")).unwrap();

        let result: Result<(), ApiError> = s.with_exclusive(|cfg| {
            cfg.insert("ws_should_not_persist".to_string(), json!({"name": "x"}));
            Ok(())
        });
        assert!(result.is_err());
        assert!(!dir.path().join("config.json").exists());
    }

    #[test]
    fn save_all_fails_when_lock_cannot_be_acquired() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        std::fs::create_dir(dir.path().join("config.lock")).unwrap();

        let mut cfg = Map::new();
        cfg.insert("ws_a".to_string(), json!({"name": "proj"}));
        assert!(s.save_all(&cfg).is_err());
        assert!(!dir.path().join("config.json").exists());
    }

    #[test]
    fn save_rejects_invalid_entries() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut cfg = Map::new();
        cfg.insert("ws_bad".to_string(), json!("not an object"));
        let err = s.save_all(&cfg).unwrap_err();
        assert!(err.contains("Invalid config entry 'ws_bad'"));
    }

    #[test]
    fn old_version_migrates_on_read() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            &dir,
            "config.json",
            r#"{"__global__": {"pinned_jobs": [{"key": "k1"}]}}"#,
        );
        let s = store(&dir);
        let cfg = s.load_all();
        let global = cfg[GLOBAL_CONFIG_KEY].as_object().unwrap();
        assert_eq!(global["config_version"], json!(4));
        assert_eq!(
            global["recent_jobs"],
            json!([{"key": "k1", "pinned": true}])
        );
        // マイグレーション結果が書き戻されている
        let text = std::fs::read_to_string(dir.path().join("config.json")).unwrap();
        assert!(text.contains("recent_jobs"));
    }

    #[test]
    fn save_global_section_merges() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        s.save_global_section("editor", json!({"url_template": "vscode://x"}))
            .unwrap();
        s.save_global_section("snippets", json!([{"command": "ls"}]))
            .unwrap();
        assert_eq!(
            s.load_global_section("editor"),
            Some(json!({"url_template": "vscode://x"}))
        );
        assert_eq!(
            s.load_global_section("snippets"),
            Some(json!([{"command": "ls"}]))
        );
    }

    #[test]
    fn find_workspace_key_by_id_and_name() {
        let mut cfg = Map::new();
        cfg.insert("ws_1".to_string(), json!({"name": "alpha"}));
        cfg.insert(GLOBAL_CONFIG_KEY.to_string(), json!({}));
        assert_eq!(
            ConfigStore::find_workspace_key(&cfg, "ws_1"),
            Some("ws_1".into())
        );
        assert_eq!(
            ConfigStore::find_workspace_key(&cfg, "alpha"),
            Some("ws_1".into())
        );
        assert_eq!(ConfigStore::find_workspace_key(&cfg, "missing"), None);
        assert_eq!(
            ConfigStore::find_workspace_key(&cfg, GLOBAL_CONFIG_KEY),
            None
        );
    }

    #[test]
    fn check_health_reports_broken_and_ok() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        assert_eq!(s.check_health()["source"], "empty");
        write_file(
            &dir,
            "config.json",
            r#"{"__global__": {"config_version": 3}}"#,
        );
        let h = s.check_health();
        assert_eq!(h["ok"], json!(true));
        assert_eq!(h["source"], "config.json");
        write_file(&dir, "config.json", "{broken");
        let h = s.check_health();
        assert_eq!(h["ok"], json!(false));
    }
}
