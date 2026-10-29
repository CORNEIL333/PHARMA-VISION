import type { KeyObject } from 'node:crypto';
import { checkChain, fromCloudEvent, verifyCheckpoint, type LedgerEvent, type SyncBatch } from '@visionpharma/protocol';

/**
 * SY-02 à SY-04 : décision sur un lot reçu, sans effet de bord. La couche base de données applique la
 * décision dans une transaction (verrou de ligne sur la tête du nœud). Le cloud ne réécrit jamais
 * l'histoire d'un nœud : une fourche met le nœud en quarantaine, rien n'est fusionné.
 */

export const MAX_BATCH_EVENTS = 1000;

export interface KnownEvent {
  id: string;
  seq: number;
  hash: string;
}

export type BatchDecision =
  | { kind: 'accept'; fresh: LedgerEvent[]; duplicates: string[]; head: { seq: number; hash: string } }
  | { kind: 'reject'; status: 400 | 422; code: 'invalid_batch' | 'bad_checkpoint' | 'hash_mismatch'; detail: string; seq: number | null }
  | { kind: 'quarantine'; code: 'chain_fork' | 'chain_break' | 'gap'; seq: number; detail: string };

/**
 * @param head  dernier événement accepté du nœud (seq 0 et 64 zéros si aucun)
 * @param known événements déjà reçus de ce nœud parmi les `seq` du lot (pour l'idempotence et les fourches)
 */
export function decideBatch(batch: SyncBatch, nodeKey: KeyObject, head: { seq: number; hash: string }, known: KnownEvent[]): BatchDecision {
  if (!Array.isArray(batch.events) || batch.events.length === 0 || batch.events.length > MAX_BATCH_EVENTS) {
    return { kind: 'reject', status: 400, code: 'invalid_batch', detail: `1 à ${MAX_BATCH_EVENTS} événements`, seq: null };
  }
  let events: LedgerEvent[];
  try {
    events = batch.events.map(fromCloudEvent);
  } catch {
    return { kind: 'reject', status: 400, code: 'invalid_batch', detail: 'enveloppe CloudEvents invalide', seq: null };
  }
  const last = events.at(-1)!;
  const cp = batch.checkpoint;
  if (!cp || cp.seq !== last.seq || cp.hash !== last.hash || !verifyCheckpoint(nodeKey, batch.node_id, cp.seq, cp.hash, cp.signature)) {
    return { kind: 'reject', status: 422, code: 'bad_checkpoint', detail: 'point de contrôle absent, faux ou mal signé', seq: last.seq };
  }
  const bySeq = new Map(known.map((k) => [k.seq, k]));
  const duplicates: string[] = [];
  for (const e of events) {
    const k = bySeq.get(e.seq);
    if (!k) continue;
    if (k.id !== e.id || k.hash !== e.hash) return { kind: 'quarantine', code: 'chain_fork', seq: e.seq, detail: 'même seq, contenu différent' };
    duplicates.push(e.id);
  }
  const fresh = events.filter((e) => !bySeq.has(e.seq));
  if (fresh.length === 0) return { kind: 'accept', fresh, duplicates, head };
  const chain = checkChain(fresh, head);
  if (!chain.ok) {
    if (chain.reason === 'hash_mismatch') return { kind: 'reject', status: 422, code: 'hash_mismatch', detail: 'empreinte recalculée différente', seq: chain.seq };
    return { kind: 'quarantine', code: chain.reason, seq: chain.seq, detail: chain.reason === 'gap' ? 'trou dans la séquence' : 'prev_hash différent de la tête connue' };
  }
  const top = fresh.at(-1)!;
  return { kind: 'accept', fresh, duplicates, head: { seq: top.seq, hash: top.hash } };
}
