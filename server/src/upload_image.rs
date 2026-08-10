//! `POST /upload-image`（Python 側 `api/main.py` の画像アップロード + クリップボード
//! 書き込みの移植）。
//!
//! ターミナルへの画像貼り付け（`useTerminalPaste`/`useQwertyCamera`）用に、
//! アップロードされた画像を一時ディレクトリへ保存し、可能ならホスト OS の
//! クリップボードへも書き込む。クリップボード書き込みに成功した場合はターミナル側で
//! Ctrl+V 相当（`\x16`）を送るだけでよく、失敗時はファイルパスを直接送って
//! エージェント側に貼り付けさせる（`upload-image-to-terminal.js` 参照）。

use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::extract::Multipart;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::auth::RequireAuth;
use crate::errors::{bad_request, too_large, ApiError};
use crate::util::{IS_MACOS, MAX_UPLOAD_SIZE, MSG_UPLOAD_TOO_LARGE};

const CLIPBOARD_WRITE_TIMEOUT_SEC: u64 = 3;
const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];

fn upload_dir() -> PathBuf {
    PathBuf::from("/tmp/any-console-uploads")
}

/// ファイル名用のコンパクトなタイムスタンプ（`%Y%m%d-%H%M%S`、UTC）。
fn timestamp_compact() -> String {
    let (y, mo, d, h, m, s) = crate::util::utc_now_parts();
    format!("{y:04}{mo:02}{d:02}-{h:02}{m:02}{s:02}")
}

fn extension_for(content_type: &str) -> String {
    content_type
        .rsplit('/')
        .next()
        .unwrap_or("bin")
        .replace("jpeg", "jpg")
}

/// AppKit の NSPasteboard に NSImage を書き込む。pbcopy はテキスト専用でバイナリ
/// 画像を扱えないため、osascript 経由で AppleScriptObjC ブリッジを使う。launchd
/// LaunchAgent は既にユーザーの GUI セッション内で動くため、Linux 版のような
/// sudo によるユーザー切り替えは不要。
const MACOS_CLIPBOARD_SCRIPT: &str = r#"
use framework "AppKit"
use scripting additions
set thePath to system attribute "AC_IMAGE_PATH"
set theImage to current application's NSImage's alloc()'s initWithContentsOfFile:thePath
if theImage is missing value then error "failed to load image"
set thePasteboard to current application's NSPasteboard's generalPasteboard()
thePasteboard's clearContents()
thePasteboard's writeObjects:{theImage}
"#;

async fn write_via_stdin_then_wait(
    mut command: Command,
    stdin_data: &[u8],
) -> Option<std::process::ExitStatus> {
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::null());
    command.stderr(std::process::Stdio::piped());
    command.kill_on_drop(true);
    let mut child = command.spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    if stdin.write_all(stdin_data).await.is_err() {
        return None;
    }
    drop(stdin);
    let wait = tokio::time::timeout(
        Duration::from_secs(CLIPBOARD_WRITE_TIMEOUT_SEC),
        child.wait(),
    )
    .await;
    match wait {
        Ok(Ok(status)) => Some(status),
        _ => None,
    }
}

async fn write_image_to_clipboard_macos(filepath: &Path) -> bool {
    if which("osascript").is_none() {
        return false;
    }
    let mut command = Command::new("osascript");
    command.arg("-").env("AC_IMAGE_PATH", filepath);
    match write_via_stdin_then_wait(command, MACOS_CLIPBOARD_SCRIPT.as_bytes()).await {
        Some(status) if status.success() => {
            tracing::info!("osascript clipboard ok");
            true
        }
        _ => {
            tracing::warn!("osascript clipboard failed");
            false
        }
    }
}

async fn write_image_to_clipboard_linux(filepath: &Path, content_type: &str) -> bool {
    if which("xclip").is_none() {
        return false;
    }
    let mime = if content_type.starts_with("image/") {
        content_type.to_string()
    } else {
        "image/png".to_string()
    };
    let user = std::env::var("SUDO_USER")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var("USER").ok().filter(|v| !v.is_empty()))
        .unwrap_or_else(crate::system::current_user);
    let Ok(data) = tokio::fs::read(filepath).await else {
        return false;
    };
    let mut command = Command::new("sudo");
    command.args([
        "-u",
        &user,
        "env",
        "DISPLAY=:0",
        "xclip",
        "-selection",
        "clipboard",
        "-t",
        &mime,
    ]);
    match write_via_stdin_then_wait(command, &data).await {
        Some(status) if status.success() => {
            tracing::info!("xclip ok user={user}");
            true
        }
        _ => {
            tracing::warn!("xclip failed user={user}");
            false
        }
    }
}

async fn write_image_to_clipboard(filepath: &Path, content_type: &str) -> bool {
    if IS_MACOS {
        write_image_to_clipboard_macos(filepath).await
    } else {
        write_image_to_clipboard_linux(filepath, content_type).await
    }
}

fn which(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

pub async fn upload_image(
    _auth: RequireAuth,
    mut multipart: Multipart,
) -> Result<axum::Json<Value>, ApiError> {
    let mut content_type = String::new();
    let mut data: Option<axum::body::Bytes> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| bad_request(format!("Invalid multipart body: {e}")))?
    {
        if field.name() == Some("file") {
            content_type = field.content_type().unwrap_or_default().to_string();
            data = Some(
                field
                    .bytes()
                    .await
                    .map_err(|_| too_large(MSG_UPLOAD_TOO_LARGE))?,
            );
        }
    }
    let Some(data) = data else {
        // Python 版（FastAPI の必須 UploadFile）はフィールド欠落を 422 で返して
        // いた。git_files.rs のアップロードと同じく 422 に揃える。
        return Err(crate::errors::unprocessable("file field required"));
    };
    if !ALLOWED_IMAGE_TYPES.contains(&content_type.as_str()) {
        return Err(bad_request(format!("Unsupported type: {content_type}")));
    }
    if data.len() > MAX_UPLOAD_SIZE {
        return Err(too_large(MSG_UPLOAD_TOO_LARGE));
    }

    let dir = upload_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| crate::errors::server_error(format!("Cannot create upload dir: {e}")))?;
    let ext = extension_for(&content_type);
    let filename = format!(
        "{}-{}.{ext}",
        timestamp_compact(),
        crate::util::token_hex(4)
    );
    let filepath = dir.join(&filename);
    tokio::fs::write(&filepath, &data)
        .await
        .map_err(|e| crate::errors::server_error(format!("Cannot write upload: {e}")))?;

    let clipboard_ok = write_image_to_clipboard(&filepath, &content_type).await;
    Ok(axum::Json(json!({
        "status": "ok",
        "path": filepath.to_string_lossy(),
        "clipboard": clipboard_ok,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_for_maps_jpeg_to_jpg() {
        assert_eq!(extension_for("image/jpeg"), "jpg");
        assert_eq!(extension_for("image/png"), "png");
        assert_eq!(extension_for("image/gif"), "gif");
        assert_eq!(extension_for("image/webp"), "webp");
    }

    #[test]
    fn timestamp_compact_has_expected_shape() {
        let ts = timestamp_compact();
        assert_eq!(ts.len(), 15, "{ts}"); // YYYYMMDD-HHMMSS
        assert_eq!(ts.as_bytes()[8], b'-');
        assert!(ts
            .chars()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit()));
    }

    #[test]
    fn which_finds_a_binary_known_to_exist() {
        // sh はどの CI/コンテナ環境にも存在する前提。
        assert!(which("sh").is_some());
        assert!(which("definitely-not-a-real-binary-xyz").is_none());
    }
}
