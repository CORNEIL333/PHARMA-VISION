import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import type { Json } from './jcs.js';

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  lead_days: number;
  active: boolean;
  created_at: string;
}

type SupplierRow = Omit<Supplier, 'active'> & { active: number };
export interface SupplierInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  lead_days?: number;
}
export type SupplierPatch = Partial<SupplierInput> & { active?: boolean };
export const MAX_LEAD_DAYS = 3650;
const FIELDS = 'id, name, phone, email, lead_days, active, created_at';

export function getSupplier(s: Services, id: string): Supplier {
  const row = s.db.prepare(`SELECT ${FIELDS} FROM suppliers WHERE id = ?`).get(id) as
    SupplierRow | undefined;
  if (!row) throw new AppError('not_found', 'Fournisseur introuvable');
  return { ...row, active: row.active === 1 };
}

export function listSuppliers(s: Services, includeInactive = false): Supplier[] {
  const rows = s.db.prepare(
    `SELECT ${FIELDS} FROM suppliers WHERE (? = 1 OR active = 1) ORDER BY name COLLATE NOCASE, id`,
  ).all(includeInactive ? 1 : 0) as SupplierRow[];
  return rows.map((row) => ({ ...row, active: row.active === 1 }));
}

export function requireActiveSupplier(s: Services, id: string): Supplier {
  const supplier = getSupplier(s, id);
  if (!supplier.active) {
    throw new AppError('validation_failed', 'Fournisseur désactivé', undefined, {
      reason: 'supplier_inactive', supplier_id: id,
    });
  }
  return supplier;
}

function cleanText(value: string, max: number, field: string): string {
  if (typeof value !== 'string' || value.length > max || /\p{Cc}/u.test(value)) {
    throw new AppError('validation_failed', 'Champ fournisseur invalide', undefined, { field });
  }
  return value.normalize('NFC').trim();
}

function normalizeSupplier(input: SupplierInput & { active: boolean }) {
  const name = cleanText(input.name, 200, 'name');
  if (!name) throw new AppError('validation_failed', 'Nom fournisseur obligatoire');
  const phone = input.phone == null ? null : cleanText(input.phone, 80, 'phone') || null;
  const email = input.email == null ? null : cleanText(input.email, 254, 'email') || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('validation_failed', 'Adresse électronique invalide');
  }
  const lead_days = input.lead_days === undefined ? 2 : input.lead_days;
  if (!Number.isSafeInteger(lead_days) || lead_days < 0 || lead_days > MAX_LEAD_DAYS) {
    throw new AppError('validation_failed', 'Délai fournisseur invalide');
  }
  if (typeof input.active !== 'boolean') throw new AppError('validation_failed', 'État fournisseur invalide');
  return { name, phone, email, lead_days, active: input.active };
}

/** BEGIN IMMEDIATE serializes this Unicode-aware uniqueness check and the subsequent write. */
function assertUniqueName(s: Services, name: string, exceptId: string | null = null): void {
  const key = name.normalize('NFC').toLowerCase();
  const rows = s.db.prepare('SELECT id, name FROM suppliers').all() as { id: string; name: string }[];
  if (rows.some((row) => row.id !== exceptId && row.name.normalize('NFC').trim().toLowerCase() === key)) {
    // Existing code only; a dedicated 409 supplier_name_taken can be added by the integrator.
    throw new AppError('validation_failed', 'Nom fournisseur déjà utilisé', undefined, {
      field: 'name', reason: 'supplier_name_taken',
    });
  }
}

export function createSupplier(s: Services, actor: string, input: SupplierInput): Supplier {
  const fields = normalizeSupplier({ ...input, active: true });
  return writeTx(s.db, () => {
    assertUniqueName(s, fields.name);
    const id = randomUUID();
    s.db.prepare(
      'INSERT INTO suppliers (id, name, phone, email, lead_days, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    ).run(id, fields.name, fields.phone, fields.email, fields.lead_days, iso(s.clock.now()));
    s.ledger.append('supplier.created', actor, {
      supplier_id: id, name: fields.name, phone: fields.phone, email: fields.email, lead_days: fields.lead_days,
    });
    return getSupplier(s, id);
  });
}

/** Disabling is an update, never a deletion; existing orders retain their supplier reference. */
export function updateSupplier(s: Services, actor: string, id: string, patch: SupplierPatch): Supplier {
  return writeTx(s.db, () => {
    const before = getSupplier(s, id);
    const fields = normalizeSupplier({ ...before, ...patch });
    assertUniqueName(s, fields.name, id);
    const changes: Record<string, Json> = {};
    for (const key of ['name', 'phone', 'email', 'lead_days', 'active'] as const) {
      if (fields[key] !== before[key]) changes[key] = fields[key];
    }
    if (Object.keys(changes).length === 0) return before;
    s.db.prepare('UPDATE suppliers SET name = ?, phone = ?, email = ?, lead_days = ?, active = ? WHERE id = ?')
      .run(fields.name, fields.phone, fields.email, fields.lead_days, fields.active ? 1 : 0, id);
    s.ledger.append('supplier.updated', actor, { supplier_id: id, changes });
    return getSupplier(s, id);
  });
}
