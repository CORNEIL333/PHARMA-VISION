import assert from 'node:assert/strict';
import type { DB } from '../src/db/index.js';
import type { Agent, TestApp } from './helpers.js';

/**
 * Préparation d'état pour R-01 à R-03 : insertions directes (aucune règle métier testée ici).
 * Les mouvements de stock sont insérés sans événement : ce sont des fixtures, pas des écritures métier.
 */

const AT = '2026-10-27T08:00:00.000Z';

export interface SeedSupplier {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  leadDays?: number;
  active?: number;
}

export function seedSupplier(db: DB, sp: SeedSupplier, at = AT): void {
  db.prepare(
    'INSERT INTO suppliers (id, name, phone, email, lead_days, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(sp.id, sp.name, sp.phone ?? null, sp.email ?? null, sp.leadDays ?? 2, sp.active ?? 1, at);
}

export function seedLot(
  db: DB,
  l: { id: string; productId: string; lotNumber?: string; expiry?: string | null; unitCost?: number | null },
  at = AT,
): void {
  db.prepare(
    'INSERT INTO lots (id, product_id, lot_number, expiry, unit_cost, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(l.id, l.productId, l.lotNumber ?? `L-${l.id}`, l.expiry ?? '2028-12-31', l.unitCost ?? null, at);
}

/** Stock de départ : un mouvement `reception` positif (ou négatif pour une sortie), sans événement (fixture). */
export function seedMovement(
  db: DB,
  m: { productId: string; lotId: string; qty: number; userId: string; kind?: string },
  at = AT,
): void {
  db.prepare(
    `INSERT INTO stock_movements (id, product_id, lot_id, qty, kind, user_id, event_seq, at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(`m-${m.lotId}-${at}-${m.qty}`, m.productId, m.lotId, m.qty, m.kind ?? (m.qty > 0 ? 'reception' : 'sale'), m.userId, at);
}

let saleSeq = 0;

/** Vente passée (pour ventes_30j de R-02) : session de caisse, vente, ligne. */
export function seedSale(
  db: DB,
  sale: { productId: string; lotId: string; qty: number; userId: string; at: string; status?: 'completed' | 'voided' },
): void {
  saleSeq += 1;
  const sess = `cs-${saleSeq}`;
  const id = `s-${saleSeq}`;
  db.prepare(
    'INSERT INTO cash_sessions (id, register, opened_by, opened_at, opening_float) VALUES (?, ?, ?, ?, 0)',
  ).run(sess, `R${saleSeq}`, sale.userId, sale.at);
  db.prepare(
    `INSERT INTO sales (id, number, cash_session_id, user_id, total, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `V-2026-${String(saleSeq).padStart(6, '0')}`, sess, sale.userId, sale.qty * 100, sale.status ?? 'completed', sale.at);
  db.prepare(
    `INSERT INTO sale_lines (id, sale_id, product_id, lot_id, qty, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, 100, ?)`,
  ).run(`sl-${saleSeq}`, id, sale.productId, sale.lotId, sale.qty, sale.qty * 100);
}

// ---------------------------------------------------------------- Appels HTTP

export const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });

export interface SupplierOut {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lead_days: number;
  active: boolean;
  created_at: string;
}

export interface OrderLineOut {
  id: string;
  product_id: string;
  product_name: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number | null;
}

export interface OrderOut {
  id: string;
  number: string;
  supplier_id: string;
  supplier_name: string;
  status: string;
  created_by: string;
  created_at: string;
  sent_at: string | null;
  closed_at: string | null;
  lines: OrderLineOut[];
}

export async function postSupplier(t: TestApp, a: Agent, body: Record<string, unknown>): Promise<SupplierOut> {
  const r = await t.app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: H(a), payload: body });
  if (r.statusCode !== 201) throw new Error(`supplier: ${r.statusCode} ${r.body}`);
  return r.json() as SupplierOut;
}

export async function postOrder(t: TestApp, a: Agent, body: Record<string, unknown>): Promise<OrderOut> {
  const r = await t.app.inject({ method: 'POST', url: '/api/v1/orders', headers: H(a), payload: body });
  if (r.statusCode !== 201) throw new Error(`order: ${r.statusCode} ${r.body}`);
  return r.json() as OrderOut;
}

export const eventsOf = (db: DB, type: string) =>
  (db.prepare('SELECT payload FROM events WHERE type = ? ORDER BY seq').all(type) as { payload: string }[]).map(
    (e) => JSON.parse(e.payload) as Record<string, unknown>,
  );

/** Independent structural checks for the uncompressed PDF contract; not a rendering engine. */
export function inspectPdf(bytes: Buffer): { text: string; pages: number; widths: number[] } {
  const source = bytes.toString('latin1');
  assert(source.startsWith('%PDF-1.4\n'));
  const start = /startxref\n(\d+)\n%%EOF\n$/.exec(source);
  assert(start);
  const xref = Number(start[1]);
  assert.equal(source.slice(xref, xref + 5), 'xref\n');
  const table = /^xref\n0 (\d+)\n([\s\S]*?)trailer\n/.exec(source.slice(xref));
  assert(table);
  const entries = table[2]!.trimEnd().split('\n');
  assert.equal(entries.length, Number(table[1]));
  for (let id = 1; id < entries.length; id += 1) {
    const entry = /^(\d{10}) 00000 n/.exec(entries[id]!);
    assert(entry);
    assert(source.slice(Number(entry[1])).startsWith(`${id} 0 obj\n`));
  }
  assert.match(source, /\/Root 1 0 R/);
  const streams = [...source.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
  for (const stream of streams) {
    const end = stream.index + stream[0].length + Number(stream[1]);
    assert.equal(source.slice(end, end + 9), 'endstream');
  }
  const texts = [...source.matchAll(/<([a-f\d]*)> Tj/g)].map((match) =>
    new TextDecoder('windows-1252').decode(Buffer.from(match[1]!, 'hex')),
  );
  const widths = [...source.matchAll(/\/MediaBox \[0 0 ([\d.]+) [\d.]+\]/g)].map((m) => Number(m[1]));
  const pages = [...source.matchAll(/\/Type \/Page\b/g)].length;
  assert.equal(streams.length, pages);
  assert.equal(widths.length, pages);
  assert(pages > 0);
  assert.match(source, new RegExp(`/Count ${pages}\\b`));
  return { text: texts.join('\n'), pages, widths };
}
