import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { decodeGs1, parseBarcode, type Gs1Data, type ParsedBarcode } from './gs1.js';
import { buildSearchText, getProductRow, toProduct, type Product } from './search.js';

/**
 * C-02, C-03, C-05, C-06 : cycle de vie de la fiche (dormant → active → sleeping),
 * association de codes-barres, fiche locale, prix de vente.
 * Toute écriture passe par writeTx et le journal est écrit dans la même transaction.
 */

export interface ProductDetail extends Product {
  barcodes: { code: string; kind: string }[];
  lots: { id: string; lot_number: string; expiry: string | null; qty: number; unit_cost: number | null }[];
}

export interface BarcodeLookup {
  found: boolean;
  code: string;
  gs1: Gs1Data | null;
  product: Product | null;
}

export const ACTIVATION_CAUSES = ['reception', 'inventory', 'order', 'regul_sale'] as const;
export type ActivationCause = (typeof ACTIVATION_CAUSES)[number];

export const CATEGORIES = ['medicament', 'dispositif', 'parapharmacie', 'autre'] as const;

export function getProduct(s: Services, id: string): Product {
  return toProduct(getProductRow(s, id));
}

/** Fiche complète : codes-barres et stock par lot (coûts masqués sans le droit `cost.view`). */
export function productDetail(s: Services, id: string, withCost: boolean): ProductDetail {
  const barcodes = s.db
    .prepare('SELECT code, kind FROM barcodes WHERE product_id = ? ORDER BY code')
    .all(id) as { code: string; kind: string }[];
  const lots = s.db
    .prepare(
      `SELECT lot_id, lot_number, expiry, qty, unit_cost FROM lot_stock WHERE product_id = ?
       ORDER BY expiry IS NULL, expiry, lot_number`,
    )
    .all(id) as {
    lot_id: string;
    lot_number: string;
    expiry: string | null;
    qty: number;
    unit_cost: number | null;
  }[];
  return {
    ...getProduct(s, id),
    barcodes,
    lots: lots.map((l) => ({
      id: l.lot_id,
      lot_number: l.lot_number,
      expiry: l.expiry,
      qty: l.qty,
      unit_cost: withCost ? l.unit_cost : null,
    })),
  };
}

/** C-03 : un scan inconnu renvoie `found=false` et, si c'est une chaîne GS1, son décodage. */
export function lookupBarcode(s: Services, raw: string): BarcodeLookup {
  const parsed = parseBarcode(raw);
  const owner = s.db.prepare('SELECT product_id FROM barcodes WHERE code = ?').get(parsed.code) as
    { product_id: string } | undefined;
  return {
    found: owner !== undefined,
    code: parsed.code,
    gs1: gs1Of(raw, parsed),
    product: owner ? getProduct(s, owner.product_id) : null,
  };
}

function gs1Of(raw: string, parsed: ParsedBarcode): Gs1Data | null {
  if (parsed.kind !== 'gtin') return null;
  const body = raw.trim();
  if (/^\d+$/.test(body)) return { gtin: parsed.code, lot: null, expiry: null, serial: null };
  return decodeGs1(body);
}

/** C-03 : association d'un code (GTIN nu ou chaîne GS1) à une fiche existante. */
export function linkBarcode(
  s: Services,
  actor: string,
  productId: string,
  raw: string,
): { created: boolean; product: Product } {
  const parsed = parseBarcode(raw);
  return writeTx(s.db, () => {
    getProduct(s, productId);
    const owner = s.db.prepare('SELECT product_id FROM barcodes WHERE code = ?').get(parsed.code) as
      { product_id: string } | undefined;
    if (owner) {
      if (owner.product_id !== productId) {
        throw new AppError('barcode_taken', 'Code déjà associé', 'Ce code-barres appartient à une autre fiche.', {
          product_id: owner.product_id,
        });
      }
      return { created: false, product: getProduct(s, productId) };
    }
    s.db
      .prepare('INSERT INTO barcodes (code, product_id, kind) VALUES (?, ?, ?)')
      .run(parsed.code, productId, parsed.kind);
    s.ledger.append('catalog.barcode_linked', actor, {
      product_id: productId,
      code: parsed.code,
      kind: parsed.kind,
    });
    return { created: true, product: getProduct(s, productId) };
  });
}

export interface LocalItemInput {
  name: string;
  category: string;
  barcode?: string | null;
  dci?: string | null;
  strength?: string | null;
  form?: string | null;
  presentation?: string | null;
  suggested_price?: number | null;
}

/** C-03 : fiche locale (`local_only=1`), active d'emblée : elle naît d'un besoin constaté au comptoir. */
export function createLocalItem(s: Services, actor: string, input: LocalItemInput): Product {
  const name = input.name.trim();
  if (!name || name.length > 200) {
    throw new AppError('validation_failed', 'Nom invalide', 'Le nom doit contenir 1 à 200 caractères.');
  }
  if (!(CATEGORIES as readonly string[]).includes(input.category)) {
    throw new AppError('validation_failed', 'Catégorie invalide', `Catégorie attendue : ${CATEGORIES.join(', ')}.`);
  }
  const parsed = input.barcode ? parseBarcode(input.barcode) : null;
  return writeTx(s.db, () => {
    if (parsed) {
      const owner = s.db.prepare('SELECT product_id FROM barcodes WHERE code = ?').get(parsed.code);
      if (owner) {
        throw new AppError('barcode_taken', 'Code déjà associé', 'Ce code-barres appartient déjà à une fiche.');
      }
    }
    const id = randomUUID();
    const now = iso(s.clock.now());
    insertLocalRow(s, id, name, input, now);
    if (parsed) {
      s.db
        .prepare('INSERT INTO barcodes (code, product_id, kind) VALUES (?, ?, ?)')
        .run(parsed.code, id, parsed.kind);
    }
    s.ledger.append('catalog.local_item_created', actor, {
      product_id: id,
      name,
      category: input.category,
      barcode: parsed?.code ?? null,
      local_only: true,
    });
    return getProduct(s, id);
  });
}

const INSERT_LOCAL = `INSERT INTO products (id, ref_code, name, dci, strength, form, presentation,
  category, rx_required, sensitive, criticity, storage, suggested_price, status, activated_at,
  last_activity_at, local_only, search_text, created_at, updated_at)
  VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 3, NULL, ?, 'active', ?, ?, 1, ?, ?, ?)`;

function insertLocalRow(s: Services, id: string, name: string, input: LocalItemInput, now: string): void {
  s.db.prepare(INSERT_LOCAL).run(
    id,
    name,
    input.dci ?? null,
    input.strength ?? null,
    input.form ?? null,
    input.presentation ?? null,
    input.category,
    input.category === 'medicament' ? 1 : 0,
    input.suggested_price ?? null,
    now,
    now,
    buildSearchText({
      name,
      dci: input.dci ?? null,
      strength: input.strength ?? null,
      form: input.form ?? null,
      presentation: input.presentation ?? null,
    }),
    now,
    now,
  );
}

/** C-06 : prix de vente de l'officine ; le prix conseillé du référentiel n'est jamais modifié. */
export function changeSalePrice(s: Services, actor: string, productId: string, salePrice: number): Product {
  if (!Number.isSafeInteger(salePrice) || salePrice < 0) {
    throw new AppError('validation_failed', 'Prix invalide', 'Le prix est un entier en XAF, positif ou nul.');
  }
  return writeTx(s.db, () => {
    const before = getProduct(s, productId);
    if (before.sale_price === salePrice) return before;
    s.db
      .prepare('UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?')
      .run(salePrice, iso(s.clock.now()), productId);
    s.ledger.append('catalog.price_changed', actor, {
      product_id: productId,
      old_price: before.sale_price,
      new_price: salePrice,
    });
    return getProduct(s, productId);
  });
}

/**
 * C-02 : activation par un événement réel (réception, inventaire, commande, vente en régularisation).
 * Doit être appelée dans la transaction de cet événement : le journal et l'état changent ensemble.
 * Idempotente : une fiche déjà active ne produit pas de second événement.
 */
export function activateProduct(
  s: Services,
  actor: string,
  productId: string,
  cause: ActivationCause,
): boolean {
  if (!s.db.inTransaction) {
    throw new Error("activateProduct doit être appelé dans la transaction de l'événement réel");
  }
  if (!ACTIVATION_CAUSES.includes(cause)) {
    throw new AppError('validation_failed', 'Cause inconnue', `Causes acceptées : ${ACTIVATION_CAUSES.join(', ')}.`);
  }
  const row = s.db.prepare('SELECT status FROM products WHERE id = ?').get(productId) as
    { status: string } | undefined;
  if (!row) throw new AppError('not_found', 'Fiche introuvable');
  const now = iso(s.clock.now());
  if (row.status === 'active') {
    s.db.prepare('UPDATE products SET last_activity_at = ? WHERE id = ?').run(now, productId);
    return false;
  }
  s.db
    .prepare(
      `UPDATE products SET status = 'active', activated_at = COALESCE(activated_at, ?),
         last_activity_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(now, now, now, productId);
  s.ledger.append('catalog.item_activated', actor, { product_id: productId, cause });
  return true;
}

/** C-05 : douze mois glissants, calculés avec l'horloge injectée. */
export function monthsAgo(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/**
 * C-05 : tâche quotidienne. Seules les fiches ACTIVES s'endorment ; une fiche dormante n'a jamais
 * été activée et une fiche déjà endormie n'est pas retouchée. L'acteur est nul (tâche système).
 */
export function sweepSleepingProducts(s: Services, months = 12): { slept: string[] } {
  const now = s.clock.now();
  const cutoff = iso(monthsAgo(now, months));
  return writeTx(s.db, () => {
    const rows = s.db
      .prepare(
        `SELECT id FROM products WHERE status = 'active'
           AND COALESCE(last_activity_at, activated_at, created_at) <= ? ORDER BY id`,
      )
      .all(cutoff) as { id: string }[];
    const update = s.db.prepare("UPDATE products SET status = 'sleeping', updated_at = ? WHERE id = ?");
    for (const r of rows) {
      update.run(iso(now), r.id);
      s.ledger.append('catalog.item_sleeping', null, { product_id: r.id });
    }
    return { slept: rows.map((r) => r.id) };
  });
}
