//! W-02, W-03 contre un vrai serveur VisionPharma (Node, TLS, autorité locale générée par `init`).
//! Lancé par `npm run desktop:pinning-test` (scripts/desktop-pinning-test.mjs), qui démarre deux nœuds
//! et fournit leurs adresses et autorités. Sans ces variables, le test est sauté.

use rustls::pki_types::pem::PemObject;
use rustls::pki_types::CertificateDer;
use vp_desktop_lib::tls::{check_pinned, fingerprint, probe, request, Origin};

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn der(path: &str) -> Vec<u8> {
    CertificateDer::from_pem_file(path)
        .expect("autorité PEM")
        .to_vec()
}

#[test]
fn w03_real_server_probe_pin_and_reject_other_authority() {
    let (Some(origin), Some(ca), Some(other_ca), Some(expected)) = (
        env("VP_PIN_ORIGIN"),
        env("VP_PIN_CA"),
        env("VP_PIN_OTHER_CA"),
        env("VP_PIN_FINGERPRINT"),
    ) else {
        eprintln!("VP_PIN_* absents : test d'épinglage sauté");
        return;
    };
    let o = Origin::parse(&origin).unwrap();
    // W-02 : la sonde extrait l'autorité de la chaîne ; son empreinte est celle de l'écran Système.
    let probed = probe(&o).expect("sonde");
    assert_eq!(fingerprint(&probed), expected);
    assert_eq!(probed, der(&ca));
    // W-03 : l'autorité appairée est acceptée, une autre autorité (faux serveur) est refusée.
    check_pinned(&o, &der(&ca)).expect("autorité appairée acceptée");
    assert!(
        check_pinned(&o, &der(&other_ca)).is_err(),
        "une autre autorité doit être refusée"
    );
    // Client HTTPS épinglé : santé du serveur.
    let r = request(&o, &der(&ca), "GET", "/api/v1/health", &[], None).expect("requête épinglée");
    assert_eq!(r.status, 200);
    assert!(String::from_utf8_lossy(&r.body).contains("\"status\":\"ok\""));
}
