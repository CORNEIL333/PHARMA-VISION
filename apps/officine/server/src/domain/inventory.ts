import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { activateProduct, getProduct } from './catalog.js';
import { decodeCursor, page, pageLimit } from './cursor.js';
import { isCalendarDate } from './dates.js';
import {
  appendStockEvent, assertCost, findOrCreateLot, getLot, lotQty, MAX_QTY, normalizeLotNumber, type Movement,
} from './stock.js';

/**
 * S-06 : inventaire complet ou par rayon. Les comptages figent la quantité système ; la validation
 * corrige l'écart de chaque lot par un mouvement `inventory`, dans une seule transaction.
 */

export const COMPLETE_SCOPE = 'complet';

export interface InventorySession {
  id: string;
  scope: string;
  status: 'open' | 'validated' | 'cancelled';
  product_ids: string[];
  opened_by: string;
  opened_at: string;
  validated_by: string | null;
  validated_at: string | null;
}

export interface InventoryCount {
  id: string;
  session_id: string;
  lot_id: string;
  product_id: string;
  product_name: string;
  lot_number: string;
  expiry: string | null;
  system_qty: number;
  counted_qty: number;
  delta: number;
  counted_by: string;
  counted_at: string;
}

export interface InventoryReport {
  session_id: string;
  scope: string;
  status: InventorySession['status'];
  counted_lots: number;
  total_delta_qty: number;
  total_delta_value_xaf?: number | null;
  lines: (Omit<InventoryCount, 'id' | 'session_id' | 'counted_by' | 'counted_at'> & { delta_value_xaf?: number | null })[];
}

export function getInventory(s: Services, id: string): InventorySession {
  const r = s.db.prepare('SELECT * FROM inventory_sessions WHERE id = ?').get(id) as
    Omit<InventorySession, 'product_ids'> | undefined;
  if (!r) throw new AppError('not_found', 'Inventaire introuvable');
  const ids = s.db.prepare('SELECT product_id FROM inventory_scope WHERE session_id = ? ORDER BY product_id').all(id) as
    { product_id: string }[];
  return { ...r, product_ids: ids.map((x) => x.product_id) };
}

export function listInventories(s: Services, opts: { limit?: number; cursor?: string } = {}) {
  const limit = pageLimit(opts.limit, 20);
  const c = decodeCursor(opts.cursor, 2);
  const rows = s.db
    .prepare(
      `SELECT id FROM inventory_sessions WHERE (@k IS NULL OR (opened_at, id) < (@k, @id))
       ORDER BY opened_at DESC, id DESC LIMIT @limit`,
    )
    .all({ k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1 }) as { id: string }[];
  const p = page(rows.map((r) => getInventory(s, r.id)), limit, (r) => [r.opened_at, r.id]);
  return p;
}

export function openInventory(
  s: Services,
  actor: string,
  input: { scope: string; product_ids?: string[] },
): InventorySession {
  const scope = typeof input.scope === 'string' ? input.scope.trim() : '';
  if (!scope || scope.length > 80) throw new AppError('validation_failed', 'Périmètre obligatoire');
  const ids = [...new Set(input.product_ids ?? [])];
  if (scope !== COMPLETE_SCOPE && ids.length === 0) {
    throw new AppError('validation_failed', 'Produits du rayon obligatoires', 'Un inventaire par rayon liste ses produits.');
  }
  if (scope === COMPLETE_SCOPE && ids.length > 0) {
    throw new AppError('validation_failed', 'Un inventaire complet ne liste pas de produits');
  }
  if (ids.length > 5000) throw new AppError('validation_failed', 'Trop de produits');
  return writeTx(s.db, () => {
    const id = randomUUID();
    const at = iso(s.clock.now());
    s.db
      .prepare("INSERT INTO inventory_sessions (id, scope, status, opened_by, opened_at) VALUES (?, ?, 'open', ?, ?)")
      .run(id, scope, actor, at);
    const insert = s.db.prepare('INSERT INTO inventory_scope (session_id, product_id) VALUES (?, ?)');
    for (const p of ids) {
      getProduct(s, p);
      insert.run(id, p);
    }
    s.ledger.append('inventory.opened', actor, { session_id: id, scope, product_ids: ids });
    return getInventory(s, id);
  });
}

export type CountInput =
  | { lot_id: string; counted_qty: number }
  | { product_id: string; lot_number: string; expiry: string | null; unit_cost?: number | null; counted_qty: number };

function requireOpen(s: Services, id: string): InventorySession {
  const session = getInventory(s, id);
  if (session.status !== 'open') throw new AppError('invalid_transition', 'Inventaire clos');
  return session;
}

/** Lot compté : lot existant, ou lot découvert à l'inventaire (activation C-02, cause inventory). */
function countedLot(s: Services, actor: string, input: CountInput): string {
  if ('lot_id' in input) return getLot(s, input.lot_id).id;
  getProduct(s, input.product_id);
  if (!isCalendarDate(input.expiry)) throw new AppError('validation_failed', 'Péremption invalide');
  const cost = input.unit_cost ?? null;
  assertCost(cost);
  const { lot } = findOrCreateLot(s, input.product_id, normalizeLotNumber(input.lot_number), input.expiry, cost);
  return lot.id;
}

const MARK_SQL = 'SELECT COALESCE(MAX(rowid), 0) AS mark FROM stock_movements WHERE lot_id = ?';

/** Saisie d'un comptage (un recomptage met à jour la même ligne ; chaque saisie est journalisée). */
export function countInventory(s: Services, actor: string, sessionId: string, input: CountInput): InventoryCount {
  const counted = input.counted_qty;
  if (!Number.isSafeInteger(counted) || counted < 0 || counted > MAX_QTY) {
    throw new AppError('validation_failed', 'Quantité comptée invalide', 'Entier positif ou nul attendu.');
  }
  return writeTx(s.db, () => {
    const session = requireOpen(s, sessionId);
    const lotId = countedLot(s, actor, input);
    const lot = getLot(s, lotId);
    if (lot.is_regul) throw new AppError('validation_failed', 'Le lot de régularisation ne se compte pas');
    if (session.scope !== COMPLETE_SCOPE && !session.product_ids.includes(lot.product_id)) {
      throw new AppError('validation_failed', 'Produit hors du périmètre de cet inventaire');
    }
    activateProduct(s, actor, lot.product_id, 'inventory');
    const system = lotQty(s, lotId);
    const mark = (s.db.prepare(MARK_SQL).get(lotId) as { mark: number }).mark;
    const at = iso(s.clock.now());
    s.db
      .prepare(
        `INSERT INTO inventory_counts (id, session_id, lot_id, counted_qty, system_qty, counted_by, counted_at, movement_mark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, lot_id) DO UPDATE SET counted_qty = excluded.counted_qty,
           system_qty = excluded.system_qty, counted_by = excluded.counted_by,
           counted_at = excluded.counted_at, movement_mark = excluded.movement_mark`,
      )
      .run(randomUUID(), sessionId, lotId, counted, system, actor, at, mark);
    s.ledger.append('inventory.counted', actor, {
      session_id: sessionId, lot_id: lotId, product_id: lot.product_id, counted_qty: counted, system_qty: system,
    });
    return getCount(s, sessionId, lotId);
  });
}

const COUNT_SQL = `SELECT c.id, c.session_id, c.lot_id, l.product_id, p.name AS product_name, l.lot_number, l.expiry,
    c.system_qty, c.counted_qty, c.counted_qty - c.system_qty AS delta, c.counted_by, c.counted_at,
    c.movement_mark, l.unit_cost
  FROM inventory_counts c JOIN lots l ON l.id = c.lot_id JOIN products p ON p.id = l.product_id`;

type CountRow = InventoryCount & { movement_mark: number; unit_cost: number | null };

function strip(r: CountRow): InventoryCount {
  const { movement_mark: _m, unit_cost: _c, ...rest } = r;
  return rest;
}

function getCount(s: Services, sessionId: string, lotId: string): InventoryCount {
  return strip(s.db.prepare(`${COUNT_SQL} WHERE c.session_id = ? AND c.lot_id = ?`).get(sessionId, lotId) as CountRow);
}

export function listInventoryCounts(s: Services, sessionId: string, opts: { limit?: number; cursor?: string } = {}) {
  getInventory(s, sessionId);
  const limit = pageLimit(opts.limit);
  const c = decodeCursor(opts.cursor, 2);
  const rows = s.db
    .prepare(
      `${COUNT_SQL} WHERE c.session_id = @session AND (@k IS NULL OR (p.name, c.id) > (@k, @id))
       ORDER BY p.name, c.id LIMIT @limit`,
    )
    .all({ session: sessionId, k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1 }) as CountRow[];
  const p = page(rows, limit, (r) => [r.product_name, r.id]);
  return { items: p.items.map(strip), next_cursor: p.next_cursor };
}

/** Lots à stock non nul du périmètre qui n'ont pas été comptés (un inventaire n'ignore rien). */
function uncountedLots(s: Services, session: InventorySession): string[] {
  const rows = s.db
    .prepare(
      `SELECT l.id, l.product_id FROM lots l
       WHERE l.is_regul = 0
         AND (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m WHERE m.lot_id = l.id) <> 0
         AND NOT EXISTS (SELECT 1 FROM inventory_counts c WHERE c.session_id = ? AND c.lot_id = l.id)`,
    )
    .all(session.id) as { id: string; product_id: string }[];
  const scoped = session.scope === COMPLETE_SCOPE ? null : new Set(session.product_ids);
  return rows.filter((r) => !scoped || scoped.has(r.product_id)).map((r) => r.id);
}

/** Validation (pharmacien ou titulaire) : un mouvement `inventory` par lot en écart, puis le rapport. */
export function validateInventory(s: Services, actor: string, sessionId: string, withCost = false): InventoryReport {
  return writeTx(s.db, () => {
    const session = requireOpen(s, sessionId);
    const missing = uncountedLots(s, session);
    if (missing.length > 0) {
      throw new AppError('invalid_transition', 'Lots non comptés', `${missing.length} lot(s) en stock n'ont pas été comptés.`, {
        lot_ids: missing.slice(0, 100),
      });
    }
    const counts = s.db.prepare(`${COUNT_SQL} WHERE c.session_id = ?`).all(sessionId) as CountRow[];
    const movements: Movement[] = [];
    for (const c of counts) {
      const mark = (s.db.prepare(MARK_SQL).get(c.lot_id) as { mark: number }).mark;
      if (mark !== c.movement_mark) {
        throw new AppError('invalid_transition', 'Recomptage nécessaire', `Le lot ${c.lot_number} a bougé depuis son comptage.`, {
          lot_id: c.lot_id,
        });
      }
      if (c.delta !== 0) {
        movements.push({
          lot_id: c.lot_id, product_id: c.product_id, qty: c.delta, kind: 'inventory',
          ref_type: 'inventory', ref_id: sessionId, reason: null,
        });
      }
    }
    const at = iso(s.clock.now());
    s.db
      .prepare("UPDATE inventory_sessions SET status = 'validated', validated_by = ?, validated_at = ? WHERE id = ?")
      .run(actor, at, sessionId);
    appendStockEvent(s, 'inventory.validated', actor, {
      session_id: sessionId, counted_lots: counts.length,
      total_delta_qty: counts.reduce((n, c) => n + c.delta, 0),
    }, movements);
    return inventoryReport(s, sessionId, withCost);
  });
}

/** Rapport d'inventaire : écarts par lot ; valeurs au coût seulement avec `cost.view` (null si coût inconnu). */
export function inventoryReport(s: Services, sessionId: string, withCost = false): InventoryReport {
  const session = getInventory(s, sessionId);
  const counts = s.db.prepare(`${COUNT_SQL} WHERE c.session_id = ? ORDER BY p.name, l.lot_number`).all(sessionId) as
    CountRow[];
  const valueOf = (c: CountRow) => (c.delta === 0 ? 0 : c.unit_cost === null ? null : c.delta * c.unit_cost);
  const lines = counts.map((c) => {
    const { id: _i, session_id: _s, counted_by: _b, counted_at: _a, ...line } = strip(c);
    return withCost ? { ...line, delta_value_xaf: valueOf(c) } : line;
  });
  const values = counts.map(valueOf);
  const report: InventoryReport = {
    session_id: sessionId,
    scope: session.scope,
    status: session.status,
    counted_lots: counts.length,
    total_delta_qty: counts.reduce((n, c) => n + c.delta, 0),
    lines,
  };
  if (withCost) {
    report.total_delta_value_xaf = values.some((v) => v === null)
      ? null
      : values.reduce<number>((n, v) => n + (v ?? 0), 0);
  }
  return report;
}
