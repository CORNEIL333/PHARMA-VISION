/** Dates civiles de l'officine : Africa/Douala (UTC+1, sans heure d'été). Stockage toujours en UTC. */

const DOUALA_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Date du jour à Douala, au format AAAA-MM-JJ. */
export function doualaDate(now: Date): string {
  return new Date(now.getTime() + DOUALA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant UTC du début (minuit) d'une date civile de Douala. */
export function doualaMidnightUtc(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - DOUALA_OFFSET_MS);
}

/** AAAA-MM-JJ réel (2027-02-30 refusé). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Nombre de jours civils de `from` à `to` (négatif si `to` est passé). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/** Instant ISO strict (avec fuseau), normalisé en UTC avec millisecondes ; null si invalide. */
export function normalizeIso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}
