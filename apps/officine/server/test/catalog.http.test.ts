import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTx } from '../src/db/index.js';
import { activateProduct } from '../src/domain/catalog.js';
import { csv, seedMany } from './catalog.helpers.js';
import { createAndLogin, makeApp, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';

interface Report {
  import_id: string;
  sha256: string;
  lines_total: number;
  inserted: number;
  updated: number;
  rejected: number;
  unknown_columns: string[];
  errors: { line: number; ref_code: string | null; reason: string }[];
  conflicts: { line: number; code: string; product_id: string }[];
}

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });

async function importCsv(text: string): Promise<Report> {
  await reauth(t, tit, STRONG, tit.totpSecret);
  const r = await t.app.inject({
    method: 'POST',
    url: '/api/v1/catalog/import',
    headers: { ...H(tit), 'content-type': 'text/csv' },
    payload: text,
  });
  if (r.statusCode !== 200) throw new Error(`import ${r.statusCode} ${r.body}`);
  return r.json() as Report;
}

const search = (q: string, extra = '') =>
  t.app.inject({ url: `/api/v1/products?q=${encodeURIComponent(q)}${extra}`, headers: { cookie: tit.cookie } });

const itemsOf = (r: { json(): unknown }) => (r.json() as { items: { id: string; ref_code: string | null; status: string }[] }).items;

const idOf = (ref: string) =>
  (t.db.prepare('SELECT id FROM products WHERE ref_code = ?').get(ref) as { id: string }).id;

const count = (sql: string, ...params: string[]) =>
  (t.db.prepare(sql).get(...params) as { n: number }).n;

describe('C-01 recherche dans tout le catalogue', () => {
  it('C-01 recherche par nom, DCI, dosage et code-barres, insensible à la casse et aux accents', async () => {
    await importCsv(
      csv(
        'VP-1;Paracétamol codéiné;paracétamol;500 mg;gélule;boîte de 20;medicament;1;0;3;ambiant;1200;03400000000005',
      ),
    );
    for (const q of ['PARACETAMOL', 'paracétamol', '500 mg', 'gelule', 'CODEINE', '03400000000005']) {
      const r = await search(q);
      expect(r.statusCode, q).toBe(200);
      expect(itemsOf(r).map((i) => i.ref_code), q).toEqual(['VP-1']);
    }
  });

  it('C-01 les fiches actives apparaissent avant les dormantes', async () => {
    await importCsv(
      csv(
        'VP-1;Paracétamol;;500 mg;comprimé;boîte de 20;medicament;1;0;3;ambiant;1000;',
        'VP-2;Paracétamol codéine;;500 mg;comprimé;boîte de 20;medicament;1;0;3;ambiant;1500;',
        'VP-3;Paracétamol enfant;;100 mg;sirop;flacon;medicament;1;0;3;ambiant;900;',
      ),
    );
    const target = idOf('VP-3');
    writeTx(t.db, () => activateProduct(t.s, tit.userId, target, 'reception'));
    const r = await search('paracetamol');
    const items = itemsOf(r);
    expect(items[0]).toMatchObject({ id: target, status: 'active' });
    expect(items.filter((i) => i.status === 'dormant')).toHaveLength(2);
  });

  it('C-01 pagination par curseur, sans doublon ni omission', async () => {
    const rows = [1, 2, 3, 4, 5].map(
      (i) => `VP-${i};Paracétamol ${i};;${i}00 mg;comprimé;boîte de ${i};medicament;1;0;3;ambiant;1000;`,
    );
    await importCsv(csv(...rows));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const r = await t.app.inject({
        url: `/api/v1/products?q=paracetamol&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: { cookie: tit.cookie },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { items: { id: string }[]; next_cursor: string | null };
      seen.push(...body.items.map((i) => i.id));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('C-01 50 000 fiches : réponse sous 150 ms au 95e centile', async () => {
    seedMany(t.db, 50_000);
    await search('amoxicilline'); // préchauffage
    const queries = ['amox', 'amoxicilline', '500 mg', 'gelule', 'paracetamol', 'zinc', 'paracetamol mg', 'ibuprofene 200'];
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const started = performance.now();
      const r = await search(queries[i % queries.length] as string);
      times.push(performance.now() - started);
      expect(r.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] as number;
    expect(p95).toBeLessThan(150);
  }, 60_000);
});

describe('C-03 code-barres inconnu', () => {
  it('C-03 code inconnu : proposition puis association à une fiche existante (catalog.barcode_linked)', async () => {
    await importCsv(csv('VP-1;Amoxicilline;amoxicilline;500 mg;gélule;boîte de 12;medicament;1;0;3;ambiant;;'));
    const scan = '01034000000000051728123110LOT42';
    const before = await t.app.inject({
      url: `/api/v1/products/by-barcode/${encodeURIComponent(scan)}`,
      headers: { cookie: tit.cookie },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      found: false,
      gs1: { gtin: '03400000000005', lot: 'LOT42', expiry: '2028-12-31' },
    });
    const id = idOf('VP-1');
    const link = await t.app.inject({
      method: 'POST',
      url: `/api/v1/products/${id}/barcodes`,
      headers: H(tit),
      payload: { code: scan },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json()).toMatchObject({ created: true, product: { id } });
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type = 'catalog.barcode_linked'")).toBe(1);
    const after = await t.app.inject({
      url: '/api/v1/products/by-barcode/03400000000005',
      headers: { cookie: tit.cookie },
    });
    expect(after.json()).toMatchObject({ found: true, product: { ref_code: 'VP-1' } });
  });

  it('C-03 code inconnu : création d’une fiche locale local_only=1 (catalog.local_item_created)', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/v1/products/local',
      headers: H(tit),
      payload: { name: 'Sérum physiologique 5 ml', category: 'dispositif', barcode: 'INT-0001' },
    });
    expect(r.statusCode).toBe(201);
    const p = r.json() as { id: string; local_only: boolean; status: string; ref_code: string | null };
    expect(p).toMatchObject({ local_only: true, status: 'active', ref_code: null });
    const ev = t.db
      .prepare("SELECT payload FROM events WHERE type = 'catalog.local_item_created'")
      .get() as { payload: string };
    expect(JSON.parse(ev.payload)).toMatchObject({ product_id: p.id, name: 'Sérum physiologique 5 ml' });
    const scan = await t.app.inject({
      url: '/api/v1/products/by-barcode/INT-0001',
      headers: { cookie: tit.cookie },
    });
    expect(scan.json()).toMatchObject({ found: true, product: { id: p.id } });
  });

  it('C-03 un code déjà associé à une autre fiche renvoie 409 barcode_taken', async () => {
    await importCsv(
      csv(
        'VP-1;Produit A;;;gélule;;medicament;;;3;ambiant;;03400000000005',
        'VP-2;Produit B;;;gélule;;medicament;;;3;ambiant;;',
      ),
    );
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/v1/products/${idOf('VP-2')}/barcodes`,
      headers: H(tit),
      payload: { code: '03400000000005' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'barcode_taken' });
  });

  it('C-03 le caissier ne peut ni associer ni créer de fiche locale (403)', async () => {
    await importCsv(csv('VP-1;Produit A;;;gélule;;medicament;;;3;ambiant;;'));
    const c = await createAndLogin(t, tit, 'caisse1', 'caissier');
    const id = idOf('VP-1');
    const link = await t.app.inject({
      method: 'POST',
      url: `/api/v1/products/${id}/barcodes`,
      headers: H(c),
      payload: { code: 'INT-0002' },
    });
    expect(link.statusCode).toBe(403);
    const local = await t.app.inject({
      method: 'POST',
      url: '/api/v1/products/local',
      headers: H(c),
      payload: { name: 'Fiche locale', category: 'autre' },
    });
    expect(local.statusCode).toBe(403);
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type = 'catalog.barcode_linked'")).toBe(0);
  });
});

describe('C-06 prix de vente de l’officine', () => {
  it('C-06 titulaire et pharmacien modifient le prix ; le prix conseillé reste visible ; catalog.price_changed', async () => {
    await importCsv(csv('VP-1;Amoxicilline;amoxicilline;500 mg;gélule;boîte de 12;medicament;1;0;3;ambiant;1500;'));
    const id = idOf('VP-1');
    const a = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${id}/price`,
      headers: H(tit),
      payload: { sale_price: 1800 },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ sale_price: 1800, suggested_price: 1500, status: 'dormant' });
    const ph = await createAndLogin(t, tit, 'pharma1', 'pharmacien');
    const b = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/products/${id}/price`,
      headers: H(ph),
      payload: { sale_price: 2000 },
    });
    expect(b.statusCode).toBe(200);
    const payloads = (
      t.db.prepare("SELECT payload FROM events WHERE type = 'catalog.price_changed' ORDER BY seq").all() as {
        payload: string;
      }[]
    ).map((r) => JSON.parse(r.payload));
    expect(payloads).toEqual([
      { product_id: id, old_price: null, new_price: 1800 },
      { product_id: id, old_price: 1800, new_price: 2000 },
    ]);
    // C-02 : un changement de prix n'active pas la fiche.
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type = 'catalog.item_activated'")).toBe(0);
  });

  it('C-06 préparateur et caissier ne peuvent pas modifier le prix (403)', async () => {
    await importCsv(csv('VP-1;Produit;;;gélule;;medicament;;;3;ambiant;;'));
    const id = idOf('VP-1');
    for (const [name, role] of [
      ['prepa1', 'preparateur'],
      ['caisse2', 'caissier'],
    ] as const) {
      const a = await createAndLogin(t, tit, name, role);
      const r = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/products/${id}/price`,
        headers: H(a),
        payload: { sale_price: 1000 },
      });
      expect(r.statusCode, role).toBe(403);
    }
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type = 'catalog.price_changed'")).toBe(0);
  });

  it('C-06 un prix négatif ou non entier est refusé (400 validation_failed)', async () => {
    await importCsv(csv('VP-1;Produit;;;gélule;;medicament;;;3;ambiant;;'));
    const id = idOf('VP-1');
    for (const sale_price of [-1, 1.5]) {
      const r = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/products/${id}/price`,
        headers: H(tit),
        payload: { sale_price },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ code: 'validation_failed' });
    }
  });
});

describe('I-04 import HTTP', () => {
  it('I-04 l’import exige une session titulaire ré-authentifiée ; le caissier est refusé', async () => {
    const text = csv('VP-1;Produit;;;gélule;;medicament;;;3;ambiant;;');
    const noReauth = await t.app.inject({
      method: 'POST',
      url: '/api/v1/catalog/import',
      headers: { ...H(tit), 'content-type': 'text/csv' },
      payload: text,
    });
    expect(noReauth.statusCode).toBe(401);
    expect(noReauth.json()).toMatchObject({ code: 'reauth_required' });
    const c = await createAndLogin(t, tit, 'caisse3', 'caissier');
    await reauth(t, tit, STRONG, tit.totpSecret);
    const forbidden = await t.app.inject({
      method: 'POST',
      url: '/api/v1/catalog/import',
      headers: { ...H(c), 'content-type': 'text/csv' },
      payload: text,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: 'forbidden' });
    const report = await importCsv(text);
    expect(report).toMatchObject({ lines_total: 1, inserted: 1, rejected: 0 });
  });

  it('I-04 sans jeton CSRF, l’import est refusé (403)', async () => {
    await reauth(t, tit, STRONG, tit.totpSecret);
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/v1/catalog/import',
      headers: { cookie: tit.cookie, 'content-type': 'text/csv' },
      payload: csv('VP-1;Produit;;;gélule;;medicament;;;3;ambiant;;'),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ code: 'csrf_failed' });
  });

  it('I-04 le rapport d’import est renvoyé au client', async () => {
    const r = await importCsv(
      csv('VP-1;Produit;;;gélule;;medicament;;;3;ambiant;;', 'VP-2;X;;;gélule;;INVALIDE;;;3;ambiant;;'),
    );
    expect(r).toMatchObject({
      lines_total: 2,
      inserted: 1,
      rejected: 1,
      errors: [{ line: 3, ref_code: 'VP-2', reason: 'category_invalid' }],
    });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.import_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Lecture du catalogue', () => {
  it('la fiche produit expose les codes-barres et le stock par lot, coûts masqués sans droit', async () => {
    await importCsv(csv('VP-1;Produit;;;gélule;;medicament;;;3;ambiant;;03400000000005'));
    const id = idOf('VP-1');
    t.db
      .prepare("INSERT INTO lots (id, product_id, lot_number, expiry, unit_cost, created_at) VALUES ('l1', ?, 'A1', '2027-01-31', 900, '2026-10-27T08:00:00.000Z')")
      .run(id);
    const r = await t.app.inject({ url: `/api/v1/products/${id}`, headers: { cookie: tit.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id,
      barcodes: [{ code: '03400000000005', kind: 'gtin' }],
      lots: [{ lot_number: 'A1', qty: 0, unit_cost: 900 }],
    });
    const c = await createAndLogin(t, tit, 'caisse4', 'caissier');
    const masked = await t.app.inject({ url: `/api/v1/products/${id}`, headers: { cookie: c.cookie } });
    expect((masked.json() as { lots: { unit_cost: number | null }[] }).lots[0]?.unit_cost).toBeNull();
  });
});
