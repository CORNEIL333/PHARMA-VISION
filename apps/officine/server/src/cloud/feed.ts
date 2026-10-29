import { randomUUID } from 'node:crypto';
import { verifyPublication, type RecallNotice, type ReferentialProduct, type ReferentialVersion, type Signed } from '@visionpharma/protocol';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { CATEGORIES } from '../domain/catalog.js';
import { parseBarcode } from '../domain/gs1.js';
import { RECALL_SOURCES } from '../domain/recalls.js';
import { buildSearchText } from '../domain/search.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getState, publicationKey, setState, type Enrolment } from './sync.js';
import { cloudRequest, type CloudTarget } from './transport.js';

/**
 * NO-03 (RA-02, RA-03) et NO-04 (RF-03, RF-04) : données descendantes du cloud, signées par sa clé de
 * publication, appliquées dans l'ordre des versions, chacune dans une transaction avec son événement.
 */

export const CLOUD_USERNAME = 'cloud.visionpharma';

/** Compte système INACTIF (ne peut pas se connecter) : auteur des rappels reçus du cloud. */
function cloudUser(s: Services): string {
  const u = s.db.prepare('SELECT id FROM users WHERE username = ?').get(CLOUD_USERNAME) as { id: string } | undefined;
  if (u) return u.id;
  const id = randomUUID();
  s.db.prepare(`INSERT INTO users (id, username, display_name, role, pw_hash, active, created_at)
    VALUES (?, ?, 'VisionPharma (cloud)', 'pharmacien', '!', 0, ?)`).run(id, CLOUD_USERNAME, iso(s.clock.now()));
  s.ledger.append('user.created', null, { user_id: id, username: CLOUD_USERNAME, role: 'pharmacien', via: 'cloud', active: false });
  return id;
}

const rejectedFeed = (detail: string) => new AppError('cloud_rejected', 'Publication du cloud refusée', detail);

/** Rappel actif : rappel local (bloque la vente, Q-02) ; inactif : clôture du rappel local (RA-04). */
function applyRecall(s: Services, n: RecallNotice): void {
  const product = s.db.prepare('SELECT id FROM products WHERE ref_code = ?').get(n.ref_code) as { id: string } | undefined;
  const prev = s.db.prepare('SELECT local_recall_id FROM cloud_recalls WHERE cloud_id = ?').get(n.id) as { local_recall_id: string | null } | undefined;
  const at = iso(s.clock.now());
  let local = prev?.local_recall_id ?? null;
  if (n.active && product && !local) {
    local = randomUUID();
    const source = (RECALL_SOURCES as readonly string[]).includes(n.source) ? n.source : 'DPML';
    s.db.prepare(`INSERT INTO recalls (id, reference, product_id, lot_number, reason, source, active, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(local, n.reference, product.id, n.lot_number, n.reason, source, cloudUser(s), at);
    s.ledger.append('recall.published', null, {
      recall_id: local, cloud_recall_id: n.id, reference: n.reference, product_id: product.id, lot_number: n.lot_number, reason: n.reason, source,
    });
  } else if (!n.active && local) {
    s.db.prepare('UPDATE recalls SET active = 0, closed_by = ?, closed_at = ? WHERE id = ? AND active = 1').run(cloudUser(s), at, local);
    s.ledger.append('recall.closed', null, { recall_id: local, cloud_recall_id: n.id, product_id: product?.id ?? null, lot_number: n.lot_number, reason: 'Clôture diffusée par le cloud' });
  }
  s.db.prepare(`INSERT INTO cloud_recalls (cloud_id, version, ref_code, lot_number, local_recall_id, active, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cloud_id) DO UPDATE SET version = excluded.version,
    local_recall_id = excluded.local_recall_id, active = excluded.active, acked_at = NULL`)
    .run(n.id, n.version, n.ref_code, n.lot_number, local, n.active ? 1 : 0, at);
}

/** Rappels en attente d'une fiche absente du catalogue local : appliqués quand la fiche arrive. */
function applyPendingRecalls(s: Services): void {
  const rows = s.db.prepare(`SELECT c.cloud_id FROM cloud_recalls c JOIN products p ON p.ref_code = c.ref_code
    WHERE c.local_recall_id IS NULL AND c.active = 1`).all() as { cloud_id: string }[];
  for (const r of rows) {
    const n = JSON.parse(getState(s, `recall:${r.cloud_id}`) ?? 'null') as RecallNotice | null;
    if (n) applyRecall(s, n);
  }
}

/** RA-02 : canal prioritaire, interrogé avant tout envoi. Renvoie le nombre de rappels appliqués. */
export async function pullRecalls(s: Services, t: CloudTarget, e: Enrolment): Promise<number> {
  const since = Number(getState(s, 'recall_version') ?? '0');
  const r = await cloudRequest(s, t, 'GET', `/sync/v1/recalls?since=${since}`);
  if (r.status !== 200) throw rejectedFeed(`statut ${r.status}`);
  const items = ((r.body as { items?: Signed<RecallNotice>[] }).items ?? []).sort((a, b) => a.body.version - b.body.version);
  const key = publicationKey(e);
  let version = since;
  for (const p of items) {
    if (!verifyPublication(key, 'recall', p)) throw rejectedFeed(`rappel ${p.body?.id ?? '?'} : signature invalide`);
    if (p.body.version !== version + 1) throw rejectedFeed(`rappel : version ${p.body.version} au lieu de ${version + 1}`);
    writeTx(s.db, () => {
      setState(s, `recall:${p.body.id}`, JSON.stringify(p.body));
      applyRecall(s, p.body);
      setState(s, 'recall_version', String(p.body.version));
    });
    version = p.body.version;
    await ackRecall(s, t, p.body);
  }
  return items.length;
}

/** RA-03 : accusé de blocage, après l'application locale. */
async function ackRecall(s: Services, t: CloudTarget, n: RecallNotice): Promise<void> {
  const r = await cloudRequest(s, t, 'POST', `/sync/v1/recalls/${encodeURIComponent(n.id)}/ack`, { version: n.version });
  if (r.status === 200) s.db.prepare('UPDATE cloud_recalls SET acked_at = ? WHERE cloud_id = ?').run(iso(s.clock.now()), n.id);
}

function checkProduct(p: ReferentialProduct): void {
  const ok = typeof p.ref_code === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(p.ref_code) && typeof p.name === 'string' && p.name.trim().length > 0 &&
    p.name.length <= 200 && (CATEGORIES as readonly string[]).includes(p.category) && [1, 2, 3].includes(p.criticity) &&
    (p.suggested_price === null || (Number.isSafeInteger(p.suggested_price) && p.suggested_price >= 0)) && Array.isArray(p.gtins);
  if (!ok) throw rejectedFeed(`fiche ${String(p.ref_code)} invalide`);
}

/** RF-03 : fiche mise à jour par `ref_code` sans toucher au stock, au prix local, aux seuils ni au statut (comme I-04). */
function upsertProduct(s: Services, p: ReferentialProduct, at: string): 'inserted' | 'updated' {
  const text = buildSearchText(p);
  const found = s.db.prepare('SELECT id FROM products WHERE ref_code = ?').get(p.ref_code) as { id: string } | undefined;
  const id = found?.id ?? randomUUID();
  if (found) {
    s.db.prepare(`UPDATE products SET name = ?, dci = ?, strength = ?, form = ?, presentation = ?, category = ?, rx_required = ?,
      sensitive = ?, criticity = ?, storage = ?, suggested_price = ?, search_text = ?, updated_at = ? WHERE id = ?`)
      .run(p.name, p.dci, p.strength, p.form, p.presentation, p.category, p.rx_required ? 1 : 0, p.sensitive ? 1 : 0, p.criticity,
        p.storage, p.suggested_price, text, at, id);
  } else {
    s.db.prepare(`INSERT INTO products (id, ref_code, name, dci, strength, form, presentation, category, rx_required, sensitive,
      criticity, storage, suggested_price, status, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dormant', ?, ?, ?)`)
      .run(id, p.ref_code, p.name, p.dci, p.strength, p.form, p.presentation, p.category, p.rx_required ? 1 : 0, p.sensitive ? 1 : 0,
        p.criticity, p.storage, p.suggested_price, text, at, at);
  }
  const link = s.db.prepare("INSERT OR IGNORE INTO barcodes (code, product_id, kind) VALUES (?, ?, 'gtin')");
  for (const g of p.gtins) {
    try {
      link.run(parseBarcode(g).code, id);
    } catch {
      /* code illisible : ignoré, comme à l'import (I-04) */
    }
  }
  return found ? 'updated' : 'inserted';
}

function applyVersion(s: Services, v: ReferentialVersion): void {
  v.products.forEach(checkProduct);
  writeTx(s.db, () => {
    const at = iso(s.clock.now());
    let inserted = 0;
    let updated = 0;
    for (const p of v.products) {
      if (upsertProduct(s, p, at) === 'inserted') inserted++;
      else updated++;
    }
    s.ledger.append('catalog.referential_applied', null, { version: v.version, inserted, updated });
    setState(s, 'referential_version', String(v.version));
    applyPendingRecalls(s);
  });
}

/** RF-03, RF-04 : versions suivantes, signature vérifiée, appliquées dans l'ordre sans trou. */
export async function pullReferential(s: Services, t: CloudTarget, e: Enrolment): Promise<number> {
  const since = Number(getState(s, 'referential_version') ?? '0');
  const r = await cloudRequest(s, t, 'GET', `/sync/v1/referential?since=${since}`);
  if (r.status !== 200) throw rejectedFeed(`statut ${r.status}`);
  const versions = ((r.body as { versions?: Signed<ReferentialVersion>[] }).versions ?? []).sort((a, b) => a.body.version - b.body.version);
  const key = publicationKey(e);
  let current = since;
  for (const p of versions) {
    if (!verifyPublication(key, 'referential', p)) throw rejectedFeed(`version ${p.body?.version ?? '?'} : signature invalide`);
    if (p.body.version !== current + 1) throw rejectedFeed(`version ${p.body.version} au lieu de ${current + 1}`);
    applyVersion(s, p.body);
    current = p.body.version;
  }
  return versions.length;
}

