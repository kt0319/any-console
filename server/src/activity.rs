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
    let (y, mo, d, h, m, s) = crate::util::utc_now_parts();
    (
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}"),
        format!("{y:04}-{mo:02}-{d:02}"),
    )
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
        // 行本体 + 改行を1回の write_all にまとめる（Python 版 `f.write(json + "\n")`
        // と同じ）。O_APPEND の write(2) はこのサイズなら1回の呼び出し単位で
        // atomic なため、2回に分けていた場合に起きる「他プロセス/他スレッドの
        // 書き込みが改行の前に割り込んで行が壊れる」競合を防ぐ（Codex レビュー
        // 指摘 — Python プロセスも同じファイルへ並行追記しうる）。
        let mut line = serde_json::to_string(&Value::Object(entry.clone()))?;
        line.push('\n');
        f.write_all(line.as_bytes())?;
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

    /// 同じ workspace へ多数のスレッドから並行に追記しても、行が他の書き込みと
    /// 混ざって壊れないこと（Codex レビュー指摘: 本文と改行を2回の write に
    /// 分けていると、O_APPEND の atomic 保証が「本文」と「改行」それぞれの
    /// write(2) 単位にしか効かず、他プロセス/他スレッドの書き込みがその間に
    /// 割り込むと本文だけが連結された壊れた行になりうる）。
    #[test]
    fn concurrent_appends_do_not_interleave_or_corrupt_lines() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_path_buf();
        const THREADS: usize = 16;
        const PER_THREAD: usize = 50;
        let handles: Vec<_> = (0..THREADS)
            .map(|t| {
                let data_dir = data_dir.clone();
                std::thread::spawn(move || {
                    for i in 0..PER_THREAD {
                        let mut fields = Map::new();
                        // ペイロードを十分な長さにして、書き込みが2回に分かれて
                        // いた場合に競合が起きやすい状態を作る。
                        fields.insert(
                            "payload".to_string(),
                            json!(format!("thread-{t}-{i}-{}", "x".repeat(200))),
                        );
                        log_activity(&data_dir, Some("proj"), "concurrent_test", fields);
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let entries: Vec<_> = std::fs::read_dir(data_dir.join("activity").join("proj"))
            .unwrap()
            .collect();
        assert_eq!(entries.len(), 1);
        let content = std::fs::read_to_string(entries[0].as_ref().unwrap().path()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(
            lines.len(),
            THREADS * PER_THREAD,
            "行数が一致しない（連結や欠落の疑い）"
        );
        for line in &lines {
            let parsed: Value = serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("corrupted line: {line:?}: {e}"));
            assert_eq!(parsed["type"], "concurrent_test");
        }
    }
}
