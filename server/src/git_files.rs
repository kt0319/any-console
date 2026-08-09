//! ワークスペースのファイル閲覧・操作 API（Python 側 `api/routers/git_files.py` +
//! `git_file_utils.py` の移植）。

use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::auth::RequireAuth;
use crate::errors::{
    bad_request, conflict, forbidden, not_found, server_error, too_large, ApiError,
};
use crate::git_helpers::{
    resolve_and_validate_workspace_path, resolve_workspace_file, validate_commit_ref,
};
use crate::git_utils::{run_git_raw, GitError, GIT_SHORT_TIMEOUT_SEC};
use crate::state::AppState;
use crate::util::{base64_standard, JsonBody, QueryParams};

const MAX_UPLOAD_SIZE: usize = 10 * 1024 * 1024;
const MAX_ZIP_DOWNLOAD_SIZE: u64 = 200 * 1024 * 1024;
const MAX_FILE_SIZE: u64 = 512 * 1024;
const MAX_IMAGE_PREVIEW_SIZE: u64 = 5 * 1024 * 1024;

const BINARY_EXTENSIONS: &[&str] = &[
    ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar", ".exe", ".dll", ".so", ".dylib", ".bin", ".pdf",
    ".doc", ".docx", ".xls", ".xlsx", ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".woff",
    ".woff2", ".ttf", ".otf", ".eot",
];
const IMAGE_EXTENSIONS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
];

fn ext_of(path: &str) -> String {
    FsPath::new(path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

/// PermissionError → 403 / その他 OS エラー → 500（Python `file_operation_guard`）。
fn map_io_error(operation_name: &str, e: std::io::Error) -> ApiError {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        forbidden("Permission denied")
    } else {
        server_error(format!("{operation_name}: {e}"))
    }
}

/// 空・None は None、それ以外は commit ref として検証（`validate_optional_commit_ref`）。
fn validate_optional_commit_ref(git_ref: Option<&str>) -> Result<Option<String>, ApiError> {
    match git_ref.map(str::trim).filter(|s| !s.is_empty()) {
        Some(v) => validate_commit_ref(v).map(Some),
        None => Ok(None),
    }
}

async fn run_raw_git_checked(
    args: &[&str],
    cwd: &FsPath,
) -> Result<crate::git_utils::GitOutput, ApiError> {
    match run_git_raw(args, cwd, GIT_SHORT_TIMEOUT_SEC, &[]).await {
        Ok(out) => Ok(out),
        Err(GitError::Timeout) => Err(crate::errors::timeout_error("Git operation timed out")),
        Err(GitError::Os(e)) => Err(server_error(format!("Git operation failed: {e}"))),
    }
}

/// バイナリ安全な raw 実行（stdout をバイト列で返す）。
async fn run_raw_git_bytes(args: &[&str], cwd: &FsPath) -> Result<(i32, Vec<u8>), ApiError> {
    let mut command = tokio::process::Command::new("git");
    command.args(args).kill_on_drop(true).current_dir(cwd);
    let fut = command.output();
    match tokio::time::timeout(
        std::time::Duration::from_secs_f64(GIT_SHORT_TIMEOUT_SEC),
        fut,
    )
    .await
    {
        Ok(Ok(out)) => Ok((out.status.code().unwrap_or(-1), out.stdout)),
        Ok(Err(e)) => Err(server_error(format!("Git operation failed: {e}"))),
        Err(_) => Err(crate::errors::timeout_error("Git operation timed out")),
    }
}

// ─── コンテンツ応答の組み立て（git_file_utils.py）───────────────────────────

fn build_content_response(path: &str, ext: &str, raw: &[u8], size: u64) -> Value {
    let filename = FsPath::new(path)
        .file_name()
        .map(|f| f.to_string_lossy())
        .unwrap_or_default();
    if IMAGE_EXTENSIONS.contains(&ext) {
        if size > MAX_IMAGE_PREVIEW_SIZE {
            return json!({"status": "ok", "path": path, "image": true, "too_large": true, "size": size});
        }
        let mime_type = mime_guess::from_path(filename.as_ref())
            .first_raw()
            .unwrap_or("application/octet-stream");
        let data_url = format!("data:{mime_type};base64,{}", base64_standard(raw));
        return json!({
            "status": "ok", "path": path, "image": true, "size": size,
            "mime_type": mime_type, "data_url": data_url,
        });
    }
    if BINARY_EXTENSIONS.contains(&ext) {
        return json!({"status": "ok", "path": path, "binary": true, "size": size});
    }
    if size > MAX_FILE_SIZE {
        return json!({"status": "ok", "path": path, "too_large": true, "size": size});
    }
    let content = String::from_utf8_lossy(raw);
    json!({"status": "ok", "path": path, "content": content, "size": size})
}

pub(crate) fn read_file_content_response(path: &str, target: &FsPath) -> Result<Value, ApiError> {
    let size = target
        .metadata()
        .map_err(|e| map_io_error("Stat failed", e))?
        .len();
    let ext = ext_of(path);
    let needs_read = !(BINARY_EXTENSIONS.contains(&ext.as_str())
        || (IMAGE_EXTENSIONS.contains(&ext.as_str()) && size > MAX_IMAGE_PREVIEW_SIZE)
        || (!IMAGE_EXTENSIONS.contains(&ext.as_str()) && size > MAX_FILE_SIZE));
    let raw = if needs_read {
        std::fs::read(target).map_err(|e| map_io_error("Read failed", e))?
    } else {
        Vec::new()
    };
    Ok(build_content_response(path, &ext, &raw, size))
}

// ─── ディレクトリ一覧（git_file_utils.py）───────────────────────────────────

async fn gitignored_names(target: &FsPath) -> std::collections::HashSet<String> {
    let result = run_git_raw(
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
        target,
        GIT_SHORT_TIMEOUT_SEC,
        &[],
    )
    .await;
    let Ok(out) = result else {
        return Default::default();
    };
    if out.code != 0 {
        return Default::default();
    }
    out.stdout
        .lines()
        .filter_map(|line| {
            let name = line.trim_end_matches('/');
            (!name.is_empty() && !name.contains('/')).then(|| name.to_string())
        })
        .collect()
}

fn count_directory_entries(path: &FsPath) -> Option<i64> {
    let mut count = 0;
    for entry in std::fs::read_dir(path).ok()? {
        let entry = entry.ok()?;
        if entry.file_name() == ".git" {
            continue;
        }
        count += 1;
    }
    Some(count)
}

fn build_symlink_entry(
    ws_path: &FsPath,
    target: &FsPath,
    entry: &std::fs::DirEntry,
    is_ignored: bool,
) -> Value {
    let mut item = json!({"name": entry.file_name().to_string_lossy(), "type": "symlink"});
    if is_ignored {
        item["gitignored"] = json!(true);
    }
    match std::fs::read_link(entry.path()) {
        Ok(link_target) => {
            let target_raw = link_target.to_string_lossy().into_owned();
            item["link_target"] = json!(target_raw);
            let resolved = target.join(&link_target);
            let resolved = resolved.canonicalize().unwrap_or(resolved);
            let ws_root = ws_path
                .canonicalize()
                .unwrap_or_else(|_| ws_path.to_path_buf());
            match resolved.strip_prefix(&ws_root) {
                Err(_) => {
                    item["target_type"] = json!("outside");
                }
                Ok(rel) => {
                    let rel_str = rel.to_string_lossy();
                    item["target_path"] = json!(if rel_str.is_empty() || rel_str == "." {
                        "".to_string()
                    } else {
                        rel_str.into_owned()
                    });
                    item["target_type"] = if resolved.is_dir() {
                        json!("dir")
                    } else if resolved.is_file() {
                        json!("file")
                    } else {
                        json!("missing")
                    };
                }
            }
        }
        Err(_) => {
            item["target_type"] = json!("missing");
        }
    }
    item
}

fn build_file_or_dir_entry(entry: &std::fs::DirEntry, is_ignored: bool) -> Value {
    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
    let entry_type = if is_dir { "dir" } else { "file" };
    let mut item = json!({"name": entry.file_name().to_string_lossy(), "type": entry_type});
    if is_ignored {
        item["gitignored"] = json!(true);
    }
    if let Ok(stat) = entry.metadata() {
        let mtime = stat
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        item["mtime"] = json!(mtime);
        if entry_type == "file" {
            item["size"] = json!(stat.len());
        } else if let Some(count) = count_directory_entries(&entry.path()) {
            item["count"] = json!(count);
        }
    }
    item
}

pub(crate) async fn list_directory_entries(
    ws_path: &FsPath,
    target: &FsPath,
) -> Result<Vec<Value>, ApiError> {
    let ignored = gitignored_names(target).await;
    let mut entries = Vec::new();
    let read_dir =
        std::fs::read_dir(target).map_err(|e| map_io_error("List directory failed", e))?;
    for entry in read_dir {
        let entry = entry.map_err(|e| map_io_error("List directory failed", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let is_ignored = ignored.contains(&name);
        let is_symlink = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
        if is_symlink {
            entries.push(build_symlink_entry(ws_path, target, &entry, is_ignored));
        } else {
            entries.push(build_file_or_dir_entry(&entry, is_ignored));
        }
    }
    let type_order = |t: &str| match t {
        "dir" => 0,
        "symlink" => 1,
        "file" => 2,
        _ => 3,
    };
    entries.sort_by_key(|e| {
        (
            type_order(e["type"].as_str().unwrap_or("")),
            e["name"].as_str().unwrap_or("").to_lowercase(),
        )
    });
    Ok(entries)
}

// ─── ref 指定の閲覧 ─────────────────────────────────────────────────────────

fn git_tree_spec(git_ref: &str, rel_path: &str) -> String {
    if rel_path.is_empty() {
        git_ref.to_string()
    } else {
        format!("{git_ref}:{rel_path}")
    }
}

async fn list_directory_entries_at_ref(
    ws_path: &FsPath,
    rel_path: &str,
    git_ref: &str,
) -> Result<Vec<Value>, ApiError> {
    let tree_spec = git_tree_spec(git_ref, rel_path);
    let result = run_raw_git_checked(&["ls-tree", "-z", &tree_spec], ws_path).await?;
    if result.code != 0 {
        return Err(not_found("Directory not found"));
    }
    let mut entries = Vec::new();
    for record in result.stdout.split('\0') {
        if record.is_empty() {
            continue;
        }
        let Some((meta, entry_name)) = record.split_once('\t') else {
            continue;
        };
        let mut meta_parts = meta.splitn(3, ' ');
        let (_mode, obj_type) = (meta_parts.next(), meta_parts.next().unwrap_or(""));
        entries.push(json!({
            "name": entry_name,
            "type": if obj_type == "tree" { "dir" } else { "file" },
        }));
    }
    entries.sort_by_key(|e| {
        (
            if e["type"] == "dir" { 0 } else { 1 },
            e["name"].as_str().unwrap_or("").to_lowercase(),
        )
    });
    Ok(entries)
}

async fn read_file_content_at_ref(
    ws_path: &FsPath,
    path: &str,
    git_ref: &str,
) -> Result<Value, ApiError> {
    let blob_spec = git_tree_spec(git_ref, path);
    let type_result = run_raw_git_checked(&["cat-file", "-t", &blob_spec], ws_path).await?;
    if type_result.code != 0 || type_result.stdout.trim() != "blob" {
        return Err(not_found("File not found"));
    }
    let (code, raw) = run_raw_git_bytes(&["show", &blob_spec], ws_path).await?;
    if code != 0 {
        return Err(not_found("File not found"));
    }
    let size = raw.len() as u64;
    Ok(build_content_response(path, &ext_of(path), &raw, size))
}

// ─── ルート ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct FilesQuery {
    #[serde(default)]
    path: String,
    #[serde(default)]
    r#ref: Option<String>,
}

pub async fn list_files(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<FilesQuery>,
) -> Result<Json<Value>, ApiError> {
    let (ws_path, target, rel) = resolve_workspace_file(&state, &name, &q.path).await?;
    let rel_path = {
        let s = rel.to_string_lossy().into_owned();
        if s == "." {
            String::new()
        } else {
            s
        }
    };
    if let Some(ref_value) = validate_optional_commit_ref(q.r#ref.as_deref())? {
        let entries = list_directory_entries_at_ref(&ws_path, &rel_path, &ref_value).await?;
        return Ok(Json(
            json!({"status": "ok", "path": rel_path, "entries": entries}),
        ));
    }
    if !target.is_dir() {
        return Err(not_found("Directory not found"));
    }
    let entries = list_directory_entries(&ws_path, &target).await?;
    Ok(Json(
        json!({"status": "ok", "path": rel_path, "entries": entries}),
    ))
}

#[derive(Deserialize)]
pub struct FileContentQuery {
    path: String,
    #[serde(default)]
    r#ref: Option<String>,
}

pub async fn file_content(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<FileContentQuery>,
) -> Result<Json<Value>, ApiError> {
    let (ws_path, target, rel) = resolve_workspace_file(&state, &name, &q.path).await?;
    let rel_path = rel.to_string_lossy().into_owned();
    if rel_path == "." {
        return Err(not_found("File not found"));
    }
    if let Some(ref_value) = validate_optional_commit_ref(q.r#ref.as_deref())? {
        return read_file_content_at_ref(&ws_path, &rel_path, &ref_value)
            .await
            .map(Json);
    }
    if target.is_symlink() {
        return Err(bad_request("Symlinks not supported"));
    }
    if !target.is_file() {
        return Err(not_found("File not found"));
    }
    read_file_content_response(&q.path, &target).map(Json)
}

// ─── upload ─────────────────────────────────────────────────────────────────

pub async fn upload(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    let mut path = String::new();
    let mut overwrite = false;
    let mut file_name: Option<String> = None;
    let mut data: Option<axum::body::Bytes> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| bad_request(format!("Invalid multipart body: {e}")))?
    {
        match field.name().unwrap_or("") {
            "path" => path = field.text().await.unwrap_or_default(),
            "overwrite" => {
                let v = field.text().await.unwrap_or_default().to_lowercase();
                overwrite = matches!(v.as_str(), "true" | "1" | "on" | "yes");
            }
            "file" => {
                file_name = field.file_name().map(String::from);
                data = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|_| too_large("File too large (max 10MB)"))?,
                );
            }
            _ => {}
        }
    }
    let Some(data) = data else {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "file field required",
        ));
    };

    let (ws_path, target_dir, rel_dir) = resolve_workspace_file(&state, &name, &path).await?;
    if target_dir.exists() && !target_dir.is_dir() {
        return Err(bad_request(format!("Not a directory: {path}")));
    }
    if !target_dir.is_dir() {
        // フォルダごとドロップ時にサブディレクトリを作成する
        std::fs::create_dir_all(&target_dir)
            .map_err(|e| map_io_error("Cannot create directory", e))?;
    }

    let filename: String = file_name.unwrap_or_default().trim().nfc().collect();
    if filename.is_empty()
        || filename == "."
        || filename == ".."
        || filename.contains('/')
        || filename.contains('\\')
    {
        return Err(bad_request("Invalid file name"));
    }

    let target_file = target_dir.join(&filename);
    // resolve + 配下検証（Python validate_workspace_relative_target 相当）
    resolve_and_validate_workspace_path(&ws_path, &rel_dir.join(&filename).to_string_lossy())?;
    if target_file.exists() {
        if target_file.is_dir() {
            return Err(conflict(format!("Directory exists at: {filename}")));
        }
        if !overwrite {
            return Err(conflict(format!("File already exists: {filename}")));
        }
    }

    if data.len() > MAX_UPLOAD_SIZE {
        return Err(too_large("File too large (max 10MB)"));
    }
    std::fs::write(&target_file, &data).map_err(|e| map_io_error("Cannot write file", e))?;

    let rel_path = rel_dir.join(&filename).to_string_lossy().into_owned();
    Ok(Json(
        json!({"status": "ok", "path": rel_path, "size": data.len()}),
    ))
}

// ─── rename / delete ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RenameRequest {
    src: String,
    dest: String,
}

pub async fn rename(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<RenameRequest>,
) -> Result<Json<Value>, ApiError> {
    let (_, src_target, _) = resolve_workspace_file(&state, &name, &body.src).await?;
    let (_, dest_target, _) = resolve_workspace_file(&state, &name, &body.dest).await?;
    if !src_target.exists() {
        return Err(not_found("Source not found"));
    }
    if !dest_target.parent().is_some_and(FsPath::exists) {
        return Err(bad_request("Destination directory not found"));
    }
    if dest_target.exists() {
        return Err(conflict("Destination already exists"));
    }
    std::fs::rename(&src_target, &dest_target).map_err(|e| map_io_error("Rename failed", e))?;
    Ok(Json(json!({"status": "ok"})))
}

#[derive(Deserialize)]
pub struct DeleteFileRequest {
    path: String,
}

pub async fn delete_file(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    JsonBody(body): JsonBody<DeleteFileRequest>,
) -> Result<Json<Value>, ApiError> {
    let (_, target, _) = resolve_workspace_file(&state, &name, &body.path).await?;
    if !target.exists() {
        return Err(not_found("File not found"));
    }
    let result = if target.is_dir() {
        std::fs::remove_dir_all(&target)
    } else {
        std::fs::remove_file(&target)
    };
    result.map_err(|e| map_io_error("Delete failed", e))?;
    Ok(Json(json!({"status": "ok"})))
}

// ─── download ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DownloadQuery {
    path: String,
}

/// TempDir を応答ストリーム終了まで保持し、drop で自動削除するボディストリーム。
struct TempDirStream {
    inner: tokio_util::io::ReaderStream<tokio::fs::File>,
    _tmp: tempfile::TempDir,
}

impl futures_util::Stream for TempDirStream {
    type Item = Result<axum::body::Bytes, std::io::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::pin::Pin::new(&mut self.inner).poll_next(cx)
    }
}

fn attachment_response(body: Body, filename: &str, media_type: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, media_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename.replace('"', "")),
        )
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// ディレクトリを zip 化する（Python `_create_zip_archive` と同一規則:
/// .git は除外・symlink はスキップ・圧縮前合計が上限超過なら 413）。
fn create_zip_archive(target: &FsPath, tmp_dir: &FsPath) -> Result<PathBuf, ApiError> {
    use zip::write::SimpleFileOptions;
    let target_name = target
        .file_name()
        .map(|n| n.to_string_lossy())
        .unwrap_or_default();
    let archive_path = tmp_dir.join(format!("{target_name}.zip"));
    let parent = target.parent().unwrap_or(target);
    let file = std::fs::File::create(&archive_path)
        .map_err(|e| map_io_error("Cannot create archive", e))?;
    let mut zf = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut total_size: u64 = 0;
    let mut stack = vec![target.to_path_buf()];
    while let Some(current) = stack.pop() {
        let rel = current
            .strip_prefix(parent)
            .unwrap_or(&current)
            .to_string_lossy();
        zf.add_directory(rel.as_ref(), options)
            .map_err(|e| server_error(format!("Cannot create archive: {e}")))?;
        let mut children: Vec<_> = std::fs::read_dir(&current)
            .map_err(|e| map_io_error("Cannot create archive", e))?
            .filter_map(Result::ok)
            .collect();
        children.sort_by_key(|e| e.file_name());
        for entry in children {
            let epath = entry.path();
            let ftype = entry
                .file_type()
                .map_err(|e| map_io_error("Cannot create archive", e))?;
            if ftype.is_symlink() {
                continue;
            }
            if ftype.is_dir() {
                if entry.file_name() == ".git" {
                    continue;
                }
                stack.push(epath);
            } else if ftype.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                total_size += size;
                if total_size > MAX_ZIP_DOWNLOAD_SIZE {
                    return Err(too_large(format!(
                        "Folder too large to download (max {}MB)",
                        MAX_ZIP_DOWNLOAD_SIZE / (1024 * 1024)
                    )));
                }
                let erel = epath
                    .strip_prefix(parent)
                    .unwrap_or(&epath)
                    .to_string_lossy()
                    .into_owned();
                zf.start_file(erel, options)
                    .map_err(|e| server_error(format!("Cannot create archive: {e}")))?;
                let mut src = std::fs::File::open(&epath)
                    .map_err(|e| map_io_error("Cannot create archive", e))?;
                std::io::copy(&mut src, &mut zf)
                    .map_err(|e| map_io_error("Cannot create archive", e))?;
            }
        }
    }
    zf.finish()
        .map_err(|e| server_error(format!("Cannot create archive: {e}")))?;
    Ok(archive_path)
}

pub async fn download(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    _auth: RequireAuth,
    QueryParams(q): QueryParams<DownloadQuery>,
) -> Result<Response, ApiError> {
    let (_, target, _) = resolve_workspace_file(&state, &name, &q.path).await?;

    if target.is_file() {
        let file = tokio::fs::File::open(&target)
            .await
            .map_err(|e| map_io_error("Read failed", e))?;
        let stream = tokio_util::io::ReaderStream::new(file);
        let filename = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Ok(attachment_response(
            Body::from_stream(stream),
            &filename,
            "application/octet-stream",
        ));
    }

    if target.is_dir() {
        let tmp = tempfile::Builder::new()
            .prefix("any-console-zip-")
            .tempdir()
            .map_err(|e| map_io_error("Cannot create archive", e))?;
        let tmp_path = tmp.path().to_path_buf();
        let target_clone = target.clone();
        // zip 生成は同期 I/O のため blocking スレッドで行う
        let archive_path =
            tokio::task::spawn_blocking(move || create_zip_archive(&target_clone, &tmp_path))
                .await
                .map_err(|e| server_error(format!("Cannot create archive: {e}")))??;
        let file = tokio::fs::File::open(&archive_path)
            .await
            .map_err(|e| map_io_error("Cannot create archive", e))?;
        let stream = TempDirStream {
            inner: tokio_util::io::ReaderStream::new(file),
            _tmp: tmp,
        };
        let dirname = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Ok(attachment_response(
            Body::from_stream(stream),
            &format!("{dirname}.zip"),
            "application/zip",
        ));
    }

    Err(not_found("File not found"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_response_by_extension() {
        let img = build_content_response("logo.png", ".png", b"\x89PNG", 4);
        assert_eq!(img["image"], true);
        assert!(img["data_url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));

        let bin = build_content_response("app.zip", ".zip", b"", 100);
        assert_eq!(bin["binary"], true);
        assert!(bin.get("content").is_none());

        let text = build_content_response("main.rs", ".rs", b"fn main() {}", 12);
        assert_eq!(text["content"], "fn main() {}");

        let large = build_content_response("big.txt", ".txt", b"", MAX_FILE_SIZE + 1);
        assert_eq!(large["too_large"], true);

        let large_img = build_content_response("big.png", ".png", b"", MAX_IMAGE_PREVIEW_SIZE + 1);
        assert_eq!(large_img["image"], true);
        assert_eq!(large_img["too_large"], true);
    }

    #[test]
    fn tree_spec_building() {
        assert_eq!(git_tree_spec("abc123", ""), "abc123");
        assert_eq!(git_tree_spec("abc123", "src/lib.rs"), "abc123:src/lib.rs");
    }

    #[test]
    fn optional_ref_validation() {
        assert_eq!(validate_optional_commit_ref(None).unwrap(), None);
        assert_eq!(validate_optional_commit_ref(Some(" ")).unwrap(), None);
        assert_eq!(
            validate_optional_commit_ref(Some("abcd12")).unwrap(),
            Some("abcd12".to_string())
        );
        assert!(validate_optional_commit_ref(Some("no!")).is_err());
    }
}
