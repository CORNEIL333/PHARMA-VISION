import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertTransition,
  cancelOrder,
  createOrder,
  getOrder,
  sendOrder,
  suggestOrder,
} from '../src/domain/orders.js';
import { createSupplier, getSupplier, updateSupplier } from '../src/domain/suppliers.js';
import { exportOrder } from '../src/domain/orderExport.js';
import { seedProduct } from './catalog.helpers.js';
import { createAndLogin, makeApp, setupTitulaire, type Agent, type TestApp } from './helpers.js';
import {
  eventsOf,
  H,
  inspectPdf,
  postOrder,
  postSupplier,
  seedLot,
  seedMovement,
  seedSale,
  seedSupplier,
  type OrderOut,
  type SupplierOut,
} from './orders.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => {
  vi.restoreAllMocks();
  t.cleanup();
});

const count = (sql: string, ...params: (string | number)[]) =>
  (t.db.prepare(sql).get(...params) as { n: number }).n;

/** Produit actif avec un stock donné (lot + mouvement de réception, fixture). */
function activeProduct(id: string, name: string, stock: number, opts: { min?: number; max?: number } = {}): void {
  seedProduct(t.db, {
    id,
    name,
    status: 'active',
    activatedAt: '2026-01-01T00:00:00.000Z',
    minQty: opts.min ?? 0,
    maxQty: opts.max ?? 0,
  });
  seedLot(t.db, { id: `lot-${id}`, productId: id, unitCost: 500 });
  if (stock !== 0) seedMovement(t.db, { productId: id, lotId: `lot-${id}`, qty: stock, userId: tit.userId });
}

// ---------------------------------------------------------------- R-01

describe('R-01 fournisseurs', () => {
  it('R-01 création : fiche renvoyée, délai par défaut de 2 jours, événement supplier.created', async () => {
    const sp = await postSupplier(t, tit, { name: 'Laborex Douala', phone: '+237 6 99 00 00 00' });
    expect(sp).toMatchObject({ name: 'Laborex Douala', phone: '+237 6 99 00 00 00', email: null, lead_days: 2, active: true });
    expect(sp.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sp.created_at).toBe(t.clock.now().toISOString());
    expect(eventsOf(t.db, 'supplier.created')).toEqual([
      { supplier_id: sp.id, name: 'Laborex Douala', phone: '+237 6 99 00 00 00', email: null, lead_days: 2 },
    ]);
  });

  it('R-01 unique supplier name uses the existing validation_failed code', async () => {
    await postSupplier(t, tit, { name: 'Ubipharm', lead_days: 3 });
    const dup = await t.app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: H(tit), payload: { name: 'UBIPHARM' } });
    expect(dup.statusCode).toBe(400);
    expect(dup.json()).toMatchObject({ code: 'validation_failed', reason: 'supplier_name_taken' });
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type = 'supplier.created'")).toBe(1);
  });

  it('R-01 modification : seuls les champs changés sont dans supplier.updated ; aucun événement si rien ne change', async () => {
    const sp = await postSupplier(t, tit, { name: 'Ubipharm' });
    const r = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${sp.id}`,
      headers: H(tit),
      payload: { lead_days: 5, email: 'commandes@ubipharm.example' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ lead_days: 5, email: 'commandes@ubipharm.example', name: 'Ubipharm' });
    const same = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${sp.id}`,
      headers: H(tit),
      payload: { lead_days: 5 },
    });
    expect(same.statusCode).toBe(200);
    expect(eventsOf(t.db, 'supplier.updated')).toEqual([
      { supplier_id: sp.id, changes: { lead_days: 5, email: 'commandes@ubipharm.example' } },
    ]);
  });

  it('R-01 désactivation : le fournisseur sort de la liste par défaut et reste visible avec include_inactive', async () => {
    const a = await postSupplier(t, tit, { name: 'A' });
    await postSupplier(t, tit, { name: 'B' });
    const off = await t.app.inject({ method: 'PATCH', url: `/api/v1/suppliers/${a.id}`, headers: H(tit), payload: { active: false } });
    expect(off.statusCode).toBe(200);
    expect((off.json() as SupplierOut).active).toBe(false);
    const list = await t.app.inject({ url: '/api/v1/suppliers', headers: { cookie: tit.cookie } });
    expect((list.json() as SupplierOut[]).map((x) => x.name)).toEqual(['B']);
    const all = await t.app.inject({ url: '/api/v1/suppliers?include_inactive=true', headers: { cookie: tit.cookie } });
    expect((all.json() as SupplierOut[]).map((x) => x.name)).toEqual(['A', 'B']);
    expect(eventsOf(t.db, 'supplier.updated')).toEqual([{ supplier_id: a.id, changes: { active: false } }]);
  });

  it('R-01 validation : nom vide, délai négatif ou champ inconnu refusés (400)', async () => {
    for (const payload of [{ name: '' }, { name: 'X', lead_days: -1 }, { name: 'X', lead_days: 1.5 }, { name: 'X', foo: 1 }]) {
      const r = await t.app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: H(tit), payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(() => createSupplier(t.s, tit.userId, { name: '   ' })).toThrow(/nom/i);
    expect(() => updateSupplier(t.s, tit.userId, '00000000-0000-4000-8000-000000000000', { name: 'Z' })).toThrow(
      /introuvable/,
    );
  });

  it('R-01 droits : titulaire, pharmacien et préparateur gèrent les fournisseurs ; le caissier est refusé', async () => {
    const ph = await createAndLogin(t, tit, 'pharma1', 'pharmacien');
    const pr = await createAndLogin(t, tit, 'prepa1', 'preparateur');
    const ca = await createAndLogin(t, tit, 'caisse1', 'caissier');
    await postSupplier(t, ph, { name: 'Par pharmacien' });
    await postSupplier(t, pr, { name: 'Par préparateur' });
    const denied = await t.app.inject({ method: 'POST', url: '/api/v1/suppliers', headers: H(ca), payload: { name: 'Par caissier' } });
    expect(denied.statusCode).toBe(403);
    const list = await t.app.inject({ url: '/api/v1/suppliers', headers: { cookie: ca.cookie } });
    expect(list.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------- R-02

describe('R-02 suggestion de commande déterministe', () => {
  beforeEach(() => seedSupplier(t.db, { id: 'sp1', name: 'Laborex', leadDays: 2 }));

  it('R-02 seuils définis et stock ≤ min : quantité = max(0, max − stock − en_commande)', () => {
    activeProduct('p1', 'Amoxicilline', 8, { min: 10, max: 50 });
    activeProduct('p2', 'Paracétamol', 12, { min: 10, max: 50 }); // au-dessus du min : rien
    activeProduct('p3', 'Ibuprofène', 15, { min: 15, max: 20 }); // 20 − 15 − 10 < 0 → 0 → absent
    seedSupplier(t.db, { id: 'sp2', name: 'Autre', leadDays: 7 });
    // En commande : p1 → 5 (envoyée), p3 → 10 (partielle, 12 commandés, 2 reçus) ; un brouillon ne compte pas.
    const sent = createOrder(t.s, tit.userId, { supplier_id: 'sp2', lines: [{ product_id: 'p1', qty: 5 }] });
    sendOrder(t.s, tit.userId, sent.id);
    const partial = createOrder(t.s, tit.userId, { supplier_id: 'sp2', lines: [{ product_id: 'p3', qty: 12 }] });
    sendOrder(t.s, tit.userId, partial.id);
    t.db.prepare('UPDATE po_lines SET qty_received = 2 WHERE po_id = ?').run(partial.id);
    t.db.prepare("UPDATE purchase_orders SET status = 'partial' WHERE id = ?").run(partial.id);
    createOrder(t.s, tit.userId, { supplier_id: 'sp2', lines: [{ product_id: 'p1', qty: 100 }] }); // brouillon

    const sug = suggestOrder(t.s, 'sp1');
    expect(sug.supplier).toMatchObject({ id: 'sp1', lead_days: 2 });
    expect(sug.items).toEqual([
      {
        product_id: 'p1',
        name: 'Amoxicilline',
        stock: 8,
        on_order: 5,
        sales_30d: 0,
        min_qty: 10,
        max_qty: 50,
        rule: 'thresholds',
        qty: 37,
      },
    ]);
  });

  it('R-02 sans seuil : quantité = arrondi supérieur de ventes_30j × (délai + 7) / 30 − stock − en_commande', () => {
    t.clock.set('2026-10-27T08:00:00.000Z');
    activeProduct('p1', 'Amoxicilline', 3); // 30 ventes × 9 / 30 = 9 ; − 3 − 2 = 4
    activeProduct('p2', 'Ibuprofène', 0); // 7 × 9 / 30 = 2,1 → 3
    activeProduct('p3', 'Zinc', 5); // 10 × 9 / 30 = 3 → 3 − 5 < 0 → absent
    activeProduct('p4', 'Vitamine C', 0); // ventes trop anciennes ou annulées : 0 → absent
    seedSale(t.db, { productId: 'p1', lotId: 'lot-p1', qty: 20, userId: tit.userId, at: '2026-10-20T10:00:00.000Z' });
    seedSale(t.db, { productId: 'p1', lotId: 'lot-p1', qty: 10, userId: tit.userId, at: '2026-09-27T08:00:00.000Z' }); // limite incluse
    seedSale(t.db, { productId: 'p1', lotId: 'lot-p1', qty: 99, userId: tit.userId, at: '2026-09-27T07:59:59.000Z' }); // hors fenêtre
    seedSale(t.db, { productId: 'p2', lotId: 'lot-p2', qty: 7, userId: tit.userId, at: '2026-10-25T10:00:00.000Z' });
    seedSale(t.db, { productId: 'p3', lotId: 'lot-p3', qty: 10, userId: tit.userId, at: '2026-10-25T10:00:00.000Z' });
    seedSale(t.db, { productId: 'p4', lotId: 'lot-p4', qty: 50, userId: tit.userId, at: '2026-10-25T10:00:00.000Z', status: 'voided' });
    seedSale(t.db, { productId: 'p4', lotId: 'lot-p4', qty: 50, userId: tit.userId, at: '2026-08-01T10:00:00.000Z' });
    seedSale(t.db, { productId: 'p4', lotId: 'lot-p4', qty: 90, userId: tit.userId, at: '2026-10-27T08:00:00.001Z' });
    seedSupplier(t.db, { id: 'sp2', name: 'Autre' });
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp2', lines: [{ product_id: 'p1', qty: 2 }] });
    sendOrder(t.s, tit.userId, o.id);

    const sug = suggestOrder(t.s, 'sp1');
    expect(sug.items.map((i) => [i.product_id, i.rule, i.sales_30d, i.qty])).toEqual([
      ['p1', 'sales', 30, 4],
      ['p2', 'sales', 7, 3],
    ]);
  });

  it('R-02 le délai du fournisseur change la suggestion ; seules les fiches actives sont considérées', () => {
    seedSupplier(t.db, { id: 'lent', name: 'Lent', leadDays: 23 }); // (23 + 7) / 30 = 1 → ventes_30j telles quelles
    activeProduct('p1', 'Amoxicilline', 0);
    seedSale(t.db, { productId: 'p1', lotId: 'lot-p1', qty: 10, userId: tit.userId, at: '2026-10-25T10:00:00.000Z' });
    seedProduct(t.db, { id: 'dormant', name: 'Dormant', minQty: 5, maxQty: 50 });
    seedProduct(t.db, { id: 'sleep', name: 'Endormi', status: 'sleeping', minQty: 5, maxQty: 50 });
    expect(suggestOrder(t.s, 'sp1').items.map((i) => [i.product_id, i.qty])).toEqual([['p1', 3]]);
    expect(suggestOrder(t.s, 'lent').items.map((i) => [i.product_id, i.qty])).toEqual([['p1', 10]]);
  });

  it('R-02 fournisseur inconnu → not_found ; route GET /orders/suggestions sous order.manage', async () => {
    expect(() => suggestOrder(t.s, '00000000-0000-4000-8000-000000000000')).toThrow(/introuvable/);
    activeProduct('p1', 'Amoxicilline', 1, { min: 2, max: 10 });
    const ok = await t.app.inject({ url: '/api/v1/orders/suggestions?supplier_id=sp1', headers: { cookie: tit.cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ supplier: { id: 'sp1' }, items: [{ product_id: 'p1', qty: 9 }] });
    const ca = await createAndLogin(t, tit, 'caisse1', 'caissier');
    const denied = await t.app.inject({ url: '/api/v1/orders/suggestions?supplier_id=sp1', headers: { cookie: ca.cookie } });
    expect(denied.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------- R-03

describe('R-03 bon de commande : cycle de vie', () => {
  beforeEach(() => {
    seedSupplier(t.db, { id: 'sp1', name: 'Laborex', leadDays: 2 });
    seedProduct(t.db, { id: 'p1', name: 'Amoxicilline 500 mg', strength: '500 mg', presentation: 'boîte de 12' });
    seedProduct(t.db, { id: 'p2', name: 'Paracétamol 1 g', status: 'active', activatedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('R-03 création : numéro BC-AAAA-NNNN séquentiel, brouillon, order.created, activation C-02 (cause order)', async () => {
    const a = await postOrder(t, tit, {
      supplier_id: 'sp1',
      lines: [
        { product_id: 'p1', qty: 10, unit_cost: 1200 },
        { product_id: 'p2', qty: 5 },
      ],
    });
    expect(a).toMatchObject({ number: 'BC-2026-0001', status: 'draft', supplier_name: 'Laborex', sent_at: null });
    expect(a.lines).toEqual([
      expect.objectContaining({ product_id: 'p1', product_name: 'Amoxicilline 500 mg', qty_ordered: 10, qty_received: 0, unit_cost: 1200 }),
      expect.objectContaining({ product_id: 'p2', qty_ordered: 5, unit_cost: null }),
    ]);
    const b = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p2', qty: 1 }] });
    expect(b.number).toBe('BC-2026-0002');
    expect(eventsOf(t.db, 'order.created')[0]).toEqual({
      po_id: a.id,
      number: 'BC-2026-0001',
      supplier_id: 'sp1',
      lines: [
        { product_id: 'p1', qty: 10, unit_cost: 1200 },
        { product_id: 'p2', qty: 5, unit_cost: null },
      ],
    });
    // C-02 : p1 (dormant) est activé avec la cause `order` ; p2 (déjà actif) ne produit pas d'événement.
    expect(eventsOf(t.db, 'catalog.item_activated')).toEqual([{ product_id: 'p1', cause: 'order' }]);
    expect(count("SELECT COUNT(*) AS n FROM products WHERE id = 'p1' AND status = 'active'")).toBe(1);
  });

  it('R-03 la numérotation dépend de l’année locale (Douala, UTC+1)', () => {
    t.clock.set('2026-12-31T23:30:00.000Z'); // déjà le 1er janvier 2027 à Douala
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: 'p2', qty: 1 }] });
    expect(o.number).toBe('BC-2027-0001');
  });

  it('R-03 création atomique : une ligne invalide n’écrit ni bon, ni compteur, ni événement', () => {
    expect(() =>
      createOrder(t.s, tit.userId, {
        supplier_id: 'sp1',
        lines: [{ product_id: 'p2', qty: 1 }, { product_id: 'inconnu', qty: 1 }],
      }),
    ).toThrow(/introuvable/);
    expect(count('SELECT COUNT(*) AS n FROM purchase_orders')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM counters')).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type LIKE 'order.%' OR type = 'catalog.item_activated'")).toBe(0);
  });

  it('R-03 validation : sans ligne, produit en double, quantité nulle ou fournisseur désactivé → 400', async () => {
    seedSupplier(t.db, { id: 'off', name: 'Fermé', active: 0 });
    const cases: Record<string, unknown>[] = [
      { supplier_id: 'sp1', lines: [] },
      { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1 }, { product_id: 'p1', qty: 2 }] },
      { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 0 }] },
      { supplier_id: 'off', lines: [{ product_id: 'p1', qty: 1 }] },
    ];
    for (const payload of cases) {
      const r = await t.app.inject({ method: 'POST', url: '/api/v1/orders', headers: H(tit), payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const missing = await t.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: H(tit),
      payload: { supplier_id: 'nope', lines: [{ product_id: 'p1', qty: 1 }] },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('R-03 sending is atomic; receipt-owned states cannot be cancelled or sent', async () => {
    const o = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 10 }, { product_id: 'p2', qty: 4 }] });
    const sendR = await t.app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/send`, headers: H(tit) });
    expect(sendR.statusCode).toBe(200);
    expect(sendR.json()).toMatchObject({ status: 'sent', sent_at: t.clock.now().toISOString() });
    const again = await t.app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/send`, headers: H(tit) });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'invalid_transition' });

    // Receipt states are fixtures only: R-04 owns quantity/status writes and its ledger event.
    t.db.prepare("UPDATE po_lines SET qty_received = 4 WHERE po_id = ? AND product_id = 'p1'").run(o.id);
    t.db.prepare("UPDATE purchase_orders SET status = 'partial' WHERE id = ?").run(o.id);
    expect(getOrder(t.s, o.id, true).status).toBe('partial');
    expect(() => cancelOrder(t.s, tit.userId, o.id, 'test')).toThrow(/transition/i);
    t.db.prepare('UPDATE po_lines SET qty_received = qty_ordered WHERE po_id = ?').run(o.id);
    t.db.prepare("UPDATE purchase_orders SET status = 'received', closed_at = ? WHERE id = ?")
      .run(t.clock.now().toISOString(), o.id);
    expect(getOrder(t.s, o.id, true)).toMatchObject({ status: 'received', closed_at: t.clock.now().toISOString() });
    // Depuis `received`, plus rien n'est permis.
    const cancelR = await t.app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/cancel`, headers: H(tit), payload: { reason: 'x' } });
    expect(cancelR.statusCode).toBe(409);
    expect(eventsOf(t.db, 'order.sent')).toEqual([
      { po_id: o.id, number: 'BC-2026-0001', supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 10, unit_cost: null }, { product_id: 'p2', qty: 4, unit_cost: null }] },
    ]);
  });

  it('R-03 annulation depuis draft et depuis sent, avec motif ; order.cancelled ; réémettre est interdit', async () => {
    const a = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1 }] });
    const b = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1 }] });
    sendOrder(t.s, tit.userId, b.id);
    for (const o of [a, b]) {
      const r = await t.app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/cancel`, headers: H(tit), payload: { reason: 'Doublon' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ status: 'cancelled', closed_at: t.clock.now().toISOString() });
    }
    expect(eventsOf(t.db, 'order.cancelled')).toEqual([
      { po_id: a.id, number: a.number, supplier_id: 'sp1', from: 'draft', reason: 'Doublon', lines: [{ product_id: 'p1', qty: 1, unit_cost: null }] },
      { po_id: b.id, number: b.number, supplier_id: 'sp1', from: 'sent', reason: 'Doublon', lines: [{ product_id: 'p1', qty: 1, unit_cost: null }] },
    ]);
    expect(() => sendOrder(t.s, tit.userId, a.id)).toThrow(/transition/i);
    // Table des transitions, exhaustive.
    const allowed: [string, string][] = [['draft', 'sent'], ['draft', 'cancelled'], ['sent', 'partial'], ['sent', 'received'], ['sent', 'cancelled'], ['partial', 'received']];
    for (const from of ['draft', 'sent', 'partial', 'received', 'cancelled']) {
      for (const to of ['draft', 'sent', 'partial', 'received', 'cancelled']) {
        const ok = allowed.some(([f, tt]) => f === from && tt === to);
        if (ok) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to), `${from} → ${to}`).toThrow(/transition/i);
      }
    }
  });

  it('R-03 modification des lignes en brouillon seulement (order.updated) ; 409 une fois envoyée', async () => {
    const o = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p2', qty: 1 }] });
    const r = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${o.id}`,
      headers: H(tit),
      payload: { lines: [{ product_id: 'p1', qty: 3, unit_cost: 900 }] },
    });
    expect(r.statusCode).toBe(200);
    const upd = r.json() as OrderOut;
    expect(upd.lines.map((l) => [l.product_id, l.qty_ordered, l.unit_cost])).toEqual([['p1', 3, 900]]);
    expect(eventsOf(t.db, 'order.updated')).toEqual([
      { po_id: o.id, number: o.number, supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 3, unit_cost: 900 }] },
    ]);
    // p1 était dormant : l'ajout en commande l'active (C-02).
    expect(eventsOf(t.db, 'catalog.item_activated')).toEqual([{ product_id: 'p1', cause: 'order' }]);
    sendOrder(t.s, tit.userId, o.id);
    const locked = await t.app.inject({ method: 'PATCH', url: `/api/v1/orders/${o.id}`, headers: H(tit), payload: { lines: [{ product_id: 'p2', qty: 2 }] } });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ code: 'invalid_transition' });
  });

  it('R-03 liste paginée, filtrable par statut et fournisseur', async () => {
    seedSupplier(t.db, { id: 'sp2', name: 'Ubipharm' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      t.clock.advance(1000);
      ids.push((await postOrder(t, tit, { supplier_id: i % 2 ? 'sp2' : 'sp1', lines: [{ product_id: 'p2', qty: 1 }] })).id);
    }
    sendOrder(t.s, tit.userId, ids[0]!);
    const page1 = await t.app.inject({ url: '/api/v1/orders?limit=2', headers: { cookie: tit.cookie } });
    expect(page1.statusCode).toBe(200);
    const b1 = page1.json() as { items: { id: string; number: string }[]; next_cursor: string | null };
    expect(b1.items.map((o) => o.number)).toEqual(['BC-2026-0005', 'BC-2026-0004']); // plus récent d'abord
    const page2 = await t.app.inject({ url: `/api/v1/orders?limit=2&cursor=${encodeURIComponent(b1.next_cursor!)}`, headers: { cookie: tit.cookie } });
    expect((page2.json() as { items: { number: string }[] }).items.map((o) => o.number)).toEqual(['BC-2026-0003', 'BC-2026-0002']);
    const sent = await t.app.inject({ url: '/api/v1/orders?status=sent', headers: { cookie: tit.cookie } });
    expect((sent.json() as { items: { id: string }[] }).items.map((o) => o.id)).toEqual([ids[0]]);
    const sp2 = await t.app.inject({ url: '/api/v1/orders?supplier_id=sp2', headers: { cookie: tit.cookie } });
    expect((sp2.json() as { items: { supplier_name: string }[] }).items.every((o) => o.supplier_name === 'Ubipharm')).toBe(true);
    expect((sp2.json() as { items: unknown[] }).items).toHaveLength(2);
  });

  it('R-03 export texte prêt pour WhatsApp : officine, numéro, fournisseur, lignes, sans coût', async () => {
    const o = await postOrder(t, tit, {
      supplier_id: 'sp1',
      lines: [{ product_id: 'p1', qty: 10, unit_cost: 1200 }, { product_id: 'p2', qty: 5 }],
    });
    const r = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=text`, headers: { cookie: tit.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/plain/);
    const text = r.body;
    expect(text).toContain('Pharmacie du Centre');
    expect(text).toContain('BC-2026-0001');
    expect(text).toContain('Laborex');
    expect(text).toMatch(/10\s*×\s*Amoxicilline 500 mg/);
    expect(text).toMatch(/5\s*×\s*Paracétamol 1 g/);
    expect(text).toContain('boîte de 12');
    expect(text).not.toContain('1200');
    expect(text).not.toContain('<');
  });

  it('R-03 actual PDF: valid offsets, page streams, A4/80mm dimensions and cost masking', async () => {
    const o = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 10, unit_cost: 1200 }] });
    const a4 = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=pdf`, headers: { cookie: tit.cookie } });
    expect(a4.statusCode).toBe(200);
    expect(a4.headers['content-type']).toMatch(/^application\/pdf/);
    expect(a4.headers['content-disposition']).toContain('BC-2026-0001.pdf');
    expect(a4.headers['cache-control']).toBe('no-store');
    const doc = inspectPdf(a4.rawPayload);
    expect(doc.widths).toEqual([595.28]);
    expect(doc.text).toContain('BC-2026-0001');
    expect(doc.text).toContain('1 200 XAF');
    expect(doc.text).toContain('Pharmacie du Centre');
    expect(doc.text).toContain('boîte de 12');
    expect(a4.body).not.toMatch(/\/JavaScript|\/URI|\/Launch|<!doctype/);
    const ticket = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=pdf&paper=80mm`, headers: { cookie: tit.cookie } });
    expect(inspectPdf(ticket.rawPayload).widths).toEqual([226.77]);
    const pr = await createAndLogin(t, tit, 'prepa1', 'preparateur');
    const masked = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=pdf`, headers: { cookie: pr.cookie } });
    expect(masked.statusCode).toBe(200);
    expect(inspectPdf(masked.rawPayload).text).not.toContain('1 200');
    const bad = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=docx`, headers: { cookie: tit.cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('R-03 unknown export is 404; PDF metacharacters remain literal text', async () => {
    seedProduct(t.db, { id: 'p3', name: 'Sirop (toux) \\ miel <fort> & "doux"' });
    const o = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p3', qty: 1 }] });
    const pdf = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=pdf`, headers: { cookie: tit.cookie } });
    expect(inspectPdf(pdf.rawPayload).text).toContain('Sirop (toux) \\ miel <fort> & "doux"');
    const r = await t.app.inject({ url: '/api/v1/orders/00000000-0000-4000-8000-000000000000/export?format=text', headers: { cookie: tit.cookie } });
    expect(r.statusCode).toBe(404);
  });

  it('R-03 PDF wraps and paginates without losing lines, deterministically', () => {
    const lines = Array.from({ length: 70 }, (_, i) => {
      const id = `pdf-${String(i).padStart(3, '0')}`;
      seedProduct(t.db, { id, name: `Produit ${i} ${'long '.repeat(25)}` });
      return { product_id: id, qty: i + 1 };
    });
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines });
    for (const paper of ['A4', '80mm'] as const) {
      const result = exportOrder(t.s, o.id, 'pdf', false, paper);
      expect(Buffer.isBuffer(result.body)).toBe(true);
      const pdf = inspectPdf(result.body as Buffer);
      expect(pdf.pages).toBeGreaterThan(1);
      expect(pdf.text).toContain('1 × Produit 0');
      expect(pdf.text).toContain('70 × Produit 69');
      expect(exportOrder(t.s, o.id, 'pdf', false, paper).body).toEqual(result.body);
    }
  });

  it('R-03 unsupported PDF glyphs fail explicitly instead of silently changing product names', async () => {
    seedProduct(t.db, { id: 'unicode', name: 'Sirop 药' });
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: 'unicode', qty: 1 }] });
    const pdf = await t.app.inject({ url: `/api/v1/orders/${o.id}/export?format=pdf`, headers: { cookie: tit.cookie } });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json()).toMatchObject({ code: 'validation_failed', reason: 'pdf_unsupported_character' });
    expect(exportOrder(t.s, o.id, 'text', false).body).toContain('Sirop 药');
  });

  it('R-03 failed ledger appends roll back suppliers, activation, counters and order transitions', () => {
    const sp = createSupplier(t.s, tit.userId, { name: 'Original' });
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: 'p2', qty: 1 }] });
    const before = t.ledger.head();
    const append = t.ledger.append.bind(t.ledger);
    vi.spyOn(t.ledger, 'append').mockImplementation((type, actor, payload) => {
      const event = append(type, actor, payload);
      if (type !== 'catalog.item_activated') throw new Error('Injected ledger failure');
      return event;
    });
    expect(() => createSupplier(t.s, tit.userId, { name: 'Rolled back' })).toThrow('Injected');
    expect(() => updateSupplier(t.s, tit.userId, sp.id, { name: 'Changed' })).toThrow('Injected');
    expect(getSupplier(t.s, sp.id).name).toBe('Original');
    expect(count("SELECT COUNT(*) AS n FROM suppliers WHERE name = 'Rolled back'")).toBe(0);
    expect(() => createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 2 }] })).toThrow('Injected');
    expect(count('SELECT COUNT(*) AS n FROM purchase_orders')).toBe(1);
    expect(count('SELECT SUM(value) AS n FROM counters')).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM products WHERE id = 'p1' AND status = 'dormant'")).toBe(1);
    expect(() => sendOrder(t.s, tit.userId, o.id)).toThrow('Injected');
    expect(getOrder(t.s, o.id)).toMatchObject({ status: 'draft', sent_at: null });
    expect(() => cancelOrder(t.s, tit.userId, o.id, 'Rollback')).toThrow('Injected');
    expect(getOrder(t.s, o.id)).toMatchObject({ status: 'draft', closed_at: null });
    expect(t.ledger.head()).toEqual(before);
  });

  it('R-03 domain rejects invalid quantities and cannot receive through generic order editing', async () => {
    for (const qty of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty }] }))
        .toThrow();
    }
    const o = await postOrder(t, tit, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1 }] });
    for (const payload of [{ status: 'received' }, { lines: [{ product_id: 'p1', qty: 1, qty_received: 1 }] }, { note: 'No schema column' }]) {
      const r = await t.app.inject({ method: 'PATCH', url: `/api/v1/orders/${o.id}`, headers: H(tit), payload });
      expect(r.statusCode).toBe(400);
    }
    expect(getOrder(t.s, o.id).lines[0]?.qty_received).toBe(0);
    expect(eventsOf(t.db, 'reception.recorded')).toEqual([]);
  });

  it('R-03 writes require CSRF and anonymous reads require a session', async () => {
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: 'p2', qty: 1 }] });
    const missing = await t.app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/send`, headers: { cookie: tit.cookie } });
    expect(missing.statusCode).toBe(403);
    expect((await t.app.inject({ url: '/api/v1/orders' })).statusCode).toBe(401);
    expect(getOrder(t.s, o.id).status).toBe('draft');
  });

  it('R-03 droits : titulaire, pharmacien, préparateur créent et envoient ; le caissier est refusé partout (V-10 : coûts masqués au préparateur)', async () => {
    const ph = await createAndLogin(t, tit, 'pharma1', 'pharmacien');
    const pr = await createAndLogin(t, tit, 'prepa1', 'preparateur');
    const ca = await createAndLogin(t, tit, 'caisse1', 'caissier');
    const byPh = await postOrder(t, ph, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1, unit_cost: 700 }] });
    const byPr = await postOrder(t, pr, { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1, unit_cost: 700 }] });
    expect(byPr.lines[0]?.unit_cost).toBeNull(); // le préparateur a saisi le coût mais ne le relit pas
    const stored = t.db.prepare('SELECT unit_cost FROM po_lines WHERE po_id = ?').get(byPr.id) as { unit_cost: number };
    expect(stored.unit_cost).toBe(700);
    expect((await t.app.inject({ method: 'POST', url: `/api/v1/orders/${byPh.id}/send`, headers: H(pr) })).statusCode).toBe(200);
    const phView = await t.app.inject({ url: `/api/v1/orders/${byPr.id}`, headers: { cookie: ph.cookie } });
    expect((phView.json() as OrderOut).lines[0]?.unit_cost).toBe(700);
    for (const [method, url] of [
      ['POST', '/api/v1/orders'],
      ['GET', '/api/v1/orders'],
      ['GET', `/api/v1/orders/${byPh.id}`],
      ['POST', `/api/v1/orders/${byPr.id}/send`],
      ['POST', `/api/v1/orders/${byPr.id}/cancel`],
      ['GET', `/api/v1/orders/${byPh.id}/export?format=text`],
    ] as const) {
      const r = await t.app.inject({ method, url, headers: H(ca), payload: method === 'GET' ? undefined : { supplier_id: 'sp1', lines: [{ product_id: 'p1', qty: 1 }] } });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
