import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTx } from '../src/db/index.js';
import { adjustStock, appendStockEvent, enterLot, executeFefo } from '../src/domain/stock.js';
import { countInventory, openInventory, validateInventory } from '../src/domain/inventory.js';
import { verifyLedger } from '../src/domain/verify.js';
import { seedProduct } from './catalog.helpers.js';
import { keyMap, makeApp, setupTitulaire, type TestApp } from './helpers.js';
import { lotQty, receive } from './stock.helpers.js';

let t: TestApp;
let actor: string;
beforeEach(async () => { t = await makeApp(); actor = (await setupTitulaire(t)).userId; });
afterEach(() => t.cleanup());

function product() {
  const id = randomUUID();
  seedProduct(t.db, { id, name: 'Property product', rx: 0 });
  return id;
}
function verify() {
  expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
}

describe('S-01 S-03 S-04 S-06 stock properties (fast-check, local dependency)', () => {
  it('S-01 S-04 arbitrary signed adjustments conserve stock and never make a normal lot negative', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 50 }), fc.array(fc.integer({ min: -30, max: 30 }), { maxLength: 30 }), (initial, deltas) => {
      const productId = product();
      const lot = receive(t.s, actor, { productId, lotNumber: 'A', expiry: '2028-01-01', qty: initial, unitCost: 20 }).lotId;
      let expected = initial;
      for (const qty of deltas) {
        const head = t.ledger.head();
        const perform = () => adjustStock(t.s, actor, { lot_id: lot, qty, reason: 'erreur_saisie' });
        if (qty === 0 || expected + qty < 0) {
          expect(perform).toThrow();
          expect(t.ledger.head()).toEqual(head);
        } else {
          perform();
          expected += qty;
        }
        expect(lotQty(t.db, lot)).toBe(expected);
        expect(expected).toBeGreaterThanOrEqual(0);
      }
      verify();
    }), { numRuns: 30 });
  });

  it('S-03 S-04 multi-lot FEFO conserves the requested quantity or atomically rejects the whole basket', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 15 }), { minLength: 1, maxLength: 5 }), fc.integer({ min: 1, max: 90 }), (quantities, wanted) => {
      const productId = product();
      const ids = quantities.map((qty, index) => receive(t.s, actor, {
        productId, lotNumber: String(index), expiry: `2028-0${index + 1}-01`, qty, unitCost: 10,
      }).lotId);
      const available = quantities.reduce((a, b) => a + b, 0);
      const head = t.ledger.head();
      const execute = () => writeTx(t.db, () => executeFefo(t.s, actor, [{ product_id: productId, qty: wanted }], { id: randomUUID(), payload: {} }));
      if (wanted > available) {
        expect(execute).toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
        expect(t.ledger.head()).toEqual(head);
        expect(ids.map((id) => lotQty(t.db, id))).toEqual(quantities);
      } else {
        const result = execute();
        expect(result.movements.reduce((n, m) => n + m.qty, 0)).toBe(-wanted);
        expect(new Set(result.movements.map((m) => m.lot_id)).size).toBe(result.movements.length);
        let remaining = wanted;
        for (let i = 0; i < ids.length; i++) {
          const q = quantities[i]!;
          const take = Math.min(q, remaining);
          expect(lotQty(t.db, ids[i]!)).toBe(q - take);
          remaining -= take;
        }
      }
      verify();
    }), { numRuns: 30 });
  });

  it('S-01 atomicity includes movements, lots, activation, events and checkpoints after injected rollback', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 8 }), (quantities) => {
      const id = product();
      const head = t.ledger.head();
      const checkpoints = t.db.prepare('SELECT * FROM checkpoints ORDER BY seq').all();
      expect(() => writeTx(t.db, () => {
        quantities.forEach((qty, i) => {
          const entry = enterLot(t.s, actor, {
            product_id: id, lot_number: String(i), expiry: '2028-01-01', unit_cost: 30, qty, kind: 'reception',
          }, 'reception');
          appendStockEvent(t.s, 'reception.recorded', actor, {}, [entry.movement]);
        });
        t.s.ledger.checkpoint();
        throw new Error('injected rollback');
      })).toThrow('injected rollback');
      expect(t.db.prepare('SELECT id FROM lots WHERE product_id = ?').all(id)).toEqual([]);
      expect(t.db.prepare('SELECT id FROM stock_movements WHERE product_id = ?').all(id)).toEqual([]);
      expect(t.db.prepare('SELECT status FROM products WHERE id = ?').get(id)).toEqual({ status: 'dormant' });
      expect(t.db.prepare('SELECT * FROM checkpoints ORDER BY seq').all()).toEqual(checkpoints);
      expect(t.ledger.head()).toEqual(head);
      verify();
    }), { numRuns: 25 });
  });

  it('S-06 inventory reconciliation equals physical counts and the ledger projection remains verifiable', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 0, max: 30 })), { minLength: 1, maxLength: 5 }), (counts) => {
      const id = product();
      const ids = counts.map(([qty], i) => receive(t.s, actor, {
        productId: id, lotNumber: String(i), expiry: '2028-01-01', qty, unitCost: 30,
      }).lotId);
      const session = openInventory(t.s, actor, { scope: 'Property shelf', product_ids: [id] });
      counts.forEach(([, qty], i) => countInventory(t.s, actor, session.id, { lot_id: ids[i]!, counted_qty: qty }));
      const report = validateInventory(t.s, actor, session.id, true);
      const delta = counts.reduce((n, [system, counted]) => n + counted - system, 0);
      expect(report.total_delta_qty).toBe(delta);
      expect(report.total_delta_value_xaf).toBe(delta * 30);
      expect(ids.map((lot) => lotQty(t.db, lot))).toEqual(counts.map(([, qty]) => qty));
      verify();
    }), { numRuns: 25 });
  });
});
