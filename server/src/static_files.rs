//! ui/dist の静的配信（Python 側 `main.py` の StaticFiles 相当）。
//!
//! Rust 側はビルド済み `ui/dist` の配信のみサポートする。dist が無い場合は
//! 静的配信を無効化し、全リクエストを Python への proxy に落とす（Python の
//! ソースモード = ui/ 直接配信 + キャッシュバスト書き換えは移植しない）。
//!
//! キャッシュ規則は Python と同一:
//! - index.html / sw.js: no-cache
//! - /assets/*: Vite のハッシュ付きファイル名のため 1 年間 immutable
//! - /icons/*: ICONS_DIR（data/icons）から配信

use std::path::{Component, Path, PathBuf};

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};

#[derive(Debug, Clone)]
pub struct StaticCtx {
    pub frontend_dir: PathBuf,
    pub icons_dir: PathBuf,
}

impl StaticCtx {
    /// dist ディレクトリが存在する場合のみ有効化する。
    pub fn detect(frontend_dir: PathBuf, icons_dir: PathBuf) -> Option<Self> {
        if frontend_dir.join("index.html").is_file() {
            Some(Self {
                frontend_dir,
                icons_dir,
            })
        } else {
            None
        }
    }

    /// SPA シェル（"/" と "/pair/{id}" が共用）。
    pub fn serve_index(&self) -> Response {
        match std::fs::read(self.frontend_dir.join("index.html")) {
            Ok(bytes) => response_with(bytes, "text/html; charset=utf-8", Some("no-cache")),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }

    pub fn serve_sw(&self) -> Response {
        match std::fs::read(self.frontend_dir.join("sw.js")) {
            Ok(bytes) => response_with(bytes, "application/javascript", Some("no-cache")),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }

    /// URL パスに対応する静的ファイルがあれば配信する。無ければ None（proxy へ）。
    pub fn try_serve(&self, url_path: &str) -> Option<Response> {
        let rel = sanitize_url_path(url_path)?;
        let (base, rel, is_icons) = match rel.strip_prefix("icons/") {
            Ok(icon_rel) => (&self.icons_dir, icon_rel.to_path_buf(), true),
            Err(_) => (&self.frontend_dir, rel, false),
        };
        let full = base.join(&rel);
        if !full.is_file() {
            return None;
        }
        let bytes = std::fs::read(&full).ok()?;
        let mime = mime_guess::from_path(&full)
            .first_or_octet_stream()
            .to_string();
        // Vite の /assets/* はファイル名にハッシュが入っており内容が変わらないので
        // 1 年間 immutable キャッシュさせる（icons は対象外）。
        let cache = if !is_icons && rel.starts_with("assets") {
            Some("public, max-age=31536000, immutable")
        } else {
            None
        };
        Some(response_with(bytes, &mime, cache))
    }
}

fn response_with(bytes: Vec<u8>, content_type: &str, cache_control: Option<&str>) -> Response {
    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type);
    if let Some(cc) = cache_control {
        resp = resp.header(header::CACHE_CONTROL, cc);
    }
    resp.body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// URL パスをベースディレクトリ配下の相対パスへ安全に変換する。
/// パストラバーサル（`..`・絶対パス・NUL）は None。
fn sanitize_url_path(url_path: &str) -> Option<PathBuf> {
    let trimmed = url_path.trim_start_matches('/');
    if trimmed.is_empty() || trimmed.contains('\0') {
        return None;
    }
    let path = Path::new(trimmed);
    let mut clean = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Normal(c) => clean.push(c),
            // `..`・ルート・ドライブ等はすべて拒否（正規化で吸収せず即座に None）
            _ => return None,
        }
    }
    if clean.as_os_str().is_empty() {
        None
    } else {
        Some(clean)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> (tempfile::TempDir, StaticCtx) {
        let dir = tempfile::tempdir().unwrap();
        let dist = dir.path().join("dist");
        std::fs::create_dir_all(dist.join("assets")).unwrap();
        std::fs::write(dist.join("index.html"), "<html>app</html>").unwrap();
        std::fs::write(dist.join("sw.js"), "// sw").unwrap();
        std::fs::write(dist.join("assets/index-abc123.js"), "console.log(1)").unwrap();
        std::fs::write(dist.join("manifest.json"), "{}").unwrap();
        let icons = dir.path().join("icons");
        std::fs::create_dir_all(&icons).unwrap();
        std::fs::write(icons.join("abc.png"), b"png").unwrap();
        let ctx = StaticCtx::detect(dist, icons).unwrap();
        (dir, ctx)
    }

    #[test]
    fn detect_requires_index_html() {
        let dir = tempfile::tempdir().unwrap();
        assert!(StaticCtx::detect(dir.path().join("missing"), dir.path().join("icons")).is_none());
    }

    #[test]
    fn index_is_no_cache() {
        let (_d, ctx) = ctx();
        let resp = ctx.serve_index();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.headers()[header::CACHE_CONTROL], "no-cache");
    }

    #[test]
    fn assets_get_immutable_cache() {
        let (_d, ctx) = ctx();
        let resp = ctx.try_serve("/assets/index-abc123.js").unwrap();
        assert_eq!(
            resp.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        let resp = ctx.try_serve("/manifest.json").unwrap();
        assert!(resp.headers().get(header::CACHE_CONTROL).is_none());
    }

    #[test]
    fn icons_served_from_icons_dir() {
        let (_d, ctx) = ctx();
        assert!(ctx.try_serve("/icons/abc.png").is_some());
        assert!(ctx.try_serve("/icons/missing.png").is_none());
    }

    #[test]
    fn missing_file_falls_through() {
        let (_d, ctx) = ctx();
        assert!(ctx.try_serve("/workspaces").is_none());
    }

    #[test]
    fn traversal_is_rejected() {
        let (_d, ctx) = ctx();
        assert!(ctx.try_serve("/../Cargo.toml").is_none());
        assert!(ctx.try_serve("/assets/../../secret").is_none());
        assert!(sanitize_url_path("/a/../b").is_none());
        assert!(sanitize_url_path("//etc/passwd").is_some_and(|p| p == Path::new("etc/passwd")));
    }
}
