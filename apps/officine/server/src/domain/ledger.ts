import { randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import type { Clock } from '../clock.js';
import { iso } from '../clock.js';
import type { DB } from '../db/index.js';
import { jcs, type Json } from './jcs.js';
import { b64url, fromB64url, sha256hex } from '../security/crypto.js';

/** Journal chaîné (doc 06 §3). Ajout seul ; chaque événement scelle le précédent. */

export const GENESIS_PREV_HASH = '0'.repeat(64);

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

export interface NodeSigner {
  nodeId: string;
  kid: string;
  privateKey: KeyObject;
}

export interface Checkpoint {
  seq: number;
  hash: string;
  signature: string;
  key_id: string;
  at: string;
}

export function computeHash(e: Omit<LedgerEvent, 'hash'>): string {
  const { seq, id, type, at, actor, payload, prev_hash } = e;
  return sha256hex(Buffer.from(jcs({ seq, id, type, at, actor, payload, prev_hash }), 'utf8'));
}

export function checkpointMessage(nodeId: string, seq: number, hash: string): string {
  return `VPCKPT1|${nodeId}|${seq}|${hash}`;
}

export function signCheckpoint(signer: NodeSigner, seq: number, hash: string): string {
  return b64url(
    sign(null, Buffer.from(checkpointMessage(signer.nodeId, seq, hash), 'utf8'), signer.privateKey),
  );
}

export function verifyCheckpointSignature(
  publicKey: KeyObject,
  nodeId: string,
  seq: number,
  hash: string,
  signature: string,
): boolean {
  return verify(
    null,
    Buffer.from(checkpointMessage(nodeId, seq, hash), 'utf8'),
    publicKey,
    fromB64url(signature),
  );
}

const EVENT_TYPE = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

export class Ledger {
  constructor(
    private readonly db: DB,
    private readonly signer: NodeSigner,
    private readonly clock: Clock,
    private readonly checkpointEvery = 100,
  ) {}

  get nodeId(): string {
    return this.signer.nodeId;
  }

  head(): { seq: number; hash: string } {
    const r = this.db.prepare('SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1').get() as
      { seq: number; hash: string } | undefined;
    return r ?? { seq: 0, hash: GENESIS_PREV_HASH };
  }

  /**
   * Ajoute un événement. Doit être appelé DANS la transaction de la modification métier (J-01).
   * Crée un point de contrôle tous les `checkpointEvery` événements (J-03).
   */
  append(type: string, actor: string | null, payload: { [k: string]: Json }): LedgerEvent {
    if (!this.db.inTransaction) throw new Error('Ledger.append doit être appelé dans une transaction');
    if (!EVENT_TYPE.test(type)) throw new Error(`Type d'événement invalide : ${type}`);
    const canonicalPayload = jcs(payload); // refuse undefined et nombres non entiers
    const head = this.head();
    const base = {
      seq: head.seq + 1,
      id: randomUUID(),
      type,
      at: iso(this.clock.now()),
      actor,
      payload,
      prev_hash: head.hash,
    };
    const ev: LedgerEvent = { ...base, hash: computeHash(base) };
    this.db
      .prepare(
        'INSERT INTO events (seq, id, type, at, actor, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ev.seq, ev.id, ev.type, ev.at, ev.actor, canonicalPayload, ev.prev_hash, ev.hash);
    if (ev.seq % this.checkpointEvery === 0) this.checkpoint();
    return ev;
  }

  /** Point de contrôle signé sur le dernier événement (clôture de caisse, minuit, tous les N). */
  checkpoint(): Checkpoint | null {
    if (!this.db.inTransaction) throw new Error('Ledger.checkpoint doit être appelé dans une transaction');
    const head = this.head();
    if (head.seq === 0) return null;
    const existing = this.db.prepare('SELECT * FROM checkpoints WHERE seq = ?').get(head.seq) as
      Checkpoint | undefined;
    if (existing) return existing;
    const cp: Checkpoint = {
      seq: head.seq,
      hash: head.hash,
      signature: signCheckpoint(this.signer, head.seq, head.hash),
      key_id: this.signer.kid,
      at: iso(this.clock.now()),
    };
    this.db
      .prepare('INSERT INTO checkpoints (seq, hash, signature, key_id, at) VALUES (?, ?, ?, ?, ?)')
      .run(cp.seq, cp.hash, cp.signature, cp.key_id, cp.at);
    return cp;
  }

  lastCheckpoint(): Checkpoint | null {
    return (
      (this.db.prepare('SELECT * FROM checkpoints ORDER BY seq DESC LIMIT 1').get() as
        Checkpoint | undefined) ?? null
    );
  }
}
