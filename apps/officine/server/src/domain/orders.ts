import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { activateProduct, getProduct } from './catalog.js';
import { MAX_LEAD_DAYS, requireActiveSupplier, type Supplier } from './suppliers.js';

export const ORDER_STATUSES = ['draft', 'sent', 'partial', 'received', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const MAX_ORDER_LINES = 500;
export const MAX_ORDER_QTY = 1_000_000;
export const MAX_UNIT_COST = 100_000_000;

export interface OrderLineInput {
  product_id: string;
  qty: number;
  unit_cost?: number | null;
}
export interface OrderInput { supplier_id: string; lines: OrderLineInput[] }
export interface OrderPatch { lines: OrderLineInput[] }
export interface OrderLine {
  id: string;
  product_id: string;
  product_name: string;
  strength: string | null;
  form: string | null;
  presentation: string | null;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number | null;
}
export interface OrderSummary {
  id: string;
  number: string;
  supplier_id: string;
  supplier_name: string;
  status: OrderStatus;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  closed_at: string | null;
}
export interface Order extends OrderSummary { lines: OrderLine[] }
export interface OrderListOptions { status?: OrderStatus; supplier_id?: string; limit?: number; cursor?: string }

const SUMMARY_SQL = `SELECT o.id, o.number, o.supplier_id, sp.name AS supplier_name, o.status,
  o.created_by, o.created_at, o.sent_at, o.closed_at
  FROM purchase_orders o JOIN suppliers sp ON sp.id = o.supplier_id`;

export function getOrder(s: Services, id: string, withCost = false): Order {
  const row = s.db.prepare(`${SUMMARY_SQL} WHERE o.id = ?`).get(id) as OrderSummary | undefined;
  if (!row) throw new AppError('not_found', 'Commande introuvable');
  const lines = s.db.prepare(
    `SELECT l.id, l.product_id, p.name AS product_name, p.strength, p.form, p.presentation,
       l.qty_ordered, l.qty_received, CASE WHEN ? = 1 THEN l.unit_cost ELSE NULL END AS unit_cost
     FROM po_lines l JOIN products p ON p.id = l.product_id WHERE l.po_id = ? ORDER BY l.product_id, l.id`,
  ).all(withCost ? 1 : 0, id) as OrderLine[];
  return { ...row, lines };
}

function readCursor(cursor?: string): [string, string] | null {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('cursor');
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('cursor');
    const [at, id] = parsed as unknown[];
    if (typeof at !== 'string' || typeof id !== 'string' || !id || id.length > 100) throw new Error('cursor');
    if (!Number.isFinite(Date.parse(at)) || iso(new Date(at)) !== at) throw new Error('cursor');
    return [at, id];
  } catch {
    throw new AppError('validation_failed', 'Curseur de commande invalide');
  }
}

export function listOrders(s: Services, opts: OrderListOptions = {}) {
  const limit = opts.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('validation_failed', 'Limite attendue entre 1 et 100');
  }
  if (opts.status !== undefined && !ORDER_STATUSES.includes(opts.status)) {
    throw new AppError('validation_failed', 'Statut de commande invalide');
  }
  const cursor = readCursor(opts.cursor);
  const rows = s.db.prepare(`${SUMMARY_SQL}
    WHERE (@status IS NULL OR o.status = @status) AND (@supplier IS NULL OR o.supplier_id = @supplier)
      AND (@at IS NULL OR (o.created_at, o.id) < (@at, @id))
    ORDER BY o.created_at DESC, o.id DESC LIMIT @limit`).all({
    status: opts.status ?? null, supplier: opts.supplier_id ?? null,
    at: cursor?.[0] ?? null, id: cursor?.[1] ?? null, limit: limit + 1,
  }) as OrderSummary[];
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next_cursor = rows.length > limit && last
    ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null;
  return { items, next_cursor };
}

/** Pure transition contract for R-04. Only receipt processing may write partial/received. */
export function assertTransition(from: string, to: string): void {
  const allowed: Record<string, readonly string[]> = {
    draft: ['sent', 'cancelled'], sent: ['partial', 'received', 'cancelled'],
    partial: ['received'], received: [], cancelled: [],
  };
  if (!Object.hasOwn(allowed, from) || !allowed[from]?.includes(to)) {
    throw new AppError('invalid_transition', 'Transition de commande interdite', undefined, { from, to });
  }
}

function validateLines(s: Services, lines: OrderLineInput[]): void {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_ORDER_LINES) {
    throw new AppError('validation_failed', 'La commande doit contenir de 1 à 500 lignes');
  }
  const ids = new Set<string>();
  for (const line of lines) {
    if (!line || typeof line.product_id !== 'string' || !line.product_id || ids.has(line.product_id)) {
      throw new AppError('validation_failed', 'Produit absent ou présent plusieurs fois');
    }
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > MAX_ORDER_QTY) {
      throw new AppError('validation_failed', 'Quantité de commande invalide');
    }
    if (line.unit_cost !== undefined && line.unit_cost !== null &&
        (!Number.isSafeInteger(line.unit_cost) || line.unit_cost < 0 || line.unit_cost > MAX_UNIT_COST)) {
      throw new AppError('validation_failed', 'Coût unitaire invalide', 'Le coût est un entier XAF positif ou nul.');
    }
    if ('qty_received' in line) throw new AppError('validation_failed', 'Quantité reçue réservée à la réception');
    ids.add(line.product_id);
    getProduct(s, line.product_id);
  }
}

function nextNumber(s: Services, at: Date): string {
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Douala', year: 'numeric' }).format(at);
  const name = `purchase_order:${year}`;
  const counter = s.db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as
    { value: number } | undefined;
  if (counter && (!Number.isSafeInteger(counter.value) || counter.value < 0 || counter.value >= Number.MAX_SAFE_INTEGER)) {
    throw new AppError('validation_failed', 'Compteur de commande invalide');
  }
  const row = s.db.prepare(`INSERT INTO counters (name, value) VALUES (?, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`).get(name) as { value: number };
  return `BC-${year}-${String(row.value).padStart(4, '0')}`;
}

function insertLines(s: Services, actor: string, id: string, lines: OrderLineInput[]): void {
  const insert = s.db.prepare(`INSERT INTO po_lines (id, po_id, product_id, qty_ordered, qty_received, unit_cost)
    VALUES (?, ?, ?, ?, 0, ?)`);
  for (const line of lines) {
    insert.run(randomUUID(), id, line.product_id, line.qty, line.unit_cost ?? null);
    activateProduct(s, actor, line.product_id, 'order');
  }
}

function eventOrder(order: Order) {
  return {
    po_id: order.id, number: order.number, supplier_id: order.supplier_id,
    lines: order.lines.map((line) => ({
      product_id: line.product_id, qty: line.qty_ordered, unit_cost: line.unit_cost,
    })),
  };
}

export function createOrder(s: Services, actor: string, input: OrderInput, withCost = false): Order {
  return writeTx(s.db, () => {
    requireActiveSupplier(s, input.supplier_id);
    validateLines(s, input.lines);
    const at = s.clock.now();
    const id = randomUUID();
    const number = nextNumber(s, at);
    s.db.prepare(`INSERT INTO purchase_orders (id, number, supplier_id, status, created_by, created_at)
      VALUES (?, ?, ?, 'draft', ?, ?)`).run(id, number, input.supplier_id, actor, iso(at));
    insertLines(s, actor, id, input.lines);
    s.ledger.append('order.created', actor, eventOrder(getOrder(s, id, true)));
    return getOrder(s, id, withCost);
  });
}

function assertUnreceived(order: Order): void {
  if (order.lines.some((line) => line.qty_received !== 0)) {
    throw new AppError('invalid_transition', 'Transition interdite après réception');
  }
}

export function updateOrder(s: Services, actor: string, id: string, patch: OrderPatch, withCost = false): Order {
  return writeTx(s.db, () => {
    const before = getOrder(s, id, true);
    if (before.status !== 'draft') throw new AppError('invalid_transition', 'Modification réservée au brouillon');
    assertUnreceived(before);
    requireActiveSupplier(s, before.supplier_id);
    validateLines(s, patch.lines);
    const previousCosts = new Map(before.lines.map((line) => [line.product_id, line.unit_cost]));
    const lines = patch.lines.map((line) => ({ ...line, unit_cost: line.unit_cost === undefined
      ? previousCosts.get(line.product_id) ?? null : line.unit_cost }));
    s.db.prepare('DELETE FROM po_lines WHERE po_id = ?').run(id);
    insertLines(s, actor, id, lines);
    s.ledger.append('order.updated', actor, eventOrder(getOrder(s, id, true)));
    return getOrder(s, id, withCost);
  });
}

export function sendOrder(s: Services, actor: string, id: string, withCost = false): Order {
  return writeTx(s.db, () => {
    const before = getOrder(s, id, true);
    assertTransition(before.status, 'sent');
    assertUnreceived(before);
    requireActiveSupplier(s, before.supplier_id);
    validateLines(s, eventOrder(before).lines);
    s.db.prepare("UPDATE purchase_orders SET status = 'sent', sent_at = ? WHERE id = ?")
      .run(iso(s.clock.now()), id);
    s.ledger.append('order.sent', actor, eventOrder(before));
    return getOrder(s, id, withCost);
  });
}

export function cancelOrder(s: Services, actor: string, id: string, reason: string, withCost = false): Order {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || /\p{Cc}/u.test(reason)) {
    throw new AppError('validation_failed', 'Motif d’annulation obligatoire (500 caractères maximum)');
  }
  return writeTx(s.db, () => {
    const before = getOrder(s, id, true);
    assertTransition(before.status, 'cancelled');
    assertUnreceived(before);
    s.db.prepare("UPDATE purchase_orders SET status = 'cancelled', closed_at = ? WHERE id = ?")
      .run(iso(s.clock.now()), id);
    s.ledger.append('order.cancelled', actor, { ...eventOrder(before), from: before.status, reason: reason.trim() });
    return getOrder(s, id, withCost);
  });
}

export interface SuggestionRow {
  product_id: string;
  name: string;
  stock: number;
  on_order: number;
  sales_30d: number;
  min_qty: number;
  max_qty: number;
}
export interface SuggestedLine extends SuggestionRow { rule: 'thresholds' | 'sales'; qty: number }
export interface OrderSuggestion { supplier: Supplier; items: SuggestedLine[] }

const SUGGESTION_SQL = `WITH sold AS (
  SELECT sl.product_id, SUM(sl.qty) AS qty FROM sale_lines sl JOIN sales sa ON sa.id = sl.sale_id
  WHERE sa.status = 'completed' AND sa.voided_at IS NULL AND sa.created_at >= ? AND sa.created_at <= ?
  GROUP BY sl.product_id
), outstanding AS (
  SELECT l.product_id, SUM(MAX(0, l.qty_ordered - l.qty_received)) AS qty
  FROM po_lines l JOIN purchase_orders o ON o.id = l.po_id
  WHERE o.status IN ('sent', 'partial') GROUP BY l.product_id
)
SELECT p.id AS product_id, p.name, ps.qty AS stock, p.min_qty, p.max_qty,
  COALESCE(sold.qty, 0) AS sales_30d, COALESCE(outstanding.qty, 0) AS on_order
FROM products p JOIN product_stock ps ON ps.product_id = p.id
LEFT JOIN sold ON sold.product_id = p.id LEFT JOIN outstanding ON outstanding.product_id = p.id
WHERE p.status = 'active' ORDER BY p.name COLLATE NOCASE, p.id`;

function suggestedLine(row: SuggestionRow, lead: number): SuggestedLine {
  for (const value of [row.stock, row.on_order, row.sales_30d, row.min_qty, row.max_qty, lead]) {
    if (!Number.isSafeInteger(value)) throw new AppError('validation_failed', 'Quantité de suggestion hors limites');
  }
  if (lead < 0 || lead > MAX_LEAD_DAYS || row.min_qty < 0 || row.max_qty < row.min_qty) {
    throw new AppError('validation_failed', 'Seuils ou délai invalides');
  }
  const thresholds = row.min_qty !== 0 || row.max_qty !== 0;
  // Integer arithmetic gives an exact ceiling, including large sales totals.
  const target = thresholds ? BigInt(row.max_qty) : (BigInt(row.sales_30d) * (BigInt(lead) + 7n) + 29n) / 30n;
  const needed = thresholds && row.stock > row.min_qty ? 0n : target - BigInt(row.stock) - BigInt(row.on_order);
  const qty = needed > 0n ? Number(needed) : 0;
  if (!Number.isSafeInteger(qty)) throw new AppError('validation_failed', 'Suggestion hors limites');
  return { ...row, rule: thresholds ? 'thresholds' : 'sales', qty };
}

/** No supplier/product mapping exists: supplier selects lead time; outstanding orders span all suppliers. */
export function suggestOrder(s: Services, supplierId: string): OrderSuggestion {
  const supplier = requireActiveSupplier(s, supplierId);
  const now = s.clock.now();
  const since = iso(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const rows = s.db.prepare(SUGGESTION_SQL).all(since, iso(now)) as SuggestionRow[];
  return { supplier, items: rows.map((row) => suggestedLine(row, supplier.lead_days)).filter((row) => row.qty > 0) };
}
