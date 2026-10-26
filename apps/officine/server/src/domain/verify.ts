import type { KeyObject } from 'node:crypto';
import type { DB } from '../db/index.js';
import { computeHash, GENESIS_PREV_HASH, verifyCheckpointSignature, type Checkpoint } from './ledger.js';
import type { Json } from './jcs.js';

/** Vérification complète du journal (J-04, doc 06 §3.5). */

export type Defect =
  'gap' | 'hash_mismatch' | 'chain_break' | 'bad_signature' | 'unknown_key' | 'projection_mismatch';

export type VerifyResult =
  | { ok: true; events: number; checkpoints: number; head: { seq: number; hash: string } }
  | { ok: false; seq: number | null; defect: Defect; detail: string };

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

/** Convention (annexe C §2) : tout événement qui touche au stock porte payload.movements = [{lot_id, qty, kind}]. */
function movementsOf(payload: { [k: string]: Json }): { lot_id: string; qty: number }[] {
  const m = payload.movements;
  if (!Array.isArray(m)) return [];
  return m.flatMap((x) =>
    x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    typeof x.lot_id === 'string' &&
    typeof x.qty === 'number'
      ? [{ lot_id: x.lot_id, qty: x.qty }]
      : [],
  );
}

export function verifyLedger(db: DB, nodeId: string, keys: Map<string, KeyObject>): VerifyResult {
  const chain = verifyChain(db);
  if (!chain.ok) return chain;
  const cps = verifyCheckpoints(db, nodeId, keys);
  if (cps !== null) return cps;
  const proj = verifyStockProjection(db, chain.lotTotals, chain.lastTouch);
  if (proj !== null) return proj;
  const count = (db.prepare('SELECT COUNT(*) AS n FROM checkpoints').get() as { n: number }).n;
  return { ok: true, events: chain.events, checkpoints: count, head: chain.head };
}

type ChainOk = {
  ok: true;
  events: number;
  head: { seq: number; hash: string };
  lotTotals: Map<string, number>;
  lastTouch: Map<string, number>;
};

function verifyChain(db: DB): ChainOk | Extract<VerifyResult, { ok: false }> {
  let expectedSeq = 1;
  let prev = GENESIS_PREV_HASH;
  const lotTotals = new Map<string, number>();
  const lastTouch = new Map<string, number>();
  const it = db
    .prepare('SELECT seq, id, type, at, actor, payload, prev_hash, hash FROM events ORDER BY seq')
    .iterate();
  for (const raw of it) {
    const r = raw as Row;
    if (r.seq !== expectedSeq)
      return { ok: false, seq: expectedSeq, defect: 'gap', detail: `seq ${expectedSeq} manquant` };
    let payload: { [k: string]: Json };
    try {
      payload = JSON.parse(r.payload) as { [k: string]: Json };
    } catch {
      return { ok: false, seq: r.seq, defect: 'hash_mismatch', detail: 'contenu illisible' };
    }
    let recomputed: string;
    try {
      recomputed = computeHash({
        seq: r.seq,
        id: r.id,
        type: r.type,
        at: r.at,
        actor: r.actor,
        payload,
        prev_hash: r.prev_hash,
      });
    } catch {
      return { ok: false, seq: r.seq, defect: 'hash_mismatch', detail: 'contenu non canonisable' };
    }
    if (recomputed !== r.hash)
      return { ok: false, seq: r.seq, defect: 'hash_mismatch', detail: 'empreinte recalculée différente' };
    if (r.prev_hash !== prev)
      return {
        ok: false,
        seq: r.seq,
        defect: 'chain_break',
        detail: 'prev_hash différent du hash précédent',
      };
    for (const m of movementsOf(payload)) {
      lotTotals.set(m.lot_id, (lotTotals.get(m.lot_id) ?? 0) + m.qty);
      lastTouch.set(m.lot_id, r.seq);
    }
    prev = r.hash;
    expectedSeq++;
  }
  return {
    ok: true,
    events: expectedSeq - 1,
    head: { seq: expectedSeq - 1, hash: prev },
    lotTotals,
    lastTouch,
  };
}

function verifyCheckpoints(
  db: DB,
  nodeId: string,
  keys: Map<string, KeyObject>,
): Extract<VerifyResult, { ok: false }> | null {
  const evHash = db.prepare('SELECT hash FROM events WHERE seq = ?');
  for (const raw of db.prepare('SELECT * FROM checkpoints ORDER BY seq').iterate()) {
    const cp = raw as Checkpoint;
    const key = keys.get(cp.key_id);
    if (!key) return { ok: false, seq: cp.seq, defect: 'unknown_key', detail: `clé ${cp.key_id} inconnue` };
    const ev = evHash.get(cp.seq) as { hash: string } | undefined;
    if (!ev || ev.hash !== cp.hash)
      return { ok: false, seq: cp.seq, defect: 'hash_mismatch', detail: 'point de contrôle ≠ événement' };
    if (!verifyCheckpointSignature(key, nodeId, cp.seq, cp.hash, cp.signature)) {
      return { ok: false, seq: cp.seq, defect: 'bad_signature', detail: 'signature invalide' };
    }
  }
  return null;
}

function verifyStockProjection(
  db: DB,
  fromEvents: Map<string, number>,
  lastTouch: Map<string, number>,
): Extract<VerifyResult, { ok: false }> | null {
  const seen = new Set<string>();
  for (const raw of db.prepare('SELECT lot_id, qty FROM lot_stock').iterate()) {
    const r = raw as { lot_id: string; qty: number };
    seen.add(r.lot_id);
    const expected = fromEvents.get(r.lot_id) ?? 0;
    if (expected !== r.qty) {
      return {
        ok: false,
        seq: lastTouch.get(r.lot_id) ?? null,
        defect: 'projection_mismatch',
        detail: `lot ${r.lot_id} : journal ${expected}, base ${r.qty}`,
      };
    }
  }
  for (const [lot, qty] of fromEvents) {
    if (!seen.has(lot) && qty !== 0) {
      return {
        ok: false,
        seq: lastTouch.get(lot) ?? null,
        defect: 'projection_mismatch',
        detail: `lot ${lot} absent de la base`,
      };
    }
  }
  return null;
}
