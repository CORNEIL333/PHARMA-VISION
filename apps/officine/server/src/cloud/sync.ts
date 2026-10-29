import { createPublicKey } from 'node:crypto';
import {
  signCheckpoint, toCloudEvent, type CloudEvent, type EnrolmentResponse, type Json, type LedgerEvent, type SyncAck, type SyncBatch,
} from '@visionpharma/protocol';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { cloudRequest, cloudTarget, type CloudTarget } from './transport.js';

/** NO-01, NO-02 : état de la synchronisation, enrôlement et envoi des lots (docs/10 §1.3, SY-01, SY-05). */

export const BATCH_SIZE = 500;

export function getState(s: Services, key: string): string | null {
  return (s.db.prepare('SELECT value FROM cloud_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

/** État opérationnel (pas un événement métier) : écrit hors du journal, comme `synced_at`. */
export function setState(s: Services, key: string, value: string): void {
  s.db.prepare(`INSERT INTO cloud_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, iso(s.clock.now()));
}

export interface Enrolment extends EnrolmentResponse {
  enrolled_at: string;
}

export function enrolment(s: Services): Enrolment | null {
  const v = getState(s, 'enrolment');
  return v ? (JSON.parse(v) as Enrolment) : null;
}

export const publicationKey = (e: Enrolment) => createPublicKey(e.publication_public_key_pem);

function rejected(status: number, body: unknown): AppError {
  const b = (body ?? {}) as { code?: string; detail?: string; title?: string };
  return new AppError('cloud_rejected', 'Refus du cloud', `${status} ${b.code ?? ''} ${b.detail ?? b.title ?? ''}`.trim(), { status, cloud_code: b.code ?? null });
}

/** CL-02 : enrôlement par jeton à usage unique ; la signature d'un point de contrôle prouve la possession de la clé. */
export async function enrol(s: Services, actor: string, token: string): Promise<Enrolment> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AppError('validation_failed', "Jeton d'enrôlement invalide");
  const t = cloudTarget(s, false);
  const head = s.ledger.head();
  const nodeId = s.keys.identity.node_id;
  const body = {
    token, node_id: nodeId, kid: s.keys.identity.kid,
    public_key_pem: s.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    checkpoint: { seq: head.seq, hash: head.hash, signature: signCheckpoint(s.keys.privateKey, nodeId, head.seq, head.hash) },
  };
  const r = await cloudRequest(s, t, 'POST', '/enrol/v1', body, { signed: false });
  if (r.status !== 200 && r.status !== 201) throw rejected(r.status, r.body);
  const res = r.body as EnrolmentResponse;
  if (res.node_id !== nodeId) throw new AppError('cloud_rejected', 'Réponse du cloud incohérente');
  createPublicKey(res.publication_public_key_pem);
  const e: Enrolment = { ...res, enrolled_at: iso(s.clock.now()) };
  writeTx(s.db, () => {
    setState(s, 'enrolment', JSON.stringify(e));
    s.ledger.append('system.cloud_enrolled', actor, { pharmacy_id: res.pharmacy_id, url: t.url.origin });
  });
  return e;
}

interface Row {
  seq: number;
  id: string;
  type: string;
  at: string;
  actor: string | null;
  payload: string;
  prev_hash: string;
  hash: string;
}

/** Identifiants de produits et de lots cités dans les contenus (clés `product_id`, `lot_id`). */
function collectRefs(v: Json, out: { products: Set<string>; lots: Set<string> }): void {
  if (Array.isArray(v)) v.forEach((x) => collectRefs(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'product_id' && typeof x === 'string') out.products.add(x);
      else if (k === 'lot_id' && typeof x === 'string') out.lots.add(x);
      else collectRefs(x, out);
    }
  }
}

function describeRefs(s: Services, events: LedgerEvent[]): Pick<SyncBatch, 'products' | 'lots'> {
  const refs = { products: new Set<string>(), lots: new Set<string>() };
  for (const e of events) collectRefs(e.payload, refs);
  const lotRow = s.db.prepare('SELECT id AS lot_id, product_id, lot_number, expiry, is_regul FROM lots WHERE id = ?');
  const lots = [...refs.lots].flatMap((id) => {
    const l = lotRow.get(id) as { lot_id: string; product_id: string; lot_number: string; expiry: string | null; is_regul: number } | undefined;
    if (!l) return [];
    refs.products.add(l.product_id);
    return [{ ...l, is_regul: l.is_regul === 1 }];
  });
  const prod = s.db.prepare(`SELECT p.id AS product_id, p.ref_code,
    (SELECT b.code FROM barcodes b WHERE b.product_id = p.id AND b.kind = 'gtin' ORDER BY b.code LIMIT 1) AS gtin
    FROM products p WHERE p.id = ?`);
  const products = [...refs.products].flatMap((id) => {
    const p = prod.get(id) as SyncBatch['products'][number] | undefined;
    return p ? [p] : [];
  });
  return { products, lots };
}

/** Prochain lot : événements non envoyés, contigus, avec le point de contrôle signé du dernier. */
export function buildBatch(s: Services, size = BATCH_SIZE): SyncBatch | null {
  const rows = s.db.prepare('SELECT seq, id, type, at, actor, payload, prev_hash, hash FROM events WHERE synced_at IS NULL ORDER BY seq LIMIT ?').all(size) as Row[];
  if (rows.length === 0) return null;
  const nodeId = s.keys.identity.node_id;
  const events: LedgerEvent[] = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as LedgerEvent['payload'] }));
  const last = events.at(-1)!;
  const cloudEvents: CloudEvent[] = events.map((e) => toCloudEvent(nodeId, e));
  return {
    node_id: nodeId, events: cloudEvents,
    checkpoint: { seq: last.seq, hash: last.hash, signature: signCheckpoint(s.keys.privateKey, nodeId, last.seq, last.hash), kid: s.keys.identity.kid },
    ...describeRefs(s, events),
  };
}

/** SY-05 : seuls les événements accusés sont marqués envoyés (colonne `synced_at`, seule modifiable). */
export function markSynced(s: Services, ids: string[]): number {
  const at = iso(s.clock.now());
  return writeTx(s.db, () => {
    const upd = s.db.prepare('UPDATE events SET synced_at = ? WHERE id = ? AND synced_at IS NULL');
    return ids.reduce((n, id) => n + upd.run(at, id).changes, 0);
  });
}

/** Envoie les lots jusqu'à vider la file (au plus `maxBatches` lots par cycle). */
export async function pushEvents(s: Services, t: CloudTarget, maxBatches = 20): Promise<number> {
  let sent = 0;
  for (let i = 0; i < maxBatches; i++) {
    const batch = buildBatch(s);
    if (!batch) break;
    const r = await cloudRequest(s, t, 'POST', '/sync/v1/batches', batch, { gzip: true });
    if (r.status !== 200) throw rejected(r.status, r.body);
    const ack = r.body as SyncAck;
    const wanted = new Set(batch.events.map((e) => e.id));
    const acked = (ack.acked ?? []).filter((id) => wanted.has(id));
    sent += markSynced(s, acked);
    if (acked.length < batch.events.length) break;
  }
  return sent;
}

