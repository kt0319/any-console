//! git ステータス監視（Python 側 `api/git_watch.py` の移植）。
//!
//! - `WatchTarget` / `collect_watch_targets`: 登録済み git ワークスペース + 動的
//!   worktree を集める（`/workspaces/statuses` が返す集合と一致させる）
//! - `is_relevant_change` / `touches_branch_change`: FS イベントのパスが git
//!   ステータスに影響しうるか・ブランチ切替相当かを判定する純関数
//! - `match_workspaces` / `watch_roots`: 変更パス集合を再計算すべきワークスペース名
//!   へ対応付け、監視すべきルートパス集合を組み立てる
//! - `GitWatchState` / `ensure_tasks` / `maybe_stop_tasks` / `nudge_workspace` /
//!   `notify_workspaces_changed`: 購読者数に連動したタスクの起動・停止（`_ensure_tasks`
//!   / `_stop_tasks` 相当）。Python 版は各 producer が専用の購読者 set を持つが、
//!   Rust 版は `StatusStreamState::subscriber_count()`（全 producer 共有）を使う
//!   ため、専用の購読者管理は不要になった
//! - `watch_loop` / `auto_fetch_loop`: FS 監視（Python 側 watchfiles の実体である
//!   `notify` crate + `notify-debouncer-full` を使用）・定期 fetch の常駐タスク

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use regex::Regex;
use serde_json::{json, Value};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::config::ConfigStore;
use crate::git_utils::{
    background_fetch, dynamic_worktree_entries, list_git_workspace_paths, run_git_raw,
    GIT_QUICK_TIMEOUT_SEC,
};
use crate::paths::safe_resolve_str;
use crate::state::AppState;
use crate::util::task_running;

/// Python `common.py` の同名定数と同じ値。
const GIT_WATCH_DEBOUNCE_MS: u64 = 300;
const GIT_WATCH_RETRY_SEC: u64 = 5;
const GIT_AUTO_FETCH_INTERVAL_SEC: u64 = 180;
/// Python `BACKGROUND_FETCH_EXECUTOR`（max_workers=4）に対応する並列度
/// （`workspaces.rs` の `BACKGROUND_FETCH_CONCURRENCY` と同じ値）。
const AUTO_FETCH_CONCURRENCY: usize = 4;

/// watchfiles DefaultFilter 相当の無視リスト（.git は要所のみ通すため除外して個別処理）。
const IGNORE_DIRS: &[&str] = &[
    "__pycache__",
    ".hg",
    ".svn",
    ".tox",
    ".venv",
    "node_modules",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    ".hypothesis",
    "site-packages",
    "dist",
];
/// `.git` 配下で git 状態の変化を表すファイル（これ以外の `.git` 内部は無視する）。
const GIT_WATCH_BASENAMES: &[&str] = &[
    "HEAD",
    "ORIG_HEAD",
    "MERGE_HEAD",
    "FETCH_HEAD",
    "index",
    "packed-refs",
];
/// ブランチ切替・作成やリモート追跡ブランチの更新を表すファイル。
const BRANCH_CHANGE_BASENAMES: &[&str] = &["HEAD", "ORIG_HEAD", "packed-refs"];

fn ignore_entity_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\.py[cod]$|\.sw.$|~$|^\.#|^\.DS_Store$").expect("valid regex"))
}

fn path_parts(path_str: &str) -> Vec<String> {
    Path::new(path_str)
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// `.git` セグメント以降の内側パーツを返す（`.git` が無い・直後が空なら None）。
fn git_inner_parts(parts: &[String]) -> Option<&[String]> {
    let idx = parts.iter().position(|p| p == ".git")?;
    let inner = &parts[idx + 1..];
    (!inner.is_empty()).then_some(inner)
}

/// FS イベントのパスが git ステータスに影響しうるか判定する純関数。
pub fn is_relevant_change(path_str: &str) -> bool {
    let parts = path_parts(path_str);
    if parts.is_empty() {
        return false;
    }
    if parts.iter().any(|p| p == ".git") {
        return match git_inner_parts(&parts) {
            None => false,
            // refs/（ブランチ・リモート追跡）配下と、要所ファイルのみ通す
            Some(inner) => {
                inner.iter().any(|p| p == "refs")
                    || GIT_WATCH_BASENAMES.contains(&inner.last().unwrap().as_str())
            }
        };
    }
    if parts.iter().any(|p| IGNORE_DIRS.contains(&p.as_str())) {
        return false;
    }
    !ignore_entity_re().is_match(parts.last().unwrap())
}

/// 変更パス群に HEAD/ORIG_HEAD/packed-refs や refs/ 配下の変更が含まれるか判定する。
///
/// 含まれる場合、checkout/switch やブランチ作成・リモート追跡ブランチ更新の
/// 可能性が高く、git_info キャッシュを無効化してブランチ名等をフル再計算させる
/// 必要がある。
pub fn touches_branch_change(paths: &HashSet<String>) -> bool {
    paths.iter().any(|p| {
        let parts = path_parts(p);
        match git_inner_parts(&parts) {
            None => false,
            Some(inner) => {
                BRANCH_CHANGE_BASENAMES.contains(&inner.last().unwrap().as_str())
                    || inner.iter().any(|x| x == "refs")
            }
        }
    })
}

/// 監視対象1件（登録済みワークスペース or 動的 worktree）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchTarget {
    pub name: String,
    pub path: PathBuf,
    /// worktree の場合はベースワークスペースの表示名（ベースが未登録なら None）。
    pub base: Option<String>,
    /// linked worktree の専用 gitdir（`<base>/.git/worktrees/<x>`）。通常リポジトリは None。
    pub gitdir: Option<PathBuf>,
    /// linked worktree が共有する本体の `.git`。通常リポジトリは None。
    pub common: Option<PathBuf>,
}

impl WatchTarget {
    pub fn new(name: &str, path: PathBuf) -> Self {
        Self {
            name: name.to_string(),
            path,
            base: None,
            gitdir: None,
            common: None,
        }
    }

    pub fn worktree(
        name: &str,
        path: PathBuf,
        base: Option<&str>,
        gitdir: Option<PathBuf>,
        common: Option<PathBuf>,
    ) -> Self {
        Self {
            name: name.to_string(),
            path,
            base: base.map(str::to_string),
            gitdir,
            common,
        }
    }
}

/// path が linked worktree なら (専用 gitdir, 共有 .git) を返す。通常リポジトリは None。
async fn worktree_git_dirs(path: &Path) -> Option<(PathBuf, PathBuf)> {
    let result = run_git_raw(
        &["rev-parse", "--absolute-git-dir", "--git-common-dir"],
        path,
        GIT_QUICK_TIMEOUT_SEC,
        &[],
    )
    .await
    .ok()?;
    if result.code != 0 {
        return None;
    }
    let lines: Vec<&str> = result.stdout.trim().lines().collect();
    if lines.len() != 2 {
        return None;
    }
    let git_dir = PathBuf::from(lines[0]);
    let mut common = PathBuf::from(lines[1]);
    if !common.is_absolute() {
        common = PathBuf::from(safe_resolve_str(&path.join(&common)));
    }
    if safe_resolve_str(&git_dir) == safe_resolve_str(&common) {
        return None;
    }
    Some((git_dir, common))
}

/// 監視対象（登録済み git ワークスペース + 動的 worktree）を集める。
///
/// `/workspaces/statuses` が返す集合と一致させる。登録済みワークスペース自体が
/// linked worktree の場合は、git 状態の実体である専用 gitdir / 共有 .git も記録し、
/// ベースが登録済みならその表示名を base に載せる（監視・マッピングに使う）。
pub async fn collect_watch_targets(store: &ConfigStore) -> Vec<WatchTarget> {
    let registered = list_git_workspace_paths(store).await;
    let name_by_path: HashMap<String, String> = registered
        .iter()
        .map(|(name, p)| (safe_resolve_str(p), name.clone()))
        .collect();

    let mut targets = Vec::new();
    for (name, p) in &registered {
        match worktree_git_dirs(p).await {
            None => targets.push(WatchTarget::new(name, p.clone())),
            Some((gitdir, common)) => {
                let base_name = common
                    .parent()
                    .map(safe_resolve_str)
                    .and_then(|resolved| name_by_path.get(&resolved).cloned());
                targets.push(WatchTarget::worktree(
                    name,
                    p.clone(),
                    base_name.as_deref(),
                    Some(gitdir),
                    Some(common),
                ));
            }
        }
    }
    for wt in dynamic_worktree_entries(store, None, false).await {
        let name = wt.get("name").and_then(Value::as_str).unwrap_or("");
        let path = wt.get("path").and_then(Value::as_str).unwrap_or("");
        let base = wt.get("worktree_base").and_then(Value::as_str);
        targets.push(WatchTarget::worktree(
            name,
            PathBuf::from(path),
            base,
            None,
            None,
        ));
    }
    targets
}

/// 監視ルートの集合を組み立てる。
///
/// 作業ツリーに加え、作業ツリー群でカバーされない worktree の共有 .git / 専用
/// gitdir（ベースが未登録のケース）も監視する。ネスト・重複は取り除く。
pub fn watch_roots(targets: &[WatchTarget]) -> Vec<PathBuf> {
    let roots: Vec<String> = targets
        .iter()
        .map(|t| t.path.to_string_lossy().into_owned())
        .collect();

    let covered = |d: &str, base: &[String]| -> bool {
        base.iter()
            .any(|r| d == r || d.starts_with(&format!("{r}{}", std::path::MAIN_SEPARATOR)))
    };

    let mut extras: Vec<String> = Vec::new();
    for t in targets {
        // gitdir は common 配下なので common を先に見る
        for d in [t.common.as_ref(), t.gitdir.as_ref()] {
            let Some(d) = d else { continue };
            let s = d.to_string_lossy().into_owned();
            if !covered(&s, &roots) && !covered(&s, &extras) {
                extras.push(s);
            }
        }
    }
    roots.into_iter().chain(extras).map(PathBuf::from).collect()
}

/// 一致したプレフィックスの種別ごとに、再計算すべきワークスペース名を決める。
fn names_for_hit(
    prefix: &str,
    t: &WatchTarget,
    kind: &str,
    p: &str,
    targets: &[WatchTarget],
) -> HashSet<String> {
    if kind == "gitdir" {
        // linked worktree の専用 gitdir（HEAD/index 等）はその worktree だけ
        return HashSet::from([t.name.clone()]);
    }
    if kind == "path" {
        let mut names = HashSet::from([t.name.clone()]);
        // .git 配下（FETCH_HEAD・refs/remotes 等の共有 git 状態）の変更は、この
        // リポジトリをベースとする worktree の ahead/behind にも影響するため展開する
        let git_seg = format!("{sep}.git{sep}", sep = std::path::MAIN_SEPARATOR);
        if p.contains(&git_seg) {
            names.extend(
                targets
                    .iter()
                    .filter(|c| c.base.as_deref() == Some(t.name.as_str()))
                    .map(|c| c.name.clone()),
            );
        }
        return names;
    }
    // kind == "common": 共有 .git の変更（FETCH_HEAD・refs 等）は、同じ .git を共有する
    // 全 worktree ＋ ベース本体 ＋ ベースに属する動的 worktree（common を持たない）へ展開する
    let mut names: HashSet<String> = targets
        .iter()
        .filter(|c| {
            c.common
                .as_deref()
                .map(|cp| cp.to_string_lossy() == prefix)
                .unwrap_or(false)
        })
        .map(|c| c.name.clone())
        .collect();
    if let Some(base) = &t.base {
        names.insert(base.clone());
        names.extend(
            targets
                .iter()
                .filter(|c| c.base.as_deref() == Some(base.as_str()))
                .map(|c| c.name.clone()),
        );
    }
    names
}

/// 変更パス集合を、再計算すべきワークスペース名の集合へ対応付ける。
///
/// - 最長プレフィックス一致で持ち主を決める（作業ツリー・専用 gitdir・共有 .git）
/// - 展開の内訳は `names_for_hit` を参照
pub fn match_workspaces(
    changed_paths: &HashSet<String>,
    targets: &[WatchTarget],
) -> HashSet<String> {
    let mut candidates: Vec<(String, &WatchTarget, &'static str)> = Vec::new();
    for t in targets {
        candidates.push((t.path.to_string_lossy().into_owned(), t, "path"));
        if let Some(gitdir) = &t.gitdir {
            candidates.push((gitdir.to_string_lossy().into_owned(), t, "gitdir"));
        }
        if let Some(common) = &t.common {
            candidates.push((common.to_string_lossy().into_owned(), t, "common"));
        }
    }
    // 同一プレフィックス（共有 .git 等）が隣接するよう文字列でも整列する
    candidates.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(&b.0)));

    let mut names: HashSet<String> = HashSet::new();
    for p in changed_paths {
        let mut best: Option<String> = None;
        for (prefix, t, kind) in &candidates {
            if let Some(b) = &best {
                if prefix != b {
                    break;
                }
            }
            let sep_prefix = format!("{prefix}{}", std::path::MAIN_SEPARATOR);
            if p != prefix && !p.starts_with(&sep_prefix) {
                continue;
            }
            best = Some(prefix.clone());
            names.extend(names_for_hit(prefix, t, kind, p, targets));
        }
    }
    names
}

// ─── 購読者連動タスク管理・push（Python 版 `_ensure_tasks`/`_stop_tasks`/
// `subscribe`/`unsubscribe`/`nudge_workspace`/`notify_workspaces_changed` 相当）
// ──────────────────────────────────────────────────────────────────────────

/// git_watch の常駐タスク（監視・自動 fetch）とその実行状態を保持する。
pub struct GitWatchState {
    watch_task: Mutex<Option<JoinHandle<()>>>,
    fetch_task: Mutex<Option<JoinHandle<()>>>,
    /// ワークスペース追加・削除時に監視ループを再起動させる（Python の
    /// `_restart_event` 相当）。
    restart: Notify,
    /// 前回配信した状態（変化が無ければ再配信しない — Python `_last_sent` 相当）。
    last_sent: Mutex<HashMap<String, Value>>,
}

impl GitWatchState {
    pub fn new() -> Self {
        Self {
            watch_task: Mutex::new(None),
            fetch_task: Mutex::new(None),
            restart: Notify::new(),
            last_sent: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for GitWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// 購読開始時に呼ぶ（status stream WS ハンドラから）。タスクが動いていなければ
/// 起動する（Python `_ensure_tasks` 相当）。
pub fn ensure_tasks(state: &Arc<AppState>) {
    {
        let mut watch = state
            .git_watch
            .watch_task
            .lock()
            .expect("git_watch state poisoned");
        if !task_running(&watch) {
            *watch = Some(tokio::spawn(watch_loop(state.clone())));
        }
    }
    let mut fetch = state
        .git_watch
        .fetch_task
        .lock()
        .expect("git_watch state poisoned");
    if !task_running(&fetch) {
        *fetch = Some(tokio::spawn(auto_fetch_loop(state.clone())));
    }
}

/// 購読解除時に呼ぶ。全体の購読者（`StatusStreamState`）がゼロになったら
/// タスクを停止する（Python `unsubscribe`/`_stop_tasks` 相当）。
pub fn maybe_stop_tasks(state: &Arc<AppState>) {
    if state.status_stream.subscriber_count() > 0 {
        return;
    }
    if let Some(h) = state
        .git_watch
        .watch_task
        .lock()
        .expect("git_watch state poisoned")
        .take()
    {
        h.abort();
    }
    if let Some(h) = state
        .git_watch
        .fetch_task
        .lock()
        .expect("git_watch state poisoned")
        .take()
    {
        h.abort();
    }
    state
        .git_watch
        .last_sent
        .lock()
        .expect("git_watch state poisoned")
        .clear();
}

/// ワークスペースの追加・削除・パス変更時に監視対象を再収集させる
/// （Python `notify_workspaces_changed` 相当）。
pub fn notify_workspaces_changed(state: &AppState) {
    state.git_watch.restart.notify_one();
}

/// API 経由の git 操作直後に該当ワークスペースの再計算・push を予約する
/// （Python `nudge_workspace` 相当。`git_helpers::invalidate_and_publish_git_info` から呼ぶ）。
/// 購読者がいなければ何もしない。
pub fn nudge_workspace(state: &Arc<AppState>, workspace_name: String) {
    if state.status_stream.subscriber_count() == 0 {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        let targets = collect_watch_targets(&state.config).await;
        if let Some(target) = targets.iter().find(|t| t.name == workspace_name) {
            push_status(&state, target).await;
        }
    });
}

/// git_info を再計算し、前回送信時から変化があれば購読者へ配信する
/// （Python `_push_status` 相当）。
///
/// Python 版はキャッシュ命中時に branch/upstream/ahead-behind を使い回す
/// `refresh_git_info`（部分更新）で高速化しているが、Rust 版は毎回
/// `git_info_cache` を invalidate してから `git_info_to_status_json`
/// （`/workspaces/statuses` と共通のフル再計算パイプライン）を呼ぶ単純な実装
/// にした。TTL キャッシュ命中時に diff/status が古いまま配信される事故を防ぐ
/// 確実さを優先し、watch イベントごとに数回分余計な git サブプロセスが増える
/// 程度のコストは許容する。
async fn push_status(state: &Arc<AppState>, target: &WatchTarget) {
    state.git_info_cache.invalidate(&target.path);
    let status =
        crate::git_info::git_info_to_status_json(&state.git_info_cache, &target.path, &target.name)
            .await;
    {
        let mut last_sent = state
            .git_watch
            .last_sent
            .lock()
            .expect("git_watch state poisoned");
        if last_sent.get(&target.name) == Some(&status) {
            return;
        }
        last_sent.insert(target.name.clone(), status.clone());
    }
    state
        .status_stream
        .broadcast(json!({"type": "statuses", "statuses": [status]}));
}

/// 変更パスの中に `.git/worktrees/` セグメントが含まれるか（worktree の作成・
/// 削除で監視対象集合が変わりうるか）を判定する。
fn touches_worktrees_segment(paths: &HashSet<String>) -> bool {
    let seg = format!(
        "{sep}.git{sep}worktrees{sep}",
        sep = std::path::MAIN_SEPARATOR
    );
    paths.iter().any(|p| p.contains(&seg))
}

/// 1回分のデバウンス済みイベントバッチを処理する（Python `_handle_changes` 相当）。
/// 戻り値: 監視対象集合が実際に変わったため監視ループを再起動すべきか。
async fn handle_changes(
    state: &Arc<AppState>,
    events: &[notify_debouncer_full::DebouncedEvent],
    targets: &[WatchTarget],
) -> bool {
    let paths: HashSet<String> = events
        .iter()
        .flat_map(|e| e.event.paths.iter())
        .map(|p| p.to_string_lossy().into_owned())
        .filter(|p| is_relevant_change(p))
        .collect();
    if paths.is_empty() {
        return false;
    }
    let names = match_workspaces(&paths, targets);
    for target in targets {
        if names.contains(&target.name) {
            push_status(state, target).await;
        }
    }
    // worktree の作成・削除は監視対象集合を変えるので、実際に変わったときだけ
    // 再起動する（無条件の再起動は awatch 再構築中の直後イベントの取りこぼしに
    // つながるため — Python 版と同じ判断）。
    if touches_worktrees_segment(&paths) {
        let new_targets = collect_watch_targets(&state.config).await;
        if new_targets != targets {
            return true;
        }
    }
    false
}

/// FS を監視し、変更のあったワークスペースを push し続ける常駐タスク
/// （Python `_watch_loop` 相当。`notify`/`notify-debouncer-full` crate を使う —
/// Python 側 `watchfiles` の実体もこの `notify` crate）。
async fn watch_loop(state: Arc<AppState>) {
    loop {
        let targets = collect_watch_targets(&state.config).await;
        if targets.is_empty() {
            // ワークスペースが1つも無い間は再収集のトリガー（追加通知）を待つ。
            state.git_watch.restart.notified().await;
            continue;
        }
        let roots = watch_roots(&targets);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<DebounceEventResult>();
        let mut debouncer = match new_debouncer(
            Duration::from_millis(GIT_WATCH_DEBOUNCE_MS),
            None,
            move |result: DebounceEventResult| {
                let _ = tx.send(result);
            },
        ) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("git watch debouncer init failed (retrying): {e}");
                tokio::time::sleep(Duration::from_secs(GIT_WATCH_RETRY_SEC)).await;
                continue;
            }
        };
        let mut watch_failed = false;
        for root in &roots {
            if let Err(e) = debouncer.watch(root.as_path(), RecursiveMode::Recursive) {
                tracing::warn!("git watch failed to watch dir={}: {e}", root.display());
                watch_failed = true;
            }
        }
        if watch_failed {
            drop(debouncer);
            tokio::time::sleep(Duration::from_secs(GIT_WATCH_RETRY_SEC)).await;
            continue;
        }

        loop {
            tokio::select! {
                _ = state.git_watch.restart.notified() => break,
                maybe_result = rx.recv() => {
                    match maybe_result {
                        Some(Ok(events)) => {
                            if handle_changes(&state, &events, &targets).await {
                                break;
                            }
                        }
                        Some(Err(errors)) => {
                            // inotify 上限やディレクトリ消失など。少し待って対象を
                            // 再収集・再試行する。失敗中も API 操作起点・自動 fetch
                            // 起点の push は動き続ける。
                            tracing::warn!("git watch error (retrying): {errors:?}");
                            drop(debouncer);
                            tokio::time::sleep(Duration::from_secs(GIT_WATCH_RETRY_SEC)).await;
                            break;
                        }
                        None => break,
                    }
                }
            }
        }
    }
}

/// 購読者がいる間、定期的に git fetch して behind 判定を最新化する常駐タスク
/// （Python `_auto_fetch_loop` 相当）。最初の起動時に1回目の fetch を実行してから
/// 待機に入る（先に sleep すると、アプリを開いてから最大
/// `GIT_AUTO_FETCH_INTERVAL_SEC` 秒 behind 判定が古いまま残るため）。
async fn auto_fetch_loop(state: Arc<AppState>) {
    loop {
        let targets = collect_watch_targets(&state.config).await;
        // worktree は本体と remote/refs を共有するので本体のみ fetch する。
        let fetch_futures: Vec<_> = targets
            .iter()
            .filter(|t| t.base.is_none())
            .map(|t| {
                let path = t.path.clone();
                let name = t.name.clone();
                async move {
                    if !background_fetch(&path).await {
                        tracing::debug!("auto fetch failed dir={name}");
                    }
                }
            })
            .collect();
        futures_util::stream::iter(fetch_futures)
            .buffered(AUTO_FETCH_CONCURRENCY)
            .collect::<Vec<()>>()
            .await;
        for target in &targets {
            push_status(&state, target).await;
        }
        tokio::time::sleep(Duration::from_secs(GIT_AUTO_FETCH_INTERVAL_SEC)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh_git(repo: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(repo)
            .env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00+00:00")
            .env("GIT_COMMITTER_DATE", "2026-01-01T00:00:00+00:00")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    // ─── is_relevant_change ──────────────────────────────────────────────

    #[test]
    fn working_tree_file_is_relevant() {
        assert!(is_relevant_change("/ws/src/main.py"));
        assert!(is_relevant_change("/ws/new-file.txt"));
    }

    #[test]
    fn dependency_and_cache_dirs_are_ignored() {
        for p in [
            "/ws/node_modules/pkg/index.js",
            "/ws/.venv/lib/python3.11/site.py",
            "/ws/src/__pycache__/mod.cpython-311.pyc",
            "/ws/.mypy_cache/3.11/mod.json",
            "/ws/.pytest_cache/v/cache/lastfailed",
        ] {
            assert!(!is_relevant_change(p), "{p} should be ignored");
        }
    }

    #[test]
    fn editor_junk_is_ignored() {
        for p in [
            "/ws/.DS_Store",
            "/ws/src/.main.py.swp",
            "/ws/src/main.py~",
            "/ws/src/mod.pyc",
        ] {
            assert!(!is_relevant_change(p), "{p} should be ignored");
        }
    }

    #[test]
    fn git_state_files_are_relevant() {
        for p in [
            "/ws/.git/HEAD",
            "/ws/.git/index",
            "/ws/.git/FETCH_HEAD",
            "/ws/.git/MERGE_HEAD",
            "/ws/.git/ORIG_HEAD",
            "/ws/.git/packed-refs",
            "/ws/.git/refs/heads/main",
            "/ws/.git/refs/remotes/origin/main",
            "/ws/.git/worktrees/wt1/HEAD",
            "/ws/.git/worktrees/wt1/index",
        ] {
            assert!(is_relevant_change(p), "{p} should be relevant");
        }
    }

    #[test]
    fn other_git_internals_are_ignored() {
        for p in [
            "/ws/.git",
            "/ws/.git/objects/ab/cdef0123",
            "/ws/.git/index.lock",
            "/ws/.git/COMMIT_EDITMSG",
            "/ws/.git/hooks/pre-commit",
        ] {
            assert!(!is_relevant_change(p), "{p} should be ignored");
        }
    }

    #[test]
    fn empty_path_is_ignored() {
        assert!(!is_relevant_change(""));
    }

    // ─── match_workspaces ────────────────────────────────────────────────

    fn plain_targets() -> Vec<WatchTarget> {
        vec![
            WatchTarget::new("main", PathBuf::from("/repos/main")),
            WatchTarget::new("nested", PathBuf::from("/repos/main/vendor/nested")),
            WatchTarget::worktree(
                "main:feat",
                PathBuf::from("/repos/main-feat"),
                Some("main"),
                None,
                None,
            ),
        ]
    }

    #[test]
    fn longest_prefix_wins() {
        let names = match_workspaces(&set(&["/repos/main/vendor/nested/a.txt"]), &plain_targets());
        assert_eq!(names, set(&["nested"]));
    }

    #[test]
    fn plain_change_maps_to_owner() {
        let names = match_workspaces(&set(&["/repos/main/src/a.py"]), &plain_targets());
        assert_eq!(names, set(&["main"]));
    }

    #[test]
    fn shared_ref_change_expands_to_worktrees() {
        for shared_ref in [
            "/repos/main/.git/FETCH_HEAD",
            "/repos/main/.git/refs/remotes/origin/main",
            "/repos/main/.git/packed-refs",
        ] {
            let names = match_workspaces(&set(&[shared_ref]), &plain_targets());
            assert_eq!(names, set(&["main", "main:feat"]), "for {shared_ref}");
        }
    }

    #[test]
    fn shared_ref_with_registered_worktree_includes_dynamic_ones() {
        let targets = vec![
            WatchTarget::new("main", PathBuf::from("/repos/main")),
            WatchTarget::worktree(
                "reg-wt",
                PathBuf::from("/repos/reg-wt"),
                Some("main"),
                Some(PathBuf::from("/repos/main/.git/worktrees/reg-wt")),
                Some(PathBuf::from("/repos/main/.git")),
            ),
            WatchTarget::worktree(
                "main:feat",
                PathBuf::from("/repos/main-feat"),
                Some("main"),
                None,
                None,
            ),
        ];
        let names = match_workspaces(&set(&["/repos/main/.git/FETCH_HEAD"]), &targets);
        assert_eq!(names, set(&["main", "reg-wt", "main:feat"]));
    }

    #[test]
    fn unmatched_path_is_dropped() {
        assert!(match_workspaces(&set(&["/elsewhere/file"]), &plain_targets()).is_empty());
    }

    #[test]
    fn worktree_gitdir_change_includes_worktree_workspaces() {
        let names = match_workspaces(
            &set(&["/repos/main/.git/worktrees/feat/HEAD"]),
            &plain_targets(),
        );
        assert_eq!(names, set(&["main", "main:feat"]));
    }

    #[test]
    fn prefix_match_requires_separator() {
        let targets = vec![WatchTarget::new("main", PathBuf::from("/repos/main"))];
        assert!(match_workspaces(&set(&["/repos/main-other/file"]), &targets).is_empty());
    }

    #[test]
    fn registered_worktree_gitdir_maps_precisely() {
        let targets = vec![
            WatchTarget::new("main", PathBuf::from("/repos/main")),
            WatchTarget::worktree(
                "wt",
                PathBuf::from("/repos/wt"),
                Some("main"),
                Some(PathBuf::from("/repos/main/.git/worktrees/wt")),
                Some(PathBuf::from("/repos/main/.git")),
            ),
        ];
        let names = match_workspaces(&set(&["/repos/main/.git/worktrees/wt/index"]), &targets);
        assert_eq!(names, set(&["wt"]));
    }

    #[test]
    fn shared_common_gitdir_maps_to_all_sharers() {
        let common = PathBuf::from("/repos/unreg/.git");
        let targets = vec![
            WatchTarget::worktree(
                "wt1",
                PathBuf::from("/repos/wt1"),
                None,
                Some(common.join("worktrees/wt1")),
                Some(common.clone()),
            ),
            WatchTarget::worktree(
                "wt2",
                PathBuf::from("/repos/wt2"),
                None,
                Some(common.join("worktrees/wt2")),
                Some(common.clone()),
            ),
        ];
        let names = match_workspaces(&set(&["/repos/unreg/.git/refs/heads/main"]), &targets);
        assert_eq!(names, set(&["wt1", "wt2"]));
        // 専用 gitdir は共有 .git より深いので、そちらが優先されて単独マッチする
        let names = match_workspaces(&set(&["/repos/unreg/.git/worktrees/wt2/HEAD"]), &targets);
        assert_eq!(names, set(&["wt2"]));
    }

    #[test]
    fn registered_worktree_included_in_base_expansion() {
        let targets = vec![
            WatchTarget::new("main", PathBuf::from("/repos/main")),
            WatchTarget::worktree(
                "wt",
                PathBuf::from("/repos/wt"),
                Some("main"),
                Some(PathBuf::from("/repos/main/.git/worktrees/wt")),
                Some(PathBuf::from("/repos/main/.git")),
            ),
        ];
        let names = match_workspaces(&set(&["/repos/main/.git/worktrees/other/HEAD"]), &targets);
        assert!(names.contains("main") && names.contains("wt"));
    }

    // ─── watch_roots ─────────────────────────────────────────────────────

    #[test]
    fn plain_targets_watch_working_trees() {
        let targets = vec![
            WatchTarget::new("a", PathBuf::from("/repos/a")),
            WatchTarget::new("b", PathBuf::from("/repos/b")),
        ];
        assert_eq!(
            watch_roots(&targets),
            vec![PathBuf::from("/repos/a"), PathBuf::from("/repos/b")]
        );
    }

    #[test]
    fn gitdir_under_registered_base_is_not_duplicated() {
        let targets = vec![
            WatchTarget::new("main", PathBuf::from("/repos/main")),
            WatchTarget::worktree(
                "wt",
                PathBuf::from("/repos/wt"),
                Some("main"),
                Some(PathBuf::from("/repos/main/.git/worktrees/wt")),
                Some(PathBuf::from("/repos/main/.git")),
            ),
        ];
        assert_eq!(
            watch_roots(&targets),
            vec![PathBuf::from("/repos/main"), PathBuf::from("/repos/wt")]
        );
    }

    #[test]
    fn unregistered_base_gitdir_is_added_once() {
        let common = PathBuf::from("/repos/unreg/.git");
        let targets = vec![
            WatchTarget::worktree(
                "wt1",
                PathBuf::from("/repos/wt1"),
                None,
                Some(common.join("worktrees/wt1")),
                Some(common.clone()),
            ),
            WatchTarget::worktree(
                "wt2",
                PathBuf::from("/repos/wt2"),
                None,
                Some(common.join("worktrees/wt2")),
                Some(common.clone()),
            ),
        ];
        assert_eq!(
            watch_roots(&targets),
            vec![
                PathBuf::from("/repos/wt1"),
                PathBuf::from("/repos/wt2"),
                common
            ]
        );
    }

    // ─── collect_watch_targets（実 git リポジトリ）───────────────────────

    fn register_workspace(store: &ConfigStore, name: &str, path: &Path) {
        let mut cfg = store.load_all();
        cfg.insert(
            name.to_string(),
            serde_json::json!({"name": name, "path": path.to_string_lossy()}),
        );
        store.save_all(&cfg).unwrap();
    }

    fn init_repo(path: &Path) {
        std::fs::create_dir_all(path).unwrap();
        sh_git(path, &["init", "-q", "-b", "main"]);
        sh_git(path, &["config", "user.email", "t@example.com"]);
        sh_git(path, &["config", "user.name", "tester"]);
        std::fs::write(path.join("a.txt"), "hello\n").unwrap();
        sh_git(path, &["add", "-A"]);
        sh_git(path, &["commit", "-q", "-m", "first commit"]);
    }

    #[tokio::test]
    async fn git_workspace_is_collected() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        init_repo(&repo);
        let store = ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "test-ws", &repo);

        let targets = collect_watch_targets(&store).await;
        assert_eq!(
            targets.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
            vec!["test-ws"]
        );
        assert!(targets[0].base.is_none());
    }

    #[tokio::test]
    async fn non_git_workspace_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let store = ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "plain-ws", &plain);

        assert!(collect_watch_targets(&store).await.is_empty());
    }

    #[tokio::test]
    async fn dynamic_worktree_is_collected_with_base() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        init_repo(&repo);
        let store = ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "test-ws", &repo);

        let wt_path = dir.path().join("repo-feat");
        sh_git(
            &repo,
            &["worktree", "add", wt_path.to_str().unwrap(), "-b", "feat"],
        );

        let targets = collect_watch_targets(&store).await;
        let names: HashSet<String> = targets.iter().map(|t| t.name.clone()).collect();
        assert!(names.contains("test-ws"));
        let wt = targets.iter().find(|t| t.name != "test-ws").unwrap();
        assert_eq!(wt.base.as_deref(), Some("test-ws"));
        assert_eq!(safe_resolve_str(&wt.path), safe_resolve_str(&wt_path));
    }

    #[tokio::test]
    async fn registered_worktree_keeps_base_and_gitdir() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        init_repo(&repo);
        let store = ConfigStore::new(dir.path().join("config.json"));
        register_workspace(&store, "test-ws", &repo);

        let wt_path = dir.path().join("registered-wt");
        sh_git(
            &repo,
            &[
                "worktree",
                "add",
                wt_path.to_str().unwrap(),
                "-b",
                "reg-feat",
            ],
        );
        register_workspace(&store, "registered-wt", &wt_path);

        let targets = collect_watch_targets(&store).await;
        let names: HashSet<String> = targets.iter().map(|t| t.name.clone()).collect();
        assert_eq!(names, set(&["test-ws", "registered-wt"]));

        let wt = targets.iter().find(|t| t.name == "registered-wt").unwrap();
        assert_eq!(wt.base.as_deref(), Some("test-ws"));
        assert!(wt.gitdir.is_some());
        assert_eq!(
            wt.common.as_ref().map(|c| safe_resolve_str(c)),
            Some(safe_resolve_str(&repo.join(".git")))
        );

        let base = targets.iter().find(|t| t.name == "test-ws").unwrap();
        assert!(base.gitdir.is_none() && base.common.is_none());
    }
}
