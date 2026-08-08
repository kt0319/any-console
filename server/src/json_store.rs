//! data/ 配下の JSON ファイル読み書き（Python 側 `api/common.py` の
//! `load_json_file` / `save_json_file` と同一セマンティクス）。
//!
//! 書き込みはアトミック（tmp ファイル → rename）。Python プロセスと同じファイルを
//! 並行して読み書きする移行期間中も、リーダーが書き込み途中の内容を読むことはない。

use std::io::Write;
use std::path::Path;

use serde_json::Value;

/// JSON ファイルを読む。欠如・破損・検証失敗時は default を返す。
pub fn load_json_file(
    path: &Path,
    default: Value,
    validate: Option<&dyn Fn(&Value) -> bool>,
) -> Value {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return default,
    };
    let data: Value = match serde_json::from_str(&text) {
        Ok(d) => d,
        Err(_) => return default,
    };
    if let Some(v) = validate {
        if !v(&data) {
            return default;
        }
    }
    data
}

/// JSON ファイルへアトミックに書き込む（親ディレクトリを自動作成）。
///
/// tmp 名は書き込みごとにユニーク（tempfile が保証）— 固定名だと並行ライター同士で
/// rename が競合する。フォーマットは Python の `json.dumps(indent=2, ensure_ascii=False)`
/// と互換（2スペースインデント・非ASCII文字は生のまま）。
pub fn save_json_file(path: &Path, data: &Value) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut tmp = tempfile::Builder::new()
        .prefix(&format!(
            "{}.",
            path.file_name().and_then(|n| n.to_str()).unwrap_or("json")
        ))
        .suffix(".tmp")
        .tempfile_in(parent)?;
    let text = serde_json::to_string_pretty(data)?;
    tmp.write_all(text.as_bytes())?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let v = load_json_file(&dir.path().join("nope.json"), json!({"d": 1}), None);
        assert_eq!(v, json!({"d": 1}));
    }

    #[test]
    fn broken_json_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("broken.json");
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load_json_file(&p, json!([]), None), json!([]));
    }

    #[test]
    fn validate_failure_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("devices.json");
        std::fs::write(&p, r#"{"other": true}"#).unwrap();
        let validate = |v: &Value| v.get("devices").is_some();
        let v = load_json_file(&p, json!({"devices": []}), Some(&validate));
        assert_eq!(v, json!({"devices": []}));
    }

    #[test]
    fn save_roundtrips_and_creates_parents() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("state.json");
        let data = json!({"token": "abc", "api_tokens": [{"id": "tok_1", "名前": "日本語"}]});
        save_json_file(&p, &data).unwrap();
        assert_eq!(load_json_file(&p, json!(null), None), data);
        // ensure_ascii=False 互換: 非ASCIIがエスケープされない
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("日本語"));
        assert!(text.contains("  \"token\""), "2-space indent expected");
    }

    #[test]
    fn python_written_file_loads_unchanged() {
        // Python 産（json.dumps indent=2）のファイルをそのまま読めること
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("auth.json");
        std::fs::write(&p, "{\n  \"token\": \"tkn\",\n  \"api_tokens\": []\n}").unwrap();
        let v = load_json_file(&p, json!({}), None);
        assert_eq!(v["token"], "tkn");
    }
}
