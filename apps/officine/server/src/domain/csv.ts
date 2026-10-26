/**
 * I-04 : lecture du CSV d'import (annexe I). Séparateur `;`, guillemets doubles (un `""` vaut un
 * guillemet), retour de ligne possible dans un champ, BOM UTF-8 facultatif, colonnes vides tolérées.
 * Chaque ligne garde son numéro : le rapport d'import désigne la ligne du fichier (en-tête = 1).
 */

export interface CsvRow {
  /** Numéro de ligne du fichier où commence l'enregistrement (1 = en-tête). */
  line: number;
  cells: string[];
}

export interface CsvTable {
  header: string[];
  rows: CsvRow[];
}

const BOM = '\uFEFF';

export function parseCsv(text: string): CsvTable {
  const records = scanRecords(text.startsWith(BOM) ? text.slice(1) : text);
  const first = records.shift();
  return {
    header: (first?.cells ?? []).map((c) => c.trim().toLowerCase()),
    rows: records,
  };
}

function scanRecords(src: string): CsvRow[] {
  const records: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (c === '"') {
        quoted = false;
        i += 1;
      } else {
        if (c === '\n') line += 1;
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
      i += 1;
    } else if (c === ';') {
      cells.push(field);
      field = '';
      i += 1;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      cells.push(field);
      pushRecord(records, cells, start);
      cells = [];
      field = '';
      i += 1;
      line += 1;
      start = line;
    } else {
      field += c;
      i += 1;
    }
  }
  cells.push(field);
  pushRecord(records, cells, start);
  return records;
}

/** Une ligne entièrement vide est ignorée : elle ne compte ni comme valide ni comme rejetée. */
function pushRecord(records: CsvRow[], cells: string[], line: number): void {
  if (cells.every((c) => c.trim() === '')) return;
  records.push({ line, cells: cells.map((c) => c.trim()) });
}
