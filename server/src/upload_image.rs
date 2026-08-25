//! `POST /upload-image`（Python 側 `api/main.py` の画像アップロード + クリップボード
//! 書き込みの移植）。
//!
//! ターミナルへの画像貼り付け（`useTerminalPaste`/`useQwertyCamera`）用に、
//! アップロードされた画像を一時ディレクトリへ保存し、可能ならホスト OS の
//! クリップボードへも書き込む。クリップボード書き込みに成功した場合はターミナル側で
//! Ctrl+V 相当（`\x16`）を送るだけでよく、失敗時はファイルパスを直接送って
//! エージェント側に貼り付けさせる（`upload-image-to-terminal.js` 参照）。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use axum::extract::{Multipart, State};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::auth::RequireAuth;
use crate::errors::{bad_request, too_large, ApiError};
use crate::subprocess::which;
use crate::util::{IS_MACOS, MAX_UPLOAD_SIZE, MSG_UPLOAD_TOO_LARGE};

const CLIPBOARD_WRITE_TIMEOUT_SEC: u64 = 3;
const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];
/// 保持するアップロード画像の最大件数。ターミナルへ貼り付けてエージェントに
/// 読ませるための一時ファイルなので直近数件あれば十分（保存先が data/ 配下で
/// 再起動を跨いで残るため、掃除しないと1件最大10MBのファイルが際限なく増える。
/// 件数上限ならディスク使用量もこの件数×最大サイズで頭打ちになる）。
const MAX_KEPT_UPLOADS: usize = 10;

/// 応答を返す前（書き込み〜クリップボード転送中）のアップロードパスの集合。
/// prune はここに載っているファイルを削除候補から除外する — 同一秒内に並行
/// アップロードが重なると、名前の辞書順がランダムサフィックス順になり、
/// 他リクエストの書き込み直後のファイルが「最古」側に並んで削除され得るため、
/// 自分のパスだけでなく in-flight 全件を保護する必要がある。
fn in_flight_uploads() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// in-flight 登録の RAII ガード。ハンドラ途中のエラー return でも drop で
/// 確実に登録解除される。
struct InFlightUpload(PathBuf);

impl InFlightUpload {
    fn register(path: PathBuf) -> Self {
        in_flight_uploads().lock().unwrap().insert(path.clone());
        InFlightUpload(path)
    }
}

impl Drop for InFlightUpload {
    fn drop(&mut self) {
        in_flight_uploads().lock().unwrap().remove(&self.0);
    }
}

/// in-flight を除いた候補から直近 `keep` 件を残して古いアップロードを削除する
/// （新規アップロードのたびに実行。ディレクトリの中身は高々 keep + 同時
/// アップロード数 + α 件なので走査コストは無視できる）。ファイル名の先頭が
/// UTC タイムスタンプ（`YYYYMMDD-HHMMSS`）のため、名前の辞書順がおおむね
/// 時刻順になる — mtime には依存しない。
fn prune_old_uploads(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let in_flight = in_flight_uploads().lock().unwrap().clone();
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && !in_flight.contains(p))
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort();
    let excess = files.len() - keep;
    for path in &files[..excess] {
        if let Err(e) = std::fs::remove_file(path) {
            // NotFound は並行する prune が先に消しただけなので正常系として無視
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!("upload prune failed ({}): {e}", path.display());
            }
        }
    }
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
        .unwrap_or_else(crate::system_info::current_user);
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

pub async fn upload_image(
    State(state): State<std::sync::Arc<crate::state::AppState>>,
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

    let dir = state.paths.uploads_dir();
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
    // 応答を返すまで並行リクエストの prune から保護する（ガードの drop で解除）。
    let _in_flight = InFlightUpload::register(filepath.clone());
    tokio::fs::write(&filepath, &data)
        .await
        .map_err(|e| crate::errors::server_error(format!("Cannot write upload: {e}")))?;
    // 書き込み後に、in-flight 分を保護しつつ直近分だけ残して掃除する
    // （今回の分 + keep 件で合計はおおむね MAX_KEPT_UPLOADS 以下に収まる）。
    prune_old_uploads(&dir, MAX_KEPT_UPLOADS - 1);

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
    fn prune_old_uploads_keeps_only_newest_files() {
        let dir = tempfile::tempdir().unwrap();
        // 実ファイル名と同じくタイムスタンプ始まり（辞書順 = 時刻順）
        let names = [
            "20260101-000000-aaaa.png",
            "20260102-000000-bbbb.png",
            "20260103-000000-cccc.png",
            "20260104-000000-dddd.png",
        ];
        for name in names {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        prune_old_uploads(dir.path(), 2);
        assert!(!dir.path().join(names[0]).exists(), "古い方から削除される");
        assert!(!dir.path().join(names[1]).exists());
        assert!(dir.path().join(names[2]).exists(), "直近 keep 件は残る");
        assert!(dir.path().join(names[3]).exists());
    }

    #[test]
    fn prune_old_uploads_is_noop_within_keep_limit() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("20260101-000000-aaaa.png"), b"x").unwrap();
        prune_old_uploads(dir.path(), 2);
        assert!(dir.path().join("20260101-000000-aaaa.png").exists());
    }

    /// 同一秒内に並行アップロードが重なると名前のタイムスタンプが同一になり、
    /// 辞書順がランダムサフィックス順になる。他リクエストの書き込み直後の
    /// ファイルが「最古」側に並んでも、in-flight 登録されている間は削除されない
    /// こと（Codex レビュー指摘: 自分のパスだけの保護では並行リクエスト分が
    /// 消え得る）。
    #[test]
    fn prune_old_uploads_never_removes_in_flight_files() {
        let dir = tempfile::tempdir().unwrap();
        // "0000" は辞書順で最古側に並ぶが、これが別リクエストの書き込み直後分
        let in_flight = dir.path().join("20260101-000000-0000.png");
        let names = [
            "20260101-000000-0000.png",
            "20260101-000000-aaaa.png",
            "20260101-000000-bbbb.png",
            "20260101-000000-cccc.png",
        ];
        for name in names {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        let guard = InFlightUpload::register(in_flight.clone());
        prune_old_uploads(dir.path(), 2);
        assert!(in_flight.exists(), "in-flight 中のファイルは削除されない");
        assert!(
            !dir.path().join(names[1]).exists(),
            "保護対象外の最古が削除される"
        );
        assert!(dir.path().join(names[2]).exists());
        assert!(dir.path().join(names[3]).exists());
        drop(guard);
        assert!(
            !in_flight_uploads().lock().unwrap().contains(&in_flight),
            "ガードの drop で登録解除される"
        );
    }

    #[test]
    fn which_finds_a_binary_known_to_exist() {
        // sh はどの CI/コンテナ環境にも存在する前提。
        assert!(which("sh").is_some());
        assert!(which("definitely-not-a-real-binary-xyz").is_none());
    }
}
