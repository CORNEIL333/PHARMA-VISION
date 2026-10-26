import { createHash, randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { parseCsv, type CsvTable } from './csv.js';
import { isValidGtin } from './gs1.js';
import { buildSearchText } from './search.js';

/**
 * I-04 : import du catalogue (annexe I). Une transaction unique : soit le fichier est appliqué
 * ligne par ligne, soit rien ne change. Le réimport met à jour le référentiel par `ref_code`
 * sans jamais toucher au stock, au prix de vente de l'officine, aux seuils ni au statut.
 */

export interface ImportError {
  line: number;
  ref_code: string | null;
  reason: string;
}

export interface ImportConflict {
  line: number;
  code: string;
  product_id: string;
}

export interface ImportReport {
  import_id: string;
  filename: string | null;
  sha256: string;
  lines_total: number;
  inserted: number;
  updated: number;
  rejected: number;
  unknown_columns: string[];
  errors: ImportError[];
  conflicts: ImportConflict[];
  /** Vrai quand les listes errors/conflicts ont été tronquées (fichier très dégradé). */
  truncated: boolean;
}

const KNOWN = new Set([
  'ref_code',
  'name',
  'dci',
  'strength',
  'form',
  'presentation',
  'category',
  'rx_required',
  'sensitive',
  'criticity',
  'storage',
  'suggested_price',
  'gtin',
]);
const REQUIRED = ['ref_code', 'name', 'category'];
const CATEGORIES = ['medicament', 'dispositif', 'parapharmacie', 'autre'];
const STORAGES = ['ambiant', '2-8C', 'moins_25C', 'congelé'];
const MAX_REPORT_ITEMS = 1000;

interface ParsedRow {
  ref_code: string;
  name: string;
  dci: string | null;
  strength: string | null;
  form: string | null;
  presentation: string | null;
  category: string;
  rx_required: number;
  sensitive: number;
  criticity: number;
  storage: string | null;
  suggested_price: number | null;
  gtins: string[];
}

type RowResult = { ok: true; row: ParsedRow } | { ok: false; reason: string };

export function importCatalog(
  s: Services,
  actor: string,
  content: Buffer,
  filename: string | null,
): ImportReport {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const table = parseCsv(content.toString('utf8'));
  const columns = columnIndex(table.header);
  const unknown = table.header.filter((h) => h !== '' && !KNOWN.has(h));
  return writeTx(s.db, () => applyImport(s, actor, table, columns, unknown, sha256, filename));
}

function columnIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (h !== '' && !index.has(h)) index.set(h, i);
  });
  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length > 0) {
    throw new AppError(
      'validation_failed',
      'En-tête incomplet',
      `Colonnes obligatoires absentes : ${missing.join(', ')}.`,
    );
  }
  return index;
}

function applyImport(
  s: Services,
  actor: string,
  table: CsvTable,
  columns: Map<string, number>,
  unknown: string[],
  sha256: string,
  filename: string | null,
): ImportReport {
  const errors: ImportError[] = [];
  const conflicts: ImportConflict[] = [];
  let inserted = 0;
  let updated = 0;
  for (const row of table.rows) {
    const cell = (c: string) => row.cells[columns.get(c) ?? -1] ?? '';
    const parsed = parseRow(cell);
    if (!parsed.ok) {
      errors.push({ line: row.line, ref_code: cell('ref_code') || null, reason: parsed.reason });
      continue;
    }
    const applied = applyRow(s, row.line, parsed.row);
    if (applied.action === 'inserted') inserted += 1;
    else updated += 1;
    conflicts.push(...applied.conflicts);
  }
  const report = buildReport({
    sha256,
    filename,
    linesTotal: table.rows.length,
    inserted,
    updated,
    unknown,
    errors,
    conflicts,
  });
  saveReport(s, actor, report);
  return report;
}

function buildReport(input: {
  sha256: string;
  filename: string | null;
  linesTotal: number;
  inserted: number;
  updated: number;
  unknown: string[];
  errors: ImportError[];
  conflicts: ImportConflict[];
}): ImportReport {
  const truncated = input.errors.length > MAX_REPORT_ITEMS || input.conflicts.length > MAX_REPORT_ITEMS;
  return {
    import_id: randomUUID(),
    filename: input.filename,
    sha256: input.sha256,
    lines_total: input.linesTotal,
    inserted: input.inserted,
    updated: input.updated,
    rejected: input.errors.length,
    unknown_columns: input.unknown,
    errors: input.errors.slice(0, MAX_REPORT_ITEMS),
    conflicts: input.conflicts.slice(0, MAX_REPORT_ITEMS),
    truncated,
  };
}

/** Le rapport est conservé en base et scellé par un événement unique portant l'empreinte du fichier. */
function saveReport(s: Services, actor: string, r: ImportReport): void {
  const now = iso(s.clock.now());
  s.db
    .prepare(
      `INSERT INTO catalog_imports (id, filename, sha256, lines_total, inserted, updated, rejected,
         unknown_columns, errors, conflicts, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.import_id,
      r.filename,
      r.sha256,
      r.lines_total,
      r.inserted,
      r.updated,
      r.rejected,
      JSON.stringify(r.unknown_columns),
      JSON.stringify(r.errors),
      JSON.stringify(r.conflicts),
      actor,
      now,
    );
  s.ledger.append('catalog.imported', actor, {
    import_id: r.import_id,
    filename: r.filename,
    sha256: r.sha256,
    lines_total: r.lines_total,
    inserted: r.inserted,
    updated: r.updated,
    rejected: r.rejected,
    unknown_columns: r.unknown_columns,
    truncated: r.truncated,
  });
}

function parseRow(cell: (col: string) => string): RowResult {
  const ref = cell('ref_code');
  if (!ref) return { ok: false, reason: 'ref_code_missing' };
  const name = cell('name');
  if (!name || name.length > 200) return { ok: false, reason: 'name_invalid' };
  const category = cell('category');
  if (!CATEGORIES.includes(category)) return { ok: false, reason: 'category_invalid' };
  const rx = flag(cell('rx_required'), category === 'medicament' ? 1 : 0);
  if (rx === null) return { ok: false, reason: 'rx_invalid' };
  const sensitive = flag(cell('sensitive'), 0);
  if (sensitive === null) return { ok: false, reason: 'sensitive_invalid' };
  const criticity = criticityOf(cell('criticity'));
  if (criticity === null) return { ok: false, reason: 'criticity_invalid' };
  const storage = cell('storage');
  if (storage && !STORAGES.includes(storage)) return { ok: false, reason: 'storage_invalid' };
  const price = priceOf(cell('suggested_price'));
  if (price === undefined) return { ok: false, reason: 'price_invalid' };
  const gtins = cell('gtin').split('|').map((g) => g.trim()).filter(Boolean);
  if (gtins.some((g) => !isValidGtin(g))) return { ok: false, reason: 'gtin_invalid' };
  return {
    ok: true,
    row: {
      ref_code: ref,
      name,
      dci: cell('dci') || null,
      strength: cell('strength') || null,
      form: cell('form') || null,
      presentation: cell('presentation') || null,
      category,
      rx_required: rx,
      sensitive,
      criticity,
      storage: storage || null,
      suggested_price: price,
      gtins,
    },
  };
}

function flag(raw: string, fallback: number): number | null {
  if (!raw) return fallback;
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  return null;
}

function criticityOf(raw: string): number | null {
  if (!raw) return 3;
  return ['1', '2', '3'].includes(raw) ? Number(raw) : null;
}

/** `undefined` = valeur invalide ; `null` = colonne vide (prix non fourni). */
function priceOf(raw: string): number | null | undefined {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Met à jour le référentiel seul : prix local, seuils, statut et lots ne sont jamais touchés. */
function applyRow(
  s: Services,
  line: number,
  row: ParsedRow,
): { action: 'inserted' | 'updated'; conflicts: ImportConflict[] } {
  const existing = s.db.prepare('SELECT id FROM products WHERE ref_code = ?').get(row.ref_code) as
    { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  const now = iso(s.clock.now());
  upsertProduct(s, id, row, now, existing !== undefined);
  return { action: existing ? 'updated' : 'inserted', conflicts: linkGtins(s, line, id, row.gtins) };
}

const INSERT_PRODUCT = `INSERT INTO products (id, ref_code, name, dci, strength, form, presentation,
  category, rx_required, sensitive, criticity, storage, suggested_price, status, local_only,
  search_text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dormant', 0, ?, ?, ?)`;

const UPDATE_PRODUCT = `UPDATE products SET name = ?, dci = ?, strength = ?, form = ?, presentation = ?,
  category = ?, rx_required = ?, sensitive = ?, criticity = ?, storage = ?, suggested_price = ?,
  search_text = ?, updated_at = ? WHERE id = ?`;

function upsertProduct(s: Services, id: string, row: ParsedRow, now: string, isUpdate: boolean): void {
  const text = buildSearchText(row);
  const values = [
    row.name,
    row.dci,
    row.strength,
    row.form,
    row.presentation,
    row.category,
    row.rx_required,
    row.sensitive,
    row.criticity,
    row.storage,
    row.suggested_price,
  ];
  if (isUpdate) {
    s.db.prepare(UPDATE_PRODUCT).run(...values, text, now, id);
    return;
  }
  s.db.prepare(INSERT_PRODUCT).run(id, row.ref_code, ...values, text, now, now);
}

/** Un GTIN déjà porté par une autre fiche est signalé en conflit et n'est jamais réaffecté. */
function linkGtins(s: Services, line: number, productId: string, codes: string[]): ImportConflict[] {
  const find = s.db.prepare('SELECT product_id FROM barcodes WHERE code = ?');
  const add = s.db.prepare('INSERT INTO barcodes (code, product_id, kind) VALUES (?, ?, ?)');
  const conflicts: ImportConflict[] = [];
  for (const code of codes) {
    const owner = find.get(code) as { product_id: string } | undefined;
    if (!owner) add.run(code, productId, 'gtin');
    else if (owner.product_id !== productId) conflicts.push({ line, code, product_id: owner.product_id });
  }
  return conflicts;
}
