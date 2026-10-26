import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importCatalog } from '../src/domain/catalogImport.js';
import { verifyLedger } from '../src/domain/verify.js';
import { AppError } from '../src/errors.js';
import { CSV_HEADER, csv, csvWithHeader } from './catalog.helpers.js';
import { keyMap, makeApp, setupTitulaire, type TestApp } from './helpers.js';

let t: TestApp;
let actor: string;
beforeEach(async () => {
  t = await makeApp();
  actor = (await setupTitulaire(t)).userId;
});
afterEach(() => t.cleanup());

const run = (text: string, filename: string | null = 'catalogue.csv') =>
  importCatalog(t.s, actor, Buffer.from(text, 'utf8'), filename);

const count = (sql: string, ...params: string[]) =>
  (t.db.prepare(sql).get(...params) as { n: number }).n;

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'no_error';
};

describe('I-04 import du catalogue', () => {
  it('I-04 CSV UTF-8 avec BOM et séparateur point-virgule : fiches dormantes, rapport produit', () => {
    const text =
      '\uFEFF' +
      csv(
        'VP-000001;Amoxicilline 500 mg gélule B/12;amoxicilline;500 mg;gélule;boîte de 12;medicament;1;0;2;ambiant;1500;',
        'VP-000002;"Paracétamol codéiné; 500 mg";paracétamol;500 mg;comprimé;boîte de 20;medicament;;0;3;ambiant;;',
      );
    const report = run(text);
    expect(report).toMatchObject({ lines_total: 2, inserted: 2, updated: 0, rejected: 0 });
    expect(report.errors).toEqual([]);
    const rows = t.db
      .prepare('SELECT ref_code, name, status, sale_price, rx_required, criticity FROM products ORDER BY ref_code')
      .all() as { ref_code: string; name: string; status: string; sale_price: number | null; rx_required: number; criticity: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ref_code: 'VP-000001',
      status: 'dormant',
      sale_price: null,
      rx_required: 1,
      criticity: 2,
    });
    // Guillemets : le point-virgule du nom est conservé.
    expect(rows[1]?.name).toBe('Paracétamol codéiné; 500 mg');
    // rx_required par défaut = 1 pour un médicament.
    expect(rows[1]?.rx_required).toBe(1);
    expect(codeOf(() => verifyLedger(t.db, t.keys.identity.node_id, keyMap(t)))).toBe('no_error');
  });

  it('I-04 une ligne invalide est rejetée avec son numéro et sa raison, les autres sont importées', () => {
    const report = run(
      csv(
        'VP-1;Produit un;;;gélule;;medicament;;;3;ambiant;;',
        'VP-2;Produit deux;;;gélule;;INCONNUE;;;3;ambiant;;',
        'VP-3;Produit trois;;;gélule;;medicament;;;3;ambiant;;',
      ),
    );
    expect(report).toMatchObject({ lines_total: 3, inserted: 2, rejected: 1 });
    expect(report.errors).toEqual([{ line: 3, ref_code: 'VP-2', reason: 'category_invalid' }]);
    expect(count('SELECT COUNT(*) AS n FROM products')).toBe(2);
  });

  it('I-04 réimport par ref_code : mise à jour du référentiel sans toucher stock, prix local ni seuils', () => {
    run(csv('VP-1;Amoxicilline 500 mg;amoxicilline;500 mg;gélule;boîte de 12;medicament;1;0;3;ambiant;1500;'));
    // L'officine règle son prix, ses seuils et possède un lot (stock).
    t.db
      .prepare("UPDATE products SET sale_price = 1800, min_qty = 5, max_qty = 40 WHERE ref_code = 'VP-1'")
      .run();
    const pid = (t.db.prepare("SELECT id FROM products WHERE ref_code = 'VP-1'").get() as { id: string }).id;
    t.db
      .prepare("INSERT INTO lots (id, product_id, lot_number, expiry, created_at) VALUES ('l1', ?, 'A1', '2027-01-31', '2026-10-27T08:00:00.000Z')")
      .run(pid);

    const report = run(
      csv('VP-1;Amoxicilline 1 g;amoxicilline;1 g;comprimé;boîte de 8;medicament;0;0;2;ambiant;2500;'),
    );
    expect(report).toMatchObject({ lines_total: 1, inserted: 0, updated: 1, rejected: 0 });
    expect(
      t.db
        .prepare('SELECT name, sale_price, min_qty, max_qty, suggested_price, status FROM products WHERE ref_code = ?')
        .get('VP-1'),
    ).toEqual({
      name: 'Amoxicilline 1 g',
      sale_price: 1800,
      min_qty: 5,
      max_qty: 40,
      suggested_price: 2500,
      status: 'dormant',
    });
    expect(count('SELECT COUNT(*) AS n FROM lots')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM products')).toBe(1);
  });

  it('I-04 GTIN invalide rejeté ; GTIN déjà associé signalé en conflit et non associé', () => {
    const g1 = '03400000000005';
    run(csv(`VP-A;Produit A;;;gélule;;medicament;;;3;ambiant;;${g1}`));
    const report = run(
      csv(
        `VP-B;Produit B;;;gélule;;medicament;;;3;ambiant;;${g1}`,
        'VP-C;Produit C;;;gélule;;medicament;;;3;ambiant;;03400000000001',
      ),
    );
    expect(report).toMatchObject({ inserted: 1, updated: 0, rejected: 1 });
    expect(report.errors).toEqual([{ line: 3, ref_code: 'VP-C', reason: 'gtin_invalid' }]);
    expect(report.conflicts).toEqual([{ line: 2, code: g1, product_id: expect.any(String) }]);
    const owners = t.db.prepare('SELECT code, product_id FROM barcodes').all() as {
      code: string;
      product_id: string;
    }[];
    expect(owners.map((o) => o.code)).toEqual([g1]);
    expect(count("SELECT COUNT(*) AS n FROM products WHERE ref_code = 'VP-B'")).toBe(1);
  });

  it('I-04 l’import émet catalog.imported avec l’empreinte SHA-256 du fichier', () => {
    const text = csv('VP-1;Produit un;;;gélule;;medicament;;;3;ambiant;;');
    const report = run(text);
    const sha = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    expect(report.sha256).toBe(sha);
    const ev = t.db
      .prepare("SELECT payload FROM events WHERE type = 'catalog.imported' ORDER BY seq DESC LIMIT 1")
      .get() as { payload: string };
    expect(JSON.parse(ev.payload)).toMatchObject({
      sha256: sha,
      lines_total: 1,
      inserted: 1,
      updated: 0,
      rejected: 0,
      import_id: report.import_id,
    });
    // Le rapport est conservé en base.
    expect(
      t.db.prepare('SELECT sha256, inserted FROM catalog_imports WHERE id = ?').get(report.import_id),
    ).toMatchObject({ sha256: sha, inserted: 1 });
  });

  it('I-04 colonnes inconnues ignorées et signalées dans le rapport', () => {
    const report = run(
      csvWithHeader(
        `${CSV_HEADER};remarque`,
        'VP-1;Produit un;;;gélule;;medicament;;;3;ambiant;;;à vérifier',
      ),
    );
    expect(report.unknown_columns).toEqual(['remarque']);
    expect(report.inserted).toBe(1);
  });

  it('I-04 l’import ne fait que créer des fiches dormantes : aucun événement d’activation', () => {
    run(csv('VP-1;Produit un;;;gélule;;medicament;;;3;ambiant;;'));
    expect(count("SELECT COUNT(*) AS n FROM events WHERE type = 'catalog.item_activated'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM products WHERE status <> 'dormant'")).toBe(0);
  });

  it('I-04 fichier sans les colonnes obligatoires ou vide : refusé', () => {
    expect(codeOf(() => run('ref_code;name\nVP-1;X\n'))).toBe('validation_failed');
    expect(codeOf(() => run(''))).toBe('validation_failed');
    expect(count('SELECT COUNT(*) AS n FROM products')).toBe(0);
  });

  it('I-04 50 000 lignes importées en moins de 60 secondes', () => {
    const lines: string[] = [];
    for (let i = 0; i < 50_000; i++) {
      const d = (i % 400) + 100;
      lines.push(`VP-${String(i).padStart(6, '0')};Amoxicilline ${d} mg gélule;amoxicilline;${d} mg;gélule;boîte de 12;medicament;1;0;3;ambiant;;`);
    }
    const text = CSV_HEADER + '\n' + lines.join('\n') + '\n';
    const started = performance.now();
    const report = run(text, 'gros.csv');
    const elapsed = performance.now() - started;
    expect(report).toMatchObject({ lines_total: 50_000, inserted: 50_000, rejected: 0 });
    expect(count('SELECT COUNT(*) AS n FROM products')).toBe(50_000);
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);
});

/** L'échantillon de l'annexe I2 est un livrable séparé : s'il est absent, le test est ignoré. */
const SAMPLE = path.resolve(process.cwd(), 'data/catalogue-echantillon.csv');

describe.skipIf(!existsSync(SAMPLE))('I-04 échantillon de démarrage (annexe I2)', () => {
  it('I-04 le fichier livré est accepté en entier, sans colonne inconnue', () => {
    const report = importCatalog(t.s, actor, readFileSync(SAMPLE), path.basename(SAMPLE));
    expect(report).toMatchObject({ rejected: 0, unknown_columns: [], updated: 0 });
    expect(report.lines_total).toBeGreaterThan(100);
    expect(report.inserted).toBe(report.lines_total);
    expect(count('SELECT COUNT(*) AS n FROM products')).toBe(report.inserted);
  });
});
