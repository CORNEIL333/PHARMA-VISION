import type { DB } from '../src/db/index.js';
import { buildSearchText } from '../src/domain/search.js';

/** En-tête du format d'import (annexe I). */
export const CSV_HEADER =
  'ref_code;name;dci;strength;form;presentation;category;rx_required;sensitive;criticity;storage;suggested_price;gtin';

export function csv(...rows: string[]): string {
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

export function csvWithHeader(header: string, ...rows: string[]): string {
  return [header, ...rows].join('\n') + '\n';
}

export interface SeedProduct {
  id: string;
  name: string;
  ref?: string | null;
  dci?: string | null;
  strength?: string | null;
  form?: string | null;
  presentation?: string | null;
  category?: string;
  rx?: number;
  sensitive?: number;
  criticity?: number;
  storage?: string | null;
  suggested?: number | null;
  sale?: number | null;
  minQty?: number;
  maxQty?: number;
  status?: 'dormant' | 'active' | 'sleeping';
  activatedAt?: string | null;
  lastActivity?: string | null;
  localOnly?: number;
}

const INSERT_PRODUCT = `INSERT INTO products (
  id, ref_code, name, dci, strength, form, presentation, category, rx_required, sensitive,
  criticity, storage, suggested_price, sale_price, min_qty, max_qty, status, activated_at,
  last_activity_at, local_only, search_text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Insère une fiche directement en base : sert à préparer un état (pas de règle métier testée ici). */
export function seedProduct(db: DB, p: SeedProduct, at = '2026-10-27T08:00:00.000Z'): void {
  const text = buildSearchText({
    name: p.name,
    dci: p.dci ?? null,
    strength: p.strength ?? null,
    form: p.form ?? null,
    presentation: p.presentation ?? null,
  });
  db.prepare(INSERT_PRODUCT).run(
    p.id,
    p.ref ?? null,
    p.name,
    p.dci ?? null,
    p.strength ?? null,
    p.form ?? null,
    p.presentation ?? null,
    p.category ?? 'medicament',
    p.rx ?? 1,
    p.sensitive ?? 0,
    p.criticity ?? 3,
    p.storage ?? 'ambiant',
    p.suggested ?? null,
    p.sale ?? null,
    p.minQty ?? 0,
    p.maxQty ?? 0,
    p.status ?? 'dormant',
    p.activatedAt ?? null,
    p.lastActivity ?? null,
    p.localOnly ?? 0,
    text,
    at,
    at,
  );
}

/** Insère n fiches réalistes (nom, DCI, dosage) pour les mesures de performance C-01. */
export function seedMany(db: DB, n: number): void {
  const stmt = db.prepare(INSERT_PRODUCT);
  const words = ['amoxicilline', 'paracetamol', 'ibuprofene', 'metronidazole', 'artemether', 'ceftriaxone', 'prednisolone', 'salbutamol', 'omeprazole', 'doxycycline'];
  db.exec('BEGIN IMMEDIATE');
  for (let i = 0; i < n; i++) {
    const w = words[i % words.length] as string;
    const name = `${w} ${100 + (i % 400)} mg gélule boîte de ${(i % 30) + 1}`;
    const status = i % 97 === 0 ? 'active' : 'dormant';
    const text = buildSearchText({ name, dci: w, strength: `${100 + (i % 400)} mg`, form: 'gélule', presentation: `boîte de ${(i % 30) + 1}` });
    stmt.run(
      `p${i}`, `VP-${String(i).padStart(6, '0')}`, name, w, `${100 + (i % 400)} mg`, 'gélule',
      `boîte de ${(i % 30) + 1}`, 'medicament', 1, 0, 3, 'ambiant', 1000 + i, null, 0, 0,
      status, status === 'active' ? '2026-01-01T00:00:00.000Z' : null, null, 0, text,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    );
  }
  db.exec('COMMIT');
}
