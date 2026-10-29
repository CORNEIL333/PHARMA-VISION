import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assignInternalBarcode, lookupBarcode } from '../src/domain/catalog.js';
import { isValidGtin } from '../src/domain/gs1.js';
import { seedProduct } from './catalog.helpers.js';
import { createAndLogin, makeApp, setupTitulaire, type Agent, type TestApp } from './helpers.js';
import { payloadsOf } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

describe('C-07 étiquettes internes', () => {
  it('C-07 code EAN-13 de circulation interne (préfixe 20), valide, unique, retrouvé au scan, stable', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    seedProduct(t.db, { id: a, name: 'Sans code A' });
    seedProduct(t.db, { id: b, name: 'Sans code B' });
    const ca = assignInternalBarcode(t.s, tit.userId, a);
    const cb = assignInternalBarcode(t.s, tit.userId, b);
    expect(ca).toEqual({ ean13: '2000000000015', created: true });
    expect(cb.ean13).toMatch(/^20\d{11}$/);
    expect(isValidGtin(cb.ean13)).toBe(true);
    expect(assignInternalBarcode(t.s, tit.userId, a)).toEqual({ ean13: ca.ean13, created: false });
    expect(lookupBarcode(t.s, ca.ean13).product?.id).toBe(a);
    expect(payloadsOf(t.db, 'catalog.barcode_linked')).toEqual([
      expect.objectContaining({ product_id: a, kind: 'interne' }), expect.objectContaining({ product_id: b, kind: 'interne' }),
    ]);
  });

  it('C-07 HTTP : préparateur autorisé, caissier refusé', async () => {
    const id = randomUUID();
    seedProduct(t.db, { id, name: 'Sans code' });
    const prep = await createAndLogin(t, tit, 'prep1', 'preparateur');
    const cash = await createAndLogin(t, tit, 'cash1', 'caissier');
    const url = `/api/v1/products/${id}/internal-barcode`;
    expect((await t.app.inject({ method: 'POST', url, headers: { cookie: cash.cookie, 'x-csrf-token': cash.csrf } })).statusCode).toBe(403);
    const r = await t.app.inject({ method: 'POST', url, headers: { cookie: prep.cookie, 'x-csrf-token': prep.csrf } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ created: true });
  });
});
