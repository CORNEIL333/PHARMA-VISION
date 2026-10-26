import { describe, expect, it } from 'vitest';
import { decodeGs1, isValidGtin, parseBarcode } from '../src/domain/gs1.js';
import { AppError } from '../src/errors.js';

const GS = '\u001d';
/** GTIN-14 valide (clé de contrôle 5). */
const GTIN14 = '03400000000005';
/** EAN-13 valide (clé de contrôle 1). */
const EAN13 = '4006381333931';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'no_error';
};

describe('C-04 décodage GS1 DataMatrix', () => {
  it('C-04 extrait GTIN, lot, péremption et numéro de série avec FNC1/GS', () => {
    const raw = `01${GTIN14}1728123110LOT-42${GS}21SERIE-9`;
    expect(decodeGs1(raw)).toEqual({
      gtin: GTIN14,
      lot: 'LOT-42',
      expiry: '2028-12-31',
      serial: 'SERIE-9',
    });
  });

  it('C-04 sans caractère FNC1 : les AI de longueur fixe se suivent, le champ variable finit la chaîne', () => {
    const raw = `01${GTIN14}1728123110LOT42`;
    expect(decodeGs1(raw)).toEqual({
      gtin: GTIN14,
      lot: 'LOT42',
      expiry: '2028-12-31',
      serial: null,
    });
  });

  it('C-04 séparateur GS entre deux champs variables (lot puis série)', () => {
    const raw = `01${GTIN14}10LOT42${GS}21SER42`;
    expect(decodeGs1(raw)).toEqual({ gtin: GTIN14, lot: 'LOT42', expiry: null, serial: 'SER42' });
  });

  it('C-04 préfixe de symbologie ]C1 ignoré et jour 00 = dernier jour du mois', () => {
    const raw = `]C101${GTIN14}1727100010A1`;
    expect(decodeGs1(raw)).toEqual({ gtin: GTIN14, lot: 'A1', expiry: '2027-10-31', serial: null });
  });

  it('C-04 un code-barres nu (EAN-13) est un GTIN sans lot ni péremption', () => {
    expect(decodeGs1(EAN13)).toEqual({ gtin: EAN13, lot: null, expiry: null, serial: null });
  });

  it('C-04 un GTIN dont la clé de contrôle est fausse est refusé', () => {
    expect(codeOf(() => decodeGs1(`01${'03400000000001'}17281231`))).toBe('invalid_barcode');
    expect(codeOf(() => decodeGs1('03400000000001'))).toBe('invalid_barcode');
  });

  it('C-04 une date GS1 impossible est refusée', () => {
    expect(codeOf(() => decodeGs1(`01${GTIN14}17261331`))).toBe('invalid_barcode');
    expect(codeOf(() => decodeGs1(`01${GTIN14}17260230`))).toBe('invalid_barcode');
  });

  it('C-04 un AI inconnu dans une chaîne structurée est refusé', () => {
    expect(codeOf(() => decodeGs1(`01${GTIN14}99xyz`))).toBe('invalid_barcode');
  });
});

describe('C-04 validation des codes-barres', () => {
  it('C-04 isValidGtin accepte 8, 12, 13 et 14 chiffres avec clé valide', () => {
    for (const ok of ['12345670', '00012345600012', EAN13, GTIN14]) expect(isValidGtin(ok)).toBe(true);
    for (const ko of ['12345678', '03400000000001', '400638133393', '1234567890123'])
      expect(isValidGtin(ko)).toBe(false);
  });

  it('C-04 un code interne non GTIN est conservé tel quel', () => {
    expect(parseBarcode('INT-0001')).toEqual({ code: 'INT-0001', kind: 'interne' });
    expect(parseBarcode(`01${GTIN14}10LOT1`)).toEqual({ code: GTIN14, kind: 'gtin' });
    expect(parseBarcode(EAN13)).toEqual({ code: EAN13, kind: 'gtin' });
  });

  it('C-04 un code vide ou manifestement faux est refusé', () => {
    expect(codeOf(() => parseBarcode('   '))).toBe('invalid_barcode');
    expect(codeOf(() => parseBarcode('03400000000001'))).toBe('invalid_barcode');
  });
});

