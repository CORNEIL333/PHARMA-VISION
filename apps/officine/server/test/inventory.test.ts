import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countInventory, getInventory, inventoryReport, listInventoryCounts, openInventory, validateInventory,
} from '../src/domain/inventory.js';
import { adjustStock, executeFefo } from '../src/domain/stock.js';
import { writeTx } from '../src/db/index.js';
import { verifyLedger } from '../src/domain/verify.js';
import { seedProduct } from './catalog.helpers.js';
import { keyMap, makeApp, setupTitulaire, type TestApp } from './helpers.js';
import { lotQty, movementsOf, payloadsOf, receive } from './stock.helpers.js';

let t: TestApp;
let actor: string;
let productId: string;
beforeEach(async () => {
  t = await makeApp();
  actor = (await setupTitulaire(t)).userId;
  productId = randomUUID();
  seedProduct(t.db, { id: productId, name: 'Inventory product' });
});
afterEach(() => { vi.restoreAllMocks(); t.cleanup(); });

function lot(number: string, qty: number, cost = 150) {
  return receive(t.s, actor, { productId, lotNumber: number, qty, expiry: '2028-01-01', unitCost: cost }).lotId;
}
function verify() {
  expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
}

describe('S-06 inventory sessions, physical counts and reconciliation', () => {
  it('S-06 complete inventory records counts, corrects minus two and reports the cost variance', () => {
    const a = lot('A', 10);
    const b = lot('B', 2, 100);
    const session = openInventory(t.s, actor, { scope: 'complet' });
    expect(session.status).toBe('open');
    const count = countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 8 });
    countInventory(t.s, actor, session.id, { lot_id: b, counted_qty: 2 });
    expect(count).toMatchObject({ system_qty: 10, counted_qty: 8, delta: -2 });
    expect(lotQty(t.db, a)).toBe(10);
    const report = validateInventory(t.s, actor, session.id, true);
    expect(report).toMatchObject({ status: 'validated', counted_lots: 2, total_delta_qty: -2, total_delta_value_xaf: -300 });
    expect(lotQty(t.db, a)).toBe(8);
    expect(movementsOf(t.db, a).at(-1)).toMatchObject({ qty: -2, kind: 'inventory' });
    expect(movementsOf(t.db, b)).toHaveLength(1);
    expect(payloadsOf(t.db, 'inventory.opened')).toHaveLength(1);
    expect(payloadsOf(t.db, 'inventory.counted')).toHaveLength(2);
    expect(payloadsOf(t.db, 'inventory.validated')[0]).toMatchObject({
      session_id: session.id, movements: [{ lot_id: a, qty: -2, kind: 'inventory' }],
    });
    expect(inventoryReport(t.s, session.id, true)).toEqual(report);
    verify();
  });

  it('S-06 recount updates the same row, audits both counts and rejects invalid transitions', () => {
    const a = lot('A', 2);
    const session = openInventory(t.s, actor, { scope: 'complet' });
    const first = countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 1 });
    const second = countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 3 });
    expect(second.id).toBe(first.id);
    expect(listInventoryCounts(t.s, session.id).items).toHaveLength(1);
    expect(payloadsOf(t.db, 'inventory.counted')).toHaveLength(2);
    validateInventory(t.s, actor, session.id);
    const head = t.ledger.head();
    expect(lotQty(t.db, a)).toBe(3);
    expect(() => validateInventory(t.s, actor, session.id)).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    expect(() => countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 2 })).toThrow();
    expect(t.ledger.head()).toEqual(head);
    verify();
  });

  it('S-06 a shelf session uses an explicit product scope and rejects out-of-scope counts', () => {
    const a = lot('A', 2);
    const other = randomUUID();
    seedProduct(t.db, { id: other, name: 'Other shelf' });
    const b = receive(t.s, actor, { productId: other, lotNumber: 'B', expiry: '2028-01-01', qty: 3 }).lotId;
    expect(() => openInventory(t.s, actor, { scope: 'Shelf A' })).toThrow();
    const session = openInventory(t.s, actor, { scope: 'Shelf A', product_ids: [productId] });
    expect(getInventory(t.s, session.id).product_ids).toEqual([productId]);
    expect(() => countInventory(t.s, actor, session.id, { lot_id: b, counted_qty: 1 })).toThrow();
    countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 1 });
    validateInventory(t.s, actor, session.id);
    expect(lotQty(t.db, a)).toBe(1);
    expect(lotQty(t.db, b)).toBe(3);
    verify();
  });

  it('S-06 complete inventory cannot silently zero or ignore uncounted lots', () => {
    const a = lot('A', 2);
    const b = lot('B', 3);
    const session = openInventory(t.s, actor, { scope: 'complet' });
    countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 0 });
    expect(() => validateInventory(t.s, actor, session.id)).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    expect(lotQty(t.db, a)).toBe(2);
    expect(lotQty(t.db, b)).toBe(3);
    countInventory(t.s, actor, session.id, { lot_id: b, counted_qty: 3 });
    validateInventory(t.s, actor, session.id);
    expect(lotQty(t.db, a)).toBe(0);
    verify();
  });

  it('S-06 concurrent stock activity after counting requires recount, even if net quantity is unchanged', () => {
    const a = lot('A', 3);
    const session = openInventory(t.s, actor, { scope: 'complet' });
    countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 1 });
    adjustStock(t.s, actor, { lot_id: a, qty: -1, reason: 'casse' });
    adjustStock(t.s, actor, { lot_id: a, qty: 1, reason: 'erreur_saisie' });
    expect(() => validateInventory(t.s, actor, session.id)).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    expect(lotQty(t.db, a)).toBe(3);
    countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 2 });
    validateInventory(t.s, actor, session.id);
    expect(lotQty(t.db, a)).toBe(2);
    verify();
  });

  it('S-06 validation rolls back every correction when a later insert fails', () => {
    const a = lot('A', 3);
    const b = lot('B', 4);
    const session = openInventory(t.s, actor, { scope: 'complet' });
    countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 2 });
    countInventory(t.s, actor, session.id, { lot_id: b, counted_qty: 3 });
    t.db.exec(`CREATE TEMP TRIGGER reject_inventory BEFORE INSERT ON stock_movements
      WHEN NEW.kind = 'inventory' AND (SELECT COUNT(*) FROM stock_movements WHERE kind = 'inventory') = 1
      BEGIN SELECT RAISE(ABORT, 'injected second insert'); END;`);
    const head = t.ledger.head();
    expect(() => validateInventory(t.s, actor, session.id)).toThrow('injected second insert');
    expect([lotQty(t.db, a), lotQty(t.db, b)]).toEqual([3, 4]);
    expect(t.ledger.head()).toEqual(head);
    expect(getInventory(t.s, session.id).status).toBe('open');
    verify();
  });

  it('S-06 C-02 inventory can discover an unrecorded lot and activate a dormant product', () => {
    const session = openInventory(t.s, actor, { scope: 'complet' });
    const count = countInventory(t.s, actor, session.id, {
      product_id: productId, lot_number: 'DISCOVERED', expiry: '2028-01-01', unit_cost: 200, counted_qty: 5,
    });
    expect(lotQty(t.db, count.lot_id)).toBe(0);
    expect(payloadsOf(t.db, 'catalog.item_activated')).toEqual([{ product_id: productId, cause: 'inventory' }]);
    validateInventory(t.s, actor, session.id);
    expect(lotQty(t.db, count.lot_id)).toBe(5);
    expect(movementsOf(t.db, count.lot_id)[0]).toMatchObject({ kind: 'inventory', qty: 5 });
    verify();
  });

  it('S-06 discovered expired stock is counted but never becomes sellable', () => {
    const session = openInventory(t.s, actor, { scope: 'complet' });
    countInventory(t.s, actor, session.id, {
      product_id: productId, lot_number: 'OLD', expiry: '2020-01-01', counted_qty: 1,
    });
    validateInventory(t.s, actor, session.id);
    expect(() => writeTx(t.db, () => executeFefo(t.s, actor, [{ product_id: productId, qty: 1 }], { id: randomUUID(), payload: {} })))
      .toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    verify();
  });

  it('S-06 invalid counts and ledger errors cannot leave a discovered lot or activation behind', () => {
    const session = openInventory(t.s, actor, { scope: 'complet' });
    for (const qty of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => countInventory(t.s, actor, session.id, {
        product_id: productId, lot_number: 'A', expiry: '2028-01-01', counted_qty: qty,
      })).toThrow();
    }
    const original = t.s.ledger.append.bind(t.s.ledger);
    vi.spyOn(t.s.ledger, 'append').mockImplementation((type, user, payload) => {
      if (type === 'inventory.counted') throw new Error('count event fault');
      return original(type, user, payload);
    });
    expect(() => countInventory(t.s, actor, session.id, {
      product_id: productId, lot_number: 'A', expiry: '2028-01-01', counted_qty: 1,
    })).toThrow('count event fault');
    expect(t.db.prepare('SELECT id FROM lots').all()).toEqual([]);
    expect(payloadsOf(t.db, 'catalog.item_activated')).toEqual([]);
  });

  it('S-06 reports preserve unknown cost and redact all valuation fields without cost permission', () => {
    const a = receive(t.s, actor, { productId, lotNumber: 'A', expiry: '2028-01-01', qty: 2 }).lotId;
    const session = openInventory(t.s, actor, { scope: 'complet' });
    countInventory(t.s, actor, session.id, { lot_id: a, counted_qty: 1 });
    const report = validateInventory(t.s, actor, session.id, true);
    expect(report.total_delta_value_xaf).toBeNull();
    expect(inventoryReport(t.s, session.id)).not.toHaveProperty('total_delta_value_xaf');
    const page = listInventoryCounts(t.s, session.id);
    expect(page.items[0]).not.toHaveProperty('unit_cost');
    expect(page.items[0]).not.toHaveProperty('delta_value_xaf');
    verify();
  });
});
