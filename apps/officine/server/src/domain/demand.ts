import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getProduct } from './catalog.js';
import { decodeCursor, page, pageLimit } from './cursor.js';
import { normalizeIso } from './dates.js';
import { createOrder, updateOrder, type Order } from './orders.js';
import { MAX_QTY } from './stock.js';

/** D-01 à D-03 : demandes non satisfaites (« Client demandait… »). */

export interface DemandInput {
  product_id?: string | null;
  free_text?: string | null;
  qty?: number;
  note?: string | null;
}

export interface Demand {
  id: string;
  product_id: string | null;
  product_name: string | null;
  free_text: string | null;
  qty: number;
  source: string;
  criticity: number;
  note: string | null;
  user_id: string;
  at: string;
  resolved_at: string | null;
  resolved_cause: string | null;
}

const DEMAND_SQL = `SELECT d.id, d.product_id, p.name AS product_name, d.free_text, d.qty, d.source, d.criticity,
  d.note, d.user_id, d.at, d.resolved_at, d.resolved_cause
  FROM unmet_demand d LEFT JOIN products p ON p.id = d.product_id`;

function cleanText(v: unknown, max: number, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new AppError('validation_failed', `${what} invalide`);
  const t = v.trim();
  if (t.length > max || /\p{Cc}/u.test(t)) throw new AppError('validation_failed', `${what} invalide`);
  return t || null;
}

export function getDemand(s: Services, id: string): Demand {
  const r = s.db.prepare(`${DEMAND_SQL} WHERE d.id = ?`).get(id) as Demand | undefined;
  if (!r) throw new AppError('not_found', 'Demande introuvable');
  return r;
}

/** D-01 : saisie au comptoir ; l'événement porte la criticité du produit (3 pour un texte libre). */
export function recordDemand(s: Services, actor: string, input: DemandInput): Demand {
  const freeText = cleanText(input.free_text, 200, 'Texte');
  const note = cleanText(input.note, 500, 'Note');
  const qty = input.qty ?? 1;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY) throw new AppError('validation_failed', 'Quantité invalide');
  const productId = input.product_id ?? null;
  if (!productId && !freeText) throw new AppError('validation_failed', 'Produit ou texte libre obligatoire');
  return writeTx(s.db, () => {
    const criticity = productId ? getProduct(s, productId).criticity : 3;
    const id = randomUUID();
    const at = iso(s.clock.now());
    s.db
      .prepare(
        `INSERT INTO unmet_demand (id, product_id, free_text, qty, source, criticity, note, user_id, at)
         VALUES (?, ?, ?, ?, 'comptoir', ?, ?, ?, ?)`,
      )
      .run(id, productId, productId ? null : freeText, qty, criticity, note, actor, at);
    s.ledger.append('demand.unmet', actor, {
      demand_id: id, product_id: productId, free_text: productId ? null : freeText, qty, criticity, source: 'comptoir',
    });
    return getDemand(s, id);
  });
}

export interface DemandListOptions {
  status?: 'open' | 'resolved' | 'all';
  product_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function period(from?: string, to?: string): { from: string | null; to: string | null } {
  const f = from === undefined ? null : normalizeIso(from);
  const t = to === undefined ? null : normalizeIso(to);
  if ((from !== undefined && !f) || (to !== undefined && !t) || (f && t && f > t)) {
    throw new AppError('validation_failed', 'Période invalide');
  }
  return { from: f, to: t };
}

/** D-02 : liste détaillée, du plus récent au plus ancien. */
export function listDemand(s: Services, opts: DemandListOptions = {}) {
  const limit = pageLimit(opts.limit);
  const c = decodeCursor(opts.cursor, 2);
  const p = period(opts.from, opts.to);
  const rows = s.db
    .prepare(
      `${DEMAND_SQL} WHERE (@status = 'all' OR (@status = 'open' AND d.resolved_at IS NULL)
         OR (@status = 'resolved' AND d.resolved_at IS NOT NULL))
         AND (@product IS NULL OR d.product_id = @product)
         AND (@from IS NULL OR d.at >= @from) AND (@to IS NULL OR d.at <= @to)
         AND (@k IS NULL OR (d.at, d.id) < (@k, @id))
       ORDER BY d.at DESC, d.id DESC LIMIT @limit`,
    )
    .all({
      status: opts.status ?? 'open', product: opts.product_id ?? null, ...p,
      k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1,
    }) as Demand[];
  return page(rows, limit, (r) => [r.at, r.id]);
}

export interface DemandSummary {
  product_id: string | null;
  label: string;
  criticity: number;
  requests: number;
  qty: number;
  open: number;
  last_at: string;
}

/** D-02, P-07 : regroupement par produit (ou par texte libre), criticité d'abord. */
export function summarizeDemand(s: Services, from?: string, to?: string): DemandSummary[] {
  const p = period(from, to);
  return s.db
    .prepare(
      `SELECT d.product_id, COALESCE(p.name, d.free_text) AS label, MIN(d.criticity) AS criticity,
              COUNT(*) AS requests, SUM(d.qty) AS qty, SUM(d.resolved_at IS NULL) AS open, MAX(d.at) AS last_at
       FROM unmet_demand d LEFT JOIN products p ON p.id = d.product_id
       WHERE (@from IS NULL OR d.at >= @from) AND (@to IS NULL OR d.at <= @to)
       GROUP BY d.product_id, CASE WHEN d.product_id IS NULL THEN lower(d.free_text) END
       ORDER BY criticity, requests DESC, label LIMIT 500`,
    )
    .all(p) as DemandSummary[];
}

/**
 * D-03 : résolution automatique des demandes ouvertes d'un produit à sa réception.
 * Appelée dans la transaction de la réception.
 */
export function resolveDemands(s: Services, actor: string, productIds: string[], cause: string, ref: string): number {
  if (!s.db.inTransaction) throw new Error('resolveDemands doit être appelé dans une transaction');
  const open = s.db.prepare('SELECT id FROM unmet_demand WHERE product_id = ? AND resolved_at IS NULL ORDER BY at, id');
  const close = s.db.prepare('UPDATE unmet_demand SET resolved_at = ?, resolved_cause = ?, resolved_ref = ? WHERE id = ?');
  const at = iso(s.clock.now());
  let n = 0;
  for (const productId of new Set(productIds)) {
    for (const r of open.all(productId) as { id: string }[]) {
      close.run(at, cause, ref, r.id);
      s.ledger.append('demand.resolved', actor, { demand_id: r.id, product_id: productId, cause, ref });
      n++;
    }
  }
  return n;
}

/** D-02 « ajouter à la commande » : ajoute la quantité au brouillon du fournisseur, ou en crée un. */
export function demandToOrder(s: Services, actor: string, demandId: string, supplierId: string, withCost = false): Order {
  const d = getDemand(s, demandId);
  if (!d.product_id) throw new AppError('validation_failed', 'Demande sans produit du catalogue', 'Associez d\'abord un produit.');
  if (d.resolved_at) throw new AppError('invalid_transition', 'Demande déjà résolue');
  const draft = s.db
    .prepare("SELECT id FROM purchase_orders WHERE supplier_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1")
    .get(supplierId) as { id: string } | undefined;
  if (!draft) return createOrder(s, actor, { supplier_id: supplierId, lines: [{ product_id: d.product_id, qty: d.qty }] }, withCost);
  const lines = s.db.prepare('SELECT product_id, qty_ordered AS qty, unit_cost FROM po_lines WHERE po_id = ?').all(draft.id) as
    { product_id: string; qty: number; unit_cost: number | null }[];
  const existing = lines.find((l) => l.product_id === d.product_id);
  if (existing) existing.qty += d.qty;
  else lines.push({ product_id: d.product_id, qty: d.qty, unit_cost: null });
  return updateOrder(s, actor, draft.id, { lines }, withCost);
}
