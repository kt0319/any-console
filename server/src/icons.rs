//! アイコンの正規化・保存（Python 側 `api/icons.py` の移植）。
//!
//! data URI は data/icons へ保存して `icon:<hash>.<ext>` 参照に変換し、
//! `favicon:<domain>` は Google favicon サービスから取得して同様に保存する
//! （取得失敗時は元の値のまま返す — Python と同一のベストエフォート）。

use std::path::Path;

use sha2::{Digest, Sha256};

pub const FAVICON_PREFIX: &str = "favicon:";

fn mime_to_ext(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

/// アイコンを保存する（Python `_save_icon_bytes` 相当）。書き込み失敗時は
/// エラーを返す（Codex レビュー指摘: 以前は失敗を握りつぶし、実際には書かれて
/// いないファイルへの参照 `icon:<filename>` を返してしまっていた — 呼び出し元が
/// その参照を config へ保存すると、以後そのアイコンは永久に壊れたまま残る）。
fn save_icon_bytes(icons_dir: &Path, raw: &[u8], ext: &str) -> std::io::Result<String> {
    let digest = Sha256::digest(raw);
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let filename = format!("{hex}.{ext}");
    let dest = icons_dir.join(&filename);
    if !dest.exists() {
        std::fs::create_dir_all(icons_dir)?;
        std::fs::write(&dest, raw)?;
        tracing::info!("icon saved file={filename} size={}", raw.len());
    }
    Ok(format!("icon:{filename}"))
}

fn base64_decode(data: &str) -> Option<Vec<u8>> {
    let table = |c: u8| -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let cleaned: Vec<u8> = data.bytes().filter(|b| !b" \t\r\n".contains(b)).collect();
    let cleaned = match cleaned.iter().position(|&b| b == b'=') {
        Some(p) => &cleaned[..p],
        None => &cleaned[..],
    };
    let mut out = Vec::with_capacity(cleaned.len() * 3 / 4);
    for chunk in cleaned.chunks(4) {
        let vals: Vec<u8> = chunk.iter().map(|&c| table(c)).collect::<Option<_>>()?;
        match vals.len() {
            4 => {
                out.push((vals[0] << 2) | (vals[1] >> 4));
                out.push((vals[1] << 4) | (vals[2] >> 2));
                out.push((vals[2] << 6) | vals[3]);
            }
            3 => {
                out.push((vals[0] << 2) | (vals[1] >> 4));
                out.push((vals[1] << 4) | (vals[2] >> 2));
            }
            2 => {
                out.push((vals[0] << 2) | (vals[1] >> 4));
            }
            _ => return None,
        }
    }
    Some(out)
}

/// `data:image/<type>;base64,<data>` をパースする（Python `DATA_URI_RE` 相当）。
fn parse_data_uri(icon: &str) -> Option<(String, &str)> {
    let rest = icon.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    if !mime.starts_with("image/")
        || !mime[6..]
            .chars()
            .all(|c| c.is_ascii_lowercase() || c == '+')
    {
        return None;
    }
    (!data.is_empty()).then(|| (mime.to_string(), data))
}

/// favicon を Google favicon サービスから取得して保存する（失敗時は fallback）。
async fn download_favicon(icons_dir: &Path, domain: &str, fallback: &str) -> String {
    let encoded: String = domain
        .bytes()
        .flat_map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                vec![b as char]
            } else {
                format!("%{b:02X}").chars().collect()
            }
        })
        .collect();
    let url = format!("https://www.google.com/s2/favicons?domain={encoded}&sz=64");
    // 外部 HTTPS のため環境の proxy 設定を尊重する（既定クライアント）
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("any-console/1.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return fallback.to_string(),
    };
    let resp = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => {
            tracing::warn!("favicon download failed domain={domain}");
            return fallback.to_string();
        }
    };
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let raw = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => {
            tracing::warn!("favicon download failed domain={domain}");
            return fallback.to_string();
        }
    };
    let ext = mime_to_ext(&content_type).unwrap_or("png");
    tracing::info!("favicon downloaded domain={domain} size={}", raw.len());
    // Python `_download_favicon` は保存も含めて try/except で囲んでおり、書き込み
    // 失敗（OSError）時も fallback（元の "favicon:domain" 文字列）を返す。
    save_icon_bytes(icons_dir, &raw, ext).unwrap_or_else(|e| {
        tracing::warn!("favicon save failed domain={domain}: {e}");
        fallback.to_string()
    })
}

/// アイコン値を解決し、必要ならディスクへ保存する（Python `normalize_icon` 相当）。
/// `favicon:<domain>` は外部ダウンロード、data URI は `icons_dir` への書き込みを
/// 伴う。data URI の保存に失敗した場合はエラーを返す（Python は素通しの例外で
/// 呼び出し元に伝播する — favicon と異なりここでは fallback せず、呼び出し元が
/// 500 を返す）。
pub async fn resolve_and_store_icon(icons_dir: &Path, icon: &str) -> std::io::Result<String> {
    if let Some(domain) = icon.strip_prefix(FAVICON_PREFIX) {
        return Ok(download_favicon(icons_dir, domain, icon).await);
    }
    let Some((mime, b64_data)) = parse_data_uri(icon) else {
        return Ok(icon.to_string());
    };
    let Some(ext) = mime_to_ext(&mime) else {
        return Ok(icon.to_string());
    };
    let Some(raw) = base64_decode(b64_data) else {
        return Ok(icon.to_string());
    };
    save_icon_bytes(icons_dir, &raw, ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip() {
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("aGVsbG8h").unwrap(), b"hello!");
        assert!(base64_decode("!!invalid!!").is_none());
    }

    #[tokio::test]
    async fn data_uri_saved_as_icon_file() {
        let dir = tempfile::tempdir().unwrap();
        // 1x1 GIF
        let uri = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
        let out = resolve_and_store_icon(dir.path(), uri).await.unwrap();
        assert!(out.starts_with("icon:"), "{out}");
        assert!(out.ends_with(".gif"));
        let filename = out.strip_prefix("icon:").unwrap();
        assert!(dir.path().join(filename).is_file());
        // ハッシュ 16 桁 + 拡張子
        assert_eq!(filename.split('.').next().unwrap().len(), 16);
        // 非対応 MIME・非 data URI はそのまま
        assert_eq!(
            resolve_and_store_icon(dir.path(), "mdi-rocket")
                .await
                .unwrap(),
            "mdi-rocket"
        );
        assert_eq!(
            resolve_and_store_icon(dir.path(), "data:image/tiff;base64,AAAA")
                .await
                .unwrap(),
            "data:image/tiff;base64,AAAA"
        );
    }

    /// data URI の保存に失敗したらエラーが伝播すること（Codex レビュー指摘:
    /// 以前は失敗を握りつぶし、実際には書かれていないファイルへの参照
    /// `icon:<filename>` を返してしまっていた）。icons_dir に同名の通常ファイルを
    /// 置いて `create_dir_all` を失敗させることで書き込みエラーを発生させる。
    #[tokio::test]
    async fn data_uri_save_failure_propagates_error() {
        let dir = tempfile::tempdir().unwrap();
        let icons_dir = dir.path().join("icons");
        std::fs::write(&icons_dir, b"not a directory").unwrap();
        let uri = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
        assert!(resolve_and_store_icon(&icons_dir, uri).await.is_err());
    }

    /// save_icon_bytes 自体の書き込み失敗が Err として伝わること（icons_dir と
    /// 同名の通常ファイルを置いて create_dir_all を失敗させる）。favicon 側
    /// （download_favicon）はこの Err を fallback 文字列へ変換する — Python
    /// `_download_favicon` の try/except と同じ挙動（実ネットワークに依存しない
    /// ようこの層だけを単体で検証する）。
    #[test]
    fn save_icon_bytes_propagates_write_failure() {
        let dir = tempfile::tempdir().unwrap();
        let icons_dir = dir.path().join("icons");
        std::fs::write(&icons_dir, b"not a directory").unwrap();
        assert!(save_icon_bytes(&icons_dir, b"fake-image-bytes", "png").is_err());
    }
}
