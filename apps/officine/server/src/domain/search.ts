import { AppError } from '../errors.js';
import type { Services } from '../services.js';

/**
 * C-01 : lecture du catalogue — normalisation pour la recherche, pagination par curseur.
 * La recherche est insensible à la casse et aux accents : le texte comparé est normalisé à
 * l'écriture (`search_text`) comme à la lecture (termes de la requête).
 */

export type ProductStatus = 'dormant' | 'active' | 'sleeping';
export const STATUSES: readonly ProductStatus[] = ['dormant', 'active', 'sleeping'];

export interface Product {
  id: string;
  ref_code: string | null;
  name: string;
  dci: string | null;
  strength: string | null;
  form: string | null;
  presentation: string | null;
  category: string;
  rx_required: boolean;
  sensitive: boolean;
  criticity: number;
  storage: string | null;
  suggested_price: number | null;
  sale_price: number | null;
  min_qty: number;
  max_qty: number;
  status: ProductStatus;
  activated_at: string | null;
  last_activity_at: string | null;
  local_only: boolean;
}

/** Ligne brute telle que stockée (entiers 0/1 pour les booléens SQLite). */
export interface ProductRow {
  id: string;
  ref_code: string | null;
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
  sale_price: number | null;
  min_qty: number;
  max_qty: number;
  status: ProductStatus;
  activated_at: string | null;
  last_activity_at: string | null;
  local_only: number;
}

export const PRODUCT_COLUMNS = `id, ref_code, name, dci, strength, form, presentation, category,
  rx_required, sensitive, criticity, storage, suggested_price, sale_price, min_qty, max_qty,
  status, activated_at, last_activity_at, local_only`;

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    ref_code: r.ref_code,
    name: r.name,
    dci: r.dci,
    strength: r.strength,
    form: r.form,
    presentation: r.presentation,
    category: r.category,
    rx_required: r.rx_required === 1,
    sensitive: r.sensitive === 1,
    criticity: r.criticity,
    storage: r.storage,
    suggested_price: r.suggested_price,
    sale_price: r.sale_price,
    min_qty: r.min_qty,
    max_qty: r.max_qty,
    status: r.status,
    activated_at: r.activated_at,
    last_activity_at: r.last_activity_at,
    local_only: r.local_only === 1,
  };
}

/** Minuscules, sans accents, toute ponctuation remplacée par une espace simple. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Texte indexé pour la recherche : nom, DCI, dosage, forme, conditionnement. */
export function buildSearchText(p: {
  name: string;
  dci: string | null;
  strength: string | null;
  form: string | null;
  presentation: string | null;
}): string {
  return normalizeText([p.name, p.dci, p.strength, p.form, p.presentation].filter(Boolean).join(' '));
}

/** Rang d'affichage : actives d'abord, puis endormies, puis dormantes (C-01). */
export const STATUS_RANK = `CASE p.status WHEN 'active' THEN 0 WHEN 'sleeping' THEN 1 ELSE 2 END`;

const SELECT_PRODUCTS = `SELECT ${PRODUCT_COLUMNS} FROM products p`;

/** Ligne brute d'une fiche ; `not_found` si l'identifiant est inconnu. */
export function getProductRow(s: Services, id: string): ProductRow {
  const row = s.db.prepare(`${SELECT_PRODUCTS} WHERE p.id = ?`).get(id) as ProductRow | undefined;
  if (!row) throw new AppError('not_found', 'Fiche introuvable');
  return row;
}

export interface SearchOptions {
  q?: string | null;
  status?: ProductStatus | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface SearchResult {
  items: Product[];
  next_cursor: string | null;
}

const MAX_TERMS = 8;

export function searchProducts(s: Services, opts: SearchOptions = {}): SearchResult {
  const limit = clampLimit(opts.limit);
  const { where, params } = searchFilter(opts);
  const rows = s.db
    .prepare(`${SELECT_PRODUCTS} WHERE ${where} ORDER BY ${STATUS_RANK}, p.name, p.id LIMIT ?`)
    .all(...params, limit + 1) as ProductRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toProduct),
    next_cursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

function clampLimit(limit: number | null | undefined): number {
  if (limit === undefined || limit === null) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AppError('validation_failed', 'Limite invalide', 'La limite doit être comprise entre 1 et 50.');
  }
  return limit;
}

/** Filtre SQL : un terme = présent dans le texte indexé ou dans un code-barres (ET entre termes). */
function searchFilter(opts: SearchOptions): { where: string; params: (string | number)[] } {
  const filters: string[] = ['1 = 1'];
  const params: (string | number)[] = [];
  for (const term of normalizeText(opts.q ?? '').split(' ').filter(Boolean).slice(0, MAX_TERMS)) {
    const like = `%${escapeLike(term)}%`;
    filters.push(
      `(p.search_text LIKE ? ESCAPE '\\' OR EXISTS (
         SELECT 1 FROM barcodes b WHERE b.product_id = p.id AND b.code LIKE ? ESCAPE '\\'))`,
    );
    params.push(like, like);
  }
  if (opts.status) {
    if (!STATUSES.includes(opts.status)) {
      throw new AppError('validation_failed', 'Statut invalide', 'Statut attendu : dormant, active ou sleeping.');
    }
    filters.push('p.status = ?');
    params.push(opts.status);
  }
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    filters.push(`(${STATUS_RANK}, p.name, p.id) > (?, ?, ?)`);
    params.push(c.r, c.n, c.i);
  }
  return { where: filters.join(' AND '), params };
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface Cursor {
  r: number;
  n: string;
  i: string;
}

function encodeCursor(row: ProductRow): string {
  const rank = row.status === 'active' ? 0 : row.status === 'sleeping' ? 1 : 2;
  return Buffer.from(JSON.stringify({ r: rank, n: row.name, i: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof v.r !== 'number' || typeof v.n !== 'string' || typeof v.i !== 'string') throw new Error('forme');
    return { r: v.r, n: v.n, i: v.i };
  } catch {
    throw new AppError('validation_failed', 'Curseur invalide', 'Le curseur de pagination est illisible.');
  }
}
