//! W-06 : génération des octets ESC/POS du ticket (80 mm, 48 colonnes en police A), sans dépendance.
//! Page de codes PC858 (Europe de l'Ouest + €) pour les accents français.

use serde::Deserialize;

pub const MAX_LINES: usize = 300;
pub const MAX_COLUMNS: usize = 64;

/// Contenu reçu de l'interface (texte du ticket préparé par le serveur, V-06).
#[derive(Debug, Clone, Deserialize)]
pub struct ReceiptPayload {
    pub lines: Vec<String>,
    #[serde(default)]
    pub open_drawer: bool,
}

/// Validation côté Rust (doc 06 §5 bis) : taille et structure, avant tout envoi à l'imprimante.
pub fn validate(p: &ReceiptPayload) -> Result<(), String> {
    if p.lines.is_empty() || p.lines.len() > MAX_LINES {
        return Err(format!("ticket de 1 à {MAX_LINES} lignes attendu"));
    }
    for l in &p.lines {
        if l.chars().count() > MAX_COLUMNS {
            return Err(format!("ligne de plus de {MAX_COLUMNS} caractères"));
        }
        if l.chars().any(|c| c.is_control()) {
            return Err("caractère de contrôle refusé dans le ticket".into());
        }
    }
    Ok(())
}

/// Caractère Unicode vers PC858 ; tout caractère non représentable devient « ? ».
pub fn to_pc858(c: char) -> u8 {
    match c {
        ' '..='~' => c as u8,
        'Ç' => 0x80,
        'ü' => 0x81,
        'é' => 0x82,
        'â' => 0x83,
        'ä' => 0x84,
        'à' => 0x85,
        'ç' => 0x87,
        'ê' => 0x88,
        'ë' => 0x89,
        'è' => 0x8A,
        'ï' => 0x8B,
        'î' => 0x8C,
        'É' => 0x90,
        'ô' => 0x93,
        'ö' => 0x94,
        'û' => 0x96,
        'ù' => 0x97,
        'ÿ' => 0x98,
        'Ô' => 0xE2,
        'À' => 0xB7,
        'Â' => 0xB6,
        'È' => 0xD4,
        'Ê' => 0xD2,
        'Î' => 0xD7,
        '€' => 0xD5,
        '°' => 0xF8,
        '·' => 0xFA,
        '\u{202f}' | '\u{a0}' => b' ',
        '−' | '–' | '—' => b'-',
        '’' | '‘' => b'\'',
        '«' => 0xAE,
        '»' => 0xAF,
        _ => b'?',
    }
}

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

/// Impulsion d'ouverture du tiroir-caisse (broche 2, 50 ms / 500 ms).
pub fn drawer_pulse() -> Vec<u8> {
    vec![ESC, b'p', 0, 25, 250]
}

/// Octets complets : initialisation, page de codes, lignes, avance, coupe partielle, tiroir.
pub fn render(p: &ReceiptPayload) -> Result<Vec<u8>, String> {
    validate(p)?;
    let mut out = vec![ESC, b'@', ESC, b't', 19];
    for line in &p.lines {
        out.extend(line.chars().map(to_pc858));
        out.push(b'\n');
    }
    out.extend_from_slice(&[ESC, b'd', 4, GS, b'V', 66, 0]);
    if p.open_drawer {
        out.extend(drawer_pulse());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(lines: &[&str], drawer: bool) -> ReceiptPayload {
        ReceiptPayload {
            lines: lines.iter().map(|s| s.to_string()).collect(),
            open_drawer: drawer,
        }
    }

    #[test]
    fn w06_render_header_lines_cut_and_drawer() {
        let bytes = render(&payload(&["Pharmacie du Centre", "TOTAL  4 500 F"], true)).unwrap();
        assert_eq!(&bytes[..5], &[ESC, b'@', ESC, b't', 19]);
        let text = b"Pharmacie du Centre\nTOTAL  4 500 F\n";
        assert_eq!(&bytes[5..5 + text.len()], text);
        let tail = &bytes[5 + text.len()..];
        assert_eq!(
            tail,
            &[ESC, b'd', 4, GS, b'V', 66, 0, ESC, b'p', 0, 25, 250]
        );
    }

    #[test]
    fn w06_french_accents_use_pc858() {
        let bytes = render(&payload(&["Réf. caissière à côté — 2 000 €"], false)).unwrap();
        let body = &bytes[5..bytes.len() - 7];
        assert_eq!(body, b"R\x82f. caissi\x8Are \x85 c\x93t\x82 - 2 000 \xD5\n");
    }

    #[test]
    fn w06_no_drawer_pulse_unless_requested() {
        let bytes = render(&payload(&["x"], false)).unwrap();
        assert!(!bytes.windows(2).any(|w| w == [ESC, b'p']));
    }

    #[test]
    fn w06_rejects_oversized_or_control_payloads() {
        assert!(render(&payload(&[], false)).is_err());
        assert!(render(&payload(&[&"x".repeat(65)], false)).is_err());
        assert!(render(&payload(&["\u{1b}@ injection"], false)).is_err());
        let many: Vec<&str> = std::iter::repeat("x").take(MAX_LINES + 1).collect();
        assert!(render(&payload(&many, false)).is_err());
    }
}
