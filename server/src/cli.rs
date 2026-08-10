//! any-console-server の軽量CLIサブコマンド群。
//!
//! バイナリ配布では python3 の存在を前提にできないため、`./any-console`
//! ラッパースクリプトが以前 python3 で行っていた config.json 操作・
//! ワークスペース自動検出・AIエージェントjob登録・tailscaleホスト名取得・
//! 認証トークン生成を、このバイナリ自身のサブコマンドとして肩代わりする
//! （実行時に必要な外部依存を git・tmux・（macOSは任意で）tailscale だけにする）。
//!
//! `dispatch` はサブコマンドとして認識できた時だけ `Some(exit_code)` を返す。
//! 未認識の引数（0個含む）は `None` を返し、呼び出し元（main.rs）が通常の
//! サーバ起動へフォールバックする。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::config::ConfigStore;
use crate::paths::{
    collapse_user_path, expand_user_path, project_root_from_env, safe_resolve_str, Paths,
};

pub async fn dispatch(args: &[String]) -> Option<i32> {
    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            print_version();
            Some(0)
        }
        Some("config") => Some(cmd_config(&args[1..])),
        Some("workspaces") => Some(cmd_workspaces(&args[1..])),
        Some("jobs") => Some(cmd_jobs(&args[1..])),
        Some("tailscale") => Some(cmd_tailscale(&args[1..]).await),
        Some("auth") => Some(cmd_auth(&args[1..])),
        Some("paths") => Some(cmd_paths(&args[1..])),
        _ => None,
    }
}

fn print_version() {
    println!(
        "any-console-server {} ({})",
        env!("CARGO_PKG_VERSION"),
        env!("ANY_CONSOLE_GIT_SHA")
    );
}

fn usage_error(msg: &str) -> i32 {
    eprintln!("Error: {msg}");
    1
}

fn store_for_cwd() -> ConfigStore {
    let paths = Paths::from_env(project_root_from_env());
    ConfigStore::new(paths.config_file)
}

fn data_dir_for_cwd() -> PathBuf {
    Paths::from_env(project_root_from_env()).data_dir
}

// ─── config ─────────────────────────────────────────────────────────────

fn cmd_config(args: &[String]) -> i32 {
    let store = store_for_cwd();
    match args.first().map(String::as_str) {
        Some("get-port") => {
            println!("{}", store.resolve_bind().1);
            0
        }
        Some("get-host") => {
            println!("{}", store.resolve_bind().0);
            0
        }
        Some("get") => {
            let Some(key) = args.get(1) else {
                return usage_error("config get requires <key>");
            };
            match store.load_global_section(key) {
                Some(Value::String(s)) => println!("{s}"),
                Some(v) => println!("{v}"),
                None => println!(),
            }
            0
        }
        Some("set-bind") => {
            let (Some(host), Some(port_str)) = (args.get(1), args.get(2)) else {
                return usage_error("config set-bind requires <host> <port>");
            };
            let Ok(port) = port_str.parse::<u16>() else {
                return usage_error(&format!("invalid port: {port_str}"));
            };
            let host = host.clone();
            match store.with_exclusive(|cfg| {
                ConfigStore::merge_global_section(cfg, "host", Value::String(host.clone()));
                ConfigStore::merge_global_section(cfg, "port", Value::Number(port.into()));
                Ok(())
            }) {
                Ok(()) => 0,
                Err(e) => usage_error(&e.detail),
            }
        }
        Some("set-ssl") => {
            let (Some(cert), Some(key)) = (args.get(1), args.get(2)) else {
                return usage_error("config set-ssl requires <certfile> <keyfile>");
            };
            let (cert, key) = (cert.clone(), key.clone());
            match store.with_exclusive(|cfg| {
                ConfigStore::merge_global_section(cfg, "ssl_certfile", Value::String(cert.clone()));
                ConfigStore::merge_global_section(cfg, "ssl_keyfile", Value::String(key.clone()));
                Ok(())
            }) {
                Ok(()) => 0,
                Err(e) => usage_error(&e.detail),
            }
        }
        _ => usage_error("unknown config subcommand"),
    }
}

// ─── workspaces ─────────────────────────────────────────────────────────

fn cmd_workspaces(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("discover") => {
            discover_git_repos();
            0
        }
        Some("register") => cmd_workspaces_register(&args[1..]),
        _ => usage_error("unknown workspaces subcommand"),
    }
}

const DISCOVER_ROOT_NAMES: &[&str] = &[
    "ghq",
    "src",
    "code",
    "repos",
    "projects",
    "dev",
    "Developer",
    "git",
    "work",
];
const DISCOVER_SKIP_DIRS: &[&str] = &[
    "node_modules",
    "__pycache__",
    "venv",
    ".venv",
    "dist",
    "build",
    "vendor",
    "target",
    ".cache",
    "Library",
    "go",
];
const DISCOVER_LIMIT: usize = 40;

/// よくある開発ディレクトリを走査してgitリポジトリのパス一覧を1行1件で出す
/// （旧: any-console内のpython discover_git_repos()と同一の探索規則）。
fn discover_git_repos() {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return;
    };
    let mut roots: Vec<(PathBuf, usize)> = Vec::new();
    for name in DISCOVER_ROOT_NAMES {
        let d = home.join(name);
        if d.is_dir() {
            roots.push((d, 4));
        }
    }
    let go_src = home.join("go").join("src");
    if go_src.is_dir() {
        roots.push((go_src, 4));
    }
    roots.push((home, 2));

    let mut found: HashSet<String> = HashSet::new();
    for (root, max_depth) in roots {
        if found.len() >= DISCOVER_LIMIT {
            break;
        }
        let root = root.canonicalize().unwrap_or(root);
        walk_git_repos(&root, 0, max_depth, &mut found);
    }
    let mut list: Vec<String> = found.into_iter().collect();
    list.sort_by_key(|s| s.to_lowercase());
    for p in list {
        println!("{p}");
    }
}

fn walk_git_repos(dir: &Path, depth: usize, max_depth: usize, found: &mut HashSet<String>) {
    if found.len() >= DISCOVER_LIMIT {
        return;
    }
    if dir.join(".git").exists() {
        let resolved = dir
            .canonicalize()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| dir.to_string_lossy().into_owned());
        found.insert(resolved);
        return;
    }
    if depth >= max_depth {
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        if found.len() >= DISCOVER_LIMIT {
            return;
        }
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || DISCOVER_SKIP_DIRS.contains(&name.as_ref()) {
            continue;
        }
        walk_git_repos(&path, depth + 1, max_depth, found);
    }
}

/// 渡されたパス群をワークスペースとして登録する（パス重複・名前衝突を解決）。
/// 旧: any-console内のpython register_workspace_paths()と同一の重複解決規則。
fn cmd_workspaces_register(raw_paths: &[String]) -> i32 {
    let store = store_for_cwd();
    let mut existing = crate::git_utils::registered_paths_by_resolved(&store);
    let mut existing_names: HashSet<String> = existing.values().cloned().collect();
    let mut entries = store.list_workspace_entries();

    let mut added = Vec::new();
    for raw in raw_paths {
        let expanded = expand_user_path(raw);
        if !expanded.is_dir() {
            continue;
        }
        let resolved = safe_resolve_str(&expanded);
        if existing.contains_key(&resolved) {
            continue;
        }
        let base = Path::new(&resolved)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "workspace".to_string());
        let mut name = base.clone();
        let mut i = 2;
        while existing_names.contains(&name) {
            name = format!("{base}-{i}");
            i += 1;
        }
        let id = unique_entity_id(&entries);
        let mut entry = Map::new();
        entry.insert("name".to_string(), Value::String(name.clone()));
        entry.insert(
            "path".to_string(),
            Value::String(collapse_user_path(&PathBuf::from(&resolved))),
        );
        if let Err(e) = store.save_workspace_config(&id, entry.clone()) {
            return usage_error(&e);
        }
        entries.insert(id, Value::Object(entry));
        existing.insert(resolved, name.clone());
        existing_names.insert(name.clone());
        added.push(name);
    }

    if added.is_empty() {
        println!("No new workspaces registered");
    } else {
        for name in &added {
            println!("Registered: {name}");
        }
    }
    0
}

fn unique_entity_id(entries: &Map<String, Value>) -> String {
    let mut id = crate::config::generate_entity_id();
    while entries.contains_key(&id) {
        id = crate::config::generate_entity_id();
    }
    id
}

// ─── jobs ───────────────────────────────────────────────────────────────

fn cmd_jobs(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("register-ai-agents") => cmd_jobs_register_ai_agents(&args[1..]),
        _ => usage_error("unknown jobs subcommand"),
    }
}

struct ToolMeta {
    label: &'static str,
    icon: &'static str,
    icon_color: &'static str,
    /// エージェントの承認待ちプロンプトに現れる文字列。合致した後、猶予期間
    /// アクティビティが無ければpush通知する。確度の高いものだけ入れてある
    /// （不正確な文字列は「設定した気になって実は一生鳴らない」方が空欄より
    /// 害があるため）。claude/codex以外は実際のプロンプト文言が分かり次第補う想定。
    notify_phrase: &'static str,
}

fn tool_meta(tool: &str) -> Option<ToolMeta> {
    Some(match tool {
        "claude" => ToolMeta {
            label: "Claude Code",
            icon: "mdi-robot-outline",
            icon_color: "#d97757",
            notify_phrase: "1. Yes",
        },
        "codex" => ToolMeta {
            label: "Codex",
            icon: "mdi-robot-outline",
            icon_color: "#10a37f",
            notify_phrase: "1. Yes",
        },
        "gemini" => ToolMeta {
            label: "Gemini CLI",
            icon: "mdi-robot-outline",
            icon_color: "#4285f4",
            notify_phrase: "",
        },
        "copilot" => ToolMeta {
            label: "GitHub Copilot",
            icon: "mdi-robot-outline",
            icon_color: "#8957e5",
            notify_phrase: "1. Yes",
        },
        "opencode" => ToolMeta {
            label: "opencode",
            icon: "mdi-robot-outline",
            icon_color: "#fab283",
            notify_phrase: "",
        },
        _ => return None,
    })
}

/// 検知済みのAIエージェントCLIをcommon jobとして登録する。既に同じcommandの
/// jobが登録済みなら二重登録しない（setup再実行でも安全 — 旧python版と同じ）。
fn cmd_jobs_register_ai_agents(tools: &[String]) -> i32 {
    let store = store_for_cwd();
    let mut jobs: Map<String, Value> = match store.load_global_section("jobs") {
        Some(Value::Object(m)) => m,
        _ => Map::new(),
    };
    let mut existing_commands: HashSet<String> = jobs
        .values()
        .filter_map(|v| v.get("command").and_then(Value::as_str))
        .map(str::to_string)
        .collect();

    let mut added = Vec::new();
    for tool in tools {
        let Some(meta) = tool_meta(tool) else {
            continue;
        };
        if existing_commands.contains(tool) {
            continue;
        }
        let key = crate::jobs_common::generate_job_key(&jobs);
        let mut entry = Map::new();
        entry.insert("command".to_string(), Value::String(tool.clone()));
        entry.insert("label".to_string(), Value::String(meta.label.to_string()));
        entry.insert("icon".to_string(), Value::String(meta.icon.to_string()));
        entry.insert(
            "icon_color".to_string(),
            Value::String(meta.icon_color.to_string()),
        );
        entry.insert("confirm".to_string(), Value::Bool(false));
        entry.insert("detached_tab".to_string(), Value::Bool(true));
        if !meta.notify_phrase.is_empty() {
            entry.insert(
                "notify_phrase".to_string(),
                Value::String(meta.notify_phrase.to_string()),
            );
        }
        jobs.insert(key, Value::Object(entry));
        existing_commands.insert(tool.clone());
        added.push(meta.label.to_string());
    }

    if !added.is_empty() {
        if let Err(e) = store.save_global_section("jobs", Value::Object(jobs)) {
            return usage_error(&e);
        }
    }
    if added.is_empty() {
        println!("No new AI agent jobs registered");
    } else {
        for label in &added {
            println!("Registered: {label}");
        }
    }
    0
}

// ─── tailscale ──────────────────────────────────────────────────────────

async fn cmd_tailscale(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("hostname") => {
            println!("{}", tailscale_hostname().await);
            0
        }
        _ => usage_error("unknown tailscale subcommand"),
    }
}

async fn tailscale_hostname() -> String {
    let Some(data) = crate::subprocess::run_tailscale_json(&["status", "--json"]).await else {
        return String::new();
    };
    data.get("Self")
        .and_then(|s| s.get("DNSName"))
        .and_then(Value::as_str)
        .map(|s| s.trim_end_matches('.').to_string())
        .unwrap_or_default()
}

// ─── auth ───────────────────────────────────────────────────────────────

fn cmd_auth(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("ensure-token") => {
            cmd_auth_ensure_token();
            0
        }
        _ => usage_error("unknown auth subcommand"),
    }
}

/// `data/auth.json` が無ければトークンを生成・保存して標準出力へ表示する
/// （初回のみ・以後は無言で何もしない — 「一度しか表示しない」UXを保つ）。
fn cmd_auth_ensure_token() {
    let data_dir = data_dir_for_cwd();
    if data_dir.join("auth.json").exists() {
        return;
    }
    let token = crate::util::token_urlsafe(24);
    crate::auth::Auth::load(data_dir, false).update_token(&token);
    println!("{token}");
}

// ─── paths ──────────────────────────────────────────────────────────────

fn cmd_paths(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("data-dir") => {
            println!("{}", data_dir_for_cwd().display());
            0
        }
        _ => usage_error("unknown paths subcommand"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // dispatchのルーティング判定のみを検証する（env/fsに触れないケース限定。
    // 実際の各サブコマンドの挙動はサブプロセス経由のtests/test_cli.rsで検証する
    // — 同一プロセス内でのANY_CONSOLE_PROJECT_ROOT操作は他の並列テストと
    // 競合するため避ける）。

    #[tokio::test]
    async fn no_args_falls_through_to_server_start() {
        assert_eq!(dispatch(&[]).await, None);
    }

    #[tokio::test]
    async fn unknown_first_arg_falls_through_to_server_start() {
        assert_eq!(dispatch(&["foo".to_string()]).await, None);
    }

    #[tokio::test]
    async fn version_flags_are_handled() {
        assert_eq!(dispatch(&["--version".to_string()]).await, Some(0));
        assert_eq!(dispatch(&["-V".to_string()]).await, Some(0));
    }
}
