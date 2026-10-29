import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeCashSession, expectedCash, openCashSession } from '../src/domain/cash.js';
import { declareDuty } from '../src/domain/duty.js';
import { buildReceipt } from '../src/domain/receipt.js';
import { checkPayments, createSale, getSale, quoteSale, voidSale } from '../src/domain/sales.js';
import { updateSettings } from '../src/domain/settings.js';
import { verifyLedger } from '../src/domain/verify.js';
import { createAndLogin, keyMap, makeApp, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { lotQty, payloadsOf, receive } from './stock.helpers.js';
import { cash, openRegister, sell, stockedProduct } from './sales.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
function verify() {
  expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
}
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => { vi.restoreAllMocks(); t.cleanup(); });

describe('V-01 sessions de caisse', () => {
  it('V-01 une seule session ouverte par poste : la deuxième renvoie 409 register_busy', async () => {
    openRegister(t, tit.userId, 'Comptoir 1');
    expect(() => openRegister(t, tit.userId, 'Comptoir 1')).toThrow(expect.objectContaining({ code: 'register_busy' }));
    openRegister(t, tit.userId, 'Comptoir 2');
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/cash/sessions', headers: H(tit), payload: { register: 'Comptoir 1', opening_float: 0 } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'register_busy' });
    expect(payloadsOf(t.db, 'cash.opened')).toHaveLength(2);
  });

  it('V-01 une vente exige une session ouverte', () => {
    const { productId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    closeCashSession(t.s, tit.userId, session, { counted_cash: 10_000 });
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000))
      .toThrow(expect.objectContaining({ code: 'invalid_transition' }));
  });
});

describe('V-03 paiements', () => {
  it('V-03 la somme différente du total est refusée (422 payment_mismatch)', async () => {
    const { productId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    const r = await t.app.inject({
      method: 'POST', url: '/api/v1/sales', headers: H(tit),
      payload: { cash_session_id: session, lines: [{ product_id: productId, qty: 2 }], payments: cash(1500) },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: 'payment_mismatch', paid: 1500, total: 2000 });
  });

  it('V-03 références obligatoires et rendu de monnaie calculé', () => {
    expect(() => checkPayments([{ method: 'mobile_money', amount: 100 }], 100)).toThrow(/Référence/);
    expect(() => checkPayments([{ method: 'carte', amount: 100, reference: ' ' }], 100)).toThrow();
    expect(() => checkPayments([{ method: 'credit', amount: 100 }], 100)).toThrow(/client/);
    expect(() => checkPayments([{ method: 'tiers_payant', amount: 100, reference: 'N1' }], 100)).toThrow(/Organisme/);
    expect(checkPayments([{ method: 'tiers_payant', amount: 60, reference: 'N1', payer: 'CNPS' }, { method: 'especes', amount: 40 }], 100, 100))
      .toMatchObject({ change: 60, tendered: 100 });
    expect(() => checkPayments([{ method: 'especes', amount: 100 }], 100, 50)).toThrow(/insuffisantes/);
    const { productId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    const sale = sell(t, tit.userId, session, [{ product_id: productId, qty: 3 }], 3000, { cash_tendered: 5000 });
    expect(sale).toMatchObject({ total: 3000, cash_tendered: 5000, change_given: 2000 });
    expect(expectedCash(t.s, session)).toBe(13_000);
  });
});

describe('V-04 atomicité', () => {
  it('V-04 une erreur au milieu de la transaction ne laisse aucune trace', () => {
    const { productId, lotId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    const head = t.ledger.head();
    t.db.exec(`CREATE TEMP TRIGGER fail_payment BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'injected payment fault'); END;`);
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 2 }], 2000)).toThrow('injected payment fault');
    t.db.exec('DROP TRIGGER fail_payment');
    const original = t.s.ledger.append.bind(t.s.ledger);
    vi.spyOn(t.s.ledger, 'append').mockImplementation((type, actor, payload) => {
      if (type === 'sale.completed') throw new Error('injected ledger fault');
      return original(type, actor, payload);
    });
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 2 }], 2000)).toThrow('injected ledger fault');
    for (const table of ['sales', 'sale_lines', 'payments']) {
      expect(t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM counters WHERE name LIKE 'sale:%'").get()).toEqual({ n: 0 });
    expect(lotQty(t.db, lotId)).toBe(10);
    expect(t.ledger.head()).toEqual(head);
    verify();
  });
});

describe('V-05 ventes en régularisation', () => {
  it('V-05 paramètre actif : vente sur le lot technique, has_regul=1, fiche activée', () => {
    const productId = randomUUID();
    t.db.prepare(`INSERT INTO products (id, name, category, sale_price, status, search_text, created_at, updated_at)
      VALUES (?, 'Sans stock', 'parapharmacie', 500, 'dormant', 'sans stock', ?, ?)`).run(productId, t.clock.now().toISOString(), t.clock.now().toISOString());
    const session = openRegister(t, tit.userId);
    expect(quoteSale(t.s, { lines: [{ product_id: productId, qty: 2 }] })).toMatchObject({ regul_allowed: true, blocking: false });
    const sale = sell(t, tit.userId, session, [{ product_id: productId, qty: 2 }], 1000);
    expect(sale.has_regul).toBe(true);
    expect(sale.lines[0]).toMatchObject({ regul: true, qty: 2 });
    expect(lotQty(t.db, sale.lines[0]!.lot_id)).toBe(-2);
    expect(payloadsOf(t.db, 'catalog.item_activated')).toEqual([{ product_id: productId, cause: 'regul_sale' }]);
    verify();
  });

  it('V-05 paramètre inactif (explicite ou après 30 jours) : insufficient_stock', () => {
    const { productId } = stockedProduct(t, tit.userId, { qty: 1 });
    const session = openRegister(t, tit.userId);
    updateSettings(t.s, tit.userId, { allow_regul_sales: false });
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 3 }], 3000))
      .toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    updateSettings(t.s, tit.userId, { allow_regul_sales: null });
    t.clock.advance(31 * 86_400_000);
    expect(() => quoteSale(t.s, { lines: [{ product_id: productId, qty: 3 }] })).not.toThrow();
    expect(quoteSale(t.s, { lines: [{ product_id: productId, qty: 3 }] })).toMatchObject({ regul_allowed: false, blocking: true });
  });
});

describe('V-06 ticket', () => {
  it('V-06 le ticket contient officine, numéro, date, caissier, lignes avec lot, total, paiements, rendu et empreinte courte', () => {
    updateSettings(t.s, tit.userId, { pharmacy_address: 'Rue de la Joie, Douala' });
    const { productId } = stockedProduct(t, tit.userId, { name: 'Sirop toux 125 ml', lot: 'S-77', expiry: '2028-06-30' });
    const session = openRegister(t, tit.userId);
    const sale = sell(t, tit.userId, session, [{ product_id: productId, qty: 2 }], 2000, { cash_tendered: 2500 });
    const r = buildReceipt(t.s, sale.id);
    const hash = (t.db.prepare("SELECT hash FROM events WHERE type = 'sale.completed'").get() as { hash: string }).hash;
    expect(r.short_hash).toBe(hash.slice(0, 8));
    for (const part of ['Pharmacie du Centre', 'Rue de la Joie', sale.number, '27/10/2026', 'Dr Mballa', 'Sirop toux 125 ml', 'Lot S-77 exp. 06/2028',
      '2 x 1 000 F = 2 000 F', 'TOTAL', 'Espèces', 'Rendu', '500 F', hash.slice(0, 8)]) {
      expect(r.text).toContain(part);
    }
    expect(r.text.split('\n').every((l) => l.length <= 48)).toBe(true);
  });
});

describe('V-07 annulation', () => {
  it('V-07 remet les quantités sur les mêmes lots, exige ré-authentification et motif', async () => {
    const { productId, lotId } = stockedProduct(t, tit.userId, { qty: 3 });
    const lot2 = receive(t.s, tit.userId, { productId, lotNumber: 'L2', qty: 5, expiry: '2028-09-30', unitCost: 600 }).lotId;
    const session = openRegister(t, tit.userId);
    const sale = sell(t, tit.userId, session, [{ product_id: productId, qty: 5 }], 5000);
    expect([lotQty(t.db, lotId), lotQty(t.db, lot2)]).toEqual([0, 3]);
    const url = `/api/v1/sales/${sale.id}/void`;
    t.clock.advance(6 * 60_000);
    expect((await t.app.inject({ method: 'POST', url, headers: H(tit), payload: { reason: 'Erreur' } })).json()).toMatchObject({ code: 'reauth_required' });
    const cashier = await createAndLogin(t, tit, 'caisse', 'caissier');
    expect((await t.app.inject({ method: 'POST', url, headers: H(cashier), payload: { reason: 'Erreur' } })).statusCode).toBe(403);
    await reauth(t, tit, STRONG, tit.totpSecret);
    const r = await t.app.inject({ method: 'POST', url, headers: H(tit), payload: { reason: 'Erreur de produit' } });
    expect(r.statusCode, r.body).toBe(200);
    expect([lotQty(t.db, lotId), lotQty(t.db, lot2)]).toEqual([3, 5]);
    expect(payloadsOf(t.db, 'sale.voided')[0]).toMatchObject({ sale_id: sale.id, reason: 'Erreur de produit' });
    expect(getSale(t.s, sale.id).status).toBe('voided');
    expect(() => voidSale(t.s, tit.userId, sale.id, 'encore')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    verify();
  });

  it('V-07 une vente de la veille (heure de Douala) ne s’annule plus', () => {
    const { productId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    t.clock.set('2026-10-27T22:30:00.000Z');
    const sale = sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000);
    t.clock.set('2026-10-27T23:05:00.000Z');
    expect(() => voidSale(t.s, tit.userId, sale.id, 'trop tard')).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
  });
});

describe('V-08 clôture', () => {
  it('V-08 écart = compté − (fond + espèces), cash.closed puis point de contrôle', () => {
    const { productId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId, 'C1', 5000);
    sell(t, tit.userId, session, [{ product_id: productId, qty: 2 }], 2000);
    createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: productId, qty: 1 }], payments: [{ method: 'mobile_money', amount: 1000, reference: 'MM-1' }] });
    const voided = sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000);
    voidSale(t.s, tit.userId, voided.id, 'erreur');
    const closed = closeCashSession(t.s, tit.userId, session, { counted_cash: 6500 });
    expect(closed).toMatchObject({ expected_cash: 7000, counted_cash: 6500, variance: -500 });
    const head = t.ledger.head();
    expect(payloadsOf(t.db, 'cash.closed')[0]).toMatchObject({ expected: 7000, counted: 6500, variance: -500 });
    expect(t.ledger.lastCheckpoint()).toMatchObject({ seq: head.seq, hash: head.hash });
    expect(() => closeCashSession(t.s, tit.userId, session, { counted_cash: 1 })).toThrow(expect.objectContaining({ code: 'invalid_transition' }));
    verify();
  });

  it('V-08 G-01 la caisse ouverte de jour se clôture avant de vendre en garde', () => {
    const { productId } = stockedProduct(t, tit.userId);
    const day = openRegister(t, tit.userId, 'C1');
    declareDuty(t.s, tit.userId, { starts_at: '2026-10-27T19:00:00.000Z', ends_at: '2026-10-28T07:00:00.000Z' });
    t.clock.set('2026-10-27T20:00:00.000Z');
    expect(() => sell(t, tit.userId, day, [{ product_id: productId, qty: 1 }], 1000)).toThrow(/garde/);
    closeCashSession(t.s, tit.userId, day, { counted_cash: 10_000 });
    const night = openCashSession(t.s, tit.userId, { register: 'C1', opening_float: 0 });
    expect(night.kind).toBe('garde');
    sell(t, tit.userId, night.id, [{ product_id: productId, qty: 1 }], 1000);
  });
});

describe('V-09 V-10 remises et coûts', () => {
  it('V-09 remise : pharmacien ou titulaire, motif, plafond ; jamais de total négatif', async () => {
    const { productId } = stockedProduct(t, tit.userId);
    const session = openRegister(t, tit.userId);
    const cashier = await createAndLogin(t, tit, 'caisse', 'caissier');
    const cashierId = (t.db.prepare("SELECT id FROM users WHERE username = 'caisse'").get() as { id: string }).id;
    const cs = openRegister(t, cashierId, 'C-caisse');
    expect(() => createSale(t.s, cashierId, { cash_session_id: cs, lines: [{ product_id: productId, qty: 1 }], payments: cash(900), discount: { amount: 100, reason: 'fidélité' } }))
      .toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() => createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: productId, qty: 1 }], payments: cash(800), discount: { amount: 200, reason: 'fidélité' } }))
      .toThrow(expect.objectContaining({ extra: expect.objectContaining({ reason: 'discount_cap' }) }));
    expect(() => createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: productId, qty: 1 }], payments: cash(900), discount: { amount: 100, reason: ' ' } }))
      .toThrow(/Motif/);
    const ok = createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: productId, qty: 1 }], payments: cash(900), discount: { amount: 100, reason: 'fidélité' } });
    expect(ok).toMatchObject({ gross: 1000, discount_total: 100, total: 900 });
    expect(payloadsOf(t.db, 'sale.completed').at(-1)).toMatchObject({ discount: 100, total: 900 });
    void cashier;
  });

  it('V-10 le caissier ne voit ni coûts ni marges', async () => {
    const { productId } = stockedProduct(t, tit.userId, { cost: 777 });
    const cashier = await createAndLogin(t, tit, 'caisse', 'caissier');
    const product = await t.app.inject({ url: `/api/v1/products/${productId}`, headers: H(cashier) });
    expect(product.statusCode).toBe(200);
    expect(product.body).not.toContain('777');
    for (const url of ['/api/v1/stock/lots', '/api/v1/stock/value', '/api/v1/receptions', '/api/v1/orders', '/api/v1/reports/stock-value']) {
      const r = await t.app.inject({ url, headers: H(cashier) });
      expect([403, 404], url).toContain(r.statusCode);
      expect(r.body).not.toContain('777');
    }
    const register = await t.app.inject({ method: 'POST', url: '/api/v1/cash/sessions', headers: H(cashier), payload: { register: 'C9', opening_float: 0 } });
    const quote = await t.app.inject({ method: 'POST', url: '/api/v1/sales/quote', headers: H(cashier), payload: { lines: [{ product_id: productId, qty: 1 }] } });
    const sale = await t.app.inject({ method: 'POST', url: '/api/v1/sales', headers: H(cashier), payload: { cash_session_id: register.json().id, lines: [{ product_id: productId, qty: 1 }], payments: cash(1000) } });
    for (const r of [quote, sale]) {
      expect(r.statusCode, r.body).toBeLessThan(300);
      expect(r.body).not.toContain('777');
      expect(r.body).not.toContain('unit_cost');
    }
  });
});
