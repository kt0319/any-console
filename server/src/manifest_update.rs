//! screen manifest のリモート更新（Python 側 `api/manifest_update.py` の移植。
//! herdr の `manifest_update.rs` に対応）。
//!
//! herdr.dev のカタログ（`index.toml`: schema_version = 1 と `[[agents]]` id/path）を
//! 取得し、エージェントごとのマニフェスト TOML を検証してから
//! `data/agent-detection/remote/<id>.toml` へ保存する。検証は herdr と同じ:
//!
//! - id がカタログのエージェントと一致し、version（ドット区切り数値）と
//!   min_engine_version が必須。エンジンバージョン超過は拒否
//! - キャッシュ済みより古い version は拒否。同一 version で内容が変わっていたら
//!   拒否（version bump なしの差し替えを防ぐ）
//! - カタログの path は相対パスのみ（`://`・先頭 `/`・`..` を含むものは拒否）
//!
//! 結果は `data/agent-detection/status.json` に記録する。
//!
//! 定期実行ループ（`run_update_loop`、`AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC`
//! 後に開始し以後 `AGENT_MANIFEST_UPDATE_INTERVAL_SEC` ごと）は `main.rs` から
//! 起動時に一度 `tokio::spawn` される。Python 側の同名ループ（`start_updater`/
//! `stop_updater`）は `api/main.py` の `lifespan()` から呼び出しを削除済み —
//! 同じ `data/agent-detection/remote/` への二重書き込みを避けるための一括切替
//! （`push.py` の `ensure_phrase_task` 削除と同じ理由）。

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Map, Value};

use crate::config::ConfigStore;
use crate::json_store::load_json_file;
use crate::screen_manifest::{
    compare_manifest_versions, parse_manifest_text, parse_manifest_version, value_to_string,
    ManifestStore,
};
use crate::state::AppState;

pub const DEFAULT_CATALOG_URL: &str = "https://herdr.dev/agent-detection/index.toml";
pub const CATALOG_URL_ENV: &str = "ANY_CONSOLE_MANIFEST_CATALOG_URL";
pub const AGENT_MANIFEST_FETCH_TIMEOUT_SEC: f64 = 15.0;
pub const AGENT_MANIFEST_MAX_FETCH_BYTES: usize = 256 * 1024;
pub const AGENT_MANIFEST_UPDATE_INTERVAL_SEC: u64 = 24 * 60 * 60;
pub const AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC: u64 = 300;

pub fn catalog_url() -> String {
    std::env::var(CATALOG_URL_ENV)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_CATALOG_URL.to_string())
}

fn base_url(url: &str) -> Result<String, String> {
    let tail = match url.rfind("://") {
        Some(idx) => &url[idx + 3..],
        None => url,
    };
    if !tail.contains('/') {
        return Err(format!("catalog url {url:?} has no path"));
    }
    match url.rsplit_once('/') {
        Some((base, _)) => Ok(base.to_string()),
        None => Ok(url.to_string()),
    }
}

/// URL からテキストを取得する（サイズ上限・タイムアウト付き）。
pub async fn fetch_text(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs_f64(
            AGENT_MANIFEST_FETCH_TIMEOUT_SEC,
        ))
        .build()
        .map_err(|e| format!("fetch failed for {url}: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| format!("fetch failed for {url}: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("fetch failed for {url}: {e}"))?;
        buf.extend_from_slice(&chunk);
        if buf.len() > AGENT_MANIFEST_MAX_FETCH_BYTES {
            return Err(format!("response for {url} exceeds size limit"));
        }
    }
    String::from_utf8(buf).map_err(|e| format!("fetch failed for {url}: {e}"))
}

/// カタログ TOML をパースして (agent_id, 相対 path) のリストを返す。
///
/// `known_ids` に無いエージェントは同梱マニフェストが無いとみなしスキップする
/// （herdr と同じ）。
pub fn parse_catalog(
    content: &str,
    known_ids: &std::collections::HashSet<String>,
) -> Result<Vec<(String, String)>, String> {
    let raw: toml::Table = content
        .parse()
        .map_err(|e: toml::de::Error| format!("failed to parse catalog TOML: {e}"))?;
    let schema_version = raw.get("schema_version").and_then(toml::Value::as_integer);
    if schema_version != Some(1) {
        return Err(format!(
            "unsupported catalog schema_version {schema_version:?}"
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut agents = Vec::new();
    let Some(raw_agents) = raw.get("agents").and_then(toml::Value::as_array) else {
        return Ok(agents);
    };
    for entry in raw_agents {
        let table = entry.as_table().ok_or("catalog entry is not a table")?;
        let agent_id = table
            .get("id")
            .map(value_to_string)
            .unwrap_or_default()
            .trim()
            .to_string();
        let path = table
            .get("path")
            .map(value_to_string)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !known_ids.contains(&agent_id) {
            // 同梱マニフェストの無いエージェントは認識対象外（herdr と同じく skip）
            tracing::info!("skipping unknown remote manifest agent {agent_id}");
            continue;
        }
        if path.is_empty() {
            return Err(format!("catalog entry {agent_id} has an empty path"));
        }
        if path.contains("://") || path.starts_with('/') || path.split('/').any(|seg| seg == "..") {
            return Err(format!(
                "catalog entry {agent_id} has an unsafe path {path}"
            ));
        }
        if !seen.insert(agent_id.clone()) {
            return Err(format!("catalog contains duplicate agent {agent_id}"));
        }
        agents.push((agent_id, path));
    }
    Ok(agents)
}

fn cached_remote_version(path: &Path) -> Option<Vec<u64>> {
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let raw: toml::Table = content.parse().ok()?;
    let version = raw.get("version")?;
    parse_manifest_version(&value_to_string(version)).ok()
}

/// 取得したマニフェストを検証してコミットする。更新があれば `Ok(true)`。
///
/// 検証失敗・バージョン後退・version bump なしの内容変更はエラー。
pub fn process_agent_manifest(
    store: &ManifestStore,
    agent_id: &str,
    content: &str,
) -> Result<bool, String> {
    let manifest = parse_manifest_text(content, "remote", true)
        .map_err(|e| format!("invalid manifest for {agent_id}: {e}"))?;
    if manifest.id != agent_id {
        return Err(format!(
            "manifest id {:?} does not match catalog agent {agent_id:?}",
            manifest.id
        ));
    }
    let Some(version) = &manifest.version else {
        return Err(format!("manifest for {agent_id} is missing version"));
    };

    let path = store.remote_manifest_path(agent_id);
    if let Some(cached) = cached_remote_version(&path) {
        match compare_manifest_versions(version, &cached) {
            cmp if cmp < 0 => {
                return Err(format!(
                    "remote version for {agent_id} is older than cached"
                ));
            }
            0 => {
                let committed = std::fs::read_to_string(&path).unwrap_or_default();
                if committed != content {
                    return Err(format!(
                        "remote manifest {agent_id} changed content without a version bump"
                    ));
                }
                return Ok(false);
            }
            _ => {}
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to store manifest for {agent_id}: {e}"))?;
    }
    std::fs::write(&path, content)
        .map_err(|e| format!("failed to store manifest for {agent_id}: {e}"))?;
    Ok(true)
}

fn status_path(store: &ManifestStore) -> std::path::PathBuf {
    store
        .override_dir()
        .parent()
        .unwrap_or(store.override_dir())
        .join("status.json")
}

pub fn load_status(store: &ManifestStore) -> Map<String, Value> {
    load_json_file(&status_path(store), json!({}), None)
        .as_object()
        .cloned()
        .unwrap_or_default()
}

fn save_status(store: &ManifestStore, status: &Map<String, Value>) {
    crate::json_store::save_or_warn(
        &status_path(store),
        &Value::Object(status.clone()),
        "agent-detection status.json",
    );
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

async fn run_catalog_check<F, Fut>(
    store: &ManifestStore,
    catalog_url: &str,
    agents_status: &mut Map<String, Value>,
    fetch: &F,
) -> Result<bool, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    let catalog_text = fetch(catalog_url.to_string()).await?;
    let known_ids: std::collections::HashSet<String> = store
        .load_manifests()
        .iter()
        .map(|m| m.id.clone())
        .collect();
    let catalog = parse_catalog(&catalog_text, &known_ids)?;
    let base = base_url(catalog_url)?;
    let mut updated = false;
    for (agent_id, path) in catalog {
        let mut entry = Map::new();
        let outcome = fetch(format!("{base}/{path}"))
            .await
            .and_then(|content| process_agent_manifest(store, &agent_id, &content));
        match outcome {
            Ok(changed) => {
                updated = updated || changed;
                entry.insert(
                    "last_result".to_string(),
                    json!(if changed { "updated" } else { "unchanged" }),
                );
            }
            Err(e) => {
                entry.insert("last_result".to_string(), json!("failed"));
                entry.insert("last_error".to_string(), json!(e));
                tracing::warn!("manifest update failed agent={agent_id}: {e}");
            }
        }
        let cached = cached_remote_version(&store.remote_manifest_path(&agent_id));
        entry.insert(
            "cached_version".to_string(),
            match cached {
                Some(v) => {
                    let parts: Vec<String> = v.iter().map(u64::to_string).collect();
                    json!(parts.join("."))
                }
                None => Value::Null,
            },
        );
        agents_status.insert(agent_id, Value::Object(entry));
    }
    Ok(updated)
}

/// カタログを確認し、更新があればコミットして status を返す。
///
/// エージェント単位のエラーは status に記録して続行する。カタログ自体の
/// 取得・解釈失敗は last_result に記録する。
pub async fn check_and_update<F, Fut>(
    store: &ManifestStore,
    catalog_url: &str,
    fetch: F,
) -> Map<String, Value>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    let mut status = load_status(store);
    status.insert("last_check_unix".to_string(), json!(now_unix()));
    let mut agents_status = status
        .get("agents")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    match run_catalog_check(store, catalog_url, &mut agents_status, &fetch).await {
        Ok(updated_any) => {
            status.insert("last_result".to_string(), json!("checked"));
            status.insert("agents".to_string(), Value::Object(agents_status));
            save_status(store, &status);
            if updated_any {
                store.invalidate_manifest_cache();
                tracing::info!("remote screen manifests updated");
            }
        }
        Err(e) => {
            status.insert("last_result".to_string(), json!(format!("failed: {e}")));
            status.insert("agents".to_string(), Value::Object(agents_status));
            tracing::warn!("manifest catalog check failed: {e}");
            save_status(store, &status);
        }
    }
    status
}

pub fn remote_update_enabled(config: &ConfigStore) -> bool {
    let Some(raw) = config.load_global_section("agent_detection") else {
        return true;
    };
    let Some(obj) = raw.as_object() else {
        return true;
    };
    obj.get("remote_update")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

/// リモートマニフェストの定期確認ループ。起動から
/// `AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC` 後に開始し、以後
/// `AGENT_MANIFEST_UPDATE_INTERVAL_SEC` ごとに確認する。`main.rs` から
/// `tokio::spawn` で一度だけ起動する（Python 版 `_update_loop` 相当）。
pub async fn run_update_loop(state: Arc<AppState>) -> ! {
    tokio::time::sleep(Duration::from_secs(AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC)).await;
    loop {
        if remote_update_enabled(&state.config) {
            check_and_update(&state.manifest_store, &catalog_url(), fetch_text).await;
        }
        tokio::time::sleep(Duration::from_secs(AGENT_MANIFEST_UPDATE_INTERVAL_SEC)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn store() -> (ManifestStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let manifest_dir = dir.path().join("bundled");
        std::fs::create_dir_all(&manifest_dir).unwrap();
        std::fs::write(
            manifest_dir.join("claude.toml"),
            "id = \"claude\"\n[[rules]]\nid = \"r\"\nstate = \"idle\"\npriority = 1\n",
        )
        .unwrap();
        std::fs::write(
            manifest_dir.join("codex.toml"),
            "id = \"codex\"\n[[rules]]\nid = \"r\"\nstate = \"idle\"\npriority = 1\n",
        )
        .unwrap();
        let store = ManifestStore::new(manifest_dir, dir.path());
        (store, dir)
    }

    const CATALOG: &str = "schema_version = 1\n\n\
        [[agents]]\nid = \"claude\"\npath = \"claude.toml\"\n\n\
        [[agents]]\nid = \"not-a-known-agent\"\npath = \"unknown.toml\"\n";

    const REMOTE_CLAUDE: &str = "id = \"claude\"\nversion = \"9999.1.1\"\nmin_engine_version = 2\n\n\
        [[rules]]\nid = \"remote_rule\"\nstate = \"blocked\"\npriority = 10\nregion = \"whole_recent\"\ncontains = [\"remote marker\"]\n";

    fn known(ids: &[&str]) -> std::collections::HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    // ─── parse_catalog ───────────────────────────────────────────────────

    #[test]
    fn valid_catalog_skips_unknown_agents() {
        assert_eq!(
            parse_catalog(CATALOG, &known(&["claude", "codex"])).unwrap(),
            vec![("claude".to_string(), "claude.toml".to_string())]
        );
    }

    #[test]
    fn rejects_wrong_schema_version() {
        assert!(parse_catalog("schema_version = 2\n", &known(&["claude"])).is_err());
    }

    #[test]
    fn rejects_invalid_toml() {
        assert!(parse_catalog("not [valid", &known(&["claude"])).is_err());
    }

    #[test]
    fn rejects_unsafe_paths() {
        for path in [
            "/abs/claude.toml",
            "https://evil/x.toml",
            "../escape.toml",
            "a/../b.toml",
        ] {
            let catalog =
                format!("schema_version = 1\n[[agents]]\nid = \"claude\"\npath = \"{path}\"\n");
            assert!(
                parse_catalog(&catalog, &known(&["claude"])).is_err(),
                "expected {path} to be rejected"
            );
        }
    }

    #[test]
    fn rejects_empty_path() {
        let catalog = "schema_version = 1\n[[agents]]\nid = \"claude\"\npath = \"\"\n";
        assert!(parse_catalog(catalog, &known(&["claude"])).is_err());
    }

    #[test]
    fn rejects_duplicate_agent() {
        let catalog = "schema_version = 1\n\
            [[agents]]\nid = \"claude\"\npath = \"a.toml\"\n\
            [[agents]]\nid = \"claude\"\npath = \"b.toml\"\n";
        assert!(parse_catalog(catalog, &known(&["claude"])).is_err());
    }

    // ─── process_agent_manifest ──────────────────────────────────────────

    #[test]
    fn commits_new_manifest() {
        let (store, _dir) = store();
        assert!(process_agent_manifest(&store, "claude", REMOTE_CLAUDE).unwrap());
        let saved = std::fs::read_to_string(store.remote_manifest_path("claude")).unwrap();
        assert_eq!(saved, REMOTE_CLAUDE);
    }

    #[test]
    fn rejects_id_mismatch() {
        let (store, _dir) = store();
        assert!(process_agent_manifest(&store, "codex", REMOTE_CLAUDE).is_err());
    }

    #[test]
    fn rejects_missing_required_fields() {
        let (store, _dir) = store();
        assert!(process_agent_manifest(&store, "claude", "id = \"claude\"\n").is_err());
    }

    #[test]
    fn rejects_engine_version_too_new() {
        let (store, _dir) = store();
        let content = REMOTE_CLAUDE.replace("min_engine_version = 2", "min_engine_version = 99");
        assert!(process_agent_manifest(&store, "claude", &content).is_err());
    }

    #[test]
    fn rejects_older_than_cached() {
        let (store, _dir) = store();
        process_agent_manifest(&store, "claude", REMOTE_CLAUDE).unwrap();
        let older = REMOTE_CLAUDE.replace("version = \"9999.1.1\"", "version = \"9999.1.0\"");
        assert!(process_agent_manifest(&store, "claude", &older).is_err());
    }

    #[test]
    fn same_version_same_content_is_noop() {
        let (store, _dir) = store();
        process_agent_manifest(&store, "claude", REMOTE_CLAUDE).unwrap();
        assert!(!process_agent_manifest(&store, "claude", REMOTE_CLAUDE).unwrap());
    }

    #[test]
    fn same_version_changed_content_is_rejected() {
        let (store, _dir) = store();
        process_agent_manifest(&store, "claude", REMOTE_CLAUDE).unwrap();
        let changed = REMOTE_CLAUDE.replace("remote marker", "tampered marker");
        assert!(process_agent_manifest(&store, "claude", &changed).is_err());
    }

    // ─── check_and_update ────────────────────────────────────────────────

    fn fetch_from(
        mapping: HashMap<&'static str, &'static str>,
    ) -> impl Fn(
        String,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<String, String>> + Send>,
    > {
        let mapping: HashMap<String, String> = mapping
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let mapping = Arc::new(mapping);
        move |url: String| {
            let mapping = mapping.clone();
            Box::pin(async move {
                for (suffix, content) in mapping.iter() {
                    if url.ends_with(suffix) {
                        return Ok(content.clone());
                    }
                }
                Err(format!("fetch failed for {url}: 404"))
            })
        }
    }

    #[tokio::test]
    async fn updates_and_records_status() {
        let (store, _dir) = store();
        let fetch = fetch_from(HashMap::from([
            ("index.toml", CATALOG),
            ("claude.toml", REMOTE_CLAUDE),
        ]));
        let status = check_and_update(&store, "https://x/index.toml", fetch).await;
        assert_eq!(status["last_result"], json!("checked"));
        assert_eq!(status["agents"]["claude"]["last_result"], json!("updated"));
        assert_eq!(
            status["agents"]["claude"]["cached_version"],
            json!("9999.1.1")
        );
        let manifest = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(manifest.source, "remote");
        assert_eq!(load_status(&store)["last_result"], json!("checked"));
    }

    #[tokio::test]
    async fn second_run_is_unchanged() {
        let (store, _dir) = store();
        let fetch = fetch_from(HashMap::from([
            ("index.toml", CATALOG),
            ("claude.toml", REMOTE_CLAUDE),
        ]));
        check_and_update(&store, "https://x/index.toml", &fetch).await;
        let status = check_and_update(&store, "https://x/index.toml", &fetch).await;
        assert_eq!(
            status["agents"]["claude"]["last_result"],
            json!("unchanged")
        );
    }

    #[tokio::test]
    async fn catalog_fetch_failure_is_recorded() {
        let (store, _dir) = store();
        let fetch = fetch_from(HashMap::new());
        let status = check_and_update(&store, "https://x/index.toml", fetch).await;
        assert!(status["last_result"]
            .as_str()
            .unwrap()
            .starts_with("failed:"));
    }

    #[tokio::test]
    async fn agent_failure_does_not_abort_run() {
        let (store, _dir) = store();
        let catalog = "schema_version = 1\n\
            [[agents]]\nid = \"claude\"\npath = \"claude.toml\"\n\
            [[agents]]\nid = \"codex\"\npath = \"codex.toml\"\n";
        let codex_manifest = REMOTE_CLAUDE.replace("id = \"claude\"", "id = \"codex\"");
        // fetch_from は 'static な &str マッピングを取るため、動的に生成した
        // codex 文字列と catalog はテスト用に leak して 'static 化する。
        let codex_leak: &'static str = Box::leak(codex_manifest.into_boxed_str());
        let catalog_leak: &'static str = Box::leak(catalog.to_string().into_boxed_str());
        let fetch = fetch_from(HashMap::from([
            ("index.toml", catalog_leak),
            ("claude.toml", "id = \"claude\"\n"),
            ("codex.toml", codex_leak),
        ]));
        let status = check_and_update(&store, "https://x/index.toml", fetch).await;
        assert_eq!(status["last_result"], json!("checked"));
        assert_eq!(status["agents"]["claude"]["last_result"], json!("failed"));
        assert!(status["agents"]["claude"]["last_error"]
            .as_str()
            .unwrap()
            .contains("invalid manifest"));
        assert_eq!(status["agents"]["codex"]["last_result"], json!("updated"));
    }

    // ─── remote_update_enabled ───────────────────────────────────────────

    #[test]
    fn default_is_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let config = ConfigStore::new(dir.path().join("config.json"));
        assert!(remote_update_enabled(&config));
    }

    #[test]
    fn config_can_disable() {
        let dir = tempfile::tempdir().unwrap();
        let config_file = dir.path().join("config.json");
        std::fs::write(
            &config_file,
            r#"{"__global__": {"agent_detection": {"remote_update": false}}}"#,
        )
        .unwrap();
        let config = ConfigStore::new(config_file);
        assert!(!remote_update_enabled(&config));
    }

    #[test]
    fn broken_config_defaults_to_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let config_file = dir.path().join("config.json");
        std::fs::write(
            &config_file,
            r#"{"__global__": {"agent_detection": "broken"}}"#,
        )
        .unwrap();
        let config = ConfigStore::new(config_file);
        assert!(remote_update_enabled(&config));
    }

    // ─── catalog_url / base_url ──────────────────────────────────────────

    // env_override / default_catalog_url はプロセスグローバルな環境変数を
    // 共有するため、他テストとの並行実行での競合を避けて 1 テストにまとめる。
    #[test]
    fn catalog_url_env_override_and_default() {
        std::env::remove_var(CATALOG_URL_ENV);
        assert_eq!(catalog_url(), DEFAULT_CATALOG_URL);
        std::env::set_var(CATALOG_URL_ENV, "https://example.com/idx.toml");
        assert_eq!(catalog_url(), "https://example.com/idx.toml");
        std::env::remove_var(CATALOG_URL_ENV);
    }

    #[test]
    fn base_url_test() {
        assert_eq!(
            base_url("https://x.dev/a/index.toml").unwrap(),
            "https://x.dev/a"
        );
        assert!(base_url("https://x.dev").is_err());
    }
}
