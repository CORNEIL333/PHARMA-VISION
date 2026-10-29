import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { decodeCursor, page, pageLimit } from './cursor.js';
import { resolveDemands } from './demand.js';
import { assertTransition, getOrder, type Order } from './orders.js';
import { appendStockEvent, assertQty, enterLot, getLot, lotQty, type Movement } from './stock.js';
import { getSupplier } from './suppliers.js';

/**
 * R-04 à R-06 : réception (avec ou sans bon de commande) et retour fournisseur.
 * Une réception = une transaction : lots, mouvements `reception`, quantités reçues du bon,
 * statut du bon, résolution des demandes (D-03) et événement `reception.recorded`.
 */

export const MAX_RECEPTION_LINES = 500;

export interface ReceptionLineInput {
  product_id: string;
  lot_number: string;
  expiry: string;
  qty: number;
  unit_cost?: number | null;
  confirm_near_expiry?: boolean;
}

export interface ReceptionInput {
  po_id?: string | null;
  supplier_id?: string | null;
  note?: string | null;
  lines: ReceptionLineInput[];
}

export interface ReceptionLine {
  product_id: string;
  product_name: string;
  lot_id: string;
  lot_number: string;
  expiry: string | null;
  qty: number;
  unit_cost?: number | null;
}

export interface Reception {
  id: string;
  po_id: string | null;
  po_number: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  note: string | null;
  received_by: string;
  received_at: string;
  lines: ReceptionLine[];
  order_status: string | null;
}

/** Quantités reçues du bon et nouveau statut (partiel ou reçu). */
function applyToOrder(s: Services, order: Order, lines: ReceptionLineInput[]): void {
  const byProduct = new Map(order.lines.map((l) => [l.product_id, l]));
  const add = s.db.prepare('UPDATE po_lines SET qty_received = qty_received + ? WHERE id = ?');
  for (const l of lines) {
    const pl = byProduct.get(l.product_id);
    if (!pl) throw new AppError('validation_failed', 'Produit absent du bon de commande', l.product_id);
    add.run(l.qty, pl.id);
  }
  const rows = s.db.prepare('SELECT qty_ordered, qty_received FROM po_lines WHERE po_id = ?').all(order.id) as
    { qty_ordered: number; qty_received: number }[];
  const status = rows.every((r) => r.qty_received >= r.qty_ordered) ? 'received' : 'partial';
  if (status !== order.status) assertTransition(order.status, status);
  s.db
    .prepare('UPDATE purchase_orders SET status = ?, closed_at = ? WHERE id = ?')
    .run(status, status === 'received' ? iso(s.clock.now()) : null, order.id);
}

function checkInput(input: ReceptionInput): void {
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > MAX_RECEPTION_LINES) {
    throw new AppError('validation_failed', 'La réception doit contenir de 1 à 500 lignes');
  }
  for (const l of input.lines) assertQty(l.qty);
  if (input.note !== undefined && input.note !== null && (input.note.length > 500 || /\p{Cc}/u.test(input.note))) {
    throw new AppError('validation_failed', 'Note invalide');
  }
}

/** R-04, R-05 : réception ligne par ligne (produit, lot, péremption, quantité, coût). */
export function recordReception(s: Services, actor: string, input: ReceptionInput, withCost = false): Reception {
  checkInput(input);
  return writeTx(s.db, () => {
    const order = input.po_id ? getOrder(s, input.po_id, true) : null;
    if (order && !['sent', 'partial'].includes(order.status)) {
      throw new AppError('invalid_transition', 'Bon non réceptionnable', `Le bon ${order.number} est « ${order.status} ».`);
    }
    const supplierId = order?.supplier_id ?? input.supplier_id ?? null;
    if (supplierId) getSupplier(s, supplierId);
    const id = randomUUID();
    const entries = input.lines.map((l) =>
      enterLot(s, actor, {
        product_id: l.product_id, lot_number: l.lot_number, expiry: l.expiry, unit_cost: l.unit_cost ?? null,
        qty: l.qty, kind: 'reception', ref_type: 'reception', ref_id: id,
        confirm_near_expiry: l.confirm_near_expiry === true,
      }, 'reception'),
    );
    if (order) applyToOrder(s, order, input.lines);
    const ev = appendStockEvent(s, 'reception.recorded', actor, {
      reception_id: id, po_id: order?.id ?? null, supplier_id: supplierId,
      lines: entries.map((e) => ({
        product_id: e.lot.product_id, lot_id: e.lot.id, lot_number: e.lot.lot_number, expiry: e.lot.expiry,
        qty: e.movement.qty, unit_cost: e.lot.unit_cost,
      })),
    }, entries.map((e) => e.movement));
    s.db
      .prepare('INSERT INTO receptions (id, po_id, supplier_id, note, received_by, received_at, event_seq) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, order?.id ?? null, supplierId, input.note?.trim() || null, actor, ev.at, ev.seq);
    resolveDemands(s, actor, entries.map((e) => e.lot.product_id), 'reception', id);
    return getReception(s, id, withCost);
  });
}

const RECEPTION_SQL = `SELECT r.id, r.po_id, o.number AS po_number, o.status AS order_status, r.supplier_id,
  sp.name AS supplier_name, r.note, r.received_by, r.received_at
  FROM receptions r LEFT JOIN purchase_orders o ON o.id = r.po_id LEFT JOIN suppliers sp ON sp.id = r.supplier_id`;

export function getReception(s: Services, id: string, withCost = false): Reception {
  const r = s.db.prepare(`${RECEPTION_SQL} WHERE r.id = ?`).get(id) as Omit<Reception, 'lines'> | undefined;
  if (!r) throw new AppError('not_found', 'Réception introuvable');
  const lines = s.db
    .prepare(
      `SELECT m.product_id, p.name AS product_name, m.lot_id, l.lot_number, l.expiry, m.qty, l.unit_cost
       FROM stock_movements m JOIN lots l ON l.id = m.lot_id JOIN products p ON p.id = m.product_id
       WHERE m.ref_type = 'reception' AND m.ref_id = ? ORDER BY p.name, l.lot_number`,
    )
    .all(id) as (ReceptionLine & { unit_cost: number | null })[];
  return {
    ...r,
    lines: lines.map(({ unit_cost, ...l }) => (withCost ? { ...l, unit_cost } : l)),
  };
}

export function listReceptions(s: Services, opts: { limit?: number; cursor?: string; po_id?: string } = {}, withCost = false) {
  const limit = pageLimit(opts.limit, 20);
  const c = decodeCursor(opts.cursor, 2);
  const rows = s.db
    .prepare(
      `SELECT id, received_at FROM receptions WHERE (@po IS NULL OR po_id = @po)
         AND (@k IS NULL OR (received_at, id) < (@k, @id)) ORDER BY received_at DESC, id DESC LIMIT @limit`,
    )
    .all({ po: opts.po_id ?? null, k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1 }) as
    { id: string; received_at: string }[];
  const p = page(rows, limit, (r) => [r.received_at, r.id]);
  return { items: p.items.map((r) => getReception(s, r.id, withCost)), next_cursor: p.next_cursor };
}

export interface SupplierReturnInput {
  supplier_id: string;
  lot_id: string;
  qty: number;
  reason: string;
}

/** R-06 : retour fournisseur avec motif (lots rappelés ou périmés compris). */
export function returnToSupplier(s: Services, actor: string, input: SupplierReturnInput): { lot_id: string; qty: number } {
  assertQty(input.qty);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 200 || /\p{Cc}/u.test(reason)) throw new AppError('validation_failed', 'Motif obligatoire');
  return writeTx(s.db, () => {
    const supplier = getSupplier(s, input.supplier_id);
    const lot = getLot(s, input.lot_id);
    if (lot.is_regul) throw new AppError('validation_failed', 'Le lot de régularisation ne se retourne pas');
    const movement: Movement = {
      lot_id: lot.id, product_id: lot.product_id, qty: -input.qty, kind: 'return_supplier',
      ref_type: 'supplier', ref_id: supplier.id, reason,
    };
    appendStockEvent(s, 'stock.returned_to_supplier', actor, {
      supplier_id: supplier.id, lot_id: lot.id, product_id: lot.product_id, reason,
    }, [movement]);
    return { lot_id: lot.id, qty: lotQty(s, lot.id) };
  });
}
