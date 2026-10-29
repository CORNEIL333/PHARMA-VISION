import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lookupBarcode } from '../src/domain/catalog.js';
import { listDemand, recordDemand } from '../src/domain/demand.js';
import { countInventory, openInventory, validateInventory } from '../src/domain/inventory.js';
import { createOrder, sendOrder, suggestOrder } from '../src/domain/orders.js';
import { recordReception } from '../src/domain/receptions.js';
import { expiryReport } from '../src/domain/reports.js';
import { createSale, quoteSale } from '../src/domain/sales.js';
import { updateSettings } from '../src/domain/settings.js';
import { verifyLedger } from '../src/domain/verify.js';
import { crashDuringSale } from './crash.helpers.js';
import { seedProduct } from './catalog.helpers.js';
import { createAndLogin, keyMap, makeApp, setupTitulaire, type Agent, type TestApp } from './helpers.js';
import { seedSupplier } from './orders.helpers.js';
import { lotQty, payloadsOf, receive } from './stock.helpers.js';
import { cash, openRegister, sell, stockedProduct } from './sales.helpers.js';

/**
 * Scénarios de recette du document 08 automatisables sur le serveur. Les autres (installation chronométrée,
 * matériel, application de bureau sur un poste neuf) ont leur procédure dans docs/manual-tests.md.
 */
let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const verify = () => expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

/** GTIN-13 valide (clé mod 10) à partir de 12 chiffres. */
function gtin13(base12: string): string {
  const sum = [...base12].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
  return base12 + ((10 - (sum % 10)) % 10);
}

describe('Recette (docs/08 §3)', () => {
  it('RC-03 réception de 20 lignes par scan GS1 sans bon : 20 fiches activées, lots et péremptions corrects', () => {
    const lines = Array.from({ length: 20 }, (_, i) => {
      const id = randomUUID();
      const gtin = gtin13(`6170000${String(i).padStart(5, '0')}`);
      seedProduct(t.db, { id, name: `Produit ${i}` });
      t.db.prepare("INSERT INTO barcodes (code, product_id, kind) VALUES (?, ?, 'gtin')").run(`0${gtin}`, id);
      // Chaîne GS1 DataMatrix : (01) GTIN-14, (17) péremption AAMMJJ, (10) lot, avec séparateur GS.
      const raw = `010${gtin}172806${String(10 + (i % 18)).padStart(2, '0')}10LOT${i}\u001d`;
      const scan = lookupBarcode(t.s, raw);
      expect(scan.found).toBe(true);
      return { product_id: scan.product!.id, lot_number: scan.gs1!.lot!, expiry: scan.gs1!.expiry!, qty: 5 + i, unit_cost: 100 };
    });
    const r = recordReception(t.s, tit.userId, { lines });
    expect(r.lines).toHaveLength(20);
    expect(payloadsOf(t.db, 'catalog.item_activated')).toHaveLength(20);
    const l7 = r.lines.find((l) => l.lot_number === 'LOT7')!;
    expect(l7).toMatchObject({ expiry: '2028-06-17', qty: 12 });
    expect(lotQty(t.db, l7.lot_id)).toBe(12);
    verify();
  });

  it('RC-04 vente de 3 articles en espèces avec rendu : stock décrémenté sur les bons lots (FEFO)', () => {
    const a = stockedProduct(t, tit.userId, { lot: 'A-TARD', expiry: '2028-12-31', qty: 5 });
    const early = receive(t.s, tit.userId, { productId: a.productId, lotNumber: 'A-TOT', expiry: '2027-06-30', qty: 5, unitCost: 600 }).lotId;
    const b = stockedProduct(t, tit.userId, { sale: 500 });
    const c = stockedProduct(t, tit.userId, { sale: 250 });
    const session = openRegister(t, tit.userId);
    const started = Date.now();
    const s = createSale(t.s, tit.userId, {
      cash_session_id: session, lines: [{ product_id: a.productId, qty: 1 }, { product_id: b.productId, qty: 1 }, { product_id: c.productId, qty: 1 }],
      payments: cash(1750), cash_tendered: 2000,
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(s).toMatchObject({ total: 1750, change_given: 250 });
    expect([lotQty(t.db, early), lotQty(t.db, a.lotId)]).toEqual([4, 5]);
    verify();
  });

  it('RC-08 deux caisses, dernière boîte : une seule vente ; le panier refusé reste intact', () => {
    // Exploitation normale : hors période de démarrage (V-05), pas de vente en régularisation.
    updateSettings(t.s, tit.userId, { allow_regul_sales: false });
    const p = stockedProduct(t, tit.userId, { qty: 1 });
    const s1 = openRegister(t, tit.userId, 'C1');
    const s2 = openRegister(t, tit.userId, 'C2');
    sell(t, tit.userId, s1, [{ product_id: p.productId, qty: 1 }], 1000);
    expect(() => sell(t, tit.userId, s2, [{ product_id: p.productId, qty: 1 }], 1000)).toThrow(expect.objectContaining({ code: 'insufficient_stock' }));
    // Le panier est côté poste : le devis le signale sans rien écrire.
    expect(quoteSale(t.s, { lines: [{ product_id: p.productId, qty: 1 }] }).blocking).toBe(true);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 1 });
    verify();
  });

  it('RC-10 demande en rupture → suggestion de commande → réception → demande résolue', () => {
    seedSupplier(t.db, { id: 'sp1', name: 'Grossiste' });
    const p = stockedProduct(t, tit.userId, { qty: 1, minQty: 2, maxQty: 10 });
    sell(t, tit.userId, openRegister(t, tit.userId), [{ product_id: p.productId, qty: 1 }], 1000);
    const d = recordDemand(t.s, tit.userId, { product_id: p.productId, qty: 2 });
    expect(listDemand(t.s).items.map((x) => x.id)).toEqual([d.id]);
    const sug = suggestOrder(t.s, 'sp1').items.find((i) => i.product_id === p.productId)!;
    expect(sug).toMatchObject({ rule: 'thresholds', qty: 10 });
    const o = createOrder(t.s, tit.userId, { supplier_id: 'sp1', lines: [{ product_id: p.productId, qty: sug.qty }] });
    sendOrder(t.s, tit.userId, o.id);
    recordReception(t.s, tit.userId, { po_id: o.id, lines: [{ product_id: p.productId, lot_number: 'NEW', expiry: '2028-01-31', qty: 10 }] });
    expect(listDemand(t.s, { status: 'resolved' }).items.map((x) => x.id)).toEqual([d.id]);
    verify();
  });

  it('RC-13 inventaire d’un rayon avec deux écarts : mouvements et valeur de l’écart', () => {
    const a = stockedProduct(t, tit.userId, { qty: 10, cost: 200 });
    const b = stockedProduct(t, tit.userId, { qty: 6, cost: 50 });
    const inv = openInventory(t.s, tit.userId, { scope: 'Rayon antalgiques', product_ids: [a.productId, b.productId] });
    countInventory(t.s, tit.userId, inv.id, { lot_id: a.lotId, counted_qty: 8 });
    countInventory(t.s, tit.userId, inv.id, { lot_id: b.lotId, counted_qty: 7 });
    expect(validateInventory(t.s, tit.userId, inv.id, true)).toMatchObject({ total_delta_qty: -1, total_delta_value_xaf: -350 });
    expect([lotQty(t.db, a.lotId), lotQty(t.db, b.lotId)]).toEqual([8, 7]);
    verify();
  });

  it('RC-07 lot périmé : vente impossible et présent au rapport des péremptions', () => {
    const p = stockedProduct(t, tit.userId, { expiry: '2026-11-15', qty: 3 });
    t.clock.set('2026-11-20T09:00:00.000Z');
    expect(quoteSale(t.s, { lines: [{ product_id: p.productId, qty: 1, lot_id: p.lotId }] }).lines[0]!.alerts[0]).toMatchObject({ code: 'expired_lot' });
    expect(expiryReport(t.s, 90, false).rows).toEqual([expect.objectContaining({ lot_number: 'L1', bucket: 'perime', qty: 3 })]);
  });

  it('RC-14 coupure brutale pendant la validation : la vente est absente, le journal se vérifie', async () => {
    const p = stockedProduct(t, tit.userId, { qty: 2 });
    const session = openRegister(t, tit.userId);
    const head = t.ledger.head();
    const code = await crashDuringSale({ dir: t.dir, userId: tit.userId, sessionId: session, productId: p.productId });
    expect(code).not.toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 0 });
    expect(lotQty(t.db, p.lotId)).toBe(2);
    expect(t.ledger.head()).toEqual(head);
    verify();
    sell(t, tit.userId, session, [{ product_id: p.productId, qty: 1 }], 1000);
    verify();
  }, 30_000);

  it('RC-15 octet altéré dans la base : verify-ledger signale le seq (code de sortie 2)', () => {
    const p = stockedProduct(t, tit.userId);
    sell(t, tit.userId, openRegister(t, tit.userId), [{ product_id: p.productId, qty: 1 }], 1000);
    const seq = (t.db.prepare("SELECT seq FROM events WHERE type = 'sale.completed'").get() as { seq: number }).seq;
    const raw = new Database(path.join(t.dir, 'officine.db'));
    raw.exec('DROP TRIGGER events_no_update');
    raw.prepare("UPDATE events SET payload = replace(payload, '\"total\":1000', '\"total\":1001') WHERE seq = ?").run(seq);
    raw.close();
    const cli = path.resolve(import.meta.dirname, '../../scripts/verify-ledger.ts');
    const tsx = path.resolve(import.meta.dirname, '../../node_modules/tsx/dist/cli.mjs');
    const r = spawnSync(process.execPath, [tsx, cli, '--data', t.dir], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, seq, defect: 'hash_mismatch' });
  }, 30_000);

  it('RC-18 un caissier appelle la route d’ajustement : 403 et tentative tracée', async () => {
    const p = stockedProduct(t, tit.userId);
    const cashier = await createAndLogin(t, tit, 'caisse1', 'caissier');
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/stock/adjustments', headers: H(cashier), payload: { lot_id: p.lotId, qty: -1, reason: 'casse' } });
    expect(r.statusCode).toBe(403);
    expect(payloadsOf(t.db, 'security.access_denied').at(-1)).toMatchObject({ role: 'caissier', action: 'stock.adjust', method: 'POST', route: '/api/v1/stock/adjustments' });
    expect(lotQty(t.db, p.lotId)).toBe(10);
    verify();
  });

  it('RC-19 journée simulée : 1 500 ventes sur 5 postes, ventes de 10 lignes sous 500 ms (NFR-PE-03), journal ok', () => {
    const products = Array.from({ length: 10 }, (_, i) => stockedProduct(t, tit.userId, { qty: 5000, sale: 100 + i, lot: `J${i}` }));
    const sessions = Array.from({ length: 5 }, (_, i) => openRegister(t, tit.userId, `Poste ${i + 1}`));
    const durations: number[] = [];
    for (let n = 0; n < 1500; n++) {
      const lines = products.map((p) => ({ product_id: p.productId, qty: 1 + (n % 3) }));
      const total = lines.reduce((sum, l, i) => sum + l.qty * (100 + i), 0);
      const t0 = performance.now();
      createSale(t.s, tit.userId, { cash_session_id: sessions[n % 5]!, lines, payments: cash(total) });
      durations.push(performance.now() - t0);
      if (n % 100 === 99) t.clock.advance(60_000);
    }
    durations.sort((x, y) => x - y);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(p95).toBeLessThan(500);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status = 'completed'").get()).toEqual({ n: 1500 });
    verify();
  }, 300_000);
});
