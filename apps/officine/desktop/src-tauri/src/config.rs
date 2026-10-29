//! Configuration locale du poste, dans le répertoire de configuration de l'application (seuls fichiers
//! lus ou écrits par l'application, doc 06 §5 bis) : appairage, secret du poste, imprimante.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pairing {
    pub host: String,
    pub port: u16,
    /// Autorité locale épinglée (DER, base16).
    pub ca_der_hex: String,
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Printer {
    /// Imprimante réseau ESC/POS « hôte:port » (port 9100 en général) ; vide = impression du système.
    pub address: String,
}

pub struct Store {
    dir: PathBuf,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unhex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("hexadécimal invalide".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| "hexadécimal invalide".to_string())
        })
        .collect()
}

/// Écriture atomique, droits 0600 sous Unix (le secret du poste n'est lisible que par son utilisateur).
fn write_private(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

impl Store {
    pub fn new(dir: PathBuf) -> Result<Store, String> {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Store { dir })
    }

    pub fn pairing(&self) -> Option<Pairing> {
        serde_json::from_slice(&fs::read(self.dir.join("pairing.json")).ok()?).ok()
    }

    pub fn secret(&self) -> Option<String> {
        let s = fs::read_to_string(self.dir.join("device.secret")).ok()?;
        let s = s.trim().to_string();
        (s.len() == 43
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .then_some(s)
    }

    pub fn save_pairing(&self, p: &Pairing, ca_der: &[u8], secret: &str) -> Result<(), String> {
        let p = Pairing {
            ca_der_hex: hex(ca_der),
            ..p.clone()
        };
        write_private(&self.dir.join("device.secret"), secret.as_bytes())?;
        write_private(
            &self.dir.join("pairing.json"),
            &serde_json::to_vec_pretty(&p).map_err(|e| e.to_string())?,
        )
    }

    /// W-09 : poste révoqué → l'appairage est oublié, l'écran d'appairage revient.
    pub fn forget(&self) {
        let _ = fs::remove_file(self.dir.join("device.secret"));
        let _ = fs::remove_file(self.dir.join("pairing.json"));
    }

    pub fn printer(&self) -> Printer {
        fs::read(self.dir.join("printer.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save_printer(&self, p: &Printer) -> Result<(), String> {
        write_private(
            &self.dir.join("printer.json"),
            &serde_json::to_vec_pretty(p).map_err(|e| e.to_string())?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn w02_pairing_round_trip_and_forget() {
        let dir = std::env::temp_dir().join(format!("vp-desktop-test-{}", std::process::id()));
        let s = Store::new(dir.clone()).unwrap();
        assert!(s.pairing().is_none());
        let p = Pairing {
            host: "officine.local".into(),
            port: 8443,
            ca_der_hex: String::new(),
            device_id: "d1".into(),
            device_name: "Comptoir".into(),
        };
        s.save_pairing(&p, &[0xde, 0xad], &"a".repeat(43)).unwrap();
        assert_eq!(s.pairing().unwrap().ca_der_hex, "dead");
        assert_eq!(unhex("dead").unwrap(), vec![0xde, 0xad]);
        assert_eq!(s.secret().unwrap(), "a".repeat(43));
        s.forget();
        assert!(s.pairing().is_none() && s.secret().is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
