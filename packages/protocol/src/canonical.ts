import { createHash, sign, verify, type KeyObject } from 'node:crypto';

/**
 * Forme canonique (RFC 8785, restreinte aux données du projet), empreintes du journal et points de
 * contrôle signés : le nœud et le cloud calculent exactement les mêmes octets (annexe C, docs/06 §3).
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function jcs(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isSafeInteger(v)) throw new Error(`JCS : nombre non entier ou hors limites (${v})`);
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
      const o = v as Record<string, unknown>;
      return '{' + Object.keys(o).sort().map((k) => {
        if (o[k] === undefined) throw new Error(`JCS : valeur undefined pour « ${k} »`);
        return JSON.stringify(k) + ':' + jcs(o[k]);
      }).join(',') + '}';
    }
    default:
      throw new Error(`JCS : type non pris en charge (${typeof v})`);
  }
}

export const GENESIS_PREV_HASH = '0'.repeat(64);

export function sha256hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const fromB64url = (s: string) => Buffer.from(s, 'base64url');

export interface LedgerEvent {
  seq: number;
  id: string;
  type: string;
  at: string;
  actor: string | null;
  payload: { [k: string]: Json };
  prev_hash: string;
  hash: string;
}

/** J-02 : hash = SHA-256(JCS({seq, id, type, at, actor, payload, prev_hash})). */
export function eventHash(e: Omit<LedgerEvent, 'hash'>): string {
  const { seq, id, type, at, actor, payload, prev_hash } = e;
  return sha256hex(jcs({ seq, id, type, at, actor, payload, prev_hash }));
}

/** J-03 : message signé d'un point de contrôle. */
export function checkpointMessage(nodeId: string, seq: number, hash: string): string {
  return `VPCKPT1|${nodeId}|${seq}|${hash}`;
}

export function signCheckpoint(key: KeyObject, nodeId: string, seq: number, hash: string): string {
  return b64url(sign(null, Buffer.from(checkpointMessage(nodeId, seq, hash)), key));
}

export function verifyCheckpoint(key: KeyObject, nodeId: string, seq: number, hash: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(checkpointMessage(nodeId, seq, hash)), key, fromB64url(signature));
  } catch {
    return false;
  }
}

/** Identifiant de clé Ed25519 : comme le nœud (keys.ts), 16 hex du SHA-256 de la clé publique SPKI DER. */
export function keyIdOf(pub: KeyObject): string {
  return 'ed25519-' + sha256hex(pub.export({ type: 'spki', format: 'der' })).slice(0, 16);
}
