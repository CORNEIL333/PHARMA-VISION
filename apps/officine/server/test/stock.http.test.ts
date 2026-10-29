import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedProduct } from './catalog.helpers.js';
import { createAndLogin, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { lotQty, makeStockApp, receive } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
let productId: string;
let lotId: string;
const headers = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
beforeEach(async () => {
  t = await makeStockApp();
  tit = await setupTitulaire(t);
  productId = randomUUID();
  seedProduct(t.db, { id: productId, name: 'HTTP stock product', rx: 0 });
  lotId = receive(t.s, tit.userId, { productId, lotNumber: 'A', expiry: '2028-01-01', qty: 4, unitCost: 317 }).lotId;
});
afterEach(async () => { await t.app.close(); t.cleanup(); });

// This harness mounts stockRoutes directly, without changing the shared application builder.
describe('S-01 to S-09 HTTP contracts and access control', () => {
  it('S-05 S-07 adjusting and destroying require fresh reauthentication and CSRF', async () => {
    const adjustment = { lot_id: lotId, qty: -1, reason: 'casse' };
    const stale = await t.app.inject({ method: 'POST', url: '/api/v1/stock/adjustments', headers: headers(tit), payload: adjustment });
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    const ok = await t.app.inject({ method: 'POST', url: '/api/v1/stock/adjustments', headers: headers(tit), payload: adjustment });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(lotQty(t.db, lotId)).toBe(3);
    t.db.prepare(`INSERT INTO recalls (id, reference, product_id, reason, source, created_by, created_at)
      VALUES (?, 'recall', ?, 'test', 'interne', ?, ?)`).run(randomUUID(), productId, tit.userId, t.clock.now().toISOString());
    t.clock.advance(5 * 60_000);
    const destruction = { lot_id: lotId, qty: 1, reason: 'recalled', pv_number: 'PV-01' };
    const denied = await t.app.inject({ method: 'POST', url: '/api/v1/stock/destructions', headers: headers(tit), payload: destruction });
    expect(denied.json()).toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    const destroyed = await t.app.inject({ method: 'POST', url: '/api/v1/stock/destructions', headers: headers(tit), payload: destruction });
    expect(destroyed.statusCode, destroyed.body).toBe(200);
    expect(lotQty(t.db, lotId)).toBe(2);
    const mutations = t.app.routeTable.filter((r) => /\/stock\/|\/inventories|\/thresholds/.test(r.url) && ['POST', 'PATCH'].includes(r.method));
    for (const route of mutations) {
      const res = await t.app.inject({ method: route.method as 'POST', url: route.url.replace(':id', productId), headers: { cookie: tit.cookie }, payload: {} });
      expect(res.statusCode, route.url).toBe(403);
      expect(res.json()).toMatchObject({ code: 'csrf_failed' });
    }
  });

  it('S-08 cashiers cannot read stock costs and preparateurs receive no cost or valuation fields', async () => {
    const prep = await createAndLogin(t, tit, 'prepstock', 'preparateur');
    const cashier = await createAndLogin(t, tit, 'cashstock', 'caissier');
    for (const url of [`/api/v1/stock/lots?product_id=${productId}`, '/api/v1/stock/value', '/api/v1/stock/movements']) {
      const r = await t.app.inject({ url, headers: headers(cashier) });
      expect(r.statusCode).toBe(403);
      expect(r.body).not.toContain('317');
      expect(r.body).not.toContain('unit_cost');
    }
    const p = await t.app.inject({ url: '/api/v1/stock/lots', headers: headers(prep) });
    expect(p.statusCode).toBe(200);
    expect(p.body).not.toContain('unit_cost');
    expect(p.body).not.toContain('value_xaf');
    const forbidden = await t.app.inject({ url: '/api/v1/stock/value', headers: headers(prep) });
    expect(forbidden.statusCode).toBe(403);
    const owner = await t.app.inject({ url: '/api/v1/stock/lots', headers: headers(tit) });
    expect(owner.json().items[0]).toMatchObject({ unit_cost: 317 });
    const valuation = await t.app.inject({ url: '/api/v1/stock/value', headers: headers(tit) });
    expect(valuation.json()).toMatchObject({ total_value_xaf: 1268 });
  });

  it('S-06 preparateurs can count but only pharmacists and owners can validate', async () => {
    const prep = await createAndLogin(t, tit, 'prepinventory', 'preparateur');
    const pharmacist = await createAndLogin(t, tit, 'pharminventory', 'pharmacien');
    const opened = await t.app.inject({ method: 'POST', url: '/api/v1/inventories', headers: headers(prep), payload: { scope: 'complet' } });
    expect(opened.statusCode, opened.body).toBe(201);
    const id = opened.json().id as string;
    const counted = await t.app.inject({ method: 'POST', url: `/api/v1/inventories/${id}/counts`, headers: headers(prep), payload: { lot_id: lotId, counted_qty: 2 } });
    expect(counted.statusCode, counted.body).toBe(200);
    expect(counted.body).not.toContain('unit_cost');
    const denied = await t.app.inject({ method: 'POST', url: `/api/v1/inventories/${id}/validate`, headers: headers(prep), payload: {} });
    expect(denied.statusCode).toBe(403);
    const valid = await t.app.inject({ method: 'POST', url: `/api/v1/inventories/${id}/validate`, headers: headers(pharmacist), payload: {} });
    expect(valid.statusCode, valid.body).toBe(200);
    expect(valid.json()).toMatchObject({ total_delta_value_xaf: -634 });
    for (const url of [`/api/v1/inventories/${id}`, `/api/v1/inventories/${id}/counts`]) {
      const r = await t.app.inject({ url, headers: headers(prep) });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain('unit_cost');
      expect(r.body).not.toContain('value_xaf');
    }
    expect(lotQty(t.db, lotId)).toBe(2);
  });

  it('S-09 thresholds use price.edit and reject invalid schemas and ranges', async () => {
    const prep = await createAndLogin(t, tit, 'prepthreshold', 'preparateur');
    const pharm = await createAndLogin(t, tit, 'pharmthreshold', 'pharmacien');
    const url = `/api/v1/products/${productId}/thresholds`;
    const no = await t.app.inject({ method: 'PATCH', url, headers: headers(prep), payload: { min_qty: 2, max_qty: 8 } });
    expect(no.statusCode).toBe(403);
    const yes = await t.app.inject({ method: 'PATCH', url, headers: headers(pharm), payload: { min_qty: 2, max_qty: 8 } });
    expect(yes.statusCode, yes.body).toBe(200);
    expect(yes.json()).toMatchObject({ product_id: productId, min_qty: 2, max_qty: 8 });
    for (const payload of [
      { min_qty: -1, max_qty: 2 }, { min_qty: 3, max_qty: 2 }, { min_qty: 0.5, max_qty: 2 },
      { min_qty: 1, max_qty: 2, role: 'titulaire' }, { min_qty: 1 },
    ]) expect((await t.app.inject({ method: 'PATCH', url, headers: headers(pharm), payload })).statusCode).toBe(400);
  });

  it('S-05 S-07 routes reject unknown keys, missing reasons, fractional and zero quantities', async () => {
    await reauth(t, tit, STRONG, tit.totpSecret);
    for (const payload of [
      { lot_id: lotId, qty: 0, reason: 'casse' }, { lot_id: lotId, qty: 0.5, reason: 'casse' },
      { lot_id: lotId, qty: 1, reason: 'other' }, { lot_id: lotId, qty: 1, reason: 'autre' },
      { lot_id: lotId, qty: 1, reason: 'casse', unit_cost: 1 },
    ]) expect((await t.app.inject({ method: 'POST', url: '/api/v1/stock/adjustments', headers: headers(tit), payload })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/stock/destructions', headers: headers(tit), payload: { lot_id: lotId, qty: 1, reason: 'expired' } })).statusCode).toBe(400);
    expect(lotQty(t.db, lotId)).toBe(4);
  });
});
