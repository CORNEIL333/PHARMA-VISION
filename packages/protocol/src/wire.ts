import { sign, verify, type KeyObject } from 'node:crypto';
import { b64url, eventHash, fromB64url, sha256hex, type Json, type LedgerEvent } from './canonical.js';

/** Enveloppe CloudEvents 1.0.2 d'un événement du nœud (annexe C §1), sans perte. */
export interface CloudEvent {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time: string;
  datacontenttype: 'application/json';
  dataschema: string;
  subject: string | null;
  data: { [k: string]: Json };
  vpseq: number;
  vpprevhash: string;
  vphash: string;
  vpactor: string | null;
}

const SUBJECT_KEYS = ['sale_id', 'lot_id', 'product_id', 'po_id', 'reception_id', 'session_id', 'recall_id', 'user_id', 'device_id'];
export const TYPE_PREFIX = 'cm.visionpharma.';

export function toCloudEvent(nodeId: string, e: LedgerEvent): CloudEvent {
  const key = SUBJECT_KEYS.find((k) => typeof e.payload[k] === 'string');
  return {
    specversion: '1.0', id: e.id, source: `urn:visionpharma:node:${nodeId}`, type: TYPE_PREFIX + e.type, time: e.at,
    datacontenttype: 'application/json', dataschema: `urn:visionpharma:schema:${e.type}:v1`,
    subject: key ? (e.payload[key] as string) : null, data: e.payload,
    vpseq: e.seq, vpprevhash: e.prev_hash, vphash: e.hash, vpactor: e.actor,
  };
}

export function fromCloudEvent(c: CloudEvent): LedgerEvent {
  if (!c.type.startsWith(TYPE_PREFIX)) throw new Error('type CloudEvents inattendu');
  return { seq: c.vpseq, id: c.id, type: c.type.slice(TYPE_PREFIX.length), at: c.time, actor: c.vpactor, payload: c.data, prev_hash: c.vpprevhash, hash: c.vphash };
}

export type ChainCheck = { ok: true } | { ok: false; seq: number; reason: 'hash_mismatch' | 'chain_break' | 'gap' };

/** Vérifie empreintes, chaînage et continuité d'une suite d'événements, à partir de la tête connue. */
export function checkChain(events: LedgerEvent[], head: { seq: number; hash: string }): ChainCheck {
  let prev = head;
  for (const e of events) {
    if (e.seq !== prev.seq + 1) return { ok: false, seq: e.seq, reason: 'gap' };
    if (e.prev_hash !== prev.hash) return { ok: false, seq: e.seq, reason: 'chain_break' };
    let h: string;
    try {
      h = eventHash(e);
    } catch {
      return { ok: false, seq: e.seq, reason: 'hash_mismatch' };
    }
    if (h !== e.hash) return { ok: false, seq: e.seq, reason: 'hash_mismatch' };
    prev = { seq: e.seq, hash: e.hash };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- requêtes signées (docs/10 §1.1)

export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function requestMessage(nodeId: string, date: string, method: string, path: string, body: Uint8Array | string): string {
  return `VPREQ1|${nodeId}|${date}|${method.toUpperCase()}|${path}|${sha256hex(body)}`;
}

export function signRequest(key: KeyObject, nodeId: string, date: string, method: string, path: string, body: Uint8Array | string): Record<string, string> {
  return {
    'x-vp-node': nodeId,
    'x-vp-date': date,
    'x-vp-signature': b64url(sign(null, Buffer.from(requestMessage(nodeId, date, method, path, body)), key)),
  };
}

export type RequestCheck = { ok: true } | { ok: false; reason: 'missing' | 'clock_skew' | 'bad_signature' };

export function verifyRequest(
  key: KeyObject,
  headers: { node?: string; date?: string; signature?: string },
  method: string,
  path: string,
  body: Uint8Array | string,
  now: Date,
): RequestCheck {
  const { node, date, signature } = headers;
  if (!node || !date || !signature) return { ok: false, reason: 'missing' };
  const t = Date.parse(date);
  if (!Number.isFinite(t) || Math.abs(now.getTime() - t) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'clock_skew' };
  try {
    const ok = verify(null, Buffer.from(requestMessage(node, date, method, path, body)), key, fromB64url(signature));
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

/** Lot envoyé par le nœud (SY-01). */
export interface SyncBatch {
  node_id: string;
  events: CloudEvent[];
  checkpoint: { seq: number; hash: string; signature: string; kid: string };
  /** Correspondance des produits et des lots cités, pour dériver la disponibilité (DI-01). */
  products: { product_id: string; ref_code: string | null; gtin: string | null }[];
  lots: { lot_id: string; product_id: string; lot_number: string; expiry: string | null; is_regul: boolean }[];
}

export interface SyncAck {
  acked: string[];
  head: { seq: number; hash: string };
}
