//! W-02, W-03 : TLS du cœur Rust (rustls seul).
//! - `probe` : première connexion, sans confiance, pour extraire l'autorité de la chaîne présentée et
//!   afficher son empreinte (comparée à celle de l'écran Système du serveur avant l'appairage) ;
//! - `pinned` : toute autre connexion n'accepte qu'un certificat signé par l'autorité appairée ;
//! - `request` : client HTTP/1.1 minimal (Connection: close) au-dessus de cette connexion épinglée.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{ring, verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    ClientConfig, ClientConnection, DigitallySignedStruct, RootCertStore, SignatureScheme,
    StreamOwned,
};

const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_RESPONSE: usize = 4 * 1024 * 1024;

fn provider() -> Arc<CryptoProvider> {
    Arc::new(ring::default_provider())
}

/// Origine normalisée « https://hôte[:port] » : seul HTTPS est accepté.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub host: String,
    pub port: u16,
}

impl Origin {
    pub fn parse(input: &str) -> Result<Origin, String> {
        let s = input.trim().trim_end_matches('/');
        let rest = s.strip_prefix("https://").unwrap_or(s);
        if rest.contains("://") || rest.contains('/') || rest.contains('@') || rest.is_empty() {
            return Err("adresse attendue : nom ou IP du serveur, avec le port si besoin".into());
        }
        let (host, port) = match rest.rsplit_once(':') {
            Some((h, p)) if !h.contains(':') => (
                h.to_string(),
                p.parse::<u16>().map_err(|_| "port invalide")?,
            ),
            _ => (rest.to_string(), 8443),
        };
        if host.is_empty()
            || !host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        {
            return Err("nom d'hôte invalide".into());
        }
        Ok(Origin { host, port })
    }

    pub fn url(&self) -> String {
        if self.port == 443 {
            format!("https://{}", self.host)
        } else {
            format!("https://{}:{}", self.host, self.port)
        }
    }
}

/// SHA-256 au format de l'écran Système (I-06) : « AB:CD:… », majuscules.
pub fn fingerprint(der: &[u8]) -> String {
    let hash = ring::default_provider()
        .cipher_suites
        .iter()
        .find_map(|s| match s {
            rustls::SupportedCipherSuite::Tls13(t)
                if t.common.suite == rustls::CipherSuite::TLS13_AES_128_GCM_SHA256 =>
            {
                Some(t.common.hash_provider.hash(der))
            }
            _ => None,
        })
        .expect("SHA-256 disponible");
    hash.as_ref()
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

/// Vérificateur de la sonde : capture la chaîne, vérifie les signatures de la poignée de main.
#[derive(Debug)]
struct Capture {
    chain: Mutex<Vec<CertificateDer<'static>>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Capture {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let mut c = self
            .chain
            .lock()
            .map_err(|_| rustls::Error::General("verrou".into()))?;
        c.push(end_entity.clone().into_owned());
        c.extend(intermediates.iter().map(|i| i.clone().into_owned()));
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        m: &[u8],
        c: &CertificateDer<'_>,
        d: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(m, c, d, &self.provider.signature_verification_algorithms)
    }
    fn verify_tls13_signature(
        &self,
        m: &[u8],
        c: &CertificateDer<'_>,
        d: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(m, c, d, &self.provider.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn connect(
    origin: &Origin,
    config: Arc<ClientConfig>,
) -> Result<StreamOwned<ClientConnection, TcpStream>, String> {
    // Toutes les adresses résolues (IPv6 puis IPv4 pour « localhost » sous Windows, par exemple).
    let addrs: Vec<_> = (origin.host.as_str(), origin.port)
        .to_socket_addrs()
        .map_err(|e| format!("adresse introuvable : {e}"))?
        .collect();
    let mut last = String::from("adresse introuvable");
    let tcp = addrs
        .iter()
        .find_map(|a| match TcpStream::connect_timeout(a, TIMEOUT) {
            Ok(t) => Some(t),
            Err(e) => {
                last = format!("serveur injoignable : {e}");
                None
            }
        })
        .ok_or(last)?;
    tcp.set_read_timeout(Some(TIMEOUT)).ok();
    tcp.set_write_timeout(Some(TIMEOUT)).ok();
    let name = ServerName::try_from(origin.host.clone()).map_err(|_| "nom de serveur invalide")?;
    let conn = ClientConnection::new(config, name).map_err(|e| e.to_string())?;
    let mut stream = StreamOwned::new(conn, tcp);
    while stream.conn.is_handshaking() {
        stream
            .conn
            .complete_io(&mut stream.sock)
            .map_err(|e| format!("poignée de main TLS refusée : {e}"))?;
    }
    Ok(stream)
}

/// W-02 : chaîne présentée par le serveur ; renvoie l'autorité (dernier certificat) en DER.
pub fn probe(origin: &Origin) -> Result<Vec<u8>, String> {
    let capture = Arc::new(Capture {
        chain: Mutex::new(Vec::new()),
        provider: provider(),
    });
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(capture.clone())
        .with_no_client_auth();
    connect(origin, Arc::new(config))?;
    let chain = capture.chain.lock().map_err(|_| "verrou")?;
    if chain.len() < 2 {
        return Err("le serveur ne présente pas son autorité locale (chaîne incomplète)".into());
    }
    Ok(chain.last().expect("chaîne non vide").to_vec())
}

/// W-03 : configuration qui n'accepte que l'autorité appairée.
pub fn pinned(ca_der: &[u8]) -> Result<Arc<ClientConfig>, String> {
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(ca_der.to_vec()))
        .map_err(|e| format!("autorité invalide : {e}"))?;
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

/// W-03 : la poignée de main aboutit-elle avec l'autorité appairée ?
pub fn check_pinned(origin: &Origin, ca_der: &[u8]) -> Result<(), String> {
    connect(origin, pinned(ca_der)?).map(|_| ())
}

#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

/// Requête HTTPS épinglée (JSON), sans cookie ni redirection.
pub fn request(
    origin: &Origin,
    ca_der: &[u8],
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
) -> Result<Response, String> {
    let mut stream = connect(origin, pinned(ca_der)?)?;
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\nAccept: application/json\r\n", origin.host, origin.port);
    for (k, v) in headers {
        if k.contains(['\r', '\n']) || v.contains(['\r', '\n']) {
            return Err("en-tête invalide".into());
        }
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(b) = body {
        head.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            b.len()
        ));
    }
    head.push_str("\r\n");
    stream
        .write_all(head.as_bytes())
        .map_err(|e| e.to_string())?;
    if let Some(b) = body {
        stream.write_all(b).map_err(|e| e.to_string())?;
    }
    stream.flush().ok();
    let mut raw = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > MAX_RESPONSE {
                    return Err("réponse trop volumineuse".into());
                }
            }
            // Fermeture sans close_notify après une réponse complète : acceptée.
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof && !raw.is_empty() => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    parse_response(&raw)
}

pub fn parse_response(raw: &[u8]) -> Result<Response, String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("réponse HTTP incomplète")?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| "en-têtes illisibles")?;
    let status = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or("statut HTTP illisible")?;
    let chunked = head.lines().any(|l| {
        l.to_ascii_lowercase().starts_with("transfer-encoding:")
            && l.to_ascii_lowercase().contains("chunked")
    });
    let body = &raw[split + 4..];
    Ok(Response {
        status,
        body: if chunked {
            dechunk(body)?
        } else {
            body.to_vec()
        },
    })
}

fn dechunk(mut b: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let eol = b
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("bloc HTTP tronqué")?;
        let size_txt = std::str::from_utf8(&b[..eol]).map_err(|_| "taille de bloc illisible")?;
        let size = usize::from_str_radix(size_txt.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| "taille de bloc invalide")?;
        b = &b[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        if b.len() < size + 2 {
            return Err("bloc HTTP tronqué".into());
        }
        out.extend_from_slice(&b[..size]);
        b = &b[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn w02_origin_accepts_host_and_port_only() {
        assert_eq!(
            Origin::parse("officine.local").unwrap(),
            Origin {
                host: "officine.local".into(),
                port: 8443
            }
        );
        assert_eq!(
            Origin::parse("https://192.168.1.10:9443/").unwrap().url(),
            "https://192.168.1.10:9443"
        );
        for bad in ["http://x", "x/y", "user@x", "", "x:99999", "ex ample"] {
            assert!(Origin::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn w02_fingerprint_matches_node_format() {
        // SHA-256("abc") = BA7816BF…
        assert!(fingerprint(b"abc").starts_with("BA:78:16:BF:8F:01:CF:EA"));
        assert_eq!(fingerprint(b"abc").len(), 32 * 3 - 1);
    }

    #[test]
    fn w03_pinned_rejects_garbage_authority() {
        assert!(pinned(b"pas un certificat").is_err());
    }

    #[test]
    fn http_parses_content_length_and_chunked_bodies() {
        let r = parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        assert_eq!((r.status, r.body.as_slice()), (200, &b"{}"[..]));
        let c = parse_response(b"HTTP/1.1 201 Created\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n").unwrap();
        assert_eq!((c.status, c.body.as_slice()), (201, &b"abcde"[..]));
        assert!(parse_response(b"garbage").is_err());
    }
}
