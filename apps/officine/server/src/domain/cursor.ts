import { AppError } from '../errors.js';

/** Curseur opaque de pagination : tableau JSON de clés de tri, encodé en base64url. */
export type CursorKey = string | number;

export function encodeCursor(keys: CursorKey[]): string {
  return Buffer.from(JSON.stringify(keys), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined, size: number): CursorKey[] | null {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 400 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('cursor');
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== size) throw new Error('cursor');
    for (const k of parsed) {
      if (typeof k === 'string' ? k.length > 200 : !Number.isSafeInteger(k)) throw new Error('cursor');
    }
    return parsed as CursorKey[];
  } catch {
    throw new AppError('validation_failed', 'Curseur invalide');
  }
}

/** Limite de page : 1 à `max` (100 au plus, spec §7), `def` par défaut. */
export function pageLimit(limit: number | undefined, def = 50, max = 100): number {
  const n = limit ?? def;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new AppError('validation_failed', `Limite attendue entre 1 et ${max}`);
  }
  return n;
}

/** Découpe la page (requête faite avec limit + 1) et calcule le curseur suivant. */
export function page<T>(rows: T[], limit: number, keys: (last: T) => CursorKey[]) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, next_cursor: rows.length > limit && last ? encodeCursor(keys(last)) : null };
}
