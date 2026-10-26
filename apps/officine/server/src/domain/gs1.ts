import { AppError } from '../errors.js';

/**
 * C-04 : décodage GS1 DataMatrix (AI 01 GTIN, 10 lot, 17 péremption, 21 série),
 * avec ou sans caractère séparateur FNC1/GS et avec ou sans préfixe de symbologie (]C1, ]Q3…).
 * Toute chaîne non conforme est refusée par `invalid_barcode` : un scan n'est jamais deviné.
 */

export const GS = '\u001d';

export interface Gs1Data {
  gtin: string | null;
  lot: string | null;
  expiry: string | null;
  serial: string | null;
}

export interface ParsedBarcode {
  code: string;
  kind: 'gtin' | 'interne' | 'autre';
}

/** Préfixe de symbologie ISO/IEC 15424 : `]` + exactement deux caractères (`]C1`, `]d2`, `]Q3`). */
const SYMBOLOGY = /^\][A-Za-z0-9]{2}/;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

function invalid(detail: string): AppError {
  return new AppError('invalid_barcode', 'Code-barres invalide', detail);
}

/** Clé de contrôle GS1 : poids 3 sur le chiffre le plus à droite du corps, puis 1 en alternance. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += (digits[i] as number) * weight;
    weight = 4 - weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Décodage complet. Un code nu (EAN-13, GTIN-14…) est accepté : GTIN seul, sans lot ni péremption. */
export function decodeGs1(raw: string): Gs1Data {
  const body = stripSymbology(raw.trim());
  if (!body) throw invalid('chaîne vide');
  if (/^\d+$/.test(body)) {
    if (!isValidGtin(body)) throw invalid('clé de contrôle GTIN incorrecte');
    return { gtin: body, lot: null, expiry: null, serial: null };
  }
  return readElements(body);
}

function stripSymbology(value: string): string {
  return SYMBOLOGY.test(value) ? value.slice((SYMBOLOGY.exec(value)?.[0] ?? '').length) : value;
}

function readElements(body: string): Gs1Data {
  const out: Gs1Data = { gtin: null, lot: null, expiry: null, serial: null };
  let i = 0;
  while (i < body.length) {
    if (body[i] === GS) {
      i += 1;
      continue;
    }
    const ai = body.slice(i, i + 2);
    i += 2;
    if (ai === '01') {
      const gtin = readFixed(body, i, 14);
      if (!isValidGtin(gtin)) throw invalid('clé de contrôle GTIN incorrecte');
      out.gtin = gtin;
      i += 14;
    } else if (ai === '17') {
      out.expiry = expiryOf(readFixed(body, i, 6));
      i += 6;
    } else if (ai === '10' || ai === '21') {
      const field = readVariable(body, i);
      if (ai === '10') out.lot = field.value;
      else out.serial = field.value;
      i = field.next;
    } else {
      throw invalid(`identifiant d'application inconnu « ${ai} »`);
    }
  }
  if (!out.gtin) throw invalid('GTIN (AI 01) absent');
  return out;
}

function readFixed(body: string, from: number, length: number): string {
  const value = body.slice(from, from + length);
  if (value.length !== length || !/^\d+$/.test(value)) {
    throw invalid(`champ de ${length} chiffres attendu`);
  }
  return value;
}

function readVariable(body: string, from: number): { value: string; next: number } {
  const end = body.indexOf(GS, from);
  const stop = end < 0 ? body.length : end;
  const value = body.slice(from, stop).trim();
  if (!value || value.length > 20) throw invalid('champ variable vide ou trop long');
  return { value, next: end < 0 ? body.length : end + 1 };
}

/** AA MM JJ : le jour 00 désigne le dernier jour du mois (règle GS1). */
function expiryOf(aammdd: string): string {
  const year = 2000 + Number(aammdd.slice(0, 2));
  const month = Number(aammdd.slice(2, 4));
  const day = Number(aammdd.slice(4, 6));
  if (month < 1 || month > 12) throw invalid('mois de péremption invalide');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const realDay = day === 0 ? last : day;
  if (realDay < 1 || realDay > last) throw invalid('jour de péremption invalide');
  return `${year}-${String(month).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`;
}

/**
 * C-03 : un scan est soit un GTIN (nu ou chaîne GS1), soit un code interne conservé tel quel.
 * Un code numérique de longueur GTIN dont la clé est fausse est refusé, jamais enregistré.
 */
export function parseBarcode(raw: string): ParsedBarcode {
  const code = raw.trim();
  if (!code) throw invalid('code vide');
  if (/^\d+$/.test(code)) {
    if (GTIN_LENGTHS.has(code.length)) {
      if (!isValidGtin(code)) throw invalid('clé de contrôle GTIN incorrecte');
      return { code, kind: 'gtin' };
    }
    return { code, kind: 'autre' };
  }
  if (code.startsWith(']') || code.includes(GS) || /^\d*01\d{14}/.test(code)) {
    const gs1 = decodeGs1(code);
    if (!gs1.gtin) throw invalid('GTIN (AI 01) absent');
    return { code: gs1.gtin, kind: 'gtin' };
  }
  return { code, kind: 'interne' };
}
