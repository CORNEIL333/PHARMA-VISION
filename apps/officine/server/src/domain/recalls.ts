import { createHash, randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getProduct } from './catalog.js';
import { parseCsv } from './csv.js';
import { parseBarcode } from './gs1.js';

/** Q-01, Q-02, Q-05 : rappels de lots. Un lot rappelé est exclu du FEFO et ne se vend pas. */

export const RECALL_SOURCES = ['DPML', 'laboratoire', 'grossiste', 'interne'] as const;

export interface RecallInput {
  reference: string;
  product_id: string;
  lot_number?: string | null;
  reason: string;
  source: string;
}

export interface Recall {
  id: string;
  reference: string;
  product_id: string;
  product_name: string;
  lot_number: string | null;
  reason: string;
  source: string;
  active: boolean;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  blocked_lots: { lot_id: string; lot_number: string; expiry: string | null; qty: number }[];
}

function text(v: unknown, max: number, what: string, optional = false): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) {
    if (optional) return null;
    throw new AppError('validation_failed', `${what} obligatoire`);
  }
  if (t.length > max || /\p{Cc}/u.test(t)) throw new AppError('validation_failed', `${what} invalide`);
  return t;
}

function checkRecall(input: RecallInput) {
  const source = text(input.source, 20, 'Source') as string;
  if (!(RECALL_SOURCES as readonly string[]).includes(source)) {
    throw new AppError('validation_failed', 'Source invalide', `Sources : ${RECALL_SOURCES.join(', ')}.`);
  }
  return {
    reference: text(input.reference, 80, 'Référence') as string,
    lot_number: text(input.lot_number, 60, 'Lot', true),
    reason: text(input.reason, 500, 'Motif') as string,
    source,
  };
}

/** Insertion d'un rappel dans la transaction courante (Q-01, Q-05). */
function insertRecall(s: Services, actor: string, productId: string, r: ReturnType<typeof checkRecall>): string {
  getProduct(s, productId);
  const id = randomUUID();
  s.db
    .prepare(
      `INSERT INTO recalls (id, reference, product_id, lot_number, reason, source, active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, r.reference, productId, r.lot_number, r.reason, r.source, actor, iso(s.clock.now()));
  s.ledger.append('recall.published', actor, {
    recall_id: id, reference: r.reference, product_id: productId, lot_number: r.lot_number, reason: r.reason, source: r.source,
  });
  return id;
}

export function createRecall(s: Services, actor: string, input: RecallInput): Recall {
  const r = checkRecall(input);
  return writeTx(s.db, () => getRecall(s, insertRecall(s, actor, input.product_id, r)));
}

export function closeRecall(s: Services, actor: string, id: string, reason: string): Recall {
  const why = text(reason, 500, 'Motif') as string;
  return writeTx(s.db, () => {
    const r = getRecall(s, id);
    if (!r.active) throw new AppError('invalid_transition', 'Rappel déjà clos');
    s.db.prepare('UPDATE recalls SET active = 0, closed_by = ?, closed_at = ? WHERE id = ?').run(actor, iso(s.clock.now()), id);
    s.ledger.append('recall.closed', actor, { recall_id: id, product_id: r.product_id, lot_number: r.lot_number, reason: why });
    return getRecall(s, id);
  });
}

const RECALL_SQL = `SELECT r.id, r.reference, r.product_id, p.name AS product_name, r.lot_number, r.reason, r.source,
  r.active, r.created_by, r.created_at, r.closed_at FROM recalls r JOIN products p ON p.id = r.product_id`;

type RecallRow = Omit<Recall, 'active' | 'blocked_lots'> & { active: number };

function withLots(s: Services, r: RecallRow): Recall {
  const lots = s.db
    .prepare(
      `SELECT * FROM (SELECT l.id AS lot_id, l.lot_number, l.expiry,
         (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m WHERE m.lot_id = l.id) AS qty
       FROM lots l WHERE l.product_id = ? AND l.is_regul = 0 AND (? IS NULL OR l.lot_number = ?))
       ORDER BY lot_number`,
    )
    .all(r.product_id, r.lot_number, r.lot_number) as Recall['blocked_lots'];
  return { ...r, active: r.active === 1, blocked_lots: lots };
}

export function getRecall(s: Services, id: string): Recall {
  const r = s.db.prepare(`${RECALL_SQL} WHERE r.id = ?`).get(id) as RecallRow | undefined;
  if (!r) throw new AppError('not_found', 'Rappel introuvable');
  return withLots(s, r);
}

export function listRecalls(s: Services, activeOnly = false): Recall[] {
  const rows = s.db
    .prepare(`${RECALL_SQL} WHERE (? = 0 OR r.active = 1) ORDER BY r.active DESC, r.created_at DESC LIMIT 500`)
    .all(activeOnly ? 1 : 0) as RecallRow[];
  return rows.map((r) => withLots(s, r));
}

export interface RecallImportReport {
  sha256: string;
  created: number;
  rejected: { line: number; reason: string }[];
}

const IMPORT_COLUMNS = ['reference', 'product', 'lot_number', 'reason', 'source'];

/** Produit visé : `ref_code` du référentiel ou code-barres (GTIN). */
function resolveProduct(s: Services, ref: string): string | null {
  const byRef = s.db.prepare('SELECT id FROM products WHERE ref_code = ?').get(ref) as { id: string } | undefined;
  if (byRef) return byRef.id;
  try {
    const code = parseBarcode(ref).code;
    return (s.db.prepare('SELECT product_id FROM barcodes WHERE code = ?').get(code) as { product_id: string } | undefined)?.product_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Q-05 : import d'un fichier de rappels (CSV `;` : reference;product;lot_number;reason;source),
 * tout ou rien : une ligne invalide fait refuser le fichier, pour qu'aucun rappel ne soit oublié.
 */
export function importRecalls(s: Services, actor: string, body: Buffer): RecallImportReport {
  const sha256 = createHash('sha256').update(body).digest('hex');
  const { header, rows } = parseCsv(body.toString('utf8'));
  const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new AppError('validation_failed', 'En-tête incomplet', `Colonnes manquantes : ${missing.join(', ')}.`);
  const rejected: RecallImportReport['rejected'] = [];
  const valid: { productId: string; r: ReturnType<typeof checkRecall> }[] = [];
  rows.forEach((row) => {
    const get = (c: string) => row.cells[header.indexOf(c)] ?? '';
    try {
      const productId = resolveProduct(s, get('product').trim());
      if (!productId) throw new AppError('validation_failed', 'Produit inconnu');
      valid.push({ productId, r: checkRecall({ reference: get('reference'), product_id: productId, lot_number: get('lot_number'), reason: get('reason'), source: get('source') }) });
    } catch (e) {
      rejected.push({ line: row.line, reason: e instanceof Error ? e.message : 'invalide' });
    }
  });
  if (rejected.length) throw new AppError('validation_failed', 'Fichier de rappels refusé', `${rejected.length} ligne(s) invalide(s).`, { rejected: rejected.slice(0, 100) });
  if (valid.length === 0) throw new AppError('validation_failed', 'Fichier vide');
  return writeTx(s.db, () => {
    for (const v of valid) insertRecall(s, actor, v.productId, v.r);
    return { sha256, created: valid.length, rejected };
  });
}
