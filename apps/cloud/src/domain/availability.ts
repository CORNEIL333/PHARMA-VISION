/**
 * DI-01, DI-02 : disponibilité consolidée, dérivée des mouvements, et fraîcheur (document 02, §15.3).
 */

export type Freshness = 'disponible' | 'a_confirmer' | 'masquee';

const HOUR = 3_600_000;

/** Moins d'1 h : disponible ; de 1 à 24 h : à confirmer ; au-delà (ou jamais) : absente de la recherche. */
export function freshness(lastSyncAt: string | null, now: Date): Freshness {
  if (!lastSyncAt) return 'masquee';
  const age = now.getTime() - Date.parse(lastSyncAt);
  if (age < HOUR) return 'disponible';
  if (age <= 24 * HOUR) return 'a_confirmer';
  return 'masquee';
}

export interface LotInfo {
  lot_id: string;
  product_id: string;
  lot_number: string;
  expiry: string | null;
  is_regul: boolean;
}

/** Lot comptable dans la disponibilité : ni lot de régularisation, ni périmé, ni rappelé. */
export function sellable(lot: LotInfo, today: string, recalled: boolean): boolean {
  return !lot.is_regul && lot.expiry !== null && lot.expiry >= today && !recalled;
}

/** Variation de stock par lot portée par les événements (convention `payload.movements`, annexe C §2). */
export function lotDeltas(events: { payload: Record<string, unknown> }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    const m = e.payload.movements;
    if (!Array.isArray(m)) continue;
    for (const x of m as { lot_id?: unknown; qty?: unknown }[]) {
      if (typeof x?.lot_id === 'string' && Number.isSafeInteger(x.qty)) out.set(x.lot_id, (out.get(x.lot_id) ?? 0) + (x.qty as number));
    }
  }
  return out;
}
