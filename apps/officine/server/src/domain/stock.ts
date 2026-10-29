import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { activateProduct, getProduct, type ActivationCause } from './catalog.js';
import { decodeCursor, page, pageLimit } from './cursor.js';
import { addDays, doualaDate, isCalendarDate, normalizeIso } from './dates.js';
import type { Json } from './jcs.js';
import type { LedgerEvent } from './ledger.js';

/**
 * S-01 à S-09 : lots, mouvements (ajout seul), FEFO, ajustements, destruction, valorisation, seuils.
 * Le stock n'est jamais stocké : c'est la somme des mouvements. Les mouvements sont « préparés »
 * puis écrits par appendStockEvent, dans la transaction de l'événement qui les porte (J-04).
 */

export const MOVEMENT_KINDS = [
  'reception', 'sale', 'void', 'adjustment', 'inventory', 'destroy', 'return_supplier',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const ADJUST_REASONS = ['casse', 'vol', 'erreur_saisie', 'don', 'autre'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];
/** R-05 : une réception qui périme dans moins de 90 jours demande une confirmation. */
export const NEAR_EXPIRY_RECEPTION_DAYS = 90;
export const MAX_QTY = 1_000_000;
export const MAX_COST = 100_000_000;
export const REGUL_LOT_NUMBER = '__REGUL__';

export interface Movement {
  lot_id: string;
  product_id: string;
  qty: number;
  kind: MovementKind;
  ref_type: string | null;
  ref_id: string | null;
  reason: string | null;
}

export interface StockPolicy {
  /** VP_EXPIRY_BLOCK_DAYS (Q-03) : un lot est invendable s'il périme avant aujourd'hui + N jours. */
  expiryBlockDays: number;
}

export function loadStockPolicy(env: NodeJS.ProcessEnv = process.env): StockPolicy {
  const raw = env.VP_EXPIRY_BLOCK_DAYS;
  if (raw === undefined || raw === '') return { expiryBlockDays: 0 };
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > 365) throw new Error(`VP_EXPIRY_BLOCK_DAYS invalide : ${raw}`);
  return { expiryBlockDays: Number(raw) };
}

/** Première date de péremption encore vendable (Q-03), en date civile de Douala. */
export function sellableFrom(s: Services): string {
  return addDays(doualaDate(s.clock.now()), s.stockPolicy?.expiryBlockDays ?? 0);
}

export function assertQty(qty: unknown, what = 'Quantité'): asserts qty is number {
  if (typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty <= 0 || qty > MAX_QTY) {
    throw new AppError('validation_failed', `${what} invalide`, 'Entier strictement positif attendu.');
  }
}

export function assertCost(cost: unknown): asserts cost is number | null {
  if (cost === null) return;
  if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 0 || cost > MAX_COST) {
    throw new AppError('validation_failed', 'Coût unitaire invalide', 'Entier XAF positif ou nul attendu.');
  }
}

function requireTx(s: Services, fn: string): void {
  if (!s.db.inTransaction) throw new Error(`${fn} doit être appelé dans une transaction`);
}

// ---------------------------------------------------------------- Lots

export interface LotRow {
  id: string;
  product_id: string;
  lot_number: string;
  expiry: string | null;
  unit_cost: number | null;
  is_regul: number;
  created_at: string;
}

export function getLot(s: Services, id: string): LotRow {
  const r = s.db.prepare('SELECT * FROM lots WHERE id = ?').get(id) as LotRow | undefined;
  if (!r) throw new AppError('not_found', 'Lot introuvable');
  return r;
}

export function lotQty(s: Services, lotId: string): number {
  const r = s.db.prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM stock_movements WHERE lot_id = ?').get(lotId) as
    { q: number };
  return r.q;
}

/** Rappel actif qui vise ce lot (rappel du lot ou de tous les lots du produit), ou null. */
export function activeRecall(
  s: Services,
  productId: string,
  lotNumber: string,
): { id: string; reference: string; reason: string } | null {
  return (
    (s.db
      .prepare(
        `SELECT id, reference, reason FROM recalls WHERE active = 1 AND product_id = ?
           AND (lot_number IS NULL OR lot_number = ?) ORDER BY created_at LIMIT 1`,
      )
      .get(productId, lotNumber) as { id: string; reference: string; reason: string } | undefined) ?? null
  );
}

export interface LotEntryInput {
  product_id: string;
  lot_number: string;
  expiry: string | null;
  unit_cost?: number | null;
  qty: number;
  kind: MovementKind;
  ref_type?: string | null;
  ref_id?: string | null;
  reason?: string | null;
  /** R-05 : confirmation explicite d'un lot qui périme dans moins de 90 jours. */
  confirm_near_expiry?: boolean;
}

/** Contrôles de sûreté d'une entrée de lot (R-05, Q-02, Q-03). */
function checkEntrySafety(s: Services, input: LotEntryInput, lotNumber: string): void {
  if (!isCalendarDate(input.expiry)) {
    throw new AppError('validation_failed', 'Péremption invalide', 'Date de péremption AAAA-MM-JJ obligatoire.');
  }
  const recall = activeRecall(s, input.product_id, lotNumber);
  if (recall) {
    throw new AppError('recalled_lot', 'Lot rappelé', `Réception refusée : rappel ${recall.reference} (${recall.reason}).`);
  }
  if (input.expiry < sellableFrom(s)) {
    throw new AppError('expired_lot', 'Lot périmé', `Le lot ${lotNumber} est périmé (${input.expiry}).`);
  }
  const near = addDays(doualaDate(s.clock.now()), NEAR_EXPIRY_RECEPTION_DAYS);
  if (input.expiry < near && input.confirm_near_expiry !== true) {
    throw new AppError('validation_failed', 'Péremption proche', `Le lot ${lotNumber} périme le ${input.expiry} : confirmation requise.`, {
      reason: 'near_expiry_confirmation_required',
    });
  }
}

export function normalizeLotNumber(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v || v.length > 60 || /\p{Cc}/u.test(v) || v.startsWith('__')) {
    throw new AppError('validation_failed', 'Numéro de lot invalide', '1 à 60 caractères imprimables.');
  }
  return v;
}

/**
 * Trouve ou crée le lot (produit, numéro). Un lot existant garde sa péremption et son coût :
 * une valeur différente est refusée (invalid_transition) plutôt que de réécrire l'historique.
 */
export function findOrCreateLot(
  s: Services,
  productId: string,
  lotNumber: string,
  expiry: string | null,
  unitCost: number | null,
): { lot: LotRow; created: boolean } {
  requireTx(s, 'findOrCreateLot');
  const existing = s.db.prepare('SELECT * FROM lots WHERE product_id = ? AND lot_number = ?').get(productId, lotNumber) as
    LotRow | undefined;
  if (existing) {
    if (existing.expiry !== expiry || (existing.unit_cost ?? null) !== unitCost) {
      throw new AppError('invalid_transition', 'Lot déjà connu', `Le lot ${lotNumber} existe avec une autre péremption ou un autre coût.`);
    }
    return { lot: existing, created: false };
  }
  const lot: LotRow = {
    id: randomUUID(), product_id: productId, lot_number: lotNumber, expiry, unit_cost: unitCost,
    is_regul: 0, created_at: iso(s.clock.now()),
  };
  s.db
    .prepare('INSERT INTO lots (id, product_id, lot_number, expiry, unit_cost, is_regul, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(lot.id, productId, lotNumber, expiry, unitCost, lot.created_at);
  return { lot, created: true };
}

/**
 * Entrée de stock sur un lot (réception) : contrôles de sûreté, lot trouvé ou créé, activation C-02.
 * Renvoie le mouvement préparé ; l'appelant l'écrit avec appendStockEvent dans la même transaction.
 */
export function enterLot(
  s: Services,
  actor: string,
  input: LotEntryInput,
  cause: ActivationCause,
): { lot: LotRow; movement: Movement; created: boolean } {
  requireTx(s, 'enterLot');
  assertQty(input.qty);
  const unitCost = input.unit_cost ?? null;
  assertCost(unitCost);
  getProduct(s, input.product_id);
  const lotNumber = normalizeLotNumber(input.lot_number);
  checkEntrySafety(s, input, lotNumber);
  const { lot, created } = findOrCreateLot(s, input.product_id, lotNumber, input.expiry, unitCost);
  activateProduct(s, actor, input.product_id, cause);
  const movement: Movement = {
    lot_id: lot.id, product_id: input.product_id, qty: input.qty, kind: input.kind,
    ref_type: input.ref_type ?? null, ref_id: input.ref_id ?? null, reason: input.reason ?? null,
  };
  return { lot, movement, created };
}

/** V-05 : lot technique « stock à régulariser » du produit (créé à la demande). */
export function regulLot(s: Services, productId: string): LotRow {
  requireTx(s, 'regulLot');
  const existing = s.db.prepare('SELECT * FROM lots WHERE product_id = ? AND is_regul = 1').get(productId) as
    LotRow | undefined;
  if (existing) return existing;
  const lot: LotRow = {
    id: randomUUID(), product_id: productId, lot_number: REGUL_LOT_NUMBER, expiry: null, unit_cost: null,
    is_regul: 1, created_at: iso(s.clock.now()),
  };
  s.db
    .prepare('INSERT INTO lots (id, product_id, lot_number, expiry, unit_cost, is_regul, created_at) VALUES (?, ?, ?, NULL, NULL, 1, ?)')
    .run(lot.id, productId, lot.lot_number, lot.created_at);
  return lot;
}

// ---------------------------------------------------------------- Écriture des mouvements

/**
 * Écrit l'événement et ses mouvements dans la transaction courante (J-01, S-01, S-04).
 * Le contenu porte `movements = [{lot_id, qty, kind}]` (annexe C §2). Aucun lot ordinaire ne
 * passe sous zéro, même si le lot apparaît plusieurs fois dans le lot de mouvements.
 */
export function appendStockEvent(
  s: Services,
  type: string,
  actor: string,
  payload: { [k: string]: Json },
  movements: Movement[],
): LedgerEvent {
  requireTx(s, 'appendStockEvent');
  const net = new Map<string, number>();
  for (const m of movements) {
    if (!Number.isSafeInteger(m.qty) || m.qty === 0) throw new AppError('validation_failed', 'Mouvement nul ou invalide');
    if (!(MOVEMENT_KINDS as readonly string[]).includes(m.kind)) throw new AppError('validation_failed', 'Type de mouvement inconnu');
    net.set(m.lot_id, (net.get(m.lot_id) ?? 0) + m.qty);
  }
  for (const [lotId, delta] of net) {
    const lot = getLot(s, lotId);
    if (!lot.is_regul && delta < 0 && lotQty(s, lotId) + delta < 0) {
      throw new AppError('insufficient_stock', 'Stock insuffisant', `Le lot ${lot.lot_number} ne peut pas passer sous zéro.`, {
        lot_id: lotId,
      });
    }
  }
  const ev = s.ledger.append(type, actor, {
    ...payload,
    movements: movements.map((m) => ({ lot_id: m.lot_id, qty: m.qty, kind: m.kind })),
  });
  const insert = s.db.prepare(
    `INSERT INTO stock_movements (id, product_id, lot_id, qty, kind, ref_type, ref_id, reason, user_id, event_seq, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const m of movements) {
    insert.run(randomUUID(), m.product_id, m.lot_id, m.qty, m.kind, m.ref_type, m.ref_id, m.reason, actor, ev.seq, ev.at);
  }
  return ev;
}

// ---------------------------------------------------------------- FEFO

export interface FefoLine {
  lot_id: string;
  lot_number: string;
  expiry: string;
  qty: number;
}

interface SellableLot {
  lot_id: string;
  lot_number: string;
  expiry: string;
  qty: number;
}

/** Lots vendables d'un produit dans l'ordre FEFO : péremption, puis date d'entrée, puis identifiant. */
export function sellableLots(s: Services, productId: string): SellableLot[] {
  return s.db
    .prepare(
      `SELECT * FROM (
         SELECT l.id AS lot_id, l.lot_number, l.expiry, l.created_at,
                (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m WHERE m.lot_id = l.id) AS qty
         FROM lots l
         WHERE l.product_id = ? AND l.is_regul = 0 AND l.expiry IS NOT NULL AND l.expiry >= ?
           AND NOT EXISTS (SELECT 1 FROM recalls r WHERE r.active = 1 AND r.product_id = l.product_id
                           AND (r.lot_number IS NULL OR r.lot_number = l.lot_number)))
       WHERE qty > 0 ORDER BY expiry, created_at, lot_id`,
    )
    .all(productId, sellableFrom(s)) as SellableLot[];
}

/** S-02, S-03 : plan de prélèvement FEFO, en lecture seule. */
export function quoteFefo(s: Services, productId: string, qty: number): FefoLine[] {
  assertQty(qty);
  const plan: FefoLine[] = [];
  let remaining = qty;
  for (const lot of sellableLots(s, productId)) {
    if (remaining === 0) break;
    const take = Math.min(lot.qty, remaining);
    plan.push({ lot_id: lot.lot_id, lot_number: lot.lot_number, expiry: lot.expiry, qty: take });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new AppError('insufficient_stock', 'Stock insuffisant', `Il manque ${remaining} unité(s) vendable(s).`, {
      product_id: productId,
      missing: remaining,
    });
  }
  return plan;
}

export interface WithdrawInput {
  product_id: string;
  qty: number;
  kind?: MovementKind;
  ref_type?: string | null;
  ref_id?: string | null;
  user_id?: string;
}

/** Prépare les mouvements négatifs FEFO (dans la transaction : le plan est recalculé sous verrou). */
export function withdrawFefo(s: Services, input: WithdrawInput): Movement[] {
  requireTx(s, 'withdrawFefo');
  return quoteFefo(s, input.product_id, input.qty).map((l) => ({
    lot_id: l.lot_id, product_id: input.product_id, qty: -l.qty, kind: input.kind ?? 'sale',
    ref_type: input.ref_type ?? null, ref_id: input.ref_id ?? null, reason: null,
  }));
}

/** Regroupe les lignes d'un panier par produit (S-03), dans l'ordre de première apparition. */
export function aggregateLines(lines: { product_id: string; qty: number }[]): { product_id: string; qty: number }[] {
  const out = new Map<string, number>();
  for (const l of lines) {
    assertQty(l.qty);
    out.set(l.product_id, (out.get(l.product_id) ?? 0) + l.qty);
  }
  return [...out].map(([product_id, qty]) => ({ product_id, qty }));
}

/** Sortie FEFO complète d'un panier : tous les mouvements et un seul événement, ou rien. */
export function executeFefo(
  s: Services,
  actor: string,
  lines: { product_id: string; qty: number }[],
  ref: { id: string; payload: { [k: string]: Json }; type?: string; kind?: MovementKind },
): { movements: Movement[]; event: LedgerEvent } {
  requireTx(s, 'executeFefo');
  const movements = aggregateLines(lines).flatMap((l) =>
    withdrawFefo(s, { ...l, kind: ref.kind ?? 'sale', ref_type: 'sale', ref_id: ref.id }),
  );
  const event = appendStockEvent(s, ref.type ?? 'sale.completed', actor, ref.payload, movements);
  return { movements, event };
}

// ---------------------------------------------------------------- S-05 ajustement, S-07 destruction

export interface AdjustInput {
  lot_id: string;
  qty: number;
  reason: string;
  reason_text?: string | null;
}

function checkAdjust(input: AdjustInput): { reason: AdjustReason; text: string | null } {
  const qty = input.qty;
  if (!Number.isSafeInteger(qty) || qty === 0 || Math.abs(qty) > MAX_QTY) {
    throw new AppError('validation_failed', 'Quantité invalide', 'Entier non nul attendu.');
  }
  if (!(ADJUST_REASONS as readonly string[]).includes(input.reason)) {
    throw new AppError('validation_failed', 'Motif invalide', `Motifs : ${ADJUST_REASONS.join(', ')}.`);
  }
  const text = typeof input.reason_text === 'string' ? input.reason_text.trim() : '';
  if (input.reason === 'autre' && !text) throw new AppError('validation_failed', 'Précisez le motif');
  if (text.length > 500 || /\p{Cc}/u.test(text)) throw new AppError('validation_failed', 'Motif trop long');
  return { reason: input.reason as AdjustReason, text: text || null };
}

/** S-05 : ajustement signé avec motif (droit et ré-authentification contrôlés par la route). */
export function adjustStock(s: Services, actor: string, input: AdjustInput): { lot_id: string; qty: number } {
  const { reason, text } = checkAdjust(input);
  return writeTx(s.db, () => {
    const lot = getLot(s, input.lot_id);
    const movement: Movement = {
      lot_id: lot.id, product_id: lot.product_id, qty: input.qty, kind: 'adjustment',
      ref_type: 'adjustment', ref_id: null, reason: text ? `${reason}: ${text}` : reason,
    };
    appendStockEvent(s, 'stock.adjusted', actor, {
      lot_id: lot.id, product_id: lot.product_id, reason, reason_text: text,
    }, [movement]);
    return { lot_id: lot.id, qty: lotQty(s, lot.id) };
  });
}

export interface DestroyInput {
  lot_id: string;
  qty: number;
  reason: string;
  pv_number: string;
}

/** S-07 : destruction des périmés et des rappelés, avec motif et numéro de procès-verbal. */
export function destroyStock(s: Services, actor: string, input: DestroyInput): { lot_id: string; qty: number } {
  assertQty(input.qty);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const pv = typeof input.pv_number === 'string' ? input.pv_number.trim() : '';
  if (!reason || reason.length > 200) throw new AppError('validation_failed', 'Motif obligatoire');
  if (!pv || pv.length > 60) throw new AppError('validation_failed', 'Numéro de procès-verbal obligatoire');
  return writeTx(s.db, () => {
    const lot = getLot(s, input.lot_id);
    const expired = lot.expiry !== null && lot.expiry < doualaDate(s.clock.now());
    if (!expired && !activeRecall(s, lot.product_id, lot.lot_number)) {
      throw new AppError('invalid_transition', 'Destruction refusée', 'Seuls les lots périmés ou rappelés sont détruits.');
    }
    const movement: Movement = {
      lot_id: lot.id, product_id: lot.product_id, qty: -input.qty, kind: 'destroy',
      ref_type: 'destruction', ref_id: pv, reason,
    };
    appendStockEvent(s, 'stock.destroyed', actor, { lot_id: lot.id, product_id: lot.product_id, reason, pv_number: pv }, [movement]);
    return { lot_id: lot.id, qty: lotQty(s, lot.id) };
  });
}

// ---------------------------------------------------------------- S-08 valorisation, S-09 seuils

export interface StockValue {
  product_id: string | null;
  qty: number;
  known_value_xaf: number;
  /** null dès qu'une quantité en stock a un coût inconnu : jamais de zéro silencieux. */
  total_value_xaf: number | null;
  unknown_cost_qty: number;
}

/** S-08 : valeur au coût d'achat de chaque lot (quantités positives des lots ordinaires). */
export function stockValue(s: Services, productId?: string): StockValue {
  const r = s.db
    .prepare(
      `SELECT COALESCE(SUM(q), 0) AS qty,
              COALESCE(SUM(CASE WHEN unit_cost IS NOT NULL THEN q * unit_cost END), 0) AS known,
              COALESCE(SUM(CASE WHEN unit_cost IS NULL THEN q END), 0) AS unknown
       FROM (SELECT l.unit_cost, (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m WHERE m.lot_id = l.id) AS q
             FROM lots l WHERE l.is_regul = 0 AND (? IS NULL OR l.product_id = ?))
       WHERE q > 0`,
    )
    .get(productId ?? null, productId ?? null) as { qty: number; known: number; unknown: number };
  return {
    product_id: productId ?? null,
    qty: r.qty,
    known_value_xaf: r.known,
    total_value_xaf: r.unknown > 0 ? null : r.known,
    unknown_cost_qty: r.unknown,
  };
}

export interface Thresholds {
  product_id: string;
  min_qty: number;
  max_qty: number;
}

/** S-09 : seuils min et max (utilisés par R-02) ; un événement par changement effectif. */
export function changeThresholds(
  s: Services,
  actor: string,
  productId: string,
  input: { min_qty: number; max_qty: number },
): Thresholds {
  const { min_qty, max_qty } = input;
  for (const v of [min_qty, max_qty]) {
    if (!Number.isSafeInteger(v) || v < 0 || v > MAX_QTY) throw new AppError('validation_failed', 'Seuil invalide');
  }
  if (min_qty > max_qty) throw new AppError('validation_failed', 'Le minimum dépasse le maximum');
  return writeTx(s.db, () => {
    const p = s.db.prepare('SELECT min_qty, max_qty FROM products WHERE id = ?').get(productId) as
      { min_qty: number; max_qty: number } | undefined;
    if (!p) throw new AppError('not_found', 'Fiche introuvable');
    if (p.min_qty !== min_qty || p.max_qty !== max_qty) {
      s.db
        .prepare('UPDATE products SET min_qty = ?, max_qty = ?, updated_at = ? WHERE id = ?')
        .run(min_qty, max_qty, iso(s.clock.now()), productId);
      s.ledger.append('catalog.thresholds_changed', actor, { product_id: productId, min: min_qty, max: max_qty });
    }
    return { product_id: productId, min_qty, max_qty };
  });
}

// ---------------------------------------------------------------- Lectures paginées

export interface LotListItem {
  lot_id: string;
  product_id: string;
  product_name: string;
  lot_number: string;
  expiry: string | null;
  qty: number;
  is_regul: boolean;
  recalled: boolean;
  expired: boolean;
  created_at: string;
  unit_cost?: number | null;
}

export interface LotListOptions {
  product_id?: string;
  in_stock?: boolean;
  limit?: number;
  cursor?: string;
}

/** Lots et quantités (S-01) ; `unit_cost` seulement avec le droit `cost.view` (V-10). */
export function listLots(s: Services, opts: LotListOptions = {}, withCost = false) {
  const limit = pageLimit(opts.limit);
  const c = decodeCursor(opts.cursor, 2);
  const rows = s.db
    .prepare(
      `SELECT * FROM (
         SELECT l.id AS lot_id, l.product_id, p.name AS product_name, l.lot_number, l.expiry, l.unit_cost,
                l.is_regul, l.created_at, COALESCE(l.expiry, '9999-12-31') AS sort_key,
                (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m WHERE m.lot_id = l.id) AS qty,
                EXISTS (SELECT 1 FROM recalls r WHERE r.active = 1 AND r.product_id = l.product_id
                        AND (r.lot_number IS NULL OR r.lot_number = l.lot_number)) AS recalled
         FROM lots l JOIN products p ON p.id = l.product_id
         WHERE (@product IS NULL OR l.product_id = @product))
       WHERE (@in_stock = 0 OR qty <> 0)
         AND (@k IS NULL OR (sort_key, lot_id) > (@k, @id))
       ORDER BY sort_key, lot_id LIMIT @limit`,
    )
    .all({
      product: opts.product_id ?? null, in_stock: opts.in_stock ? 1 : 0,
      k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1,
    }) as (Omit<LotListItem, 'is_regul' | 'recalled' | 'expired'> & { is_regul: number; recalled: number; sort_key: string; unit_cost: number | null })[];
  const today = doualaDate(s.clock.now());
  const p = page(rows, limit, (r) => [r.sort_key, r.lot_id]);
  return {
    next_cursor: p.next_cursor,
    items: p.items.map(({ sort_key: _k, unit_cost, ...r }) => ({
      ...r,
      is_regul: r.is_regul === 1,
      recalled: r.recalled === 1,
      expired: r.expiry !== null && r.expiry < today,
      ...(withCost ? { unit_cost } : {}),
    })) as LotListItem[],
  };
}

export interface MovementListOptions {
  product_id?: string;
  lot_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface MovementItem {
  id: string;
  product_id: string;
  product_name: string;
  lot_id: string;
  lot_number: string;
  qty: number;
  kind: MovementKind;
  ref_type: string | null;
  ref_id: string | null;
  reason: string | null;
  user_id: string;
  event_seq: number;
  at: string;
}

/** Mouvements, du plus récent au plus ancien, filtrables par produit, lot et période. */
export function listMovements(s: Services, opts: MovementListOptions = {}) {
  const limit = pageLimit(opts.limit);
  const c = decodeCursor(opts.cursor, 2);
  const from = opts.from === undefined ? null : normalizeIso(opts.from);
  const to = opts.to === undefined ? null : normalizeIso(opts.to);
  if ((opts.from !== undefined && !from) || (opts.to !== undefined && !to)) {
    throw new AppError('validation_failed', 'Période invalide');
  }
  if (from && to && from > to) throw new AppError('validation_failed', 'Période inversée');
  const rows = s.db
    .prepare(
      `SELECT m.id, m.product_id, p.name AS product_name, m.lot_id, l.lot_number, m.qty, m.kind, m.ref_type,
              m.ref_id, m.reason, m.user_id, m.event_seq, m.at
       FROM stock_movements m JOIN lots l ON l.id = m.lot_id JOIN products p ON p.id = m.product_id
       WHERE (@product IS NULL OR m.product_id = @product) AND (@lot IS NULL OR m.lot_id = @lot)
         AND (@from IS NULL OR m.at >= @from) AND (@to IS NULL OR m.at <= @to)
         AND (@k IS NULL OR (m.at, m.id) < (@k, @id))
       ORDER BY m.at DESC, m.id DESC LIMIT @limit`,
    )
    .all({
      product: opts.product_id ?? null, lot: opts.lot_id ?? null, from, to,
      k: c?.[0] ?? null, id: c?.[1] ?? null, limit: limit + 1,
    }) as MovementItem[];
  return page(rows, limit, (r) => [r.at, r.id]);
}
