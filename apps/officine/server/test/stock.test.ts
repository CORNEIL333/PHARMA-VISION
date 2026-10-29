import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeTx } from '../src/db/index.js';
import {
  adjustStock, appendStockEvent, changeThresholds, destroyStock, enterLot, executeFefo,
  listLots, listMovements, loadStockPolicy, quoteFefo, stockValue, withdrawFefo,
} from '../src/domain/stock.js';
import { verifyLedger } from '../src/domain/verify.js';
import { seedProduct } from './catalog.helpers.js';
import { keyMap, makeApp, setupTitulaire, type TestApp } from './helpers.js';
import { lotQty, movementsOf, payloadsOf, raceFefo, receive, seedLot } from './stock.helpers.js';

let t: TestApp;
let actor: string;
let productId: string;
beforeEach(async () => {
  t = await makeApp();
  actor = (await setupTitulaire(t)).userId;
  productId = randomUUID();
  seedProduct(t.db, { id: productId, name: 'Stock test', rx: 0 });
});
afterEach(() => { vi.restoreAllMocks(); t.cleanup(); });

function receiveLot(number: string, qty: number, expiry = '2027-12-31', cost = 100) {
  return receive(t.s, actor, { productId, lotNumber: number, qty, expiry, unitCost: cost }).lotId;
}
function sell(qty: number) {
  return writeTx(t.db, () => executeFefo(t.s, actor, [{ product_id: productId, qty }], {
    id: randomUUID(), payload: { source: 'stock_test' },
  }));
}
function verify() {
  expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
}

// Written before the domain implementation; execution is intentionally deferred to Verify.
describe('S-01 append-only stock and atomic integration primitives', () => {
  it('S-01 stock equals signed movements; UPDATE and DELETE fail in SQLite', () => {
    const lot = receiveLot('A', 6);
    adjustStock(t.s, actor, { lot_id: lot, qty: -2, reason: 'casse' });
    expect(lotQty(t.db, lot)).toBe(4);
    expect(movementsOf(t.db, lot).map((m) => m.qty)).toEqual([6, -2]);
    expect(() => t.db.prepare('UPDATE stock_movements SET qty = ? WHERE lot_id = ?').run(100, lot)).toThrow();
    expect(() => t.db.prepare('DELETE FROM stock_movements WHERE lot_id = ?').run(lot)).toThrow();
    verify();
  });

  it('S-01 C-02 lot entry activates the product and preserves immutable lot cost and expiry', () => {
    const lot = receiveLot('A', 3);
    expect(receiveLot('A', 2)).toBe(lot);
    expect(lotQty(t.db, lot)).toBe(5);
    expect(payloadsOf(t.db, 'catalog.item_activated')).toEqual([{ product_id: productId, cause: 'reception' }]);
    const head = t.ledger.head();
    expect(() => receiveLot('A', 1, '2027-12-31', 200)).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    expect(() => receiveLot('A', 1, '2028-01-01')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    expect(t.ledger.head()).toEqual(head);
    expect(lotQty(t.db, lot)).toBe(5);
    verify();
  });

  it('S-01 reception rejects recalled, expired, unknown-expiry and unconfirmed near-expiry lots', () => {
    expect(() => receiveLot('old', 1, '2026-10-26')).toThrow(expect.objectContaining({ code: 'expired_lot' }));
    expect(() => receiveLot('near', 1, '2026-11-01')).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    expect(() => receive(t.s, actor, { productId, lotNumber: 'none', qty: 1 })).toThrow();
    expect(() => receiveLot('bad', 1, '2027-02-30')).toThrow();
    t.db.prepare(`INSERT INTO recalls (id, reference, product_id, reason, source, created_by, created_at)
      VALUES (?, 'recall', ?, 'test', 'interne', ?, ?)`).run(randomUUID(), productId, actor, t.clock.now().toISOString());
    expect(() => receiveLot('recalled', 1)).toThrow(expect.objectContaining({ code: 'recalled_lot' }));
    expect(t.db.prepare('SELECT id FROM lots').all()).toEqual([]);
  });

  it('S-01 entering a lot requires the caller transaction and rolls back activation on a later error', () => {
    const input = { product_id: productId, lot_number: 'A', expiry: '2028-01-01', unit_cost: 100, qty: 2, kind: 'reception' as const };
    expect(() => enterLot(t.s, actor, input, 'reception')).toThrow(/transaction/i);
    const head = t.ledger.head();
    expect(() => writeTx(t.db, () => {
      const entry = enterLot(t.s, actor, input, 'reception');
      appendStockEvent(t.s, 'reception.recorded', actor, {}, [entry.movement]);
      throw new Error('injected');
    })).toThrow('injected');
    expect(t.db.prepare('SELECT id FROM lots').all()).toEqual([]);
    expect(t.ledger.head()).toEqual(head);
    expect(t.db.prepare('SELECT status FROM products WHERE id = ?').get(productId)).toEqual({ status: 'dormant' });
  });
});

describe('S-02 S-03 FEFO quote and execution', () => {
  it('S-02 quote takes the earliest expiry, is read-only and excludes unsafe or empty lots', () => {
    const a = receiveLot('A', 2, '2028-01-01');
    const b = receiveLot('B', 2, '2027-11-01');
    const c = receiveLot('C', 2, '2027-10-01');
    t.db.prepare(`INSERT INTO recalls (id, reference, product_id, lot_number, reason, source, created_by, created_at)
      VALUES (?, 'recall', ?, 'C', 'test', 'interne', ?, ?)`).run(randomUUID(), productId, actor, t.clock.now().toISOString());
    seedLot(t.db, { id: randomUUID(), productId, lotNumber: 'unknown' });
    seedLot(t.db, { id: randomUUID(), productId, lotNumber: 'empty', expiry: '2027-01-01' });
    seedLot(t.db, { id: randomUUID(), productId, lotNumber: 'REGUL', isRegul: 1 });
    const head = t.ledger.head();
    expect(quoteFefo(t.s, productId, 3).map((x) => [x.lot_id, x.qty])).toEqual([[b, 2], [a, 1]]);
    expect(lotQty(t.db, c)).toBe(2);
    expect(t.ledger.head()).toEqual(head);
  });

  it('S-02 applies a nonnegative expiry buffer at Douala midnight; missing dates fail closed', () => {
    receiveLot('A', 3, '2027-06-01');
    t.clock.set('2027-05-31T23:00:00.000Z');
    expect(quoteFefo(t.s, productId, 1)).toHaveLength(1);
    expect(() => quoteFefo({ ...t.s, stockPolicy: { expiryBlockDays: 1 } }, productId, 1))
      .toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    t.clock.set('2027-06-01T23:00:00.000Z');
    expect(() => quoteFefo(t.s, productId, 1)).toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    expect(loadStockPolicy({ VP_EXPIRY_BLOCK_DAYS: '7' })).toEqual({ expiryBlockDays: 7 });
    for (const value of ['-1', '1.5', 'bad', 'Infinity']) {
      expect(() => loadStockPolicy({ VP_EXPIRY_BLOCK_DAYS: value })).toThrow();
    }
  });

  it('S-02 equal expiry is ordered by receipt time then lot identifier', () => {
    const first = receiveLot('Z', 1);
    t.clock.advance(1000);
    const second = receiveLot('A', 1);
    expect(quoteFefo(t.s, productId, 2).map((x) => x.lot_id)).toEqual([first, second]);
  });

  it('S-03 a sale spans three lots, emits one signed movement per lot and one event', () => {
    const a = receiveLot('A', 2, '2028-03-01');
    const b = receiveLot('B', 3, '2028-02-01');
    const c = receiveLot('C', 4, '2028-01-01');
    const result = sell(8);
    expect(result.movements.map((m) => [m.lot_id, m.qty, m.kind])).toEqual([[c, -4, 'sale'], [b, -3, 'sale'], [a, -1, 'sale']]);
    expect([a, b, c].map((id) => lotQty(t.db, id))).toEqual([1, 0, 0]);
    const event = payloadsOf(t.db, 'sale.completed')[0];
    expect(event?.movements).toEqual(result.movements.map(({ lot_id, qty, kind }) => ({ lot_id, qty, kind })));
    verify();
  });

  it('S-03 duplicate basket products are aggregated before allocation', () => {
    const a = receiveLot('A', 5);
    const result = writeTx(t.db, () => executeFefo(t.s, actor, [
      { product_id: productId, qty: 2 }, { product_id: productId, qty: 2 },
    ], { id: randomUUID(), payload: {} }));
    expect(result.movements).toHaveLength(1);
    expect(lotQty(t.db, a)).toBe(1);
    expect(() => sell(2)).toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    verify();
  });

  it('S-02 execution rechecks a stale quote and rejects a recall created after planning', () => {
    receiveLot('A', 1);
    expect(quoteFefo(t.s, productId, 1)).toHaveLength(1);
    t.db.prepare(`INSERT INTO recalls (id, reference, product_id, reason, source, created_by, created_at)
      VALUES (?, 'recall', ?, 'test', 'interne', ?, ?)`).run(randomUUID(), productId, actor, t.clock.now().toISOString());
    expect(() => sell(1)).toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    expect(payloadsOf(t.db, 'sale.completed')).toEqual([]);
  });
});

describe('S-04 non-negativity and real concurrency', () => {
  it('S-04 only one of two independent SQLite connections can sell the last unit', async () => {
    const lot = receiveLot('last', 1);
    const result = await raceFefo({ dir: t.dir, productId, userId: actor, qty: 1 });
    expect(result.filter((x) => x.ok)).toHaveLength(1);
    expect(result.filter((x) => !x.ok)).toEqual([{ ok: false, code: 'insufficient_stock' }]);
    expect(lotQty(t.db, lot)).toBe(0);
    expect(movementsOf(t.db, lot).filter((m) => m.kind === 'sale')).toHaveLength(1);
    verify();
  });

  it('S-04 negative stock is rejected except on an explicit technical regul lot', () => {
    const a = receiveLot('A', 1);
    expect(() => adjustStock(t.s, actor, { lot_id: a, qty: -2, reason: 'erreur_saisie' }))
      .toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    const regul = randomUUID();
    seedLot(t.db, { id: regul, productId, lotNumber: 'REGUL', isRegul: 1 });
    adjustStock(t.s, actor, { lot_id: regul, qty: -2, reason: 'erreur_saisie' });
    expect(lotQty(t.db, regul)).toBe(-2);
    expect(() => quoteFefo(t.s, productId, 2)).toThrow();
    verify();
  });

  it('S-04 staged duplicate withdrawals cannot oversell when appended together', () => {
    const lot = receiveLot('A', 1);
    const head = t.ledger.head();
    expect(() => writeTx(t.db, () => {
      const m = withdrawFefo(t.s, { product_id: productId, qty: 1, user_id: actor });
      appendStockEvent(t.s, 'sale.completed', actor, {}, [...m, ...m]);
    })).toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    expect(lotQty(t.db, lot)).toBe(1);
    expect(t.ledger.head()).toEqual(head);
  });
});

describe('S-05 S-07 adjustments and destruction', () => {
  it('S-05 signed adjustments require an enumerated reason, autre requires text', () => {
    const lot = receiveLot('A', 4);
    for (const reason of ['casse', 'vol', 'erreur_saisie', 'don'] as const) {
      adjustStock(t.s, actor, { lot_id: lot, qty: 1, reason });
    }
    adjustStock(t.s, actor, { lot_id: lot, qty: -2, reason: 'autre', reason_text: 'Physical recount' });
    expect(lotQty(t.db, lot)).toBe(6);
    const head = t.ledger.head();
    for (const input of [
      { lot_id: lot, qty: 0, reason: 'casse' }, { lot_id: lot, qty: 0.5, reason: 'casse' },
      { lot_id: lot, qty: 1, reason: '' }, { lot_id: lot, qty: 1, reason: 'unknown' },
      { lot_id: lot, qty: 1, reason: 'autre', reason_text: '   ' },
    ]) expect(() => adjustStock(t.s, actor, input)).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    expect(t.ledger.head()).toEqual(head);
    expect(payloadsOf(t.db, 'stock.adjusted').at(-1)).toMatchObject({ reason: 'autre', reason_text: 'Physical recount' });
    verify();
  });

  it('S-05 ledger failure rolls back stock and no partial event remains', () => {
    const lot = receiveLot('A', 4);
    const head = t.ledger.head();
    vi.spyOn(t.s.ledger, 'append').mockImplementation(() => { throw new Error('ledger fault'); });
    expect(() => adjustStock(t.s, actor, { lot_id: lot, qty: 2, reason: 'don' })).toThrow('ledger fault');
    expect(lotQty(t.db, lot)).toBe(4);
    expect(t.ledger.head()).toEqual(head);
  });

  it('S-07 destruction is restricted to expired or recalled stock with reason and PV', () => {
    const lot = receiveLot('A', 4, '2027-06-01');
    expect(() => destroyStock(t.s, actor, { lot_id: lot, qty: 2, reason: 'expired', pv_number: 'PV-1' }))
      .toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    t.clock.set('2027-06-02T09:00:00.000Z');
    for (const payload of [
      { lot_id: lot, qty: 2, reason: '', pv_number: 'PV-1' },
      { lot_id: lot, qty: 2, reason: 'expired', pv_number: ' ' },
      { lot_id: lot, qty: -2, reason: 'expired', pv_number: 'PV-1' },
    ]) expect(() => destroyStock(t.s, actor, payload)).toThrow();
    destroyStock(t.s, actor, { lot_id: lot, qty: 2, reason: 'expired', pv_number: 'PV-1' });
    expect(lotQty(t.db, lot)).toBe(2);
    expect(payloadsOf(t.db, 'stock.destroyed')).toEqual([expect.objectContaining({
      reason: 'expired', pv_number: 'PV-1', movements: [{ lot_id: lot, qty: -2, kind: 'destroy' }],
    })]);
    verify();
  });

  it('S-07 recalled stock is destructible before expiry but cannot be overdrawn', () => {
    const lot = receiveLot('A', 2);
    t.db.prepare(`INSERT INTO recalls (id, reference, product_id, lot_number, reason, source, created_by, created_at)
      VALUES (?, 'recall', ?, 'A', 'test', 'interne', ?, ?)`).run(randomUUID(), productId, actor, t.clock.now().toISOString());
    expect(() => destroyStock(t.s, actor, { lot_id: lot, qty: 3, reason: 'recalled', pv_number: 'PV-2' })).toThrow();
    destroyStock(t.s, actor, { lot_id: lot, qty: 2, reason: 'recalled', pv_number: 'PV-2' });
    expect(lotQty(t.db, lot)).toBe(0);
    verify();
  });
});

describe('S-08 S-09 values, thresholds and bounded reads', () => {
  it('S-08 valuation uses each lot cost; unknown cost is explicit, never silently zero', () => {
    receiveLot('A', 3, '2028-01-01', 100);
    receiveLot('B', 4, '2028-02-01', 250);
    expect(stockValue(t.s, productId)).toMatchObject({ known_value_xaf: 1300, total_value_xaf: 1300, unknown_cost_qty: 0 });
    receive(t.s, actor, { productId, lotNumber: 'C', expiry: '2028-03-01', qty: 2, unitCost: null });
    expect(stockValue(t.s, productId)).toMatchObject({ known_value_xaf: 1300, total_value_xaf: null, unknown_cost_qty: 2 });
    expect(listLots(t.s, { product_id: productId }, false).items.every((x) => !('unit_cost' in x))).toBe(true);
    expect(listLots(t.s, { product_id: productId }, true).items.some((x) => x.unit_cost === 250)).toBe(true);
  });

  it('S-09 validates min/max integers and records exactly one event per actual change', () => {
    expect(changeThresholds(t.s, actor, productId, { min_qty: 2, max_qty: 8 })).toMatchObject({ min_qty: 2, max_qty: 8 });
    changeThresholds(t.s, actor, productId, { min_qty: 2, max_qty: 8 });
    for (const input of [{ min_qty: -1, max_qty: 8 }, { min_qty: 9, max_qty: 8 }, { min_qty: 0.5, max_qty: 8 }]) {
      expect(() => changeThresholds(t.s, actor, productId, input)).toThrow();
    }
    expect(payloadsOf(t.db, 'catalog.thresholds_changed')).toEqual([expect.objectContaining({ product_id: productId, min: 2, max: 8 })]);
    expect(t.db.prepare('SELECT status FROM products WHERE id = ?').get(productId)).toEqual({ status: 'dormant' });
    verify();
  });

  it('S-01 stock lists use bounded cursors without duplicates', () => {
    receiveLot('A', 1); receiveLot('B', 1); receiveLot('C', 1);
    const a = listLots(t.s, { product_id: productId, limit: 2 });
    const b = listLots(t.s, { product_id: productId, limit: 2, cursor: a.next_cursor! });
    expect(new Set([...a.items, ...b.items].map((x) => x.lot_id)).size).toBe(3);
    expect(b.next_cursor).toBeNull();
    const m = listMovements(t.s, { product_id: productId, limit: 2 });
    expect(listMovements(t.s, { product_id: productId, cursor: m.next_cursor!, limit: 2 }).items).toHaveLength(1);
    expect(() => listLots(t.s, { limit: 101 })).toThrow();
    expect(() => listMovements(t.s, { cursor: 'invalid' })).toThrow();
    expect(() => listMovements(t.s, { from: '2028-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' })).toThrow();
  });
});
