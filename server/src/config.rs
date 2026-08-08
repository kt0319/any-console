//! config.json の読み取り（Python 側 `api/config.py` のサブセット）。
//!
//! Phase 0 では Rust 側は config.json を **読み取り専用** で扱う。書き込み
//! （正規化・スキーマ検証・マイグレーション・.bak ローテーション）は Python 側が
//! 引き続き唯一のライターであり、プロセスをまたいだ read-modify-write 競合を
//! 作らない。書き込み系は設定 API（settings router）を移行する Phase 1 で、
//! ライターの役割ごと Rust へ移す。
//!
//! 読み取りに fcntl ロックは不要: Python のライターはアトミック rename で
//! 差し替えるため、リーダーが書き込み途中の内容を見ることはない（Python 側の
//! 共有ロックは read-modify-write サイクルの保護であり、純粋な読み取りには効かない）。

use std::path::PathBuf;

use serde_json::{Map, Value};

pub const GLOBAL_CONFIG_KEY: &str = "__global__";
pub const DEFAULT_BIND_HOST: &str = "0.0.0.0";
pub const DEFAULT_BIND_PORT: u16 = 8888;

#[derive(Debug, Clone)]
pub struct ConfigReader {
    pub config_file: PathBuf,
}

impl ConfigReader {
    pub fn new(config_file: PathBuf) -> Self {
        Self { config_file }
    }

    /// config.json を読む。壊れていれば .bak へフォールバックする
    /// （Python `_read_config_unlocked` と同じ復旧規則。ただし読み取り専用のため
    /// 復旧結果の書き戻しは行わず、次回 Python 側の読み込みに委ねる）。
    fn read_raw(&self) -> Map<String, Value> {
        let parse = |path: &PathBuf| -> Option<Map<String, Value>> {
            let text = std::fs::read_to_string(path).ok()?;
            match serde_json::from_str::<Value>(&text).ok()? {
                Value::Object(m) => Some(m),
                _ => None,
            }
        };
        if let Some(m) = parse(&self.config_file) {
            return m;
        }
        let bak = self.config_file.with_extension("bak");
        parse(&bak).unwrap_or_default()
    }

    /// `__global__.<key>` を返す。
    pub fn global_section(&self, key: &str) -> Option<Value> {
        self.read_raw()
            .get(GLOBAL_CONFIG_KEY)?
            .as_object()?
            .get(key)
            .cloned()
    }

    /// `__global__.host` / `__global__.port` を読む。未設定はデフォルト
    /// （Python `resolve_bind` と同一規則: 空文字 host・0/型不正 port はデフォルトへ）。
    pub fn resolve_bind(&self) -> (String, u16) {
        let host = match self.global_section("host") {
            Some(Value::String(s)) if !s.is_empty() => s,
            _ => DEFAULT_BIND_HOST.to_string(),
        };
        let port = match self.global_section("port") {
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

    /// 認証無効化フラグ（Python `_is_auth_disabled` と同一: 環境変数が優先）。
    pub fn auth_disabled(&self) -> bool {
        if std::env::var("ANY_CONSOLE_DISABLE_AUTH")
            .map(|v| v.trim() == "1")
            .unwrap_or(false)
        {
            return true;
        }
        matches!(
            self.global_section("auth_disabled"),
            Some(Value::Bool(true))
        )
    }

    /// Tailscale ヘッダ信頼の opt-in（Python `_is_tailscale_trust_enabled` と同一）。
    pub fn trust_tailscale_auth(&self) -> bool {
        if std::env::var("ANY_CONSOLE_TRUST_TAILSCALE_AUTH")
            .map(|v| v.trim() == "1")
            .unwrap_or(false)
        {
            return true;
        }
        matches!(
            self.global_section("trust_tailscale_auth"),
            Some(Value::Bool(true))
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn writer(dir: &tempfile::TempDir, name: &str, content: &str) -> PathBuf {
        let p = dir.path().join(name);
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn missing_config_uses_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let r = ConfigReader::new(dir.path().join("config.json"));
        assert_eq!(
            r.resolve_bind(),
            (DEFAULT_BIND_HOST.to_string(), DEFAULT_BIND_PORT)
        );
        assert!(!r.auth_disabled());
    }

    #[test]
    fn reads_global_bind() {
        let dir = tempfile::tempdir().unwrap();
        let p = writer(
            &dir,
            "config.json",
            r#"{"__global__": {"host": "127.0.0.1", "port": 9000}}"#,
        );
        let r = ConfigReader::new(p);
        assert_eq!(r.resolve_bind(), ("127.0.0.1".to_string(), 9000));
    }

    #[test]
    fn invalid_port_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let p = writer(&dir, "config.json", r#"{"__global__": {"port": "abc"}}"#);
        let r = ConfigReader::new(p);
        assert_eq!(r.resolve_bind().1, DEFAULT_BIND_PORT);
    }

    #[test]
    fn broken_config_falls_back_to_bak() {
        let dir = tempfile::tempdir().unwrap();
        writer(&dir, "config.bak", r#"{"__global__": {"port": 9100}}"#);
        let p = writer(&dir, "config.json", "{broken");
        let r = ConfigReader::new(p);
        assert_eq!(r.resolve_bind().1, 9100);
    }

    #[test]
    fn workspace_entries_do_not_leak_into_global() {
        let dir = tempfile::tempdir().unwrap();
        let p = writer(
            &dir,
            "config.json",
            r#"{"ws_abc": {"name": "proj", "host": "10.0.0.1"}}"#,
        );
        let r = ConfigReader::new(p);
        assert_eq!(r.resolve_bind().0, DEFAULT_BIND_HOST);
    }
}
