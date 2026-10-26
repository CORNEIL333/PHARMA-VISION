import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTx } from '../src/db/index.js';
import { activateProduct, sweepSleepingProducts } from '../src/domain/catalog.js';
import { searchProducts } from '../src/domain/search.js';
import { verifyLedger } from '../src/domain/verify.js';
import { seedProduct } from './catalog.helpers.js';
import { keyMap, makeApp, setupTitulaire, type TestApp } from './helpers.js';

let t: TestApp;
let actor: string;
beforeEach(async () => {
  t = await makeApp();
  actor = (await setupTitulaire(t)).userId;
});
afterEach(() => t.cleanup());

const events = (type: string) =>
  t.db.prepare('SELECT payload FROM events WHERE type = ? ORDER BY seq').all(type) as { payload: string }[];

const statusOf = (id: string) =>
  (t.db.prepare('SELECT status, activated_at FROM products WHERE id = ?').get(id) as {
    status: string;
    activated_at: string | null;
  });

describe('C-02 activation par un événement réel', () => {
  it('C-02 une fiche dormante devient active au premier événement réel, l’événement porte la cause', () => {
    const causes = ['reception', 'inventory', 'order', 'regul_sale'] as const;
    causes.forEach((_, i) => seedProduct(t.db, { id: `p${i}`, name: `Produit ${i}` }));
    causes.forEach((cause, i) => {
      expect(writeTx(t.db, () => activateProduct(t.s, actor, `p${i}`, cause))).toBe(true);
    });
    expect(events('catalog.item_activated').map((e) => JSON.parse(e.payload).cause)).toEqual([...causes]);
    for (let i = 0; i < causes.length; i++) {
      expect(statusOf(`p${i}`)).toMatchObject({ status: 'active', activated_at: t.clock.now().toISOString() });
    }
  });

  it('C-02 une fiche déjà active n’émet pas un second événement et garde sa date d’activation', () => {
    seedProduct(t.db, { id: 'p1', name: 'Produit', status: 'active', activatedAt: '2026-01-01T00:00:00.000Z' });
    expect(writeTx(t.db, () => activateProduct(t.s, actor, 'p1', 'reception'))).toBe(false);
    expect(events('catalog.item_activated')).toEqual([]);
    expect(statusOf('p1').activated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('C-02 une recherche seule n’active rien', () => {
    seedProduct(t.db, { id: 'p1', name: 'Amoxicilline 500 mg' });
    const found = searchProducts(t.s, { q: 'amoxicilline' });
    expect(found.items.map((p) => p.id)).toEqual(['p1']);
    expect(statusOf('p1').status).toBe('dormant');
    expect(events('catalog.item_activated')).toEqual([]);
  });

  it('C-02 l’activation exige la transaction de l’événement réel', () => {
    seedProduct(t.db, { id: 'p1', name: 'Produit' });
    expect(() => activateProduct(t.s, actor, 'p1', 'reception')).toThrow(/transaction/);
    expect(statusOf('p1').status).toBe('dormant');
  });
});

describe('C-05 mise en sommeil après douze mois', () => {
  it('C-05 une fiche sans vente ni stock depuis 12 mois passe en sleeping, avec horloge injectée', () => {
    seedProduct(t.db, {
      id: 'vieille',
      name: 'Ancienne',
      status: 'active',
      activatedAt: '2024-01-01T00:00:00.000Z',
      lastActivity: '2025-09-01T00:00:00.000Z',
    });
    seedProduct(t.db, {
      id: 'recente',
      name: 'Récente',
      status: 'active',
      activatedAt: '2026-05-01T00:00:00.000Z',
      lastActivity: '2026-09-01T00:00:00.000Z',
    });
    const r = sweepSleepingProducts(t.s);
    expect(r.slept).toEqual(['vieille']);
    expect(statusOf('vieille').status).toBe('sleeping');
    expect(statusOf('recente').status).toBe('active');
    expect(events('catalog.item_sleeping').map((e) => JSON.parse(e.payload).product_id)).toEqual(['vieille']);
    expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
  });

  it('C-05 une fiche endormie redevient active au prochain événement réel', () => {
    seedProduct(t.db, { id: 'p1', name: 'Produit', status: 'sleeping', activatedAt: '2024-01-01T00:00:00.000Z' });
    expect(writeTx(t.db, () => activateProduct(t.s, actor, 'p1', 'inventory'))).toBe(true);
    expect(statusOf('p1')).toMatchObject({ status: 'active', activated_at: '2024-01-01T00:00:00.000Z' });
    expect(events('catalog.item_activated').map((e) => JSON.parse(e.payload).cause)).toEqual(['inventory']);
  });

  it('C-05 le balayage n’endort jamais une fiche dormante', () => {
    seedProduct(t.db, { id: 'p1', name: 'Produit', status: 'dormant', lastActivity: '2020-01-01T00:00:00.000Z' });
    expect(sweepSleepingProducts(t.s).slept).toEqual([]);
    expect(statusOf('p1').status).toBe('dormant');
  });
});
