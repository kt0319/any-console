//! データディレクトリ・設定ファイルのパス解決（Python 側 `api/common.py` と同一規則）。
//!
//! `ANY_CONSOLE_DATA_DIR` による隔離（E2E 使い捨てサーバ）を Rust 側でも一級で
//! サポートする。設定されていれば data/ も config.json もその配下、未設定なら
//! PROJECT_ROOT 直下。

use std::path::{Path, PathBuf};

/// `~` 前置パスをホームディレクトリで展開する（Python の `Path.expanduser` 相当）。
fn expand_user(raw: &str) -> PathBuf {
    if raw == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    } else if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(raw)
}

/// config.json に保存されたパス文字列を PathBuf に変換する（`~` を展開する）。
/// Python `expand_workspace_path` に対応。
pub fn expand_user_path(s: &str) -> PathBuf {
    expand_user(s)
}

/// ホームディレクトリ配下のパスを `~/...` 形式の文字列に変換する
/// （Python `collapse_user_path` 相当。ホーム自身は Python の
/// `relative_to` が `.` を返すのに合わせて "~/." になる）。
pub fn collapse_user_path(p: &Path) -> String {
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        if let Ok(rel) = p.strip_prefix(&home) {
            if rel.as_os_str().is_empty() {
                return "~/.".to_string();
            }
            return format!("~/{}", rel.to_string_lossy());
        }
    }
    p.to_string_lossy().into_owned()
}

/// パスを解決した絶対パス文字列を返す（Python `safe_resolve_str` 相当）。
/// canonicalize（symlink 解決込み）を試み、失敗時はレキシカルな正規化で代替する。
pub fn safe_resolve_str(path: &Path) -> String {
    if let Ok(c) = path.canonicalize() {
        return c.to_string_lossy().into_owned();
    }
    let abs = absolutize(path.to_path_buf());
    let mut normalized = PathBuf::new();
    for comp in abs.components() {
        match comp {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized.to_string_lossy().into_owned()
}

/// 相対パスをカレントディレクトリ基準で絶対化する（存在しないパスも扱えるよう
/// canonicalize は使わない — Python の `resolve()` は存在チェックなしで解決する）。
fn absolutize(p: PathBuf) -> PathBuf {
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir().map(|cwd| cwd.join(&p)).unwrap_or(p)
    }
}

/// (DATA_DIR, CONFIG_FILE) を決める。`api/common.py` の `resolve_data_paths` と同一。
///
/// strip 相当の空白判定は空値の検出のみに使い、パスには生の値を使う
/// （前後に空白を含む正当なディレクトリ名を別パスへ化けさせないため）。
pub fn resolve_data_paths(project_root: &Path, env_value: Option<&str>) -> (PathBuf, PathBuf) {
    if let Some(v) = env_value {
        if !v.trim().is_empty() {
            let data_dir = absolutize(expand_user(v));
            let config = data_dir.join("config.json");
            return (data_dir, config);
        }
    }
    (project_root.join("data"), project_root.join("config.json"))
}

/// `ANY_CONSOLE_PROJECT_ROOT`（未設定はカレントディレクトリ）。
/// main.rs のサーバ起動・cli.rs のCLIサブコマンド双方で使う共通の解決規則。
pub fn project_root_from_env() -> PathBuf {
    match std::env::var("ANY_CONSOLE_PROJECT_ROOT") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => std::env::current_dir().expect("cwd unavailable"),
    }
}

/// tmux セッション名のプレフィックス（未設定は "ac-"）。`resolve_tmux_prefix` と同一。
pub fn resolve_tmux_prefix(env_value: Option<&str>) -> String {
    match env_value {
        Some(v) if !v.trim().is_empty() => v.to_string(),
        _ => "ac-".to_string(),
    }
}

/// サーバが参照するパス一式。Python 側のモジュールグローバル定数に対応する。
#[derive(Debug, Clone)]
pub struct Paths {
    pub project_root: PathBuf,
    pub data_dir: PathBuf,
    pub config_file: PathBuf,
    pub frontend_dir: PathBuf,
    pub icons_dir: PathBuf,
    pub tmux_prefix: String,
}

impl Paths {
    pub fn from_env(project_root: PathBuf) -> Self {
        let env_value = std::env::var("ANY_CONSOLE_DATA_DIR").ok();
        let (data_dir, config_file) = resolve_data_paths(&project_root, env_value.as_deref());
        let tmux_prefix =
            resolve_tmux_prefix(std::env::var("ANY_CONSOLE_TMUX_PREFIX").ok().as_deref());
        // Python main.py の DIST_DIR と同じ場所（vite.config.js の outDir =
        // PROJECT_ROOT/dist）。ビルド済み dist の配信のみサポートする
        // （ソースモード = ui/ 直接配信 + キャッシュバスト書き換えは移植していない）。
        let dist = project_root.join("dist");
        Self {
            frontend_dir: dist,
            icons_dir: data_dir.join("icons"),
            project_root,
            data_dir,
            config_file,
            tmux_prefix,
        }
    }

    /// セッション ID から tmux セッション名（`{tmux_prefix}{session_id}`）を組み立てる。
    pub fn tmux_session_name(&self, session_id: &str) -> String {
        format!("{}{session_id}", self.tmux_prefix)
    }

    /// 画像アップロードの保存先。data_dir 配下に置くことで
    /// `ANY_CONSOLE_DATA_DIR` による隔離（E2E 使い捨てサーバ）を効かせる。
    pub fn uploads_dir(&self) -> PathBuf {
        self.data_dir.join("uploads")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uploads_dir_is_under_data_dir() {
        let root = Path::new("/srv/any-console");
        let (data_dir, config_file) = resolve_data_paths(root, Some("/tmp/isolated"));
        let paths = Paths {
            project_root: root.to_path_buf(),
            frontend_dir: root.join("dist"),
            icons_dir: data_dir.join("icons"),
            data_dir,
            config_file,
            tmux_prefix: "ac-".to_string(),
        };
        assert_eq!(paths.uploads_dir(), PathBuf::from("/tmp/isolated/uploads"));
    }

    #[test]
    fn default_paths_under_project_root() {
        let root = Path::new("/srv/any-console");
        let (data, config) = resolve_data_paths(root, None);
        assert_eq!(data, PathBuf::from("/srv/any-console/data"));
        assert_eq!(config, PathBuf::from("/srv/any-console/config.json"));
    }

    #[test]
    fn empty_or_whitespace_env_falls_back() {
        let root = Path::new("/srv/any-console");
        for v in ["", "   "] {
            let (data, _) = resolve_data_paths(root, Some(v));
            assert_eq!(data, PathBuf::from("/srv/any-console/data"));
        }
    }

    #[test]
    fn isolated_data_dir_holds_both() {
        let root = Path::new("/srv/any-console");
        let (data, config) = resolve_data_paths(root, Some("/tmp/e2e-run"));
        assert_eq!(data, PathBuf::from("/tmp/e2e-run"));
        assert_eq!(config, PathBuf::from("/tmp/e2e-run/config.json"));
    }

    #[test]
    fn tmux_prefix_default_and_custom() {
        assert_eq!(resolve_tmux_prefix(None), "ac-");
        assert_eq!(resolve_tmux_prefix(Some("")), "ac-");
        assert_eq!(resolve_tmux_prefix(Some("  ")), "ac-");
        assert_eq!(resolve_tmux_prefix(Some("e2e-abc-")), "e2e-abc-");
    }
}
