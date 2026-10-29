import { checkChain, eventHash, GENESIS_PREV_HASH, verifyCheckpoint, type LedgerEvent } from '@visionpharma/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeHash } from '../src/domain/ledger.js';
import { makeApp, setupTitulaire, type TestApp } from './helpers.js';
import { openRegister, sell, stockedProduct } from './sales.helpers.js';

/** B2 : le nœud et packages/protocol calculent les mêmes empreintes et vérifient les mêmes signatures. */
let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(() => t.cleanup());

describe('SY-02 équivalence nœud ↔ packages/protocol', () => {
  it('SY-02 empreintes, chaîne et points de contrôle du nœud vérifiés par le protocole commun', async () => {
    const tit = await setupTitulaire(t);
    const p = stockedProduct(t, tit.userId, { name: 'Équivalence « é » €' });
    sell(t, tit.userId, openRegister(t, tit.userId), [{ product_id: p.productId, qty: 2 }], 2000);
    const rows = t.db.prepare('SELECT * FROM events ORDER BY seq').all() as (Omit<LedgerEvent, 'payload'> & { payload: string })[];
    const events = rows.map((r) => ({ seq: r.seq, id: r.id, type: r.type, at: r.at, actor: r.actor, payload: JSON.parse(r.payload), prev_hash: r.prev_hash, hash: r.hash }));
    for (const e of events) expect(eventHash(e)).toBe(computeHash(e));
    expect(checkChain(events, { seq: 0, hash: GENESIS_PREV_HASH })).toEqual({ ok: true });
    const cp = t.db.prepare('SELECT * FROM checkpoints ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string; signature: string } | undefined;
    if (cp) expect(verifyCheckpoint(t.keys.publicKey, t.keys.identity.node_id, cp.seq, cp.hash, cp.signature)).toBe(true);
  });
});
