//! 添付画像（`image_paths`）の検証・配置・期限切れ掃除。

use super::*;

/// `image_paths` はクライアントが指定した生のファイルパス（将来的には生パスでは
/// なく `POST /upload-image` が発行する不透明なアップロードIDへ置き換えたい）。
/// それまでの間、`sync_dispatch_image_dir` へ渡す前に「`uploads_dir()` 直下の
/// 通常ファイルか」を実体パス（symlink解決込み）で検証する。ここを通さずに
/// リネーム対象・`compose_text_with_images` 埋め込み対象に使うと、任意ファイルの
/// 移動やCLIエージェントへの読み取り誘導（`Image: <path>` 経由）につながる。
enum DispatchImageSrc {
    /// `uploads_dir()` 直下の通常ファイル。移動対象。
    InUploads(PathBuf),
    /// 既に対象 dispatch の画像ディレクトリ直下にある通常ファイル。移動不要。
    AlreadyPlaced(PathBuf),
}

/// `src` を検証し、移動対象 / 移動不要のいずれかに分類する。範囲外・symlink・
/// 走査パス・非通常ファイルは `None` で拒否する。
async fn validate_dispatch_image_src(
    uploads_dir: &FsPath,
    dispatch_dir: &FsPath,
    src: &str,
) -> Option<DispatchImageSrc> {
    let canonical_src = tokio::fs::canonicalize(src).await.ok()?;
    let metadata = tokio::fs::metadata(&canonical_src).await.ok()?;
    if !metadata.is_file() {
        return None;
    }
    if let Ok(canonical_dispatch_dir) = tokio::fs::canonicalize(dispatch_dir).await {
        if canonical_src.parent() == Some(canonical_dispatch_dir.as_path()) {
            return Some(DispatchImageSrc::AlreadyPlaced(canonical_src));
        }
    }
    let canonical_uploads_dir = tokio::fs::canonicalize(uploads_dir).await.ok()?;
    if canonical_src.parent() == Some(canonical_uploads_dir.as_path()) {
        return Some(DispatchImageSrc::InUploads(canonical_src));
    }
    None
}

/// dispatch 1件の添付画像を、`uploads_dir()` などの一時領域から
/// `dispatch_images_dir(dispatch_id)` へ集約する（idempotent）。既にそこに
/// あるファイルは移動せず、現在の `image_paths` に含まれなくなったフォルダ内の
/// 孤立ファイル（Run前の差し替え・削除分）は削除する。戻り値は移動後のパス。
/// `uploads_dir()` 直下の通常ファイルでない `src`（範囲外パス・symlink・
/// 走査パス等）は `validate_dispatch_image_src` で拒否し、結果から丸ごと除外する
/// （移動失敗時と違い元パスのまま残さない — テキストへの埋め込みに使われるため）。
pub(super) async fn sync_dispatch_image_dir(
    paths: &Paths,
    dispatch_id: &str,
    image_paths: &[String],
) -> Vec<String> {
    if image_paths.is_empty() {
        return Vec::new();
    }
    let dir = paths.dispatch_images_dir(dispatch_id);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        tracing::warn!("dispatch image dir create failed ({}): {e}", dir.display());
        return Vec::new();
    }
    let uploads_dir = paths.uploads_dir();
    let mut result = Vec::with_capacity(image_paths.len());
    let mut keep_names: HashSet<OsString> = HashSet::new();
    for src in image_paths {
        let Some(validated) = validate_dispatch_image_src(&uploads_dir, &dir, src).await else {
            tracing::warn!("dispatch image path rejected (outside uploads dir): {src}");
            continue;
        };
        match validated {
            DispatchImageSrc::AlreadyPlaced(path) => {
                if let Some(name) = path.file_name() {
                    keep_names.insert(name.to_os_string());
                }
                // 実体は移動していないため、`src` の表記ゆれ（canonicalize による
                // シンボリックリンク解決等）を持ち込まず元の文字列をそのまま返す。
                result.push(src.clone());
            }
            DispatchImageSrc::InUploads(src_path) => {
                let Some(name) = src_path.file_name() else {
                    continue;
                };
                let dest = dir.join(name);
                match tokio::fs::rename(&src_path, &dest).await {
                    Ok(()) => {
                        keep_names.insert(name.to_os_string());
                        result.push(dest.to_string_lossy().into_owned());
                    }
                    Err(e) => {
                        tracing::warn!("dispatch image move failed ({}): {e}", src_path.display());
                    }
                }
            }
        }
    }
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if !keep_names.contains(&entry.file_name()) {
                if let Err(e) = tokio::fs::remove_file(entry.path()).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        tracing::warn!(
                            "dispatch image cleanup failed ({}): {e}",
                            entry.path().display()
                        );
                    }
                }
            }
        }
    }
    result
}

/// 決定済み（実行/破棄）dispatchの添付画像を、TTL（`DISPATCH_IMAGE_TTL_SEC`）
/// 超過分だけ削除する。`upload_image.rs::prune_old_uploads` と同じく能動的な
/// バックグラウンドタイマーは持たず、起動時・新規dispatch受付の都度呼び出す
/// アクセス時lazy sweep方式。
pub(super) async fn sweep_expired_dispatch_images(state: &Arc<AppState>) {
    let now = now_epoch();
    let mut expired_ids: Vec<String> = Vec::new();
    {
        let mut recent = state.dispatch.recent.lock().await;
        for item in recent.iter_mut() {
            let has_images = item["request"]["image_paths"]
                .as_array()
                .map(|a| !a.is_empty())
                .unwrap_or(false);
            if !has_images {
                continue;
            }
            let decided_at = item["request"]["decided_at"].as_i64().unwrap_or(0);
            if now - decided_at < DISPATCH_IMAGE_TTL_SEC {
                continue;
            }
            let Some(id) = item.get("id").and_then(Value::as_str).map(str::to_string) else {
                continue;
            };
            if let Some(req_obj) = item.get_mut("request").and_then(Value::as_object_mut) {
                req_obj.insert("image_paths".to_string(), json!([]));
                req_obj.insert("images_expired".to_string(), json!(true));
            }
            expired_ids.push(id);
        }
    }
    for id in &expired_ids {
        let dir = state.paths.dispatch_images_dir(id);
        if let Err(e) = tokio::fs::remove_dir_all(&dir).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!("dispatch image dir cleanup failed ({}): {e}", dir.display());
            }
        }
    }
    if !expired_ids.is_empty() {
        persist_recent(state).await;
    }
}

/// 貼り付けられた画像パスを送信テキストへ埋め込む。CLIエージェント（Claude Code等）は
/// テキスト中のファイルパス言及から Read ツールで画像を読みに行くため、tmux 環境変数
/// 経由ではなく本文に含める必要がある。
pub(super) fn compose_text_with_images(text: &str, image_paths: &[String]) -> String {
    if image_paths.is_empty() {
        return text.to_string();
    }
    let mut composed = text.to_string();
    if !composed.is_empty() {
        composed.push_str("\n\n");
    }
    for path in image_paths {
        composed.push_str("Image: ");
        composed.push_str(path);
        composed.push('\n');
    }
    composed.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_text_with_images_no_images_returns_text_unchanged() {
        assert_eq!(compose_text_with_images("hello", &[]), "hello");
        assert_eq!(compose_text_with_images("", &[]), "");
    }

    #[test]
    fn compose_text_with_images_appends_paths_after_text() {
        let paths = vec!["/tmp/a.png".to_string(), "/tmp/b.png".to_string()];
        assert_eq!(
            compose_text_with_images("look at this", &paths),
            "look at this\n\nImage: /tmp/a.png\nImage: /tmp/b.png"
        );
    }

    #[test]
    fn compose_text_with_images_with_empty_text_omits_leading_blank_line() {
        let paths = vec!["/tmp/a.png".to_string()];
        assert_eq!(compose_text_with_images("", &paths), "Image: /tmp/a.png");
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_moves_new_files_into_dispatch_dir() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let uploads = state.paths.uploads_dir();
        std::fs::create_dir_all(&uploads).unwrap();
        let src = uploads.join("a.png");
        std::fs::write(&src, b"x").unwrap();

        let synced =
            sync_dispatch_image_dir(&state.paths, "disp1", &[src.to_string_lossy().into_owned()])
                .await;

        assert_eq!(synced.len(), 1);
        assert!(!src.exists(), "元ファイルは移動されて残らない");
        let expected = state.paths.dispatch_images_dir("disp1").join("a.png");
        assert_eq!(synced[0], expected.to_string_lossy());
        assert!(expected.exists());
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_is_noop_for_already_placed_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let path = img_dir.join("a.png");
        std::fs::write(&path, b"x").unwrap();
        let path_str = path.to_string_lossy().into_owned();

        let synced =
            sync_dispatch_image_dir(&state.paths, "disp1", std::slice::from_ref(&path_str)).await;

        assert_eq!(synced, vec![path_str]);
        assert!(path.exists());
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_removes_orphaned_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let kept = img_dir.join("keep.png");
        let stale = img_dir.join("stale.png");
        std::fs::write(&kept, b"x").unwrap();
        std::fs::write(&stale, b"x").unwrap();

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[kept.to_string_lossy().into_owned()],
        )
        .await;

        assert_eq!(synced, vec![kept.to_string_lossy().into_owned()]);
        assert!(kept.exists(), "現在参照されているファイルは残る");
        assert!(!stale.exists(), "参照が外れたファイルは削除される");
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_rejects_path_outside_uploads_dir() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        std::fs::create_dir_all(state.paths.uploads_dir()).unwrap();
        // uploads_dir の外（別ディレクトリ）に置かれたファイルを image_paths に
        // 直接指定するケース（例: /etc/passwd 等の任意ファイルを指す想定）。
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.txt");
        std::fs::write(&outside_file, b"secret").unwrap();

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[outside_file.to_string_lossy().into_owned()],
        )
        .await;

        assert!(synced.is_empty(), "範囲外パスは結果から除外される");
        assert!(outside_file.exists(), "範囲外ファイルは移動・削除されない");
    }

    #[tokio::test]
    async fn sync_dispatch_image_dir_rejects_traversal_path() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let uploads = state.paths.uploads_dir();
        std::fs::create_dir_all(&uploads).unwrap();
        // uploads_dir の親（data_dir直下）に置かれた、`../` 走査で参照できて
        // しまうファイル。
        let sibling_file = uploads.parent().unwrap().join("secret.txt");
        std::fs::write(&sibling_file, b"secret").unwrap();
        let traversal = uploads.join("..").join("secret.txt");

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[traversal.to_string_lossy().into_owned()],
        )
        .await;

        assert!(synced.is_empty(), "走査パスは結果から除外される");
        assert!(
            sibling_file.exists(),
            "走査パスの参照先は移動・削除されない"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sync_dispatch_image_dir_rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let uploads = state.paths.uploads_dir();
        std::fs::create_dir_all(&uploads).unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.txt");
        std::fs::write(&outside_file, b"secret").unwrap();
        let link = uploads.join("link.png");
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();

        let synced = sync_dispatch_image_dir(
            &state.paths,
            "disp1",
            &[link.to_string_lossy().into_owned()],
        )
        .await;

        assert!(
            synced.is_empty(),
            "uploads_dir外を指すsymlinkは結果から除外される"
        );
        assert!(
            outside_file.exists(),
            "symlink先の実ファイルは移動・削除されない"
        );
    }

    #[tokio::test]
    async fn sweep_expired_dispatch_images_keeps_items_within_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let img_path = img_dir.join("a.png").to_string_lossy().into_owned();
        state.dispatch.recent.lock().await.push(json!({
            "id": "disp1",
            "request": {"image_paths": [img_path], "decided_at": now_epoch()},
            "outcome": "executed",
        }));

        sweep_expired_dispatch_images(&state).await;

        let recent = state.dispatch.recent.lock().await;
        assert_eq!(
            recent[0]["request"]["image_paths"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(recent[0]["request"]["images_expired"].is_null());
        assert!(state.paths.dispatch_images_dir("disp1").exists());
    }

    #[tokio::test]
    async fn sweep_expired_dispatch_images_clears_paths_and_removes_dir_past_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let state = test_state(&dir).await;
        let img_dir = state.paths.dispatch_images_dir("disp1");
        std::fs::create_dir_all(&img_dir).unwrap();
        let img_path = img_dir.join("a.png").to_string_lossy().into_owned();
        let old_decided_at = now_epoch() - DISPATCH_IMAGE_TTL_SEC - 1;
        state.dispatch.recent.lock().await.push(json!({
            "id": "disp1",
            "request": {"image_paths": [img_path], "decided_at": old_decided_at},
            "outcome": "executed",
        }));

        sweep_expired_dispatch_images(&state).await;

        let recent = state.dispatch.recent.lock().await;
        assert_eq!(recent[0]["request"]["image_paths"], json!([]));
        assert_eq!(recent[0]["request"]["images_expired"], json!(true));
        assert!(!state.paths.dispatch_images_dir("disp1").exists());
    }
}
