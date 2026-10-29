import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cloudStatus, nextDelay, syncCycle } from '../src/cloud/cycle.js';
import { CLOUD_USERNAME } from '../src/cloud/feed.js';
import { enrol, markSynced } from '../src/cloud/sync.js';
import { writeTx } from '../src/db/index.js';
import { quoteSale } from '../src/domain/sales.js';
import { updateSettings } from '../src/domain/settings.js';
import { verifyLedger } from '../src/domain/verify.js';
import { startFakeCloud, type FakeCloud } from './fakecloud.js';
import { keyMap, makeApp, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { stockedProduct } from './sales.helpers.js';
import { payloadsOf } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
let fc: FakeCloud;
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const verify = () => expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });

beforeEach(async () => {
  t = await makeApp();
  // Le faux cloud tourne avec l'horloge réelle : le nœud signe ses requêtes à l'heure réelle.
  t.clock.set(new Date().toISOString());
  tit = await setupTitulaire(t);
  fc = await startFakeCloud();
});
afterEach(async () => {
  await fc.close();
  t.cleanup();
});

function configure(enabled = true, spki = fc.spki) {
  updateSettings(t.s, tit.userId, { cloud_url: fc.url, cloud_spki_sha256: spki, cloud_sync_enabled: enabled });
}
function noise(n: number) {
  writeTx(t.db, () => {
    for (let i = 0; i < n; i++) t.ledger.append('test.noise', null, { i });
  });
}

describe('NO-01 NO-02 désactivé par défaut, épinglage', () => {
  it('NO-01 sans activation : aucune connexion sortante', async () => {
    expect(await syncCycle(t.s)).toMatchObject({ ran: false });
    updateSettings(t.s, tit.userId, { cloud_url: fc.url, cloud_spki_sha256: fc.spki });
    expect(await syncCycle(t.s)).toMatchObject({ ran: false });
    expect([fc.tlsConnections, fc.httpRequests]).toEqual([0, 0]);
    expect(cloudStatus(t.s)).toMatchObject({ enabled: false, configured: true, enrolled: false });
  });

  it('NO-02 clé du cloud différente de l’empreinte : poignée de main puis coupure, aucun octet HTTP envoyé', async () => {
    configure(true, 'a'.repeat(64));
    await expect(enrol(t.s, tit.userId, fc.token)).rejects.toMatchObject({ code: 'forbidden', extra: { reason: 'pin_mismatch' } });
    expect(fc.tlsConnections).toBe(1);
    expect(fc.httpRequests).toBe(0);
  });
});

describe('CL-02 SY-03 SY-05 enrôlement et envoi des lots', () => {
  it('CL-02 enrôlement par jeton (titulaire ré-authentifié) puis envoi de toute la file, dans l’ordre', async () => {
    configure();
    const url = '/api/v1/cloud/enrol';
    t.clock.advance(6 * 60_000);
    expect((await t.app.inject({ method: 'POST', url, headers: H(tit), payload: { token: fc.token } })).json()).toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    const r = await t.app.inject({ method: 'POST', url, headers: H(tit), payload: { token: fc.token } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ pharmacy_id: 'pharmacie-test' });
    t.clock.set(new Date().toISOString());
    expect(payloadsOf(t.db, 'system.cloud_enrolled')).toEqual([{ pharmacy_id: 'pharmacie-test', url: fc.url }]);
    noise(1200);
    const res = await syncCycle(t.s);
    expect(res.error).toBeNull();
    const head = t.ledger.head();
    expect(fc.events.map((e) => e.seq)).toEqual(Array.from({ length: head.seq }, (_, i) => i + 1));
    expect(fc.batches.length).toBeGreaterThanOrEqual(3);
    expect(cloudStatus(t.s)).toMatchObject({ queue: 0, enrolled: true, last_error: null });
    verify();
  });

  it('SY-05 accusé perdu : rien n’est marqué ; le lot rejoué est dédoublonné puis accusé', async () => {
    configure();
    await enrol(t.s, tit.userId, fc.token);
    noise(30);
    fc.failNext = { mode: 'lost_ack', count: 1 };
    expect((await syncCycle(t.s)).error).toMatch(/Cloud injoignable/);
    expect(cloudStatus(t.s).queue).toBe(t.ledger.head().seq);
    const stored = fc.events.length;
    expect((await syncCycle(t.s)).error).toBeNull();
    expect(fc.events.length).toBe(stored);
    expect(new Set(fc.events.map((e) => e.id)).size).toBe(fc.events.length);
    expect(cloudStatus(t.s).queue).toBe(0);
  });

  it('SY-07 coupures répétées : 2 000 événements arrivent tous, une fois, dans l’ordre', async () => {
    configure();
    await enrol(t.s, tit.userId, fc.token);
    noise(2000);
    const { BATCH_SIZE } = await import('../src/cloud/sync.js');
    expect(BATCH_SIZE).toBe(500);
    let cycles = 0;
    while (cloudStatus(t.s).queue > 0 && cycles < 30) {
      fc.failNext = { mode: cycles % 2 ? 'lost_ack' : 'cut', count: 1, after: cycles % 3 };
      await syncCycle(t.s);
      cycles++;
    }
    expect(cloudStatus(t.s).queue).toBe(0);
    expect(fc.events.map((e) => e.seq)).toEqual(Array.from({ length: t.ledger.head().seq }, (_, i) => i + 1));
    expect(nextDelay(0)).toBe(60_000);
    expect(nextDelay(3)).toBe(240_000);
    expect(nextDelay(10)).toBe(300_000);
  }, 120_000);

  it('SY-05 seuls les identifiants accusés sont marqués', () => {
    const before = cloudStatus(t.s).queue;
    expect(markSynced(t.s, ['inconnu'])).toBe(0);
    expect(cloudStatus(t.s).queue).toBe(before);
  });
});

describe('NO-03 RA-02 RA-03 rappels prioritaires', () => {
  it('RA-02 un rappel diffusé bloque la vente du lot dès le cycle suivant ; accusé envoyé ; clôture propagée', async () => {
    configure();
    await enrol(t.s, tit.userId, fc.token);
    const p = stockedProduct(t, tit.userId, { lot: 'BAD-1' });
    t.db.prepare('UPDATE products SET ref_code = ? WHERE id = ?').run('VP-0042', p.productId);
    const id = randomUUID();
    fc.publishRecall({ id, reference: 'DPML-2026-099', ref_code: 'VP-0042', lot_number: 'BAD-1', reason: 'Contamination', source: 'DPML', regions: [], active: true });
    const r = await syncCycle(t.s);
    expect(r).toMatchObject({ recalls: 1, error: null });
    const q = quoteSale(t.s, { lines: [{ product_id: p.productId, qty: 1, lot_id: p.lotId }] });
    expect(q.lines[0]!.alerts[0]).toMatchObject({ code: 'recalled_lot' });
    expect(fc.acks).toEqual([{ id, version: 1 }]);
    const recall = t.db.prepare('SELECT r.active, u.username, u.active AS user_active FROM recalls r JOIN users u ON u.id = r.created_by').get() as { username: string; user_active: number };
    expect(recall).toMatchObject({ active: 1, username: CLOUD_USERNAME, user_active: 0 });
    expect(cloudStatus(t.s).recalls[0]).toMatchObject({ applied: true, acked_at: expect.any(String) });
    fc.publishRecall({ id, reference: 'DPML-2026-099', ref_code: 'VP-0042', lot_number: 'BAD-1', reason: 'Levée', source: 'DPML', regions: [], active: false });
    await syncCycle(t.s);
    expect(quoteSale(t.s, { lines: [{ product_id: p.productId, qty: 1, lot_id: p.lotId }] }).blocking).toBe(false);
    verify();
  });

  it('RF-04 rappel mal signé ou version non consécutive : refusé, version inchangée', async () => {
    configure();
    await enrol(t.s, tit.userId, fc.token);
    fc.publishRecall({ id: 'r1', reference: 'R', ref_code: 'X', lot_number: null, reason: 'x', source: 'DPML', regions: [], active: true });
    fc.recalls[0] = { ...fc.recalls[0]!, body: { ...fc.recalls[0]!.body, reason: 'altéré' } };
    expect((await syncCycle(t.s)).error).toMatch(/signature invalide/);
    expect(cloudStatus(t.s).recall_version).toBe(0);
    fc.recalls = [];
    fc.publishRecall({ id: 'r1', reference: 'R', ref_code: 'X', lot_number: null, reason: 'x', source: 'DPML', regions: [], active: true });
    fc.recalls[0] = fc.recalls[0]!;
    fc.publishRecall({ id: 'r2', reference: 'R', ref_code: 'X', lot_number: null, reason: 'x', source: 'DPML', regions: [], active: true });
    fc.recalls.shift();
    expect((await syncCycle(t.s)).error).toMatch(/version 2 au lieu de 1/);
  });
});

describe('NO-04 RF-03 référentiel distant', () => {
  const product = (ref: string, name: string, gtins: string[] = []) => ({
    ref_code: ref, name, dci: 'paracétamol', strength: '500 mg', form: 'comprimé', presentation: 'boîte de 16', category: 'medicament',
    rx_required: true, sensitive: false, criticity: 3, storage: 'ambiant', suggested_price: 900, gtins,
  });

  it('RF-03 versions appliquées dans l’ordre ; prix local, seuils et statut conservés ; rappel en attente appliqué', async () => {
    configure();
    await enrol(t.s, tit.userId, fc.token);
    const p = stockedProduct(t, tit.userId, { sale: 1500, minQty: 2, maxQty: 9 });
    t.db.prepare("UPDATE products SET ref_code = 'VP-1' WHERE id = ?").run(p.productId);
    fc.publishRecall({ id: 'r-pending', reference: 'R-9', ref_code: 'VP-2', lot_number: null, reason: 'x', source: 'DPML', regions: [], active: true });
    fc.publishVersion([product('VP-1', 'Paracétamol 500 mg (corrigé)')]);
    fc.publishVersion([product('VP-2', 'Nouveau produit', ['3400930000001'])]);
    expect(await syncCycle(t.s)).toMatchObject({ versions: 2, error: null });
    const updated = t.db.prepare('SELECT name, sale_price, min_qty, max_qty, status, suggested_price FROM products WHERE id = ?').get(p.productId);
    expect(updated).toEqual({ name: 'Paracétamol 500 mg (corrigé)', sale_price: 1500, min_qty: 2, max_qty: 9, status: 'active', suggested_price: 900 });
    const added = t.db.prepare("SELECT id, status FROM products WHERE ref_code = 'VP-2'").get() as { id: string; status: string };
    expect(added.status).toBe('dormant');
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM recalls WHERE product_id = ?').get(added.id)).toEqual({ n: 1 });
    expect(cloudStatus(t.s)).toMatchObject({ referential_version: 2 });
    expect(payloadsOf(t.db, 'catalog.referential_applied').map((x) => x.version)).toEqual([1, 2]);
    verify();
  });

  it('NO-05 état et cycle immédiat par HTTP (pharmacien autorisé)', async () => {
    configure();
    await enrol(t.s, tit.userId, fc.token);
    const st = await t.app.inject({ url: '/api/v1/cloud/status', headers: H(tit) });
    expect(st.json()).toMatchObject({ enabled: true, enrolled: true, pharmacy_id: 'pharmacie-test' });
    const now = await t.app.inject({ method: 'POST', url: '/api/v1/cloud/sync-now', headers: H(tit) });
    expect(now.json()).toMatchObject({ ran: true, error: null });
  });
});
