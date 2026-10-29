import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demandToOrder, listDemand, recordDemand, summarizeDemand } from '../src/domain/demand.js';
import { createOrder, getOrder, sendOrder } from '../src/domain/orders.js';
import { recordReception, returnToSupplier } from '../src/domain/receptions.js';
import { verifyLedger } from '../src/domain/verify.js';
import { seedProduct } from './catalog.helpers.js';
import { createAndLogin, keyMap, makeApp, setupTitulaire, type Agent, type TestApp } from './helpers.js';
import { seedSupplier } from './orders.helpers.js';
import { lotQty, movementsOf, payloadsOf } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
let p1: string;
let p2: string;
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const line = (product_id: string, lot: string, qty: number, expiry = '2028-01-31', unit_cost: number | null = 250) =>
  ({ product_id, lot_number: lot, expiry, qty, unit_cost });
function verify() {
  expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
}

beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
  p1 = randomUUID();
  p2 = randomUUID();
  seedProduct(t.db, { id: p1, name: 'Amoxicilline 500', criticity: 1 });
  seedProduct(t.db, { id: p2, name: 'Paracétamol 500', criticity: 3 });
  seedSupplier(t.db, { id: 'sp1', name: 'Grossiste A' });
});
afterEach(() => { vi.restoreAllMocks(); t.cleanup(); });

describe('R-04 réception avec ou sans bon de commande', () => {
  it('R-04 sans bon : lots créés, mouvements reception, activation C-02 et événement reception.recorded', () => {
    const r = recordReception(t.s, tit.userId, { supplier_id: 'sp1', lines: [line(p1, 'A1', 10), line(p2, 'B1', 5, '2028-03-31', null)] }, true);
    expect(r.lines).toHaveLength(2);
    const a1 = r.lines.find((l) => l.lot_number === 'A1')!;
    expect(lotQty(t.db, a1.lot_id)).toBe(10);
    expect(movementsOf(t.db, a1.lot_id)).toEqual([expect.objectContaining({ qty: 10, kind: 'reception' })]);
    expect(payloadsOf(t.db, 'catalog.item_activated').map((x) => x.cause)).toEqual(['reception', 'reception']);
    const ev = payloadsOf(t.db, 'reception.recorded')[0]!;
    expect(ev).toMatchObject({ reception_id: r.id, po_id: null, supplier_id: 'sp1' });
    expect(ev.lines).toEqual(expect.arrayContaining([expect.objectContaining({ lot_number: 'A1', qty: 10, unit_cost: 250, expiry: '2028-01-31' })]));
    verify();
  });

  it('R-04 avec bon : qty_received mise à jour, bon partiel puis reçu', () => {
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: p1, qty: 10 }, { product_id: p2, qty: 4 }] });
    expect(() => recordReception(t.s, tit.userId, { po_id: o.id, lines: [line(p1, 'A1', 1)] }))
      .toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    sendOrder(t.s, tit.userId, o.id);
    recordReception(t.s, tit.userId, { po_id: o.id, lines: [line(p1, 'A1', 6)] });
    expect(getOrder(t.s, o.id)).toMatchObject({ status: 'partial' });
    recordReception(t.s, tit.userId, { po_id: o.id, lines: [line(p1, 'A2', 4, '2028-02-29'), line(p2, 'B1', 4)] });
    const done = getOrder(t.s, o.id);
    expect(done.status).toBe('received');
    expect(done.closed_at).not.toBeNull();
    expect(done.lines.map((l) => l.qty_received).sort()).toEqual([10, 4].sort());
    expect(() => recordReception(t.s, tit.userId, { po_id: o.id, lines: [line(p1, 'A3', 1)] }))
      .toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    verify();
  });

  it('R-04 un produit hors du bon est refusé et rien n’est écrit', () => {
    const p3 = randomUUID();
    seedProduct(t.db, { id: p3, name: 'Hors bon' });
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: p1, qty: 2 }] });
    sendOrder(t.s, tit.userId, o.id);
    const head = t.ledger.head();
    expect(() => recordReception(t.s, tit.userId, { po_id: o.id, lines: [line(p1, 'A1', 1), line(p3, 'X', 1)] })).toThrow();
    expect(t.ledger.head()).toEqual(head);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM lots').get()).toEqual({ n: 0 });
    expect(getOrder(t.s, o.id).lines[0]!.qty_received).toBe(0);
  });
});

describe('R-05 lots périmés, rappelés ou proches de la péremption', () => {
  it('R-05 lot périmé ou rappelé refusé ; moins de 90 jours exige une confirmation', () => {
    expect(() => recordReception(t.s, tit.userId, { lines: [line(p1, 'OLD', 1, '2026-10-01')] }))
      .toThrow(expect.objectContaining({ code: 'expired_lot' }));
    t.db.prepare(`INSERT INTO recalls (id, reference, product_id, lot_number, reason, source, created_by, created_at)
      VALUES (?, 'DPML-1', ?, 'BAD', 'contamination', 'DPML', ?, ?)`).run(randomUUID(), p1, tit.userId, t.clock.now().toISOString());
    expect(() => recordReception(t.s, tit.userId, { lines: [line(p1, 'BAD', 1)] }))
      .toThrow(expect.objectContaining({ code: 'recalled_lot' }));
    expect(() => recordReception(t.s, tit.userId, { lines: [line(p1, 'NEAR', 1, '2026-12-15')] }))
      .toThrow(expect.objectContaining({ code: 'validation_failed', extra: { reason: 'near_expiry_confirmation_required' } }));
    const ok = recordReception(t.s, tit.userId, { lines: [{ ...line(p1, 'NEAR', 1, '2026-12-15'), confirm_near_expiry: true }] });
    expect(ok.lines).toHaveLength(1);
    verify();
  });
});

describe('R-06 retour fournisseur', () => {
  it('R-06 mouvement return_supplier avec motif ; jamais sous zéro', () => {
    const r = recordReception(t.s, tit.userId, { lines: [line(p1, 'A1', 5)] });
    const lot = r.lines[0]!.lot_id;
    expect(returnToSupplier(t.s, tit.userId, { supplier_id: 'sp1', lot_id: lot, qty: 2, reason: 'Colis abîmé' })).toEqual({ lot_id: lot, qty: 3 });
    expect(movementsOf(t.db, lot).at(-1)).toMatchObject({ qty: -2, kind: 'return_supplier' });
    expect(payloadsOf(t.db, 'stock.returned_to_supplier')[0]).toMatchObject({ supplier_id: 'sp1', reason: 'Colis abîmé' });
    expect(() => returnToSupplier(t.s, tit.userId, { supplier_id: 'sp1', lot_id: lot, qty: 4, reason: 'x' }))
      .toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    expect(() => returnToSupplier(t.s, tit.userId, { supplier_id: 'sp1', lot_id: lot, qty: 1, reason: ' ' })).toThrow();
    verify();
  });
});

describe('D-01 D-02 D-03 demandes non satisfaites', () => {
  it('D-01 demand.unmet porte la criticité du produit ; texte libre accepté', () => {
    const d = recordDemand(t.s, tit.userId, { product_id: p1, qty: 2, note: 'urgent' });
    expect(d).toMatchObject({ product_id: p1, criticity: 1, qty: 2, resolved_at: null });
    recordDemand(t.s, tit.userId, { free_text: 'Sirop introuvable' });
    expect(payloadsOf(t.db, 'demand.unmet')).toEqual([
      expect.objectContaining({ product_id: p1, criticity: 1, qty: 2, source: 'comptoir' }),
      expect.objectContaining({ product_id: null, free_text: 'Sirop introuvable', criticity: 3 }),
    ]);
    expect(() => recordDemand(t.s, tit.userId, {})).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    verify();
  });

  it('D-02 liste par période et par produit ; synthèse par criticité ; ajout au brouillon de commande', () => {
    recordDemand(t.s, tit.userId, { product_id: p2 });
    t.clock.advance(60_000);
    recordDemand(t.s, tit.userId, { product_id: p1, qty: 3 });
    recordDemand(t.s, tit.userId, { product_id: p1, qty: 1 });
    expect(listDemand(t.s).items).toHaveLength(3);
    expect(listDemand(t.s, { product_id: p1 }).items).toHaveLength(2);
    expect(listDemand(t.s, { from: t.clock.now().toISOString() }).items).toHaveLength(2);
    expect(summarizeDemand(t.s)[0]).toMatchObject({ product_id: p1, criticity: 1, requests: 2, qty: 4, open: 2 });
    const [a, b] = listDemand(t.s, { product_id: p1 }).items;
    const o1 = demandToOrder(t.s, tit.userId, a!.id, 'sp1');
    const o2 = demandToOrder(t.s, tit.userId, b!.id, 'sp1');
    expect(o2.id).toBe(o1.id);
    expect(getOrder(t.s, o1.id).lines).toEqual([expect.objectContaining({ product_id: p1, qty_ordered: 4 })]);
    verify();
  });

  it('D-03 la réception du produit résout les demandes ouvertes (demand.resolved)', () => {
    const d = recordDemand(t.s, tit.userId, { product_id: p1 });
    recordDemand(t.s, tit.userId, { product_id: p2 });
    const r = recordReception(t.s, tit.userId, { lines: [line(p1, 'A1', 3)] });
    expect(listDemand(t.s, { status: 'resolved' }).items).toEqual([expect.objectContaining({ id: d.id, resolved_cause: 'reception' })]);
    expect(listDemand(t.s).items.map((x) => x.product_id)).toEqual([p2]);
    expect(payloadsOf(t.db, 'demand.resolved')).toEqual([{ demand_id: d.id, product_id: p1, cause: 'reception', ref: r.id }]);
    verify();
  });

  it('D-01 D-02 HTTP : le caissier saisit, ne liste pas ; coûts de réception masqués au préparateur', async () => {
    const cashier = await createAndLogin(t, tit, 'caisse1', 'caissier');
    const prep = await createAndLogin(t, tit, 'prep1', 'preparateur');
    const created = await t.app.inject({ method: 'POST', url: '/api/v1/demand', headers: H(cashier), payload: { product_id: p1 } });
    expect(created.statusCode, created.body).toBe(201);
    expect((await t.app.inject({ url: '/api/v1/demand', headers: H(cashier) })).statusCode).toBe(403);
    expect((await t.app.inject({ url: '/api/v1/demand', headers: H(prep) })).json().items).toHaveLength(1);
    const rec = await t.app.inject({ method: 'POST', url: '/api/v1/receptions', headers: H(prep), payload: { lines: [line(p1, 'A1', 2)] } });
    expect(rec.statusCode, rec.body).toBe(201);
    expect(rec.body).not.toContain('unit_cost');
    const own = await t.app.inject({ url: `/api/v1/receptions/${rec.json().id}`, headers: H(tit) });
    expect(own.json().lines[0]).toMatchObject({ unit_cost: 250 });
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/receptions', headers: H(cashier), payload: { lines: [line(p1, 'A2', 1)] } })).statusCode).toBe(403);
    const near = await t.app.inject({ method: 'POST', url: '/api/v1/receptions', headers: H(prep), payload: { lines: [line(p1, 'N', 1, '2026-11-20')] } });
    expect(near.statusCode).toBe(400);
    expect(near.json()).toMatchObject({ reason: 'near_expiry_confirmation_required' });
  });
});
