/** Affichage : XAF entiers, dates et heures de Douala (UTC+1, sans heure d'été). */
const DOUALA_MS = 3_600_000;

export function xaf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F`.replace(/^/, n < 0 ? '−' : '');
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function local(isoAt: string): string {
  return new Date(Date.parse(isoAt) + DOUALA_MS).toISOString();
}

export function dateTime(isoAt: string | null | undefined): string {
  if (!isoAt) return '—';
  const d = local(isoAt);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}

export function date(isoOrDay: string | null | undefined): string {
  if (!isoOrDay) return '—';
  const d = isoOrDay.length === 10 ? isoOrDay : local(isoOrDay).slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export function expiry(day: string | null | undefined): string {
  return day ? `${day.slice(5, 7)}/${day.slice(0, 4)}` : '—';
}

/** Date du jour à Douala (AAAA-MM-JJ). */
export function today(): string {
  return local(new Date().toISOString()).slice(0, 10);
}

/** Bornes UTC d'une journée de Douala, pour les filtres de période. */
export function dayRange(day: string): { from: string; to: string } {
  const start = Date.parse(`${day}T00:00:00.000Z`) - DOUALA_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000 - 1).toISOString() };
}
