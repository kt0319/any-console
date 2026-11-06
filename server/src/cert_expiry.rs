//! 公開中の HTTPS 証明書（tailscale serve が配る Let's Encrypt 証明書）の有効期限を
//! 実際に TLS 接続して読む。期限切れの証明書でも読めるよう、検証はせず握手結果の
//! 証明書だけを使う（System info の警告表示用で、通信の安全性判断には使わない）。

use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpStream;
use tokio_rustls::rustls::{
    self,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

const TAG_UTC_TIME: u8 = 0x17;
const TAG_GENERALIZED_TIME: u8 = 0x18;
const TAG_SEQUENCE: u8 = 0x30;
const TAG_CONTEXT_0: u8 = 0xA0;

#[derive(Debug)]
struct AcceptAnyCert(Arc<rustls::crypto::CryptoProvider>);

impl ServerCertVerifier for AcceptAnyCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// `host:port` に TLS 接続し、サーバ証明書の notAfter を UNIX 秒で返す。
/// 接続・握手・パースのどれかに失敗したら None（呼び出し側は「不明」として扱う）。
pub async fn fetch_cert_expiry_unix(host: &str, port: u16) -> Option<i64> {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .ok()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyCert(provider)))
        .with_no_client_auth();
    let server_name = ServerName::try_from(host.to_string()).ok()?;
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let handshake = async {
        let tcp = TcpStream::connect((host, port)).await.ok()?;
        connector.connect(server_name, tcp).await.ok()
    };
    let stream = match tokio::time::timeout(CONNECT_TIMEOUT, handshake).await {
        Ok(Some(stream)) => stream,
        Ok(None) => {
            tracing::debug!("cert expiry: handshake failed host={host} port={port}");
            return None;
        }
        Err(_) => {
            tracing::debug!("cert expiry: timeout host={host} port={port}");
            return None;
        }
    };
    let leaf = stream.get_ref().1.peer_certificates()?.first()?;
    let expiry = parse_not_after_unix(leaf.as_ref());
    if expiry.is_none() {
        tracing::warn!("cert expiry: could not parse notAfter host={host} port={port}");
    }
    expiry
}

/// DER の TLV を1つ読み、(tag, 中身, 残り) を返す。
fn read_tlv(data: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = data.split_first()?;
    let (&first_len, rest) = rest.split_first()?;
    let (len, rest) = if first_len < 0x80 {
        (first_len as usize, rest)
    } else {
        let len_bytes = (first_len & 0x7F) as usize;
        if len_bytes == 0 || len_bytes > 4 || rest.len() < len_bytes {
            return None;
        }
        let len = rest[..len_bytes]
            .iter()
            .fold(0usize, |acc, b| (acc << 8) | *b as usize);
        (len, &rest[len_bytes..])
    };
    if rest.len() < len {
        return None;
    }
    Some((tag, &rest[..len], &rest[len..]))
}

/// X.509 証明書（DER）の validity.notAfter を UNIX 秒で返す。
fn parse_not_after_unix(cert_der: &[u8]) -> Option<i64> {
    let (tag, cert, _) = read_tlv(cert_der)?;
    if tag != TAG_SEQUENCE {
        return None;
    }
    let (tag, tbs, _) = read_tlv(cert)?;
    if tag != TAG_SEQUENCE {
        return None;
    }
    let mut rest = tbs;
    let (tag, _, after) = read_tlv(rest)?;
    if tag == TAG_CONTEXT_0 {
        rest = after;
    }
    // serialNumber, signature, issuer を読み飛ばして validity に到達する
    for _ in 0..3 {
        rest = read_tlv(rest)?.2;
    }
    let (tag, validity, _) = read_tlv(rest)?;
    if tag != TAG_SEQUENCE {
        return None;
    }
    let (_, _, after_not_before) = read_tlv(validity)?;
    let (time_tag, time, _) = read_tlv(after_not_before)?;
    parse_asn1_time_unix(time_tag, time)
}

fn parse_asn1_time_unix(tag: u8, bytes: &[u8]) -> Option<i64> {
    let text = std::str::from_utf8(bytes).ok()?.strip_suffix('Z')?;
    let (year, rest) = match tag {
        TAG_UTC_TIME => {
            let yy: i64 = text.get(..2)?.parse().ok()?;
            (if yy < 50 { 2000 + yy } else { 1900 + yy }, text.get(2..)?)
        }
        TAG_GENERALIZED_TIME => (text.get(..4)?.parse().ok()?, text.get(4..)?),
        _ => return None,
    };
    let field = |i: usize| -> Option<i64> { rest.get(i * 2..i * 2 + 2)?.parse().ok() };
    let (month, day, hour, minute, second) =
        (field(0)?, field(1)?, field(2)?, field(3)?, field(4)?);
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// グレゴリオ暦の年月日から 1970-01-01 起点の日数を返す（Howard Hinnant の days_from_civil）。
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    const SELF_SIGNED_NOT_AFTER_2036_12_31_235959: &str = "MIIBSjCB8qADAgECAhRtjQXwqAsl/tDLRY+yLZ2DU1OAyjAKBggqhkjOPQQDAjAMMQowCAYDVQQDDAF0MB4XDTI2MDEwMTAwMDAwMFoXDTM2MTIzMTIzNTk1OVowDDEKMAgGA1UEAwwBdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABCDz+Bs46s12QaDvGEuP/g8nV2kn+OJg+J86qNaXs+vM5i5jVJNBc6a1AZ55VZLM76ee9rV/UWgKBpDVJXQrQcejMjAwMB0GA1UdDgQWBBS9BrmZI6hGQfN0cDKgd2ueyQvZ/TAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIAR01j3ee21/c7CzME2nFnMs8WzZMTlRX1o3VYXmp1nbAiA6Rme0C/v0GFZJCliDi1/FGse+5jceErFe+vmWElbzkg==";

    fn decode_base64(text: &str) -> Vec<u8> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(text)
            .unwrap()
    }

    #[test]
    fn not_after_is_read_from_real_certificate() {
        let der = decode_base64(SELF_SIGNED_NOT_AFTER_2036_12_31_235959);
        assert_eq!(parse_not_after_unix(&der), Some(2_114_380_799));
    }

    #[test]
    fn truncated_certificate_is_none() {
        let der = decode_base64(SELF_SIGNED_NOT_AFTER_2036_12_31_235959);
        assert_eq!(parse_not_after_unix(&der[..40]), None);
        assert_eq!(parse_not_after_unix(&[]), None);
    }

    #[test]
    fn asn1_time_handles_utc_and_generalized() {
        assert_eq!(
            parse_asn1_time_unix(TAG_UTC_TIME, b"700101000000Z"),
            Some(0)
        );
        assert_eq!(
            parse_asn1_time_unix(TAG_UTC_TIME, b"270203004518Z"),
            Some(1_801_615_518)
        );
        assert_eq!(
            parse_asn1_time_unix(TAG_UTC_TIME, b"991231235959Z"),
            Some(946_684_799)
        );
        assert_eq!(
            parse_asn1_time_unix(TAG_GENERALIZED_TIME, b"20510101000000Z"),
            Some(2_556_144_000)
        );
        assert_eq!(parse_asn1_time_unix(TAG_UTC_TIME, b"270203004518"), None);
    }
}
