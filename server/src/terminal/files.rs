//! ターミナルセッションのファイル操作（cwd・一覧・アップロード・ダウンロード・パスを開く）。

use super::*;

pub async fn get_terminal_session_cwd(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
) -> Result<Json<Value>, ApiError> {
    state.terminal_session(&session_id).await?;
    let name = state.paths.tmux_session_name(&session_id);
    let cwd = tmux::get_session_cwd(&name)
        .await
        .ok_or_else(|| not_found("CWD unavailable"))?;
    Ok(Json(json!({ "cwd": cwd })))
}

async fn resolve_terminal_session_file(
    state: &Arc<AppState>,
    session_id: &str,
    path: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), ApiError> {
    let root = terminal_session_root(state, session_id).await?;
    let (target, rel) = resolve_and_validate_workspace_path(&root, path)?;
    Ok((root, target, rel))
}

async fn terminal_session_root(
    state: &Arc<AppState>,
    session_id: &str,
) -> Result<PathBuf, ApiError> {
    state.terminal_session(session_id).await?;
    let name = state.paths.tmux_session_name(session_id);
    let cwd = tmux::get_session_cwd(&name)
        .await
        .ok_or_else(|| not_found("CWD unavailable"))?;
    Ok(PathBuf::from(&cwd)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&cwd)))
}

#[derive(Deserialize)]
pub struct PathQuery {
    #[serde(default)]
    path: String,
}

pub async fn list_terminal_session_files(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<PathQuery>,
) -> Result<Json<Value>, ApiError> {
    let (root, target, rel) =
        resolve_terminal_session_file(&state, &session_id, &query.path).await?;
    crate::git_files::list_dir_response(&root, &target, &rel)
        .await
        .map(Json)
}

pub async fn upload_terminal_session_file(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let root = terminal_session_root(&state, &session_id).await?;
    crate::git_files::save_multipart_upload(&root, multipart).await
}

pub async fn rename_terminal_session_file(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<crate::git_files::RenameRequest>,
) -> Result<Json<Value>, ApiError> {
    let root = terminal_session_root(&state, &session_id).await?;
    crate::git_files::rename_under(&root, &body)
}

pub async fn delete_terminal_session_file(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<crate::git_files::DeleteFileRequest>,
) -> Result<Json<Value>, ApiError> {
    let root = terminal_session_root(&state, &session_id).await?;
    crate::git_files::delete_under(&root, &body.path)
}

pub async fn download_terminal_session_file(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<crate::git_files::DownloadQuery>,
) -> Result<Response, ApiError> {
    let root = terminal_session_root(&state, &session_id).await?;
    crate::git_files::download_under(&root, &query.path).await
}

#[derive(Deserialize)]
pub struct FileContentQuery {
    path: String,
}

pub async fn get_terminal_session_file_content(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<FileContentQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_, target, rel) = resolve_terminal_session_file(&state, &session_id, &query.path).await?;
    let rel_path = rel.to_string_lossy().into_owned();
    crate::git_files::file_content_or_error(&rel_path, &target, &rel).map(Json)
}

/// ターミナルに表示されたパス文字列を実ファイルへ解決する。`~` はホーム、相対パスは
/// セッションの cwd 基準。ワークスペース内外は問わない（ターミナル自体が同じ権限を持つ）。
fn resolve_terminal_open_path(
    cwd: &std::path::Path,
    home: Option<&std::path::Path>,
    input: &str,
) -> PathBuf {
    let expanded = match (input.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(input),
    };
    if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    }
}

async fn resolve_terminal_open_file(
    state: &Arc<AppState>,
    session_id: &str,
    input: &str,
) -> Result<PathBuf, ApiError> {
    let cwd = terminal_session_root(state, session_id).await?;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let candidate = resolve_terminal_open_path(&cwd, home.as_deref(), input.trim());
    let target = candidate
        .canonicalize()
        .map_err(|_| not_found("File not found"))?;
    if !target.is_file() {
        return Err(not_found("File not found"));
    }
    Ok(target)
}

pub async fn open_terminal_session_path(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<FileContentQuery>,
) -> Result<Json<Value>, ApiError> {
    let target = resolve_terminal_open_file(&state, &session_id, &query.path).await?;
    let mut response =
        crate::git_files::read_file_content_response(&target.to_string_lossy(), &target)?;
    if let Some(rel) = session_workspace_relative_path(&state, &session_id, &target).await {
        response["workspace_path"] = json!(rel);
    }
    Ok(Json(response))
}

/// ワークスペース未紐付け・解決失敗・配下でない場合は None（プレビュー表示に倒す）。
async fn session_workspace_relative_path(
    state: &Arc<AppState>,
    session_id: &str,
    target: &std::path::Path,
) -> Option<String> {
    let session = state.terminal_session(session_id).await.ok()?;
    let workspace = session.lock().await.workspace.clone()?;
    let root = resolve_workspace_path(&state.config, &workspace)
        .await
        .ok()?;
    relative_within(&root, target)
}

fn relative_within(root: &std::path::Path, target: &std::path::Path) -> Option<String> {
    let root = root.canonicalize().ok()?;
    let rel = target.strip_prefix(&root).ok()?;
    let rel = rel.to_string_lossy();
    (!rel.is_empty()).then(|| rel.into_owned())
}

pub async fn download_terminal_session_open_path(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    _auth: RequireAuth,
    QueryParams(query): QueryParams<FileContentQuery>,
) -> Result<Response, ApiError> {
    let target = resolve_terminal_open_file(&state, &session_id, &query.path).await?;
    crate::git_files::download_file(&target).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_path_resolves_relative_home_and_absolute() {
        let cwd = std::path::Path::new("/work/proj");
        let home = std::path::Path::new("/home/me");
        assert_eq!(
            resolve_terminal_open_path(cwd, Some(home), "src/a.rs"),
            PathBuf::from("/work/proj/src/a.rs")
        );
        assert_eq!(
            resolve_terminal_open_path(cwd, Some(home), "~/x.txt"),
            PathBuf::from("/home/me/x.txt")
        );
        assert_eq!(
            resolve_terminal_open_path(cwd, Some(home), "/etc/hosts"),
            PathBuf::from("/etc/hosts")
        );
        assert_eq!(
            resolve_terminal_open_path(cwd, None, "~/x.txt"),
            PathBuf::from("/work/proj/~/x.txt")
        );
    }

    #[test]
    fn relative_within_returns_path_only_under_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let canonical_root = root.path().canonicalize().unwrap();
        let inside = canonical_root.join("src/a.rs");
        assert_eq!(
            relative_within(root.path(), &inside),
            Some("src/a.rs".to_string())
        );
        assert_eq!(relative_within(root.path(), &canonical_root), None);
        assert_eq!(
            relative_within(
                root.path(),
                &outside.path().canonicalize().unwrap().join("a.rs")
            ),
            None
        );
    }
}
