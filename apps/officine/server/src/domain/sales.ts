import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { grant } from '../security/rbac.js';
import type { Services } from '../services.js';
import { assertAmount, requireSellableSession } from './cash.js';
import { activateProduct, getProduct } from './catalog.js';
import { decodeCursor, page, pageLimit } from './cursor.js';
import { addDays, doualaDate, normalizeIso } from './dates.js';
import type { Json } from './jcs.js';
import { getPrescription } from './prescriptions.js';
import type { Product } from './search.js';
import { getSetting, regulSalesAllowed } from './settings.js';
import {
  activeRecall, appendStockEvent, assertQty, getLot, lotQty, quoteFefo, regulLot, sellableFrom, type Movement,
} from './stock.js';
import { getUser } from './users.js';

/**
 * V-02 à V-07, V-09, O-01, O-02, O-06, Q-02 à Q-04 : panier, contrôle et vente atomique.
 * `quoteSale` ne fait que lire ; `createSale` écrit tout (vente, lignes, paiements, mouvements,
 * événement) dans une seule transaction BEGIN IMMEDIATE, ou rien (V-04).
 */

export const PAYMENT_METHODS = ['especes', 'mobile_money', 'carte', 'credit', 'tiers_payant'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Q-04 : avertissement non bloquant pour un lot qui périme dans moins de 30 jours. */
export const NEAR_EXPIRY_SALE_DAYS = 30;
export const MAX_SALE_LINES = 200;

export interface SaleLineInput {
  product_id: string;
  qty: number;
  /** Lot scanné (GS1) : la vente prend ce lot précis ; sinon FEFO. */
  lot_id?: string | null;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  payer?: string | null;
}

export interface Alert {
  level: 'block' | 'warn';
  code: string;
  message: string;
}

export interface Allocation {
  lot_id: string;
  lot_number: string;
  expiry: string | null;
  qty: number;
  regul: boolean;
}

export interface PlannedLine {
  product_id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  line_total: number;
  rx_required: boolean;
  sensitive: boolean;
  allocations: Allocation[];
  alerts: Alert[];
}

/** O-01, O-06 : ordonnance requise selon la politique ; toujours pour un produit sensible. */
export function rxRequirement(s: Services, p: Product): { required: boolean; sensitive: boolean } {
  const policy = getSetting(s, 'rx_policy');
  const byPolicy = policy === 'all_medicines' ? p.category === 'medicament' : p.rx_required;
  return { required: p.sensitive || byPolicy, sensitive: p.sensitive };
}

const block = (code: string, message: string): Alert => ({ level: 'block', code, message });

/** Lot précis (scan GS1) : jamais rappelé (Q-02), jamais périmé (Q-03), jamais sous zéro (S-04). */
function allocateLot(s: Services, productId: string, lotId: string, qty: number): Allocation[] | Alert {
  const lot = getLot(s, lotId);
  if (lot.product_id !== productId || lot.is_regul) return block('validation_failed', 'Lot sans rapport avec ce produit.');
  const recall = activeRecall(s, productId, lot.lot_number);
  if (recall) return block('recalled_lot', `Lot ${lot.lot_number} rappelé (${recall.reference}) : ${recall.reason}`);
  if (!lot.expiry || lot.expiry < sellableFrom(s)) return block('expired_lot', `Lot ${lot.lot_number} périmé (${lot.expiry ?? 'date inconnue'}).`);
  if (lotQty(s, lot.id) < qty) return block('insufficient_stock', `Stock insuffisant sur le lot ${lot.lot_number}.`);
  return [{ lot_id: lot.id, lot_number: lot.lot_number, expiry: lot.expiry, qty, regul: false }];
}

/** FEFO (S-02, S-03), puis lot de régularisation pour le reste si V-05 est actif. */
function allocateFefo(s: Services, productId: string, qty: number, regulAllowed: boolean): Allocation[] | Alert {
  try {
    return quoteFefo(s, productId, qty).map((l) => ({ ...l, regul: false }));
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'insufficient_stock') throw e;
    const missing = Number(e.extra?.missing ?? qty);
    if (!regulAllowed) return block('insufficient_stock', `Stock vendable insuffisant : il manque ${missing} unité(s).`);
    const taken = qty - missing > 0 ? quoteFefo(s, productId, qty - missing).map((l) => ({ ...l, regul: false })) : [];
    return [...taken, { lot_id: '', lot_number: 'Régularisation', expiry: null, qty: missing, regul: true }];
  }
}

function planLine(s: Services, line: SaleLineInput, regulAllowed: boolean): PlannedLine {
  assertQty(line.qty);
  const p = getProduct(s, line.product_id);
  const rx = rxRequirement(s, p);
  const unitPrice = p.sale_price ?? p.suggested_price;
  const alloc = line.lot_id ? allocateLot(s, p.id, line.lot_id, line.qty) : allocateFefo(s, p.id, line.qty, regulAllowed);
  const alerts: Alert[] = [];
  if (!Array.isArray(alloc)) alerts.push(alloc);
  if (unitPrice === null) alerts.push(block('price_missing', 'Prix de vente non renseigné.'));
  const allocations = Array.isArray(alloc) ? alloc : [];
  const soon = addDays(doualaDate(s.clock.now()), NEAR_EXPIRY_SALE_DAYS);
  for (const a of allocations) {
    if (a.regul) alerts.push({ level: 'warn', code: 'regul', message: `${a.qty} unité(s) vendue(s) en régularisation.` });
    else if (a.expiry && a.expiry < soon) alerts.push({ level: 'warn', code: 'near_expiry', message: `Lot ${a.lot_number} périme le ${a.expiry}.` });
  }
  return {
    product_id: p.id, name: p.name, qty: line.qty, unit_price: unitPrice,
    line_total: (unitPrice ?? 0) * line.qty, rx_required: rx.required, sensitive: rx.sensitive, allocations, alerts,
  };
}

/** Regroupe les lignes identiques (même produit, même lot choisi). */
function mergeLines(lines: SaleLineInput[]): SaleLineInput[] {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_SALE_LINES) {
    throw new AppError('validation_failed', 'Panier vide ou trop long');
  }
  const out = new Map<string, SaleLineInput>();
  for (const l of lines) {
    assertQty(l.qty);
    const key = `${l.product_id}|${l.lot_id ?? ''}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, qty: prev.qty + l.qty } : { ...l });
  }
  return [...out.values()];
}

export interface Quote {
  lines: PlannedLine[];
  gross: number;
  discount: number;
  total: number;
  rx_required: boolean;
  sensitive: boolean;
  regul_allowed: boolean;
  prescription: { ok: boolean; message: string | null };
  blocking: boolean;
}

/** Contrôle d'une ordonnance pour un panier (O-02, O-05, O-06) ; null si elle convient. */
function prescriptionProblem(s: Services, id: string | null | undefined, rx: boolean, sensitive: boolean): Alert | null {
  if (!rx) return null;
  if (!id) return block('rx_required', 'Ordonnance validée par un pharmacien requise.');
  const p = getPrescription(s, id);
  if (p.sale_id) return block('rx_required', 'Cette ordonnance est déjà liée à une autre vente.');
  if (sensitive && !p.prescriber_reg) return block('rx_required', "Produit sensible : numéro d'inscription du prescripteur requis.");
  const max = getSetting(s, 'prescription_max_age_days');
  if (p.age_days > max && !p.age_override_reason) return block('stale_prescription', `Ordonnance de ${p.age_days} jours.`);
  return null;
}

/** POST /sales/quote : vérifie le panier sans rien écrire. */
export function quoteSale(
  s: Services,
  input: { lines: SaleLineInput[]; prescription_id?: string | null; discount_amount?: number },
): Quote {
  const regul = regulSalesAllowed(s).allowed;
  const lines = mergeLines(input.lines).map((l) => planLine(s, l, regul));
  const gross = lines.reduce((n, l) => n + l.line_total, 0);
  const discount = input.discount_amount ?? 0;
  const rx = lines.some((l) => l.rx_required);
  const sensitive = lines.some((l) => l.sensitive);
  const rxProblem = prescriptionProblem(s, input.prescription_id, rx, sensitive);
  return {
    lines, gross, discount, total: Math.max(0, gross - discount), rx_required: rx, sensitive, regul_allowed: regul,
    prescription: { ok: rxProblem === null, message: rxProblem?.message ?? null },
    blocking: rxProblem !== null || lines.some((l) => l.alerts.some((a) => a.level === 'block')),
  };
}

// ---------------------------------------------------------------- Vente atomique

export interface SaleInput {
  cash_session_id: string;
  lines: SaleLineInput[];
  payments: PaymentInput[];
  prescription_id?: string | null;
  discount?: { amount: number; reason: string } | null;
  /** Espèces remises par le client (V-03 : rendu de monnaie). */
  cash_tendered?: number | null;
}

function cleanRef(v: unknown, max = 80): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max || /\p{Cc}/u.test(v)) throw new AppError('validation_failed', 'Référence invalide');
  return v.trim() || null;
}

/** V-03 : méthodes et champs obligatoires ; somme = total ; rendu calculé pour les espèces. */
export function checkPayments(payments: PaymentInput[], total: number, tendered?: number | null) {
  if (!Array.isArray(payments) || payments.length === 0 || payments.length > 10) {
    throw new AppError('validation_failed', 'Paiement obligatoire');
  }
  const clean = payments.map((p) => {
    if (!(PAYMENT_METHODS as readonly string[]).includes(p.method)) throw new AppError('validation_failed', 'Méthode inconnue');
    assertAmount(p.amount, 'Montant');
    if (p.amount === 0) throw new AppError('validation_failed', 'Montant nul');
    const reference = cleanRef(p.reference);
    const payer = cleanRef(p.payer, 120);
    if ((p.method === 'mobile_money' || p.method === 'carte' || p.method === 'tiers_payant') && !reference) {
      throw new AppError('validation_failed', 'Référence de paiement obligatoire', `Référence obligatoire pour le paiement ${p.method}.`);
    }
    if ((p.method === 'credit' || p.method === 'tiers_payant') && !payer) {
      throw new AppError('validation_failed', p.method === 'credit' ? 'Nom du client obligatoire' : 'Organisme obligatoire');
    }
    return { method: p.method, amount: p.amount, reference, payer };
  });
  const sum = clean.reduce((n, p) => n + p.amount, 0);
  if (sum !== total) {
    throw new AppError('payment_mismatch', 'Paiements différents du total', `Payé ${sum} XAF pour ${total} XAF.`, { paid: sum, total });
  }
  const cash = clean.filter((p) => p.method === 'especes');
  if (cash.length > 1) throw new AppError('validation_failed', 'Un seul paiement en espèces');
  const cashAmount = cash[0]?.amount ?? 0;
  if (tendered !== undefined && tendered !== null) {
    assertAmount(tendered, 'Espèces remises');
    if (cash.length === 0 || tendered < cashAmount) throw new AppError('validation_failed', 'Espèces remises insuffisantes');
  }
  const change = tendered !== undefined && tendered !== null ? tendered - cashAmount : 0;
  return { payments: clean, tendered: tendered ?? null, change };
}

/** V-09 : remise explicite, pharmacien ou titulaire, plafonnée en pourcentage du panier. */
function checkDiscount(s: Services, actor: string, gross: number, d: SaleInput['discount']): { amount: number; reason: string | null } {
  if (!d || d.amount === 0) return { amount: 0, reason: null };
  assertAmount(d.amount, 'Remise');
  if (grant(getUser(s, actor).role, 'sale.discount') === '-') throw new AppError('forbidden', 'Remise réservée au pharmacien');
  const reason = cleanRef(d.reason, 200);
  if (!reason) throw new AppError('validation_failed', 'Motif de remise obligatoire');
  const cap = Math.floor((gross * getSetting(s, 'discount_max_pct')) / 100);
  if (d.amount > cap) throw new AppError('validation_failed', 'Remise au-delà du plafond', `Plafond : ${cap} XAF.`, { reason: 'discount_cap', cap });
  return { amount: d.amount, reason };
}

function nextSaleNumber(s: Services): string {
  const year = doualaDate(s.clock.now()).slice(0, 4);
  const row = s.db
    .prepare(`INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`)
    .get(`sale:${year}`) as { value: number };
  return `V-${year}-${String(row.value).padStart(6, '0')}`;
}

/** Plan exécutable : lignes sans alerte bloquante, mouvements préparés (lot de régularisation créé au besoin). */
function executablePlan(s: Services, lines: PlannedLine[], saleId: string): { movements: Movement[]; hasRegul: boolean } {
  const movements: Movement[] = [];
  let hasRegul = false;
  for (const l of lines) {
    const blocking = l.alerts.find((a) => a.level === 'block');
    if (blocking) throw new AppError(blocking.code as AppError['code'], 'Vente refusée', blocking.message, { product_id: l.product_id });
    for (const a of l.allocations) {
      if (a.regul) {
        a.lot_id = regulLot(s, l.product_id).id;
        hasRegul = true;
      }
      movements.push({ lot_id: a.lot_id, product_id: l.product_id, qty: -a.qty, kind: 'sale', ref_type: 'sale', ref_id: saleId, reason: null });
    }
  }
  return { movements, hasRegul };
}

function insertSaleRows(
  s: Services,
  sale: { id: string; number: string; session: string; actor: string; total: number; hasRegul: boolean; at: string },
  input: SaleInput,
  discount: { amount: number; reason: string | null },
  pay: ReturnType<typeof checkPayments>,
  lines: PlannedLine[],
): void {
  s.db
    .prepare(
      `INSERT INTO sales (id, number, cash_session_id, user_id, prescription_id, total, status, has_regul, discount_total,
         discount_by, discount_reason, created_at, cash_tendered, change_given)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sale.id, sale.number, sale.session, sale.actor, input.prescription_id ?? null, sale.total, sale.hasRegul ? 1 : 0,
      discount.amount, discount.amount ? sale.actor : null, discount.reason, sale.at, pay.tendered, pay.change);
  const insLine = s.db.prepare(
    'INSERT INTO sale_lines (id, sale_id, product_id, lot_id, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const l of lines) {
    for (const a of l.allocations) insLine.run(randomUUID(), sale.id, l.product_id, a.lot_id, a.qty, l.unit_price, a.qty * (l.unit_price ?? 0));
  }
  const insPay = s.db.prepare('INSERT INTO payments (id, sale_id, method, amount, reference, payer) VALUES (?, ?, ?, ?, ?, ?)');
  for (const p of pay.payments) insPay.run(randomUUID(), sale.id, p.method, p.amount, p.reference, p.payer);
}

function salePayload(sale: { id: string; number: string; session: string; total: number; hasRegul: boolean }, input: SaleInput,
  discount: { amount: number; reason: string | null }, pay: ReturnType<typeof checkPayments>, lines: PlannedLine[]): { [k: string]: Json } {
  return {
    sale_id: sale.id, number: sale.number, cash_session_id: sale.session, total: sale.total,
    lines: lines.flatMap((l) => l.allocations.map((a) => ({ product_id: l.product_id, lot_id: a.lot_id, qty: a.qty, unit_price: l.unit_price ?? 0 }))),
    discount: discount.amount, discount_reason: discount.reason,
    payments: pay.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference, payer: p.payer })),
    change: pay.change, prescription_id: input.prescription_id ?? null, has_regul: sale.hasRegul,
  };
}

/** Activité du produit (C-05) ; activation C-02 pour une vente en régularisation d'une fiche dormante. */
function touchProducts(s: Services, actor: string, lines: PlannedLine[]): void {
  const at = iso(s.clock.now());
  for (const l of lines) {
    if (l.allocations.some((a) => a.regul)) activateProduct(s, actor, l.product_id, 'regul_sale');
    else s.db.prepare('UPDATE products SET last_activity_at = ? WHERE id = ?').run(at, l.product_id);
  }
}

/** V-04 : vente atomique. */
export function createSale(s: Services, actor: string, input: SaleInput): Sale {
  return writeTx(s.db, () => {
    const session = requireSellableSession(s, input.cash_session_id);
    const quote = quoteSale(s, { lines: input.lines, prescription_id: input.prescription_id, discount_amount: 0 });
    const rxProblem = prescriptionProblem(s, input.prescription_id, quote.rx_required, quote.sensitive);
    if (rxProblem) throw new AppError(rxProblem.code as AppError['code'], 'Ordonnance requise', rxProblem.message);
    const discount = checkDiscount(s, actor, quote.gross, input.discount);
    const total = quote.gross - discount.amount;
    const pay = checkPayments(input.payments, total, input.cash_tendered);
    const id = randomUUID();
    const { movements, hasRegul } = executablePlan(s, quote.lines, id);
    const sale = { id, number: nextSaleNumber(s), session: session.id, actor, total, hasRegul, at: iso(s.clock.now()) };
    insertSaleRows(s, sale, input, discount, pay, quote.lines);
    touchProducts(s, actor, quote.lines);
    const ev = appendStockEvent(s, 'sale.completed', actor, salePayload(sale, input, discount, pay, quote.lines), movements);
    s.db.prepare('UPDATE sales SET event_seq = ? WHERE id = ?').run(ev.seq, id);
    return getSale(s, id);
  });
}

// ---------------------------------------------------------------- Lecture, annulation

export interface Sale {
  id: string;
  number: string;
  cash_session_id: string;
  register: string;
  user_id: string;
  user_name: string;
  prescription_id: string | null;
  gross: number;
  discount_total: number;
  discount_reason: string | null;
  total: number;
  status: 'completed' | 'voided';
  has_regul: boolean;
  cash_tendered: number | null;
  change_given: number;
  created_at: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  short_hash: string | null;
  lines: { product_id: string; name: string; lot_id: string; lot_number: string; expiry: string | null; qty: number; unit_price: number; line_total: number; regul: boolean }[];
  payments: { method: PaymentMethod; amount: number; reference: string | null; payer: string | null }[];
}

const SALE_SQL = `SELECT sa.id, sa.number, sa.cash_session_id, c.register, sa.user_id, u.display_name AS user_name,
  sa.prescription_id, sa.total + sa.discount_total AS gross, sa.discount_total, sa.discount_reason, sa.total, sa.status,
  sa.has_regul, sa.cash_tendered, sa.change_given, sa.created_at, sa.voided_by, sa.voided_at, sa.void_reason,
  substr(e.hash, 1, 8) AS short_hash
  FROM sales sa JOIN cash_sessions c ON c.id = sa.cash_session_id JOIN users u ON u.id = sa.user_id
  LEFT JOIN events e ON e.seq = sa.event_seq`;

export function getSale(s: Services, id: string): Sale {
  const r = s.db.prepare(`${SALE_SQL} WHERE sa.id = ?`).get(id) as (Omit<Sale, 'has_regul' | 'lines' | 'payments'> & { has_regul: number }) | undefined;
  if (!r) throw new AppError('not_found', 'Vente introuvable');
  const lines = s.db
    .prepare(
      `SELECT sl.product_id, p.name, sl.lot_id, l.lot_number, l.expiry, sl.qty, sl.unit_price, sl.line_total, l.is_regul AS regul
       FROM sale_lines sl JOIN products p ON p.id = sl.product_id JOIN lots l ON l.id = sl.lot_id WHERE sl.sale_id = ? ORDER BY sl.rowid`,
    )
    .all(id) as (Omit<Sale['lines'][number], 'regul'> & { regul: number })[];
  const payments = s.db.prepare('SELECT method, amount, reference, payer FROM payments WHERE sale_id = ? ORDER BY rowid').all(id) as Sale['payments'];
  return { ...r, has_regul: r.has_regul === 1, lines: lines.map((l) => ({ ...l, regul: l.regul === 1 })), payments };
}

/** V-07 : annulation le jour même (Douala), avec motif ; mouvements `void` sur les mêmes lots. */
export function voidSale(s: Services, actor: string, id: string, reason: string): Sale {
  const why = cleanRef(reason, 300);
  if (!why) throw new AppError('validation_failed', "Motif d'annulation obligatoire");
  return writeTx(s.db, () => {
    const sale = getSale(s, id);
    if (sale.status !== 'completed') throw new AppError('invalid_transition', 'Vente déjà annulée');
    if (doualaDate(new Date(sale.created_at)) !== doualaDate(s.clock.now())) {
      throw new AppError('invalid_transition', 'Annulation impossible', 'Seules les ventes du jour peuvent être annulées.');
    }
    const movements: Movement[] = sale.lines.map((l) => ({
      lot_id: l.lot_id, product_id: l.product_id, qty: l.qty, kind: 'void', ref_type: 'sale', ref_id: id, reason: why,
    }));
    s.db
      .prepare("UPDATE sales SET status = 'voided', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?")
      .run(actor, iso(s.clock.now()), why, id);
    appendStockEvent(s, 'sale.voided', actor, { sale_id: id, number: sale.number, reason: why }, movements);
    return getSale(s, id);
  });
}

export interface SaleListOptions {
  from?: string;
  to?: string;
  user_id?: string;
  cash_session_id?: string;
  limit?: number;
  cursor?: string;
}

export function listSales(s: Services, opts: SaleListOptions = {}) {
  const limit = pageLimit(opts.limit);
  const c = decodeCursor(opts.cursor, 2);
  const from = opts.from === undefined ? null : normalizeIso(opts.from);
  const to = opts.to === undefined ? null : normalizeIso(opts.to);
  if ((opts.from !== undefined && !from) || (opts.to !== undefined && !to)) throw new AppError('validation_failed', 'Période invalide');
  const rows = s.db
    .prepare(
      `${SALE_SQL} WHERE (@from IS NULL OR sa.created_at >= @from) AND (@to IS NULL OR sa.created_at <= @to)
         AND (@user IS NULL OR sa.user_id = @user) AND (@session IS NULL OR sa.cash_session_id = @session)
         AND (@k IS NULL OR (sa.created_at, sa.id) < (@k, @id))
       ORDER BY sa.created_at DESC, sa.id DESC LIMIT @limit`,
    )
    .all({
      from, to, user: opts.user_id ?? null, session: opts.cash_session_id ?? null,
      k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1,
    }) as (Omit<Sale, 'has_regul' | 'lines' | 'payments'> & { has_regul: number })[];
  const p = page(rows, limit, (r) => [r.created_at, r.id]);
  return { items: p.items.map((r) => ({ ...r, has_regul: r.has_regul === 1 })), next_cursor: p.next_cursor };
}
