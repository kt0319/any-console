//! 操作ログを data/activity/{workspace}/{YYYY-MM-DD}.jsonl に追記する
//! （Python 側 `api/activity.py` の移植）。
//!
//! 移行期間中は Python プロセスも同じファイルへ追記するが、O_APPEND の
//! 行単位追記のため相互に安全（フォーマットも同一: ensure_ascii=False 相当）。

use std::io::Write;
use std::path::Path;

use serde_json::{Map, Value};

/// UTC の現在時刻を (エントリ用 "%Y-%m-%dT%H:%M:%S", ファイル名用 "%Y-%m-%d") で返す。
fn utc_now_strings() -> (String, String) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    let (h, m, s) = ((secs % 86400) / 3600, (secs % 3600) / 60, secs % 60);
    // 1970-01-01 起点の civil date 変換（proleptic Gregorian）
    let (y, mo, d) = civil_from_days(days as i64);
    (
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}"),
        format!("{y:04}-{mo:02}-{d:02}"),
    )
}

/// Howard Hinnant の days->civil アルゴリズム。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// activity イベントを1行追記する。書き込み失敗は警告ログのみ（呼び出しは失敗しない）。
pub fn log_activity(
    data_dir: &Path,
    workspace: Option<&str>,
    event_type: &str,
    fields: Map<String, Value>,
) {
    let ws = workspace.filter(|w| !w.is_empty()).unwrap_or("_global");
    let (t, date) = utc_now_strings();
    let mut entry = Map::new();
    entry.insert("t".to_string(), Value::String(t));
    entry.insert("type".to_string(), Value::String(event_type.to_string()));
    entry.extend(fields);
    let path = data_dir
        .join("activity")
        .join(ws)
        .join(format!("{date}.jsonl"));
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().expect("activity path parent"))?;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        let line = serde_json::to_string(&Value::Object(entry.clone()))?;
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        Ok(())
    };
    if write().is_err() {
        tracing::warn!("activity log write failed ws={ws} type={event_type}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn civil_date_conversion() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1)); // 2024-01-01
        assert_eq!(civil_from_days(20_666), (2026, 8, 1)); // 2026-08-01
    }

    #[test]
    fn appends_jsonl_with_field_order() {
        let dir = tempfile::tempdir().unwrap();
        let mut fields = Map::new();
        fields.insert("branch".to_string(), json!("main"));
        fields.insert("commit".to_string(), json!("abc"));
        log_activity(dir.path(), Some("proj"), "git_commit", fields.clone());
        log_activity(dir.path(), None, "other", Map::new());

        let entries: Vec<_> = std::fs::read_dir(dir.path().join("activity").join("proj"))
            .unwrap()
            .collect();
        assert_eq!(entries.len(), 1);
        let content = std::fs::read_to_string(entries[0].as_ref().unwrap().path()).unwrap();
        let parsed: Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(parsed["type"], "git_commit");
        assert_eq!(parsed["branch"], "main");
        // キー順: t, type, kwargs（Python の dict 挿入順と同一）
        let keys: Vec<_> = parsed.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["t", "type", "branch", "commit"]);
        assert!(dir.path().join("activity").join("_global").is_dir());
    }
}
