import { iso } from '../clock.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getSettings } from '../domain/settings.js';
import { pullRecalls, pullReferential } from './feed.js';
import { enrolment, getState, pushEvents, setState } from './sync.js';
import { cloudTarget } from './transport.js';

/** NO-02 à NO-05 : un cycle de synchronisation (rappels d'abord, RA-02), et son état pour l'écran Système. */

export const POLL_MS = 60_000;
export const MAX_BACKOFF_MS = 5 * 60_000;

export interface CycleResult {
  ran: boolean;
  recalls: number;
  sent: number;
  versions: number;
  error: string | null;
}

export async function syncCycle(s: Services): Promise<CycleResult> {
  const st = getSettings(s);
  const e = enrolment(s);
  if (!st.cloud_sync_enabled || !e) return { ran: false, recalls: 0, sent: 0, versions: 0, error: null };
  setState(s, 'last_attempt_at', iso(s.clock.now()));
  try {
    const t = cloudTarget(s);
    const recalls = await pullRecalls(s, t, e);
    const sent = await pushEvents(s, t);
    const versions = await pullReferential(s, t, e);
    setState(s, 'last_sync_at', iso(s.clock.now()));
    setState(s, 'last_error', '');
    setState(s, 'failures', '0');
    return { ran: true, recalls, sent, versions, error: null };
  } catch (err) {
    const msg = err instanceof AppError ? `${err.title} : ${err.message}` : 'erreur inattendue';
    setState(s, 'last_error', msg.slice(0, 300));
    setState(s, 'failures', String(Number(getState(s, 'failures') ?? '0') + 1));
    return { ran: true, recalls: 0, sent: 0, versions: 0, error: msg };
  }
}

/** Attente avant le prochain cycle : 60 s, doublée à chaque échec, plafonnée à 5 minutes. */
export function nextDelay(failures: number): number {
  return Math.min(POLL_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS) || POLL_MS;
}

export interface CloudStatus {
  enabled: boolean;
  configured: boolean;
  enrolled: boolean;
  pharmacy_id: string | null;
  url: string | null;
  last_sync_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  queue: number;
  referential_version: number;
  recall_version: number;
  recalls: { cloud_id: string; ref_code: string; lot_number: string | null; active: boolean; applied: boolean; acked_at: string | null; received_at: string }[];
}

export function cloudStatus(s: Services): CloudStatus {
  const st = getSettings(s);
  const e = enrolment(s);
  const recalls = (s.db.prepare(`SELECT cloud_id, ref_code, lot_number, active, local_recall_id IS NOT NULL AS applied, acked_at, received_at
    FROM cloud_recalls ORDER BY version DESC LIMIT 10`).all() as (Omit<CloudStatus['recalls'][number], 'active' | 'applied'> & { active: number; applied: number })[])
    .map((r) => ({ ...r, active: r.active === 1, applied: r.applied === 1 }));
  return {
    enabled: st.cloud_sync_enabled, configured: !!(st.cloud_url && st.cloud_spki_sha256), enrolled: !!e,
    pharmacy_id: e?.pharmacy_id ?? null, url: st.cloud_url,
    last_sync_at: getState(s, 'last_sync_at'), last_attempt_at: getState(s, 'last_attempt_at'), last_error: getState(s, 'last_error') || null,
    queue: (s.db.prepare('SELECT COUNT(*) AS n FROM events WHERE synced_at IS NULL').get() as { n: number }).n,
    referential_version: Number(getState(s, 'referential_version') ?? '0'),
    recall_version: Number(getState(s, 'recall_version') ?? '0'),
    recalls,
  };
}

/** Tâche de fond : un cycle à la fois ; aucune connexion tant que la synchronisation est désactivée. */
export function scheduleCloudSync(s: Services, onError: (e: unknown) => void): { stop: () => void; now: () => Promise<CycleResult> } {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<CycleResult> | null = null;
  const run = () => {
    running ??= syncCycle(s).finally(() => {
      running = null;
    });
    return running;
  };
  const arm = () => {
    timer = setTimeout(() => {
      run().catch(onError).finally(arm);
    }, nextDelay(Number(getState(s, 'failures') ?? '0')));
    timer.unref();
  };
  arm();
  return { stop: () => clearTimeout(timer), now: run };
}
