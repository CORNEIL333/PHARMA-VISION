import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeCashSession } from '../src/domain/cash.js';
import { recordDemand } from '../src/domain/demand.js';
import { createPrescription } from '../src/domain/prescriptions.js';
import {
  cashCloseReport, complianceReport, deadStockReport, expiryReport, fraudReport, period, salesReport, stockValueReport,
  toCsv, unmetDemandReport,
} from '../src/domain/reports.js';
import { createSale, voidSale } from '../src/domain/sales.js';
import { updateSettings } from '../src/domain/settings.js';
import { adjustStock, destroyStock } from '../src/domain/stock.js';
import { createRecall } from '../src/domain/recalls.js';
import { createAndLogin, makeApp, setupTitulaire, type Agent, type TestApp } from './helpers.js';
import { cash, openRegister, sell, stockedProduct } from './sales.helpers.js';
import { receive } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

describe('P-01 clôture de caisse', () => {
  it('P-01 ventes par mode, tickets, annulations (motif, auteur), remises, régularisation, attendu, compté, écart', () => {
    const a = stockedProduct(t, tit.userId, { qty: 20 });
    const regul = randomUUID();
    t.db.prepare(`INSERT INTO products (id, name, category, sale_price, status, search_text, created_at, updated_at)
      VALUES (?, 'Régul', 'autre', 300, 'active', 'regul', ?, ?)`).run(regul, t.clock.now().toISOString(), t.clock.now().toISOString());
    const session = openRegister(t, tit.userId, 'C1', 5000);
    sell(t, tit.userId, session, [{ product_id: a.productId, qty: 2 }], 2000);
    createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: a.productId, qty: 1 }], payments: [{ method: 'carte', amount: 1000, reference: 'TPE-9' }] });
    createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: a.productId, qty: 1 }], payments: cash(900), discount: { amount: 100, reason: 'fidélité' } });
    sell(t, tit.userId, session, [{ product_id: regul, qty: 1 }], 300);
    const v = sell(t, tit.userId, session, [{ product_id: a.productId, qty: 1 }], 1000);
    voidSale(t.s, tit.userId, v.id, 'Mauvais produit');
    closeCashSession(t.s, tit.userId, session, { counted_cash: 8000 });
    const r = cashCloseReport(t.s, session);
    expect(r).toMatchObject({ provisional: false, tickets: 4, gross: 4300, discounts: 100, revenue: 4200, expected_cash: 8200, counted_cash: 8000, variance: -200 });
    expect(r.by_method).toEqual([{ method: 'carte', count: 1, amount: 1000 }, { method: 'especes', count: 3, amount: 3200 }]);
    expect(r.voids).toEqual([expect.objectContaining({ reason: 'Mauvais produit', voided_by: 'Dr Mballa', total: 1000 })]);
    expect(r.discount_lines).toEqual([expect.objectContaining({ amount: 100, reason: 'fidélité' })]);
    expect(r.regul_sales).toHaveLength(1);
  });

  it('P-01 le caissier voit sa clôture, pas celle d’un autre', async () => {
    const cashier = await createAndLogin(t, tit, 'caisse', 'caissier');
    const other = openRegister(t, tit.userId, 'C1');
    const own = await t.app.inject({ method: 'POST', url: '/api/v1/cash/sessions', headers: H(cashier), payload: { register: 'C2', opening_float: 0 } });
    expect((await t.app.inject({ url: `/api/v1/reports/cash-close/${own.json().id}`, headers: H(cashier) })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/api/v1/reports/cash-close/${other}`, headers: H(cashier) })).statusCode).toBe(403);
  });
});

describe('P-02 P-04 P-05 stock', () => {
  it('P-02 lots périmés et à 30/60/90 jours, valeur au coût seulement avec cost.view', async () => {
    const p = stockedProduct(t, tit.userId, { expiry: '2026-11-10', cost: 100, qty: 3 });
    receive(t.s, tit.userId, { productId: p.productId, lotNumber: 'L60', qty: 2, expiry: '2026-12-20', unitCost: 50, confirmNearExpiry: true });
    receive(t.s, tit.userId, { productId: p.productId, lotNumber: 'L90', qty: 1, expiry: '2027-01-20', unitCost: 10, confirmNearExpiry: true });
    receive(t.s, tit.userId, { productId: p.productId, lotNumber: 'LOIN', qty: 1, expiry: '2028-01-20', unitCost: 10 });
    const prep = await createAndLogin(t, tit, 'prep', 'preparateur');
    const http = await t.app.inject({ url: '/api/v1/reports/expiry?days=90', headers: H(prep) });
    expect(http.statusCode).toBe(200);
    expect(http.body).toContain('L1');
    expect(http.body).not.toContain('value_xaf');
    t.clock.set('2026-11-12T08:00:00.000Z');
    const r = expiryReport(t.s, 90, true);
    expect(r.rows.map((x) => [x.lot_number, x.bucket, x.qty, x.value_xaf])).toEqual([['L1', 'perime', 3, 300], ['L60', '60', 2, 100], ['L90', '90+', 1, 10]]);
    expect(expiryReport(t.s, 90, false).rows[0]).not.toHaveProperty('value_xaf');
  });

  it('P-04 stock valorisé par lot au coût d’achat ; P-05 stock immobilisé depuis 90 jours', () => {
    const a = stockedProduct(t, tit.userId, { qty: 4, cost: 250, name: 'Vendu' });
    const b = stockedProduct(t, tit.userId, { qty: 3, cost: 100, name: 'Dormant' });
    expect(stockValueReport(t.s)).toMatchObject({ total_value_xaf: 1300, unknown_cost_qty: 0 });
    const session = openRegister(t, tit.userId);
    sell(t, tit.userId, session, [{ product_id: a.productId, qty: 1 }], 1000);
    t.clock.advance(100 * 86_400_000);
    sell(t, tit.userId, session, [{ product_id: a.productId, qty: 1 }], 1000);
    expect(deadStockReport(t.s, 90, true).rows).toEqual([expect.objectContaining({ product_id: b.productId, qty: 3, value_xaf: 300, last_sale_at: null })]);
  });
});

describe('P-03 P-06 P-07 P-08', () => {
  it('P-03 chiffre d’affaires, panier moyen, meilleures ventes, par famille et par utilisateur', () => {
    const a = stockedProduct(t, tit.userId, { name: 'A', category: 'parapharmacie' });
    const b = stockedProduct(t, tit.userId, { name: 'B', category: 'dispositif', sale: 500 });
    const session = openRegister(t, tit.userId);
    sell(t, tit.userId, session, [{ product_id: a.productId, qty: 3 }], 3000);
    sell(t, tit.userId, session, [{ product_id: b.productId, qty: 2 }], 1000);
    const r = salesReport(t.s, period(t.s));
    expect(r).toMatchObject({ tickets: 2, revenue: 4000, average_basket: 2000 });
    expect(r.top_products.map((x) => x.product)).toEqual(['A', 'B']);
    expect(r.by_category).toEqual([{ category: 'parapharmacie', qty: 3, amount: 3000 }, { category: 'dispositif', qty: 2, amount: 1000 }]);
    expect(r.by_user).toEqual([{ user: 'Dr Mballa', tickets: 2, revenue: 4000 }]);
  });

  it('P-06 ventes sur ordonnance, registre des sensibles, rappels, ajustements et destructions', () => {
    const s1 = stockedProduct(t, tit.userId, { category: 'medicament', sensitive: 1, name: 'Tramadol' });
    const rx = createPrescription(t.s, tit.userId, { prescriber_name: 'Dr X', prescriber_reg: 'ONMC-9', issued_on: '2026-10-25', patient_ref: 'A.B.' });
    const session = openRegister(t, tit.userId);
    sell(t, tit.userId, session, [{ product_id: s1.productId, qty: 1 }], 1000, { prescription_id: rx.id });
    adjustStock(t.s, tit.userId, { lot_id: s1.lotId, qty: -1, reason: 'casse' });
    createRecall(t.s, tit.userId, { reference: 'R-9', product_id: s1.productId, lot_number: 'L1', reason: 'test', source: 'interne' });
    destroyStock(t.s, tit.userId, { lot_id: s1.lotId, qty: 1, reason: 'recalled', pv_number: 'PV-7' });
    const r = complianceReport(t.s, period(t.s));
    expect(r.rx_sales).toEqual([expect.objectContaining({ prescriber_reg: 'ONMC-9', patient_ref: 'A.B.', validated_by: 'Dr Mballa' })]);
    expect(r.sensitive_register).toEqual([expect.objectContaining({ product: 'Tramadol', lot_number: 'L1', qty: 1, prescriber_reg: 'ONMC-9' })]);
    expect(r.recalls).toEqual([expect.objectContaining({ reference: 'R-9', blocked_qty: 7 })]);
    expect(r.adjustments.map((x) => [x.kind, x.qty, x.pv_number])).toEqual([['adjustment', -1, null], ['destroy', -1, 'PV-7']]);
  });

  it('P-07 produits les plus demandés et introuvables, par criticité', () => {
    const p1 = stockedProduct(t, tit.userId, { criticity: 1, name: 'Critique' });
    const p3 = stockedProduct(t, tit.userId, { criticity: 3, name: 'Confort' });
    recordDemand(t.s, tit.userId, { product_id: p3.productId });
    recordDemand(t.s, tit.userId, { product_id: p3.productId });
    recordDemand(t.s, tit.userId, { product_id: p1.productId });
    expect(unmetDemandReport(t.s, period(t.s)).rows.map((r) => [r.label, r.criticity, r.requests])).toEqual([['Critique', 1, 1], ['Confort', 3, 2]]);
  });

  it('P-08 annulations au-delà du seuil, ventes hors horaires, écarts de caisse répétés', () => {
    updateSettings(t.s, tit.userId, { fraud_void_threshold: 1 });
    const a = stockedProduct(t, tit.userId, { qty: 50 });
    const s1 = openRegister(t, tit.userId, 'C1');
    for (let i = 0; i < 2; i++) voidSale(t.s, tit.userId, sell(t, tit.userId, s1, [{ product_id: a.productId, qty: 1 }], 1000).id, 'test');
    closeCashSession(t.s, tit.userId, s1, { counted_cash: 9000 });
    t.clock.set('2026-10-27T21:30:00.000Z');
    const s2 = openRegister(t, tit.userId, 'C1');
    sell(t, tit.userId, s2, [{ product_id: a.productId, qty: 1 }], 1000);
    closeCashSession(t.s, tit.userId, s2, { counted_cash: 0 });
    const r = fraudReport(t.s, period(t.s, '2026-10-26T23:00:00.000Z', '2026-10-27T22:59:59.999Z'));
    expect(r.voids).toEqual([expect.objectContaining({ user: 'Dr Mballa', voids: 2 })]);
    expect(r.out_of_hours).toHaveLength(1);
    expect(r.repeated_variances).toEqual([expect.objectContaining({ sessions: 2 })]);
  });

  it('P-01 à P-08 export CSV ; formules neutralisées ; droits', async () => {
    expect(toCsv([{ a: '=SUM(A1)', b: 'x;y', c: -5 }])).toBe('﻿a;b;c\n\'=SUM(A1);"x;y";-5\n');
    const a = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    sell(t, tit.userId, session, [{ product_id: a.productId, qty: 1 }], 1000);
    const csv = await t.app.inject({ url: '/api/v1/reports/sales?format=csv', headers: H(tit) });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('product_id;product;qty;amount');
    const pharm = await createAndLogin(t, tit, 'pharm', 'pharmacien');
    expect((await t.app.inject({ url: '/api/v1/reports/fraud', headers: H(pharm) })).statusCode).toBe(403);
    const cashier = await createAndLogin(t, tit, 'cashier1', 'caissier');
    for (const url of ['/api/v1/reports/sales', '/api/v1/reports/expiry', '/api/v1/reports/stock-value', '/api/v1/reports/compliance', '/api/v1/reports/dead-stock', '/api/v1/reports/unmet-demand']) {
      expect((await t.app.inject({ url, headers: H(cashier) })).statusCode, url).toBe(403);
    }
  });
});
