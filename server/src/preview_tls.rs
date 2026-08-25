//! preview proxy（dev server への TLS 終端）で使う証明書探索とロード
//! （`preview.rs` から分離。`SSL_CERTFILE`/`SSL_KEYFILE` env var →
//! `data/certs/*.crt`+`.key` の優先順位で探す）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

/// TLS 証明書の起動時ロード結果（Python の `_ssl_loaded`/`_ssl_ctx` に対応する
/// 遅延一回ロード）。ロード自体に失敗した場合も再試行はしない（Python と同じ）。
pub type TlsConfig = Option<Arc<tokio_rustls::rustls::ServerConfig>>;

pub fn find_cert_pair(data_dir: &Path) -> Option<(PathBuf, PathBuf)> {
    if let (Ok(cert), Ok(key)) = (std::env::var("SSL_CERTFILE"), std::env::var("SSL_KEYFILE")) {
        let (cert, key) = (PathBuf::from(cert), PathBuf::from(key));
        if cert.is_file() && key.is_file() {
            return Some((cert, key));
        }
    }
    let cert_dir = data_dir.join("certs");
    let Ok(entries) = std::fs::read_dir(&cert_dir) else {
        return None;
    };
    let mut crt_files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "crt"))
        .collect();
    crt_files.sort();
    for cert in crt_files {
        let key = cert.with_extension("key");
        if key.is_file() {
            return Some((cert, key));
        }
    }
    None
}

pub fn load_tls_server_config(
    cert: &Path,
    key: &Path,
) -> Option<Arc<tokio_rustls::rustls::ServerConfig>> {
    use tokio_rustls::rustls;
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let cert_pem = std::fs::read(cert).ok()?;
    let key_pem = std::fs::read(key).ok()?;
    let certs: Vec<_> = rustls_pemfile::certs(&mut cert_pem.as_slice())
        .filter_map(|r| r.ok())
        .collect();
    if certs.is_empty() {
        tracing::warn!("TLS disabled: no certificate found in {}", cert.display());
        return None;
    }
    let private_key = match rustls_pemfile::private_key(&mut key_pem.as_slice()) {
        Ok(Some(key)) => key,
        Ok(None) => {
            return None;
        }
        Err(e) => {
            tracing::warn!("TLS disabled: key load failed: {e}");
            return None;
        }
    };
    match rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, private_key)
    {
        Ok(cfg) => {
            tracing::info!(
                "TLS certificate loaded cert={}",
                cert.file_name()
                    .map(|n| n.to_string_lossy())
                    .unwrap_or_default()
            );
            Some(Arc::new(cfg))
        }
        Err(e) => {
            tracing::warn!("TLS disabled: cert load failed: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    // SSL_CERTFILE/SSL_KEYFILE はプロセス全体で共有される環境変数のため、
    // cargo test のデフォルト並列実行では他の find_cert_pair テストと
    // レースして誤検出しうる（実際にCIで発生した）。この4テストだけ
    // Mutexで直列化する。
    fn cert_pair_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct CertEnvGuard {
        cert: Option<String>,
        key: Option<String>,
    }

    impl CertEnvGuard {
        fn clear() -> Self {
            let guard = Self {
                cert: std::env::var("SSL_CERTFILE").ok(),
                key: std::env::var("SSL_KEYFILE").ok(),
            };
            unsafe {
                std::env::remove_var("SSL_CERTFILE");
                std::env::remove_var("SSL_KEYFILE");
            }
            guard
        }
    }

    impl Drop for CertEnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.cert {
                    Some(v) => std::env::set_var("SSL_CERTFILE", v),
                    None => std::env::remove_var("SSL_CERTFILE"),
                }
                match &self.key {
                    Some(v) => std::env::set_var("SSL_KEYFILE", v),
                    None => std::env::remove_var("SSL_KEYFILE"),
                }
            }
        }
    }

    #[test]
    fn find_cert_pair_prefers_env_over_certs_dir() {
        let _guard = cert_pair_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = CertEnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("env.crt"), b"cert").unwrap();
        std::fs::write(dir.path().join("env.key"), b"key").unwrap();
        unsafe {
            std::env::set_var("SSL_CERTFILE", dir.path().join("env.crt"));
            std::env::set_var("SSL_KEYFILE", dir.path().join("env.key"));
        }
        let found = find_cert_pair(dir.path());
        assert_eq!(
            found,
            Some((dir.path().join("env.crt"), dir.path().join("env.key")))
        );
    }

    #[test]
    fn find_cert_pair_falls_back_to_certs_dir() {
        let _guard = cert_pair_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = CertEnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        let certs_dir = dir.path().join("certs");
        std::fs::create_dir(&certs_dir).unwrap();
        std::fs::write(certs_dir.join("host.crt"), b"cert").unwrap();
        std::fs::write(certs_dir.join("host.key"), b"key").unwrap();
        assert_eq!(
            find_cert_pair(dir.path()),
            Some((certs_dir.join("host.crt"), certs_dir.join("host.key")))
        );
    }

    #[test]
    fn find_cert_pair_none_when_key_missing() {
        let _guard = cert_pair_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = CertEnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        let certs_dir = dir.path().join("certs");
        std::fs::create_dir(&certs_dir).unwrap();
        std::fs::write(certs_dir.join("host.crt"), b"cert").unwrap();
        assert_eq!(find_cert_pair(dir.path()), None);
    }

    #[test]
    fn find_cert_pair_none_when_certs_dir_missing() {
        let _guard = cert_pair_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = CertEnvGuard::clear();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(find_cert_pair(dir.path()), None);
    }

    /// openssl が無い実行環境ではスキップする（CI/開発機には通常入っている）。
    fn generate_self_signed_cert(cert: &Path, key: &Path) -> bool {
        let key_ok = std::process::Command::new("openssl")
            .args([
                "ecparam",
                "-name",
                "prime256v1",
                "-genkey",
                "-noout",
                "-out",
                key.to_str().unwrap(),
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !key_ok {
            return false;
        }
        std::process::Command::new("openssl")
            .args([
                "req",
                "-x509",
                "-new",
                "-key",
                key.to_str().unwrap(),
                "-out",
                cert.to_str().unwrap(),
                "-days",
                "1",
                "-nodes",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=DNS:localhost",
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn load_tls_server_config_accepts_valid_self_signed_cert() {
        // rustls 0.23 は複数 crypto backend が同居しうるため、`ServerConfig::builder()`
        // より前に一度だけ明示的にプロセス既定の provider を選ぶ必要がある
        // （本番は main.rs の起動直後に一度だけ実行 — ここではテスト用に模する）。
        static INIT: std::sync::Once = std::sync::Once::new();
        INIT.call_once(|| {
            let _ = tokio_rustls::rustls::crypto::aws_lc_rs::default_provider().install_default();
        });
        let dir = tempfile::tempdir().unwrap();
        let cert = dir.path().join("test.crt");
        let key = dir.path().join("test.key");
        if !generate_self_signed_cert(&cert, &key) {
            eprintln!("openssl not available, skipping");
            return;
        }
        assert!(load_tls_server_config(&cert, &key).is_some());
    }

    #[test]
    fn load_tls_server_config_none_for_garbage_pem() {
        let dir = tempfile::tempdir().unwrap();
        let cert = dir.path().join("bad.crt");
        let key = dir.path().join("bad.key");
        std::fs::write(&cert, b"not a certificate").unwrap();
        std::fs::write(&key, b"not a key").unwrap();
        assert!(load_tls_server_config(&cert, &key).is_none());
    }

    #[test]
    fn load_tls_server_config_none_for_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            load_tls_server_config(&dir.path().join("nope.crt"), &dir.path().join("nope.key"))
                .is_none()
        );
    }
}
