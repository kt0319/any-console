//! herdr の screen manifest によるエージェント状態判定（Python 側
//! `api/screen_manifest.py` の移植）。
//!
//! ベンダリングした TOML マニフェスト（`agent_manifests/` —
//! ogulcancelik/herdr 由来、Apache-2.0）を可視ペイン内容と照合し、既知
//! エージェント（Claude Code / Codex 等）の blocked（承認・入力待ち）等の
//! 状態を判定する。評価の意味論は herdr の `src/detect/manifest.rs` に
//! 合わせる:
//!
//! - ルールは定義順に走査し、優先度が「厳密に大きい」ときだけ勝者を置き換える
//!   （同優先度は先勝ち）。
//! - `contains` は小文字化した部分一致の AND。`regex` はリージョン全体への
//!   検索、`line_regex` は「各パターンがいずれかの行に一致」。`any` は OR、
//!   `all` は AND、`not` は「どれにも一致しない」。
//! - 勝者ルールが `skip_state_update` の場合は状態を確定しない（None を返す）。
//!
//! マニフェストは herdr と同じ 3 階層で解決する（優先度の高い順）:
//!
//! 1. ローカル override: `data/agent-detection/<id>.toml`
//! 2. リモートキャッシュ: `data/agent-detection/remote/<id>.toml`
//! 3. 同梱: `agent_manifests/*.toml`（読み取り専用のパッケージデータ）
//!
//! Python 版は `\x{...}` 等の Rust regex 記法を Python `re` 用に変換する
//! `translate_rust_regex()` を持つが、マニフェストはそもそも Rust regex
//! （herdr）向けに書かれているため、Rust の `regex` クレートはこの変換なしで
//! そのままコンパイルできる（`\x{7F}` 波括弧 hex エスケープ・`\p{Alphabetic}`
//! Unicode プロパティともにネイティブ対応）。
//!
//! `AppState::manifest_store` として保持され、`agent_watch.rs`・
//! `manifest_update.rs` から利用される。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use regex::Regex;

pub const ENGINE_VERSION: i64 = 3;
pub const STATE_WORKING: &str = "working";
pub const STATE_IDLE: &str = "idle";
pub const STATE_BLOCKED: &str = "blocked";
pub const STATE_UNKNOWN: &str = "unknown";
/// agent_watch がセッション状態として採用する manifest 判定（unknown は採用しない）。
pub const ADOPTED_STATES: &[&str] = &[STATE_WORKING, STATE_IDLE, STATE_BLOCKED];

pub const SCREEN_MANIFEST_CACHE_TTL_SEC: u64 = 60;

// ─── バージョン比較 ─────────────────────────────────────────────────────────

/// ドット区切り数値バージョンをパースする（herdr の ManifestVersion 相当）。
/// 数値以外・空セグメントはエラー。
pub fn parse_manifest_version(value: &str) -> Result<Vec<u64>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("version must not be empty".to_string());
    }
    let mut segments = Vec::new();
    for segment in trimmed.split('.') {
        if segment.is_empty() || !segment.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("version {trimmed:?} must be dotted numeric"));
        }
        segments.push(segment.parse::<u64>().map_err(|e| e.to_string())?);
    }
    Ok(segments)
}

/// -1 / 0 / 1 を返す。桁数が違う場合は 0 を補って比較する（1.2 == 1.2.0）。
pub fn compare_manifest_versions(left: &[u64], right: &[u64]) -> i32 {
    let length = left.len().max(right.len());
    let pad = |v: &[u64]| -> Vec<u64> {
        let mut out = v.to_vec();
        out.resize(length, 0);
        out
    };
    match pad(left).cmp(&pad(right)) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Equal => 0,
    }
}

// ─── マニフェストのデータ構造 ───────────────────────────────────────────────

#[derive(Clone, Default)]
pub struct Gate {
    pub contains: Vec<String>,
    pub regex: Vec<Regex>,
    pub line_regex: Vec<Regex>,
    pub all_gates: Vec<Gate>,
    pub any_gates: Vec<Gate>,
    pub not_gates: Vec<Gate>,
}

#[derive(Clone)]
pub struct Rule {
    pub id: String,
    pub state: String,
    pub priority: i64,
    pub region: String,
    pub skip_state_update: bool,
    pub gate: Gate,
}

#[derive(Clone)]
pub struct Manifest {
    pub id: String,
    pub aliases: Vec<String>,
    pub rules: Vec<Rule>,
    pub version: Option<Vec<u64>>,
    pub min_engine_version: Option<i64>,
    /// "bundled" | "remote" | "override"
    pub source: String,
}

// ─── TOML → 構造体へのコンパイル ────────────────────────────────────────────

pub(crate) fn value_to_string(v: &toml::Value) -> String {
    match v {
        toml::Value::String(s) => s.clone(),
        toml::Value::Integer(i) => i.to_string(),
        toml::Value::Float(f) => f.to_string(),
        toml::Value::Boolean(b) => b.to_string(),
        toml::Value::Datetime(d) => d.to_string(),
        toml::Value::Array(_) | toml::Value::Table(_) => String::new(),
    }
}

fn value_to_i64(v: &toml::Value) -> Result<i64, String> {
    match v {
        toml::Value::Integer(i) => Ok(*i),
        toml::Value::Float(f) => Ok(*f as i64),
        toml::Value::String(s) => s.trim().parse::<i64>().map_err(|e| e.to_string()),
        _ => Err("expected an integer".to_string()),
    }
}

fn compile_regex_list(raw: &toml::Table, key: &str) -> Result<Vec<Regex>, String> {
    let Some(arr) = raw.get(key).and_then(toml::Value::as_array) else {
        return Ok(Vec::new());
    };
    arr.iter()
        .map(|v| Regex::new(&value_to_string(v)).map_err(|e| e.to_string()))
        .collect()
}

fn compile_gate_list(raw: &toml::Table, key: &str) -> Result<Vec<Gate>, String> {
    let Some(arr) = raw.get(key).and_then(toml::Value::as_array) else {
        return Ok(Vec::new());
    };
    arr.iter()
        .map(|v| {
            v.as_table()
                .ok_or_else(|| format!("{key} entries must be tables"))
                .and_then(compile_gate)
        })
        .collect()
}

fn compile_gate(raw: &toml::Table) -> Result<Gate, String> {
    let contains = raw
        .get("contains")
        .and_then(toml::Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|v| value_to_string(v).to_lowercase())
                .collect()
        })
        .unwrap_or_default();
    Ok(Gate {
        contains,
        regex: compile_regex_list(raw, "regex")?,
        line_regex: compile_regex_list(raw, "line_regex")?,
        all_gates: compile_gate_list(raw, "all")?,
        any_gates: compile_gate_list(raw, "any")?,
        not_gates: compile_gate_list(raw, "not")?,
    })
}

/// パース + コンパイルし、エンジンバージョンを検証する。
///
/// `require_remote_fields=true`（リモート由来）では herdr と同じく version と
/// min_engine_version を必須にする（バージョン比較・互換判定に必要なため）。
fn compile_manifest(
    raw: &toml::Table,
    source: &str,
    require_remote_fields: bool,
) -> Result<Manifest, String> {
    let version = raw
        .get("version")
        .map(|v| parse_manifest_version(&value_to_string(v)))
        .transpose()?;
    let min_engine_version = raw
        .get("min_engine_version")
        .map(value_to_i64)
        .transpose()?;
    if require_remote_fields {
        if version.is_none() {
            return Err("remote manifest must include version".to_string());
        }
        if min_engine_version.is_none() {
            return Err("remote manifest must include min_engine_version".to_string());
        }
    }
    if let Some(min_engine) = min_engine_version {
        if min_engine > ENGINE_VERSION {
            return Err(format!(
                "manifest requires engine {min_engine}, current engine is {ENGINE_VERSION}"
            ));
        }
    }
    let mut rules = Vec::new();
    if let Some(raw_rules) = raw.get("rules").and_then(toml::Value::as_array) {
        for raw_rule in raw_rules {
            let table = raw_rule.as_table().ok_or("rule must be a table")?;
            rules.push(Rule {
                id: table.get("id").map(value_to_string).unwrap_or_default(),
                state: table
                    .get("state")
                    .map(value_to_string)
                    .unwrap_or_else(|| STATE_UNKNOWN.to_string()),
                priority: table
                    .get("priority")
                    .map(value_to_i64)
                    .transpose()?
                    .unwrap_or(0),
                region: table
                    .get("region")
                    .map(value_to_string)
                    .unwrap_or_else(|| "whole_recent".to_string())
                    .trim()
                    .to_string(),
                skip_state_update: table
                    .get("skip_state_update")
                    .and_then(toml::Value::as_bool)
                    .unwrap_or(false),
                gate: compile_gate(table)?,
            });
        }
    }
    let id = raw.get("id").map(value_to_string).unwrap_or_default();
    let aliases = raw
        .get("aliases")
        .and_then(toml::Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|v| value_to_string(v).to_lowercase())
                .collect()
        })
        .unwrap_or_default();
    Ok(Manifest {
        id,
        aliases,
        rules,
        version,
        min_engine_version,
        source: source.to_string(),
    })
}

/// TOML 文字列からマニフェストを構築する（manifest_update 相当のリモート検証にも使う）。
pub fn parse_manifest_text(
    content: &str,
    source: &str,
    require_remote_fields: bool,
) -> Result<Manifest, String> {
    let raw: toml::Table = content
        .parse()
        .map_err(|e: toml::de::Error| e.to_string())?;
    let manifest = compile_manifest(&raw, source, require_remote_fields)?;
    if manifest.id.is_empty() {
        return Err("manifest is missing id".to_string());
    }
    Ok(manifest)
}

// ─── 階層解決・キャッシュ付きロード ─────────────────────────────────────────

/// `embed-assets` feature（バイナリ配布ビルド専用）有効時、`agent_manifests/`
/// をコンパイル時にバイナリへ焼き込む。ディスク上に`manifest_dir`が無い/空の
/// 場合のみ使われるフォールバック。
#[cfg(feature = "embed-assets")]
static EMBEDDED_MANIFESTS: include_dir::Dir<'_> =
    include_dir::include_dir!("$CARGO_MANIFEST_DIR/../agent_manifests");

/// マニフェストの解決（同梱 + override + リモートキャッシュ）と TTL キャッシュを持つ。
///
/// `manifest_dir` は同梱データ（`agent_manifests/`）、`data_dir` から
/// override / remote の保存先を導出する（`DATA_DIR` 配下 = E2E 隔離対象）。
pub struct ManifestStore {
    manifest_dir: PathBuf,
    override_dir: PathBuf,
    remote_dir: PathBuf,
    ttl: Duration,
    cache: Mutex<Option<(Instant, Vec<Arc<Manifest>>)>>,
}

impl ManifestStore {
    pub fn new(manifest_dir: PathBuf, data_dir: &Path) -> Self {
        let override_dir = data_dir.join("agent-detection");
        let remote_dir = override_dir.join("remote");
        Self {
            manifest_dir,
            override_dir,
            remote_dir,
            ttl: Duration::from_secs(SCREEN_MANIFEST_CACHE_TTL_SEC),
            cache: Mutex::new(None),
        }
    }

    /// remote 層のマニフェスト保存先（manifest_update の書き込み先と共有）。
    pub(crate) fn remote_manifest_path(&self, agent_id: &str) -> PathBuf {
        self.remote_dir.join(format!("{agent_id}.toml"))
    }

    /// `data/agent-detection/` 配下の親ディレクトリ（manifest_update の
    /// `status.json` 保存先と共有 — Python の `REMOTE_DIR.parent` 相当）。
    pub(crate) fn override_dir(&self) -> &Path {
        &self.override_dir
    }

    fn override_manifest_path(&self, agent_id: &str) -> PathBuf {
        self.override_dir.join(format!("{agent_id}.toml"))
    }

    /// remote / override の 1 階層を読み込む。無い・壊れている場合は None。
    fn load_layer(
        path: &Path,
        bundled_id: &str,
        source: &str,
        require_remote_fields: bool,
    ) -> Option<Manifest> {
        if !path.is_file() {
            return None;
        }
        let content = std::fs::read_to_string(path).ok()?;
        match parse_manifest_text(&content, source, require_remote_fields) {
            Ok(manifest) if manifest.id == bundled_id => Some(manifest),
            Ok(manifest) => {
                tracing::warn!(
                    "ignored {source} manifest {}: id {:?} does not match {bundled_id:?}",
                    path.display(),
                    manifest.id
                );
                None
            }
            Err(e) => {
                tracing::warn!("ignored {source} manifest {}: {e}", path.display());
                None
            }
        }
    }

    /// 同梱 1 ファイル分の生テキストを起点に override > remote > bundled の
    /// 順で解決する（生テキストの取得元はディスク・バイナリ埋め込みのどちらでも
    /// 同じ処理にかけられるよう、パスではなくテキストを受け取る）。
    fn load_layered_manifest(&self, source_label: &str, content: &str) -> Option<Manifest> {
        let bundled = match parse_manifest_text(content, "bundled", false) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("screen manifest load failed source={source_label}: {e}");
                return None;
            }
        };

        let mut resolved = bundled.clone();
        let remote_path = self.remote_manifest_path(&bundled.id);
        if let Some(remote) = Self::load_layer(&remote_path, &bundled.id, "remote", true) {
            let ignore_remote = match (&bundled.version, &remote.version) {
                (Some(bv), Some(rv)) => compare_manifest_versions(rv, bv) < 0,
                _ => false,
            };
            if ignore_remote {
                tracing::info!(
                    "ignored remote manifest {}: cached version is older than bundled",
                    remote_path.display()
                );
            } else {
                resolved = remote;
            }
        }

        let override_path = self.override_manifest_path(&bundled.id);
        if let Some(over) = Self::load_layer(&override_path, &bundled.id, "override", false) {
            resolved = over;
        }

        Some(resolved)
    }

    /// 全エージェントのマニフェストを階層解決して返す（TTL キャッシュ付き）。
    pub fn load_manifests(&self) -> Vec<Arc<Manifest>> {
        {
            let cache = self.cache.lock().expect("manifest cache lock poisoned");
            if let Some((ts, manifests)) = cache.as_ref() {
                if ts.elapsed() < self.ttl {
                    return manifests.clone();
                }
            }
        }
        let sources = self.bundled_manifest_sources();
        let manifests: Vec<Arc<Manifest>> = sources
            .iter()
            .filter_map(|(label, content)| self.load_layered_manifest(label, content))
            .map(Arc::new)
            .collect();
        *self.cache.lock().expect("manifest cache lock poisoned") =
            Some((Instant::now(), manifests.clone()));
        manifests
    }

    /// 同梱マニフェストの (表示用ラベル, TOML生テキスト) 一覧をファイル名昇順で
    /// 返す。ディスク（`manifest_dir`）を優先し、1件も見つからなければ
    /// （`embed-assets` 有効時のみ）バイナリに埋め込まれたコピーへ
    /// フォールバックする（git clone開発フローはディスクが常に非空なので
    /// この分岐を通らない）。
    fn bundled_manifest_sources(&self) -> Vec<(String, String)> {
        let mut paths: Vec<PathBuf> = std::fs::read_dir(&self.manifest_dir)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("toml"))
            .collect();
        if !paths.is_empty() {
            paths.sort();
            return paths
                .iter()
                .filter_map(|p| {
                    let label = p.display().to_string();
                    let content = std::fs::read_to_string(p).ok()?;
                    Some((label, content))
                })
                .collect();
        }
        #[cfg(feature = "embed-assets")]
        {
            let mut entries: Vec<(String, String)> = EMBEDDED_MANIFESTS
                .files()
                .filter(|f| f.path().extension().and_then(|s| s.to_str()) == Some("toml"))
                .filter_map(|f| {
                    let label = format!("embedded:{}", f.path().display());
                    let content = String::from_utf8(f.contents().to_vec()).ok()?;
                    Some((label, content))
                })
                .collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            entries
        }
        #[cfg(not(feature = "embed-assets"))]
        Vec::new()
    }

    /// リモート更新のコミット後などに階層解決キャッシュを破棄する。
    pub fn invalidate_manifest_cache(&self) {
        *self.cache.lock().expect("manifest cache lock poisoned") = None;
    }

    fn lookup_manifest(&self, name: &str) -> Option<Arc<Manifest>> {
        self.load_manifests()
            .into_iter()
            .find(|m| m.id == name || m.aliases.iter().any(|a| a == name))
    }

    /// tmux の `#{pane_current_command}` からエージェントのマニフェストを特定する。
    pub fn identify_agent(&self, pane_command: Option<&str>) -> Option<Arc<Manifest>> {
        let pane_command = pane_command?;
        if pane_command.is_empty() {
            return None;
        }
        let name = normalized_basename(pane_command);
        if name.is_empty() {
            return None;
        }
        self.lookup_manifest(&name)
    }

    /// 前面プロセスグループの argv 一覧からエージェントを特定する。
    ///
    /// プロセス名（`#{pane_current_command}`）で特定できないラッパー起動
    /// （node スクリプト・`sh -c` 等）向けのフォールバック。最初に一致した
    /// プロセスのマニフェストを返す。
    pub fn identify_agent_from_argvs(&self, argvs: &[Vec<String>]) -> Option<Arc<Manifest>> {
        for argv in argvs {
            let Some(first) = argv.first() else {
                continue;
            };
            let argv0 = normalized_basename(first);
            let mut candidates = vec![argv0.clone()];
            if RUNTIME_NAMES.contains(&argv0.as_str()) {
                if let Some(script) = runtime_script_name(argv) {
                    candidates.push(script);
                }
            } else if SHELL_NAMES.contains(&argv0.as_str()) {
                if let Some(command) = shell_command_name(argv) {
                    candidates.push(command);
                }
            }
            for name in &candidates {
                if let Some(manifest) = self.lookup_manifest(name) {
                    return Some(manifest);
                }
            }
        }
        None
    }
}

/// パス・引用符・既知の拡張子を落とした照合用の名前を返す。
fn normalized_basename(token: &str) -> String {
    let trimmed = token.trim_matches(|c| c == '"' || c == '\'');
    let replaced = trimmed.replace('\\', "/");
    let last = replaced.rsplit('/').next().unwrap_or(&replaced);
    let name = last.to_lowercase();
    for ext in [".js", ".mjs", ".cjs", ".py", ".exe", ".cmd"] {
        if let Some(stripped) = name.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    name
}

// ランタイム・シェル経由の起動（`node /path/claude` 等）でエージェント名が
// argv の後方に来るもの。herdr の wrapped_agent_name_from_runtime_argv の
// Linux / macOS 向けサブセット。
const RUNTIME_NAMES: &[&str] = &["node", "bun", "deno", "python", "python2", "python3"];
const SHELL_NAMES: &[&str] = &["sh", "bash", "zsh", "fish"];
// これらのフラグが来たらスクリプト実行ではない（インライン評価）ので諦める
const RUNTIME_EVAL_FLAGS: &[&str] = &["-e", "--eval", "-p", "--print", "-c", "-m"];
// 値を取るフラグ（次の引数をスクリプト名と誤認しないためスキップする）
const RUNTIME_VALUE_FLAGS: &[&str] = &[
    "-r",
    "--require",
    "--loader",
    "--import",
    "--experimental-loader",
];

/// ランタイム argv からスクリプト名（正規化済み basename）を取り出す。
fn runtime_script_name(argv: &[String]) -> Option<String> {
    let mut i = 1;
    while i < argv.len() {
        let arg = argv[i].as_str();
        if arg == "--" {
            return argv.get(i + 1).map(|s| normalized_basename(s));
        }
        if RUNTIME_EVAL_FLAGS.contains(&arg) {
            return None;
        }
        if arg.starts_with('-') {
            if RUNTIME_VALUE_FLAGS.contains(&arg) {
                i += 1;
            }
            i += 1;
            continue;
        }
        return Some(normalized_basename(arg));
    }
    None
}

/// `sh -c 'claude ...'` 形式からコマンド名を取り出す。
fn shell_command_name(argv: &[String]) -> Option<String> {
    for (i, arg) in argv.iter().enumerate().skip(1) {
        if arg == "-c" && i + 1 < argv.len() {
            let tokens: Vec<&str> = argv[i + 1].split_whitespace().collect();
            return tokens.first().map(|t| normalized_basename(t));
        }
    }
    None
}

// ─── リージョン切り出し（herdr manifest.rs の移植） ─────────────────────────

/// Rust の `str::lines()` 相当（末尾改行後の空要素を作らず、`\r` を除去）。
fn split_lines(text: &str) -> Vec<&str> {
    let mut raw: Vec<&str> = text.split('\n').collect();
    if raw.last() == Some(&"") {
        raw.pop();
    }
    raw.into_iter()
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

pub fn is_horizontal_rule(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let mut rule_chars = 0usize;
    for ch in trimmed.chars() {
        if ch == '─' {
            rule_chars += 1;
        } else {
            break;
        }
    }
    if rule_chars == 0 {
        return false;
    }
    let suffix: String = trimmed.chars().skip(rule_chars).collect();
    let suffix = suffix.trim_start();
    suffix.is_empty() || rule_chars >= 3
}

fn bottom_non_empty_lines(lines: &[&str], count: usize) -> String {
    let mut start: Option<usize> = None;
    let mut remaining = count;
    for i in (0..lines.len()).rev() {
        if !lines[i].trim().is_empty() {
            start = Some(i);
            remaining = remaining.saturating_sub(1);
            if remaining == 0 {
                break;
            }
        }
    }
    match start {
        Some(start) => lines[start..].join("\n"),
        None => String::new(),
    }
}

fn after_last_horizontal_rule(lines: &[&str]) -> String {
    let mut last: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if is_horizontal_rule(line) {
            last = Some(i);
        }
    }
    let start = last.map(|i| i + 1).unwrap_or(0);
    lines[start..].join("\n")
}

fn prompt_box_top_border_index(lines: &[&str]) -> Option<usize> {
    let mut border_count = 0;
    for i in (0..lines.len()).rev() {
        if is_horizontal_rule(lines[i]) {
            border_count += 1;
            if border_count == 2 {
                return Some(i);
            }
        }
    }
    None
}

fn prompt_box_body(lines: &[&str]) -> String {
    let Some(top) = prompt_box_top_border_index(lines) else {
        return String::new();
    };
    let mut end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(top + 1) {
        if is_horizontal_rule(line) {
            end = i;
            break;
        }
    }
    lines[top + 1..end].join("\n")
}

fn codex_prompt_line(line: &str) -> bool {
    line == "›" || line.starts_with("› ")
}

fn after_last_prompt_marker(lines: &[&str], content: &str) -> String {
    let mut index = None;
    for i in (0..lines.len()).rev() {
        if codex_prompt_line(lines[i]) {
            index = Some(i);
            break;
        }
    }
    match index {
        Some(index) => lines[index + 1..].join("\n"),
        None => content.to_string(),
    }
}

fn bottom_lines(lines: &[&str], count: usize) -> String {
    let start = lines.len().saturating_sub(count);
    lines[start..].join("\n")
}

fn top_non_empty_lines(lines: &[&str], count: usize) -> String {
    let mut end: Option<usize> = None;
    let mut remaining = count;
    for (i, line) in lines.iter().enumerate() {
        if !line.trim().is_empty() {
            end = Some(i);
            remaining = remaining.saturating_sub(1);
            if remaining == 0 {
                break;
            }
        }
    }
    match end {
        Some(end) => lines[..=end].join("\n"),
        None => String::new(),
    }
}

fn region_count_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(bottom_non_empty_lines|bottom_lines|top_non_empty_lines)\((\d+)\)$")
            .expect("valid regex")
    })
}

/// ルールの region 指定に対応するテキストを返す。未実装リージョンは空文字。
pub fn region_text(region: &str, screen: &str, osc_title: &str, osc_progress: &str) -> String {
    match region {
        "osc_title" => return osc_title.to_string(),
        "osc_progress" => return osc_progress.to_string(),
        "whole_recent" => return screen.to_string(),
        _ => {}
    }
    let lines = split_lines(screen);
    match region {
        "after_last_horizontal_rule" => return after_last_horizontal_rule(&lines),
        "prompt_box_body" => return prompt_box_body(&lines),
        "after_last_prompt_marker" => return after_last_prompt_marker(&lines, screen),
        _ => {}
    }
    if let Some(caps) = region_count_re().captures(region) {
        let count: usize = caps[2].parse().unwrap_or(0);
        return match &caps[1] {
            "bottom_non_empty_lines" => bottom_non_empty_lines(&lines, count),
            "bottom_lines" => bottom_lines(&lines, count),
            _ => top_non_empty_lines(&lines, count),
        };
    }
    String::new()
}

// ─── ゲート評価 ──────────────────────────────────────────────────────────────

fn gate_matches(gate: &Gate, text: &str, lower_text: &str) -> bool {
    if !gate
        .contains
        .iter()
        .all(|needle| lower_text.contains(needle.as_str()))
    {
        return false;
    }
    if !gate.regex.iter().all(|re| re.is_match(text)) {
        return false;
    }
    if !gate.line_regex.is_empty() {
        let lines = split_lines(text);
        if !gate
            .line_regex
            .iter()
            .all(|re| lines.iter().any(|line| re.is_match(line)))
        {
            return false;
        }
    }
    if !gate
        .all_gates
        .iter()
        .all(|g| gate_matches(g, text, lower_text))
    {
        return false;
    }
    if !gate.any_gates.is_empty()
        && !gate
            .any_gates
            .iter()
            .any(|g| gate_matches(g, text, lower_text))
    {
        return false;
    }
    if gate
        .not_gates
        .iter()
        .any(|g| gate_matches(g, text, lower_text))
    {
        return false;
    }
    true
}

/// マニフェストを評価して状態文字列を返す。確定できない場合は None。
pub fn evaluate_state(
    manifest: &Manifest,
    screen: &str,
    osc_title: &str,
    osc_progress: &str,
) -> Option<String> {
    let mut best: Option<&Rule> = None;
    for rule in &manifest.rules {
        let text = region_text(&rule.region, screen, osc_title, osc_progress);
        let lower = text.to_lowercase();
        if !gate_matches(&rule.gate, &text, &lower) {
            continue;
        }
        if best.map(|b| rule.priority > b.priority).unwrap_or(true) {
            best = Some(rule);
        }
    }
    match best {
        None => None,
        Some(rule) if rule.skip_state_update => None,
        Some(rule) => Some(rule.state.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(contains: &[&str]) -> Gate {
        Gate {
            contains: contains.iter().map(|s| s.to_string()).collect(),
            ..Gate::default()
        }
    }

    fn rule(state: &str, priority: i64, g: Gate) -> Rule {
        Rule {
            id: "r".to_string(),
            state: state.to_string(),
            priority,
            region: "whole_recent".to_string(),
            skip_state_update: false,
            gate: g,
        }
    }

    // ─── バージョン ─────────────────────────────────────────────────────

    #[test]
    fn parse_dotted_numeric() {
        assert_eq!(
            parse_manifest_version("2026.08.04.1").unwrap(),
            vec![2026, 8, 4, 1]
        );
    }

    #[test]
    fn parse_rejects_non_numeric() {
        assert!(parse_manifest_version("1.2a").is_err());
        assert!(parse_manifest_version("").is_err());
        assert!(parse_manifest_version("1..2").is_err());
    }

    #[test]
    fn compare_pads_trailing_zeros() {
        assert_eq!(compare_manifest_versions(&[1, 2], &[1, 2, 0]), 0);
        assert_eq!(compare_manifest_versions(&[1, 2, 1], &[1, 2]), 1);
        assert_eq!(compare_manifest_versions(&[1, 2], &[1, 10]), -1);
    }

    // ─── native Rust regex 記法（\x{...} braced hex, \p{Alphabetic}）確認 ──

    #[test]
    fn rust_regex_syntax_needs_no_translation() {
        let re = Regex::new(r"^[\x{2800}-\x{28FF}] ").unwrap();
        assert!(re.is_match("⠋ Thinking"));
        let re2 = Regex::new(r"\p{Alphabetic}+ing\b").unwrap();
        assert!(re2.is_match("Thinking"));
    }

    // ─── is_horizontal_rule ──────────────────────────────────────────────

    #[test]
    fn rule_line() {
        assert!(is_horizontal_rule("────────"));
    }

    #[test]
    fn rule_with_suffix_needs_three_chars() {
        assert!(is_horizontal_rule("─── title"));
        assert!(!is_horizontal_rule("─ title"));
    }

    #[test]
    fn non_rule_lines() {
        assert!(!is_horizontal_rule(""));
        assert!(!is_horizontal_rule("  hello"));
    }

    // ─── region_text ─────────────────────────────────────────────────────

    #[test]
    fn whole_recent_returns_screen() {
        assert_eq!(region_text("whole_recent", "a\nb", "t", "p"), "a\nb");
    }

    #[test]
    fn osc_regions_use_dedicated_inputs() {
        assert_eq!(region_text("osc_title", "screen", "title", "prog"), "title");
        assert_eq!(
            region_text("osc_progress", "screen", "title", "prog"),
            "prog"
        );
    }

    #[test]
    fn bottom_non_empty_lines_includes_trailing_blanks() {
        let screen = "one\ntwo\n\nthree\n\n";
        assert_eq!(
            region_text("bottom_non_empty_lines(2)", screen, "", ""),
            "two\n\nthree\n"
        );
    }

    #[test]
    fn bottom_non_empty_lines_empty_screen() {
        assert_eq!(region_text("bottom_non_empty_lines(3)", "\n\n", "", ""), "");
    }

    #[test]
    fn after_last_horizontal_rule_test() {
        let screen = "output\n────\nprompt line\nmore";
        assert_eq!(
            region_text("after_last_horizontal_rule", screen, "", ""),
            "prompt line\nmore"
        );
    }

    #[test]
    fn after_last_horizontal_rule_without_rule_returns_all() {
        assert_eq!(
            region_text("after_last_horizontal_rule", "a\nb", "", ""),
            "a\nb"
        );
    }

    #[test]
    fn prompt_box_body_between_borders() {
        let screen = "output\n────\n❯ draft text\n────\nhint";
        assert_eq!(
            region_text("prompt_box_body", screen, "", ""),
            "❯ draft text"
        );
    }

    #[test]
    fn prompt_box_body_requires_two_borders() {
        assert_eq!(region_text("prompt_box_body", "────\ntext", "", ""), "");
    }

    #[test]
    fn after_last_prompt_marker_test() {
        let screen = "old\n› question\nanswer area";
        assert_eq!(
            region_text("after_last_prompt_marker", screen, "", ""),
            "answer area"
        );
    }

    #[test]
    fn after_last_prompt_marker_without_marker_returns_all() {
        assert_eq!(
            region_text("after_last_prompt_marker", "a\nb", "", ""),
            "a\nb"
        );
    }

    #[test]
    fn top_non_empty_lines_includes_leading_blanks() {
        let screen = "\nfirst\nsecond\nthird";
        assert_eq!(
            region_text("top_non_empty_lines(2)", screen, "", ""),
            "\nfirst\nsecond"
        );
    }

    #[test]
    fn top_non_empty_lines_empty_screen() {
        assert_eq!(region_text("top_non_empty_lines(1)", "\n\n", "", ""), "");
    }

    #[test]
    fn bottom_lines_counts_raw_lines() {
        assert_eq!(region_text("bottom_lines(2)", "a\nb\nc\n", "", ""), "b\nc");
    }

    #[test]
    fn unknown_region_is_empty() {
        assert_eq!(region_text("osc_hyperlink", "screen", "t", "p"), "");
    }

    // ─── gate_matches ────────────────────────────────────────────────────

    #[test]
    fn contains_is_case_insensitive_and() {
        let g = gate(&["do you want", "esc to cancel"]);
        assert!(gate_matches(
            &g,
            "Do you WANT to proceed? esc to cancel",
            "do you want to proceed? esc to cancel"
        ));
        assert!(!gate_matches(
            &g,
            "Do you want to proceed?",
            "do you want to proceed?"
        ));
    }

    #[test]
    fn line_regex_requires_some_line_per_pattern() {
        let g = Gate {
            line_regex: vec![Regex::new(r"^\s*❯").unwrap()],
            ..Gate::default()
        };
        assert!(gate_matches(&g, "output\n  ❯ 1. Yes", "output\n  ❯ 1. yes"));
        assert!(!gate_matches(&g, "output ❯ inline", "output ❯ inline"));
    }

    #[test]
    fn any_is_or() {
        let g = Gate {
            any_gates: vec![gate(&["aaa"]), gate(&["bbb"])],
            ..Gate::default()
        };
        assert!(gate_matches(&g, "xx bbb yy", "xx bbb yy"));
        assert!(!gate_matches(&g, "xx yy", "xx yy"));
    }

    #[test]
    fn not_rejects() {
        let g = Gate {
            contains: vec!["yes".to_string()],
            not_gates: vec![gate(&["never"])],
            ..Gate::default()
        };
        assert!(gate_matches(&g, "yes", "yes"));
        assert!(!gate_matches(&g, "yes never", "yes never"));
    }

    // ─── evaluate_state ──────────────────────────────────────────────────

    #[test]
    fn highest_priority_wins() {
        let manifest = Manifest {
            id: "x".to_string(),
            aliases: vec![],
            rules: vec![
                rule("idle", 100, gate(&["a"])),
                rule("blocked", 200, gate(&["a"])),
            ],
            version: None,
            min_engine_version: None,
            source: "bundled".to_string(),
        };
        assert_eq!(
            evaluate_state(&manifest, "a", "", "").as_deref(),
            Some("blocked")
        );
    }

    #[test]
    fn equal_priority_keeps_first() {
        let manifest = Manifest {
            id: "x".to_string(),
            aliases: vec![],
            rules: vec![
                rule("idle", 100, gate(&["a"])),
                rule("blocked", 100, gate(&["a"])),
            ],
            version: None,
            min_engine_version: None,
            source: "bundled".to_string(),
        };
        assert_eq!(
            evaluate_state(&manifest, "a", "", "").as_deref(),
            Some("idle")
        );
    }

    #[test]
    fn skip_state_update_returns_none() {
        let mut skip_rule = rule("unknown", 200, gate(&["a"]));
        skip_rule.skip_state_update = true;
        let manifest = Manifest {
            id: "x".to_string(),
            aliases: vec![],
            rules: vec![rule("blocked", 100, gate(&["a"])), skip_rule],
            version: None,
            min_engine_version: None,
            source: "bundled".to_string(),
        };
        assert_eq!(evaluate_state(&manifest, "a", "", ""), None);
    }

    #[test]
    fn no_match_returns_none() {
        let manifest = Manifest {
            id: "x".to_string(),
            aliases: vec![],
            rules: vec![rule("blocked", 100, gate(&["missing"]))],
            version: None,
            min_engine_version: None,
            source: "bundled".to_string(),
        };
        assert_eq!(evaluate_state(&manifest, "other text", "", ""), None);
    }

    // ─── 同梱マニフェスト（実ファイル）───────────────────────────────────

    fn bundled_manifest_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../agent_manifests")
    }

    fn bundled_store() -> (ManifestStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let store = ManifestStore::new(bundled_manifest_dir(), dir.path());
        (store, dir)
    }

    #[test]
    fn claude_and_codex_load() {
        let (store, _dir) = bundled_store();
        let ids: std::collections::HashSet<String> = store
            .load_manifests()
            .iter()
            .map(|m| m.id.clone())
            .collect();
        assert!(ids.contains("claude"));
        assert!(ids.contains("codex"));
    }

    #[test]
    fn all_bundled_manifests_load_without_duplicate_ids() {
        let (store, _dir) = bundled_store();
        let toml_count = std::fs::read_dir(bundled_manifest_dir())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("toml"))
            .count();
        let manifests = store.load_manifests();
        assert_eq!(manifests.len(), toml_count);
        let ids: std::collections::HashSet<&str> =
            manifests.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids.len(), manifests.len(), "duplicate manifest ids");
    }

    #[test]
    fn all_rules_use_supported_regions_and_states() {
        const SUPPORTED_REGIONS: &[&str] = &[
            "whole_recent",
            "after_last_horizontal_rule",
            "prompt_box_body",
            "after_last_prompt_marker",
            "osc_title",
            "osc_progress",
        ];
        const KNOWN_STATES: &[&str] = &["working", "idle", "blocked", "unknown"];
        let (store, _dir) = bundled_store();
        for manifest in store.load_manifests() {
            for rule in &manifest.rules {
                assert!(
                    SUPPORTED_REGIONS.contains(&rule.region.as_str())
                        || region_count_re().is_match(&rule.region),
                    "{}:{} uses unsupported region {}",
                    manifest.id,
                    rule.id,
                    rule.region
                );
                assert!(
                    KNOWN_STATES.contains(&rule.state.as_str()),
                    "{}:{} has unknown state {}",
                    manifest.id,
                    rule.id,
                    rule.state
                );
            }
        }
    }

    #[test]
    fn identify_agent_from_argvs_test() {
        let (store, _dir) = bundled_store();
        let s = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // 直接起動
        assert_eq!(
            store
                .identify_agent_from_argvs(&[s(&["claude", "--continue"])])
                .map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        // ランタイムラッパー（node スクリプト・フラグ・拡張子付き）
        assert_eq!(
            store
                .identify_agent_from_argvs(&[s(&["node", "/usr/lib/node_modules/claude"])])
                .map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        assert_eq!(
            store
                .identify_agent_from_argvs(&[s(&["node", "--require", "x.js", "/y/claude.js"])])
                .map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        assert_eq!(
            store
                .identify_agent_from_argvs(&[s(&["python3", "/opt/codex"])])
                .map(|m| m.id.clone()),
            Some("codex".to_string())
        );
        // シェル -c 形式
        assert_eq!(
            store
                .identify_agent_from_argvs(&[s(&["zsh", "-c", "claude --continue"])])
                .map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        // グループ内のいずれかのプロセスが一致すればよい
        assert_eq!(
            store
                .identify_agent_from_argvs(&[s(&["npm", "run", "x"]), s(&["node", "/a/claude"])])
                .map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        // インライン評価は特定しない
        assert!(store
            .identify_agent_from_argvs(&[s(&["node", "-e", "claude"])])
            .is_none());
        // 非一致・空
        assert!(store
            .identify_agent_from_argvs(&[s(&["vim", "notes.md"])])
            .is_none());
        assert!(store.identify_agent_from_argvs(&[]).is_none());
        assert!(store.identify_agent_from_argvs(&[vec![]]).is_none());
    }

    #[test]
    fn identify_agent_test() {
        let (store, _dir) = bundled_store();
        assert_eq!(
            store.identify_agent(Some("claude")).map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        assert_eq!(
            store
                .identify_agent(Some("claude-code"))
                .map(|m| m.id.clone()),
            Some("claude".to_string())
        );
        assert_eq!(
            store
                .identify_agent(Some("/usr/local/bin/codex"))
                .map(|m| m.id.clone()),
            Some("codex".to_string())
        );
        assert_eq!(
            store.identify_agent(Some("Codex")).map(|m| m.id.clone()),
            Some("codex".to_string())
        );
        assert!(store.identify_agent(Some("bash")).is_none());
        assert!(store.identify_agent(Some("")).is_none());
        assert!(store.identify_agent(None).is_none());
    }

    #[test]
    fn claude_permission_prompt_is_blocked() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen = "Running command...\n\
             ──────────────────────────────\n\
             Do you want to proceed?\n\
             ❯ 1. Yes\n  2. No\nesc to cancel\n";
        assert_eq!(
            evaluate_state(&claude, screen, "", "").as_deref(),
            Some("blocked")
        );
    }

    #[test]
    fn claude_prompt_box_is_idle() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen = "Some previous output\n\
             ──────────────────────────────\n\
             ❯ \n\
             ──────────────────────────────\n\
             \x20\x20? for shortcuts\n";
        assert_eq!(
            evaluate_state(&claude, screen, "", "").as_deref(),
            Some("idle")
        );
    }

    #[test]
    fn claude_model_picker_is_guarded() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        let screen =
            "Select Model\n❯ 1. Sonnet\n  2. Opus\nEnter to set as default · esc to cancel\n";
        assert_eq!(evaluate_state(&claude, screen, "", ""), None);
    }

    #[test]
    fn claude_osc_title_spinner_is_working() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(
            evaluate_state(&claude, "", "⠋ Thinking...", "").as_deref(),
            Some("working")
        );
    }

    #[test]
    fn codex_confirm_prompt_is_blocked() {
        let (store, _dir) = bundled_store();
        let codex = store.identify_agent(Some("codex")).unwrap();
        let screen = "Apply this patch?\nPress Enter to confirm or Esc to cancel\n";
        assert_eq!(
            evaluate_state(&codex, screen, "", "").as_deref(),
            Some("blocked")
        );
    }

    #[test]
    fn codex_osc_title_action_required_is_blocked() {
        let (store, _dir) = bundled_store();
        let codex = store.identify_agent(Some("codex")).unwrap();
        assert_eq!(
            evaluate_state(&codex, "", "Action Required: approve", "").as_deref(),
            Some("blocked")
        );
    }

    #[test]
    fn plain_shell_screen_has_no_state() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(evaluate_state(&claude, "$ ls\nREADME.md\n$ ", "", ""), None);
    }

    // ─── 階層解決（override > remote > bundled）───────────────────────────

    const OVERRIDE_MANIFEST: &str = "id = \"claude\"\n[[rules]]\nid = \"custom\"\nstate = \"blocked\"\npriority = 10\nregion = \"whole_recent\"\ncontains = [\"my custom marker\"]\n";
    const REMOTE_MANIFEST: &str = "id = \"claude\"\nversion = \"9999.1.1\"\nmin_engine_version = 2\n[[rules]]\nid = \"remote_rule\"\nstate = \"blocked\"\npriority = 10\nregion = \"whole_recent\"\ncontains = [\"remote marker\"]\n";

    fn write(dir: &Path, name: &str, content: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn bundled_is_default_source() {
        let (store, _dir) = bundled_store();
        let claude = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(claude.source, "bundled");
    }

    #[test]
    fn override_wins() {
        let (store, dir) = bundled_store();
        write(
            &dir.path().join("agent-detection"),
            "claude.toml",
            OVERRIDE_MANIFEST,
        );
        store.invalidate_manifest_cache();
        let manifest = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(manifest.source, "override");
        assert_eq!(
            evaluate_state(&manifest, "my custom marker", "", "").as_deref(),
            Some("blocked")
        );
    }

    #[test]
    fn remote_newer_than_bundled_wins() {
        let (store, dir) = bundled_store();
        write(
            &dir.path().join("agent-detection").join("remote"),
            "claude.toml",
            REMOTE_MANIFEST,
        );
        store.invalidate_manifest_cache();
        let manifest = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(manifest.source, "remote");
        assert_eq!(
            evaluate_state(&manifest, "remote marker", "", "").as_deref(),
            Some("blocked")
        );
    }

    #[test]
    fn remote_older_than_bundled_is_ignored() {
        let (store, dir) = bundled_store();
        let old = REMOTE_MANIFEST.replace("version = \"9999.1.1\"", "version = \"1.0.0\"");
        write(
            &dir.path().join("agent-detection").join("remote"),
            "claude.toml",
            &old,
        );
        store.invalidate_manifest_cache();
        assert_eq!(
            store.identify_agent(Some("claude")).unwrap().source,
            "bundled"
        );
    }

    #[test]
    fn override_beats_remote() {
        let (store, dir) = bundled_store();
        write(
            &dir.path().join("agent-detection").join("remote"),
            "claude.toml",
            REMOTE_MANIFEST,
        );
        write(
            &dir.path().join("agent-detection"),
            "claude.toml",
            OVERRIDE_MANIFEST,
        );
        store.invalidate_manifest_cache();
        assert_eq!(
            store.identify_agent(Some("claude")).unwrap().source,
            "override"
        );
    }

    #[test]
    fn broken_override_falls_back() {
        let (store, dir) = bundled_store();
        write(
            &dir.path().join("agent-detection"),
            "claude.toml",
            "not [valid toml",
        );
        store.invalidate_manifest_cache();
        assert_eq!(
            store.identify_agent(Some("claude")).unwrap().source,
            "bundled"
        );
    }

    #[test]
    fn override_with_wrong_id_falls_back() {
        let (store, dir) = bundled_store();
        let wrong = OVERRIDE_MANIFEST.replace("id = \"claude\"", "id = \"other\"");
        write(&dir.path().join("agent-detection"), "claude.toml", &wrong);
        store.invalidate_manifest_cache();
        assert_eq!(
            store.identify_agent(Some("claude")).unwrap().source,
            "bundled"
        );
    }

    #[test]
    fn remote_without_required_fields_is_ignored() {
        let (store, dir) = bundled_store();
        write(
            &dir.path().join("agent-detection").join("remote"),
            "claude.toml",
            OVERRIDE_MANIFEST,
        );
        store.invalidate_manifest_cache();
        assert_eq!(
            store.identify_agent(Some("claude")).unwrap().source,
            "bundled"
        );
    }

    #[test]
    fn cache_returns_same_until_invalidated() {
        let (store, dir) = bundled_store();
        assert_eq!(
            store.identify_agent(Some("claude")).unwrap().source,
            "bundled"
        );
        write(
            &dir.path().join("agent-detection"),
            "claude.toml",
            OVERRIDE_MANIFEST,
        );
        let cached = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(cached.source, "bundled");
        store.invalidate_manifest_cache();
        let fresh = store.identify_agent(Some("claude")).unwrap();
        assert_eq!(fresh.source, "override");
    }
}
