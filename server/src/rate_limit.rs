//! インプロセス固定窓レートリミッタ（Python 側 `api/rate_limiter.py` と同一規則）。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const RATE_WINDOW_SEC: u64 = 60;
const DEFAULT_RATE_LIMIT: u32 = 1000;

/// E2E テスト等で連続アクセスが上限を超える場合に環境変数で引き上げられる。
/// 0 や負数・非数値はリクエスト上限として不正のため既定値へフォールバックする。
pub fn rate_limit_from_env() -> u32 {
    match std::env::var("ANY_CONSOLE_RATE_LIMIT") {
        Ok(v) => match v.parse::<i64>() {
            Ok(n) if n > 0 && n <= u32::MAX as i64 => n as u32,
            _ => DEFAULT_RATE_LIMIT,
        },
        Err(_) => DEFAULT_RATE_LIMIT,
    }
}

// Python 側 `_STATIC_DIRS` / `_STATIC_SUFFIXES` / `_SKIP_EXACT` / `_SKIP_PREFIXES` と同一。
const STATIC_DIRS: &[&str] = &[
    "/assets/",
    "/icons/",
    "/styles/",
    "/utils/",
    "/components/",
    "/composables/",
    "/stores/",
    "/vendor/",
    "/public/",
];

const STATIC_SUFFIXES: &[&str] = &[
    ".js", ".mjs", ".css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".otf",
];

const SKIP_EXACT: &[&str] = &[
    "/",
    "/sw.js",
    "/manifest.json",
    "/favicon.png",
    "/apple-touch-icon.png",
    "/auth/check",
    "/agent-hooks/events",
];

const SKIP_PREFIXES: &[&str] = &["/terminal/ws/", "/preview/"];

pub fn should_skip(path: &str) -> bool {
    SKIP_EXACT.contains(&path)
        || STATIC_DIRS.iter().any(|p| path.starts_with(p))
        || SKIP_PREFIXES.iter().any(|p| path.starts_with(p))
        || STATIC_SUFFIXES.iter().any(|s| path.ends_with(s))
}

pub struct FixedWindowCounter {
    counts: Mutex<HashMap<String, (Instant, u32)>>,
}

impl Default for FixedWindowCounter {
    fn default() -> Self {
        Self::new()
    }
}

impl FixedWindowCounter {
    pub fn new() -> Self {
        Self {
            counts: Mutex::new(HashMap::new()),
        }
    }

    pub fn is_allowed(&self, key: &str, limit: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut counts = self.counts.lock().expect("rate limiter lock poisoned");
        match counts.get(key).copied() {
            None => {
                counts.insert(key.to_string(), (now, 1));
                true
            }
            Some((start, _)) if now.duration_since(start) >= window => {
                counts.insert(key.to_string(), (now, 1));
                true
            }
            Some((_, count)) if count >= limit => false,
            Some((start, count)) => {
                counts.insert(key.to_string(), (start, count + 1));
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_rules_match_python() {
        assert!(should_skip("/"));
        assert!(should_skip("/auth/check"));
        assert!(should_skip("/agent-hooks/events"));
        assert!(should_skip("/assets/index-abc123.js"));
        assert!(should_skip("/terminal/ws/sess1"));
        assert!(should_skip("/preview/local/3000/index.html"));
        assert!(should_skip("/some/deep/file.css"));
        assert!(!should_skip("/workspaces"));
        assert!(!should_skip("/dispatch"));
        assert!(!should_skip("/terminal/sessions"));
    }

    #[test]
    fn fixed_window_counts_and_resets() {
        let c = FixedWindowCounter::new();
        let window = Duration::from_millis(50);
        assert!(c.is_allowed("api:1.2.3.4", 2, window));
        assert!(c.is_allowed("api:1.2.3.4", 2, window));
        assert!(!c.is_allowed("api:1.2.3.4", 2, window));
        // 別キーは独立
        assert!(c.is_allowed("api:5.6.7.8", 2, window));
        // 窓が切れたらリセット
        std::thread::sleep(Duration::from_millis(60));
        assert!(c.is_allowed("api:1.2.3.4", 2, window));
    }

    #[test]
    fn env_fallbacks() {
        // 環境変数未設定時のデフォルト（テストプロセスでは通常未設定）
        if std::env::var("ANY_CONSOLE_RATE_LIMIT").is_err() {
            assert_eq!(rate_limit_from_env(), 1000);
        }
    }
}
