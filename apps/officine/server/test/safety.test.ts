import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPrescription, getPrescription, prescriptionImage } from '../src/domain/prescriptions.js';
import { closeRecall, createRecall, importRecalls } from '../src/domain/recalls.js';
import { createSale, quoteSale } from '../src/domain/sales.js';
import { updateSettings } from '../src/domain/settings.js';
import { quoteFefo } from '../src/domain/stock.js';
import { verifyLedger } from '../src/domain/verify.js';
import { totpAt } from '../src/security/totp.js';
import { createAndLogin, keyMap, makeApp, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { cash, openRegister, sell, stockedProduct } from './sales.helpers.js';
import { payloadsOf, receive } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const RX = { prescriber_name: 'Dr Ekane', prescriber_reg: 'ONMC-1234', issued_on: '2026-10-20', patient_ref: 'J.N.' };
/** Plus petit PNG valide (1×1). */
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082', 'hex');
function verify() {
  expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
}
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

describe('O-01 O-02 O-06 ordonnance requise', () => {
  it('O-01 politique all_medicines : tout médicament ; flagged : seulement rx_required=1', () => {
    const med = stockedProduct(t, tit.userId, { category: 'medicament', rx: 0 });
    const para = stockedProduct(t, tit.userId, { category: 'parapharmacie', rx: 0 });
    const flagged = stockedProduct(t, tit.userId, { category: 'medicament', rx: 1 });
    const rx = (p: string) => quoteSale(t.s, { lines: [{ product_id: p, qty: 1 }] }).rx_required;
    expect([rx(med.productId), rx(para.productId), rx(flagged.productId)]).toEqual([true, false, true]);
    updateSettings(t.s, tit.userId, { rx_policy: 'flagged' });
    expect([rx(med.productId), rx(para.productId), rx(flagged.productId)]).toEqual([false, false, true]);
  });

  it('O-02 sans ordonnance validée : 409 rx_required ; avec ordonnance : vente liée', () => {
    const { productId } = stockedProduct(t, tit.userId, { category: 'medicament' });
    const session = openRegister(t, tit.userId);
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000)).toThrow(expect.objectContaining({ code: 'rx_required' }));
    const p = createPrescription(t.s, tit.userId, RX);
    const sale = sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000, { prescription_id: p.id });
    expect(sale.prescription_id).toBe(p.id);
    expect(getPrescription(t.s, p.id).sale_id).toBe(sale.id);
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000, { prescription_id: p.id }))
      .toThrow(expect.objectContaining({ code: 'rx_required' }));
    verify();
  });

  it('O-02 le caissier seul ne peut pas valider ; un pharmacien valide sur le même poste avec ses identifiants', async () => {
    const cashier = await createAndLogin(t, tit, 'caisse', 'caissier');
    await createAndLogin(t, tit, 'pharma', 'pharmacien');
    const pharmaId = (t.db.prepare("SELECT id FROM users WHERE username = 'pharma'").get() as { id: string }).id;
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/prescriptions', headers: H(cashier), payload: RX })).statusCode).toBe(403);
    const bad = await t.app.inject({ method: 'POST', url: '/api/v1/prescriptions/countersigned', headers: H(cashier), payload: { ...RX, validator: { username: 'caisse', password: STRONG } } });
    expect(bad.json()).toMatchObject({ code: 'invalid_credentials' });
    const wrong = await t.app.inject({ method: 'POST', url: '/api/v1/prescriptions/countersigned', headers: H(cashier), payload: { ...RX, validator: { username: 'pharma', password: 'nope-nope-nope' } } });
    expect(wrong.json()).toMatchObject({ code: 'invalid_credentials' });
    const ok = await t.app.inject({ method: 'POST', url: '/api/v1/prescriptions/countersigned', headers: H(cashier), payload: { ...RX, validator: { username: 'pharma', password: STRONG } } });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ validated_by: pharmaId });
    expect(payloadsOf(t.db, 'security.reauth').at(-1)).toMatchObject({ user_id: pharmaId, purpose: 'prescription_countersign' });
    // Le titulaire a la double authentification : son code est exigé.
    t.clock.advance(30_000);
    const noCode = await t.app.inject({ method: 'POST', url: '/api/v1/prescriptions/countersigned', headers: H(cashier), payload: { ...RX, validator: { username: 'titulaire', password: STRONG } } });
    expect(noCode.statusCode).toBe(401);
    const withCode = await t.app.inject({ method: 'POST', url: '/api/v1/prescriptions/countersigned', headers: H(cashier), payload: { ...RX, validator: { username: 'titulaire', password: STRONG, code: totpAt(tit.totpSecret, t.clock.now()) } } });
    expect(withCode.statusCode, withCode.body).toBe(201);
  });

  it('O-06 produit sensible : ordonnance exigée quelle que soit la politique, avec numéro du prescripteur', () => {
    updateSettings(t.s, tit.userId, { rx_policy: 'flagged' });
    const { productId } = stockedProduct(t, tit.userId, { category: 'medicament', rx: 0, sensitive: 1 });
    const session = openRegister(t, tit.userId);
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000)).toThrow(expect.objectContaining({ code: 'rx_required' }));
    const noReg = createPrescription(t.s, tit.userId, { ...RX, prescriber_reg: null });
    expect(() => sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000, { prescription_id: noReg.id })).toThrow(/inscription/);
    const ok = createPrescription(t.s, tit.userId, RX);
    sell(t, tit.userId, session, [{ product_id: productId, qty: 1 }], 1000, { prescription_id: ok.id });
  });
});

describe('O-03 O-04 O-05 contenu, photo chiffrée, ancienneté', () => {
  it('O-03 champs validés : prescripteur et date obligatoires, date future refusée', () => {
    expect(() => createPrescription(t.s, tit.userId, { ...RX, prescriber_name: ' ' })).toThrow();
    expect(() => createPrescription(t.s, tit.userId, { ...RX, issued_on: '2026-02-30' })).toThrow();
    expect(() => createPrescription(t.s, tit.userId, { ...RX, issued_on: '2026-11-30' })).toThrow(/futur/);
    const p = createPrescription(t.s, tit.userId, { ...RX, notes: 'renouvelable' });
    expect(p).toMatchObject({ prescriber_name: 'Dr Ekane', prescriber_reg: 'ONMC-1234', patient_ref: 'J.N.', has_image: false, age_days: 7 });
    expect(payloadsOf(t.db, 'prescription.validated')[0]).toMatchObject({ prescription_id: p.id, patient_ref: 'J.N.' });
  });

  it('O-04 photo chiffrée sur le disque, type vérifié par signature, caissier refusé', async () => {
    expect(() => createPrescription(t.s, tit.userId, { ...RX, image_base64: Buffer.from('GIF89a....').toString('base64') })).toThrow(/JPEG ou PNG/);
    const p = createPrescription(t.s, tit.userId, { ...RX, image_base64: PNG.toString('base64') });
    const dir = path.join(t.dir, 'blobs');
    const files = readdirSync(dir);
    expect(files).toEqual([`rx-${p.id}.vpb`]);
    const onDisk = readFileSync(path.join(dir, files[0]!));
    expect(onDisk.includes(PNG.subarray(0, 8))).toBe(false);
    expect(onDisk.toString('utf8')).not.toContain('IHDR');
    expect(prescriptionImage(t.s, p.id)).toEqual({ mime: 'image/png', bytes: PNG });
    const cashier = await createAndLogin(t, tit, 'caisse', 'caissier');
    expect((await t.app.inject({ url: `/api/v1/prescriptions/${p.id}/image`, headers: H(cashier) })).statusCode).toBe(403);
    const img = await t.app.inject({ url: `/api/v1/prescriptions/${p.id}/image`, headers: H(tit) });
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toBe('no-store');
    expect(img.rawPayload.equals(PNG)).toBe(true);
  });

  it('O-05 ordonnance de plus de 90 jours : bloquant sans motif, levée par un pharmacien avec motif', () => {
    expect(() => createPrescription(t.s, tit.userId, { ...RX, issued_on: '2026-07-01' })).toThrow(expect.objectContaining({ code: 'stale_prescription' }));
    const p = createPrescription(t.s, tit.userId, { ...RX, issued_on: '2026-07-01', age_override_reason: 'Traitement chronique' });
    expect(p).toMatchObject({ age_days: 118, age_override_reason: 'Traitement chronique' });
    updateSettings(t.s, tit.userId, { prescription_max_age_days: 200 });
    expect(() => createPrescription(t.s, tit.userId, { ...RX, issued_on: '2026-07-01' })).not.toThrow();
  });
});

describe('Q-01 à Q-05 rappels, péremptions', () => {
  it('Q-01 création par pharmacien ou titulaire avec ré-authentification ; recall.published', async () => {
    const { productId } = stockedProduct(t, tit.userId);
    const body = { reference: 'DPML-2026-014', product_id: productId, lot_number: 'L1', reason: 'Contamination', source: 'DPML' };
    t.clock.advance(6 * 60_000);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/recalls', headers: H(tit), payload: body })).json()).toMatchObject({ code: 'reauth_required' });
    const prep = await createAndLogin(t, tit, 'prep', 'preparateur');
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/recalls', headers: H(prep), payload: body })).statusCode).toBe(403);
    await reauth(t, tit, STRONG, tit.totpSecret);
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/recalls', headers: H(tit), payload: body });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ active: true, blocked_lots: [expect.objectContaining({ lot_number: 'L1', qty: 10 })] });
    expect(payloadsOf(t.db, 'recall.published')).toEqual([expect.objectContaining({ reference: 'DPML-2026-014', lot_number: 'L1' })]);
  });

  it('Q-02 lot rappelé : exclu du FEFO, vente du lot scanné refusée en 409 recalled_lot avec le motif', async () => {
    const { productId, lotId } = stockedProduct(t, tit.userId, { qty: 2, lot: 'BAD', expiry: '2027-12-31' });
    const good = receive(t.s, tit.userId, { productId, lotNumber: 'GOOD', qty: 2, expiry: '2028-12-31', unitCost: 500 }).lotId;
    createRecall(t.s, tit.userId, { reference: 'R-1', product_id: productId, lot_number: 'BAD', reason: 'Défaut de stérilité', source: 'laboratoire' });
    expect(quoteFefo(t.s, productId, 2).map((l) => l.lot_id)).toEqual([good]);
    const quote = quoteSale(t.s, { lines: [{ product_id: productId, qty: 1, lot_id: lotId }] });
    expect(quote.blocking).toBe(true);
    expect(quote.lines[0]!.alerts[0]).toMatchObject({ level: 'block', code: 'recalled_lot', message: expect.stringContaining('Défaut de stérilité') });
    const session = openRegister(t, tit.userId);
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/sales', headers: H(tit), payload: { cash_session_id: session, lines: [{ product_id: productId, qty: 1, lot_id: lotId }], payments: cash(1000) } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'recalled_lot' });
    expect(r.json().detail).toContain('Défaut de stérilité');
  });

  it('Q-02 la clôture du rappel rend le lot de nouveau vendable', () => {
    const { productId } = stockedProduct(t, tit.userId, { lot: 'X' });
    const recall = createRecall(t.s, tit.userId, { reference: 'R-2', product_id: productId, reason: 'Précaution', source: 'interne' });
    expect(() => quoteFefo(t.s, productId, 1)).toThrow();
    closeRecall(t.s, tit.userId, recall.id, 'Levée par la DPML');
    expect(quoteFefo(t.s, productId, 1)).toHaveLength(1);
    expect(payloadsOf(t.db, 'recall.closed')).toHaveLength(1);
  });

  it('Q-03 lot périmé invendable (horloge injectée, marge VP_EXPIRY_BLOCK_DAYS)', () => {
    const { productId, lotId } = stockedProduct(t, tit.userId, { expiry: '2026-11-15' });
    const session = openRegister(t, tit.userId);
    t.clock.set('2026-11-15T22:59:00.000Z');
    expect(quoteSale(t.s, { lines: [{ product_id: productId, qty: 1, lot_id: lotId }] }).blocking).toBe(false);
    t.clock.set('2026-11-15T23:01:00.000Z');
    const q = quoteSale(t.s, { lines: [{ product_id: productId, qty: 1, lot_id: lotId }] });
    expect(q.lines[0]!.alerts[0]).toMatchObject({ code: 'expired_lot' });
    expect(() => createSale(t.s, tit.userId, { cash_session_id: session, lines: [{ product_id: productId, qty: 1, lot_id: lotId }], payments: cash(1000) }))
      .toThrow(expect.objectContaining({ code: 'expired_lot' }));
    t.clock.set('2026-11-10T09:00:00.000Z');
    t.s.stockPolicy = { expiryBlockDays: 7 };
    expect(quoteSale(t.s, { lines: [{ product_id: productId, qty: 1, lot_id: lotId }] }).lines[0]!.alerts[0]).toMatchObject({ code: 'expired_lot' });
  });

  it('Q-04 un lot qui périme dans moins de 30 jours affiche un avertissement non bloquant', () => {
    const { productId } = stockedProduct(t, tit.userId, { expiry: '2026-11-20' });
    const q = quoteSale(t.s, { lines: [{ product_id: productId, qty: 1 }] });
    expect(q.blocking).toBe(false);
    expect(q.lines[0]!.alerts).toEqual([expect.objectContaining({ level: 'warn', code: 'near_expiry' })]);
  });

  it('Q-05 import d’un fichier de rappels : tout ou rien', () => {
    const a = randomUUID();
    t.db.prepare(`INSERT INTO products (id, ref_code, name, search_text, created_at, updated_at) VALUES (?, 'VP-1', 'Produit A', 'produit a', ?, ?)`)
      .run(a, t.clock.now().toISOString(), t.clock.now().toISOString());
    const bad = 'reference;product;lot_number;reason;source\nR1;VP-1;L1;Motif;DPML\nR2;VP-404;;Motif;DPML\n';
    expect(() => importRecalls(t.s, tit.userId, Buffer.from(bad))).toThrow(expect.objectContaining({ code: 'validation_failed' }));
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM recalls').get()).toEqual({ n: 0 });
    const good = 'reference;product;lot_number;reason;source\nR1;VP-1;L1;Motif;DPML\nR2;VP-1;;Tous lots;grossiste\n';
    expect(importRecalls(t.s, tit.userId, Buffer.from(good))).toMatchObject({ created: 2 });
    expect(payloadsOf(t.db, 'recall.published')).toHaveLength(2);
    verify();
  });
});
