import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ledger } from '../src/domain/ledger.js';
import {
  applyPendingRestore, createBackup, KEEP_BACKUPS, listBackups, openArchive, readHeader, recordAppliedRestore, stageRestore,
} from '../src/domain/backup.js';
import { exportQueue, verifyExport } from '../src/domain/ledgerExport.js';
import { updateSettings } from '../src/domain/settings.js';
import { verifyLedger } from '../src/domain/verify.js';
import { msUntilNextLocalHour } from '../src/jobs/backup.js';
import { openDb } from '../src/db/index.js';
import { createPrescription } from '../src/domain/prescriptions.js';
import { loadNodeKeys, paths } from '../src/security/keys.js';
import { createAndLogin, keyMap, makeApp, makeNode, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { openRegister, sell, stockedProduct } from './sales.helpers.js';
import { payloadsOf } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082', 'hex');
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

function someActivity() {
  const p = stockedProduct(t, tit.userId, { qty: 5 });
  const session = openRegister(t, tit.userId);
  sell(t, tit.userId, session, [{ product_id: p.productId, qty: 2 }], 2000);
  createPrescription(t.s, tit.userId, { prescriber_name: 'Dr A', issued_on: '2026-10-25', image_base64: PNG.toString('base64') });
  return p;
}

describe('B-01 archive chiffrée', () => {
  it('B-01 en-tête (version, kid, nonce, dernier seq et hash) ; un octet modifié est refusé (GCM)', async () => {
    someActivity();
    const b = await createBackup(t.s, tit.userId, 'manual');
    const file = path.join(t.dir, 'backups', b.file);
    const buf = readFileSync(file);
    const { header } = readHeader(buf);
    const head = (t.db.prepare("SELECT seq FROM events WHERE type = 'system.backup_created'").get() as { seq: number }).seq - 1;
    expect(header).toMatchObject({ v: 1, node_id: t.keys.identity.node_id, kid: t.keys.identity.data_kid, last_seq: head });
    expect(header.nonce).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(buf.includes(Buffer.from('SQLite format 3'))).toBe(false);
    const { entries } = openArchive(buf, { dataKey: t.keys.dataKey });
    expect(entries.map((e) => e.name).sort()).toEqual(['blobs/' + readdirSync(path.join(t.dir, 'blobs'))[0], 'keys/node.json', 'keys/node_ed25519.pem', 'officine.db'].sort());
    for (const offset of [12, Math.floor(buf.length / 2), buf.length - 1]) {
      const bad = Buffer.from(buf);
      bad[offset] = bad[offset]! ^ 0x01;
      expect(() => openArchive(bad, { dataKey: t.keys.dataKey }), String(offset)).toThrow(expect.objectContaining({ code: 'backup_invalid' }));
    }
    expect(payloadsOf(t.db, 'system.backup_created')[0]).toMatchObject({ file: b.file, last_seq: head, reason: 'manual', mirror: 'disabled' });
  });
});

describe('B-02 sauvegarde planifiée, conservation, miroir', () => {
  it('B-02 heure configurée (Douala), 14 archives conservées, miroir absent = alerte sans arrêt', async () => {
    expect(msUntilNextLocalHour(new Date('2026-10-27T00:30:00.000Z'), 2)).toBe(30 * 60_000);
    expect(msUntilNextLocalHour(new Date('2026-10-27T01:30:00.000Z'), 2)).toBe(23.5 * 3_600_000);
    updateSettings(t.s, tit.userId, { backup_mirror_dir: path.join(t.dir, 'usb-absent') });
    const r = await createBackup(t.s, null, 'scheduled');
    expect(r.mirror).toBe('absent');
    const usb = path.join(t.dir, 'usb');
    mkdirSync(usb);
    updateSettings(t.s, tit.userId, { backup_mirror_dir: usb });
    for (let i = 0; i < KEEP_BACKUPS + 2; i++) {
      t.clock.advance(86_400_000);
      await createBackup(t.s, null, 'scheduled');
    }
    expect(listBackups(path.join(t.dir, 'backups'))).toHaveLength(KEEP_BACKUPS);
    expect(listBackups(usb)).toHaveLength(KEEP_BACKUPS);
    expect(payloadsOf(t.db, 'system.backup_created').at(-1)).toMatchObject({ mirror: 'ok', reason: 'scheduled' });
  });
});

describe('B-03 B-05 HTTP', () => {
  it('B-03 sauvegarde manuelle par le titulaire seulement ; santé indique l’âge de la dernière', async () => {
    expect((await t.app.inject({ url: '/api/v1/health' })).json()).toMatchObject({ last_backup_age_s: null });
    const pharm = await createAndLogin(t, tit, 'pharm', 'pharmacien');
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/system/backups', headers: H(pharm) })).statusCode).toBe(403);
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/system/backups', headers: H(tit) });
    expect(r.statusCode, r.body).toBe(201);
    t.clock.advance(60_000);
    expect((await t.app.inject({ url: '/api/v1/health' })).json()).toMatchObject({ last_backup_age_s: 60 });
    expect((await t.app.inject({ url: '/api/v1/system/backups', headers: H(tit) })).json().items).toHaveLength(1);
  });

  it('B-05 sauvegardes, clés et base ne sont jamais servies par HTTP', async () => {
    const b = await createBackup(t.s, tit.userId, 'manual');
    for (const url of [`/backups/${b.file}`, `/data-local/backups/${b.file}`, '/keys/data.key', '/officine.db', '/tls/ca.key.pem',
      '/api/v1/../keys/data.key', '/blobs/x.vpb', `/api/v1/system/backups/${b.file}`]) {
      const r = await t.app.inject({ url, headers: H(tit) });
      expect(r.statusCode, url).toBe(404);
      expect(r.body).not.toContain('VPBAK1');
    }
  });
});

describe('B-04 J-06 restauration', () => {
  it('B-04 nouvelle machine : sauvegarde + clé de récupération seulement ; journal vérifié ; system.restored', async () => {
    const p = someActivity();
    const b = await createBackup(t.s, tit.userId, 'manual');
    const archive = path.join(t.dir, 'backups', b.file);
    const fresh = makeNode();
    try {
      const freshDir = fresh.dir;
      fresh.db.close();
      expect(() => stageRestore(freshDir, archive, { recoveryKey: 'AAAA-' + t.recoveryKey.slice(5) }, null, new Date()))
        .toThrow(expect.objectContaining({ code: 'backup_invalid' }));
      stageRestore(freshDir, archive, { recoveryKey: t.recoveryKey }, null, new Date());
      expect(applyPendingRestore(freshDir, new Date())).toMatchObject({ new_machine: true, last_seq: b.last_seq });
      const keys = loadNodeKeys(freshDir);
      expect(keys.identity.node_id).toBe(t.keys.identity.node_id);
      expect(keys.dataKey.equals(t.keys.dataKey)).toBe(true);
      const db = openDb(paths(freshDir).db);
      const ledger = new Ledger(db, { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey }, fresh.clock);
      const s = { ...t.s, db, ledger, keys, config: { ...t.s.config, dataDir: freshDir } };
      expect(recordAppliedRestore(s)).toBe(true);
      expect(verifyLedger(db, keys.identity.node_id, new Map([[keys.identity.kid, keys.publicKey]]))).toMatchObject({ ok: true });
      expect(db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT id FROM products WHERE id = ?').get(p.productId)).toBeTruthy();
      const ev = db.prepare("SELECT payload FROM events WHERE type = 'system.restored'").get() as { payload: string };
      expect(JSON.parse(ev.payload)).toMatchObject({ archive: b.file, last_seq: b.last_seq, new_machine: true });
      const { prescriptionImage } = await import('../src/domain/prescriptions.js');
      const rx = db.prepare('SELECT id FROM prescriptions').get() as { id: string };
      expect(prescriptionImage(s, rx.id).bytes.equals(PNG)).toBe(true);
      db.close();
    } finally {
      rmSync(fresh.dir, { recursive: true, force: true });
    }
  });

  it('B-04 une archive dont le journal est altéré est refusée avant tout remplacement', async () => {
    someActivity();
    const b = await createBackup(t.s, tit.userId, 'manual');
    const buf = readFileSync(path.join(t.dir, 'backups', b.file));
    const { header, entries } = openArchive(buf, { dataKey: t.keys.dataKey });
    const dbEntry = entries.find((e) => e.name === 'officine.db')!;
    const tmpDb = path.join(t.dir, 'tampered.db');
    writeFileSync(tmpDb, dbEntry.data);
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(tmpDb);
    raw.exec('DROP TRIGGER events_no_update');
    raw.prepare("UPDATE events SET payload = replace(payload, '2000', '2001') WHERE type = 'sale.completed'").run();
    raw.close();
    const { sealArchive } = await import('../src/domain/backup.js');
    const { writeTar } = await import('../src/domain/tar.js');
    const { nonce: _n, ...h } = header;
    const forged = sealArchive(t.keys.dataKey, h, writeTar(entries.map((e) => (e.name === 'officine.db' ? { ...e, data: readFileSync(tmpDb) } : e))));
    const forgedFile = path.join(t.dir, 'backups', 'forged.vpbak');
    writeFileSync(forgedFile, forged);
    expect(() => stageRestore(t.dir, forgedFile, { dataKey: t.keys.dataKey }, null, new Date())).toThrow(expect.objectContaining({ code: 'backup_invalid', title: 'Journal de la sauvegarde invalide', message: expect.stringContaining('hash_mismatch') }));
    expect(applyPendingRestore(t.dir, new Date())).toBeNull();
  });

  it('B-04 HTTP : titulaire ré-authentifié ; restauration mise en attente puis redémarrage demandé', async () => {
    someActivity();
    const b = await createBackup(t.s, tit.userId, 'manual');
    let restarted = '';
    t.s.requestRestart = (r) => { restarted = r; };
    t.clock.advance(6 * 60_000);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/system/restore', headers: H(tit), payload: { file: b.file } })).json())
      .toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/system/restore', headers: H(tit), payload: { file: '../keys/data.key' } })).statusCode).toBe(400);
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/system/restore', headers: H(tit), payload: { file: b.file } });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toMatchObject({ archive: b.file, restart: true });
    expect(restarted).toBe('restauration');
    expect(readdirSync(t.dir)).toContain('restore.pending.json');
  });
});

describe('J-05 file d’envoi et export signé', () => {
  it('J-05 export JSON Lines CloudEvents + point de contrôle ; re-vérification ; altération détectée', async () => {
    someActivity();
    const e = exportQueue(t.s, tit.userId);
    const lines = e.body.trim().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ specversion: '1.0', type: 'cm.visionpharma.system.initialized', vpseq: 1, source: `urn:visionpharma:node:${t.keys.identity.node_id}` });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ type: 'checkpoint', seq: e.to_seq });
    expect(verifyExport(e.body, t.keys.publicKey)).toEqual({ ok: true, events: lines.length - 1, to_seq: e.to_seq });
    expect(verifyExport(e.body.replace('"total":2000', '"total":2001'))).toMatchObject({ ok: false, detail: expect.stringContaining('Empreinte') });
    const dropped = [...lines.slice(0, 2), ...lines.slice(3)].join('\n');
    expect(verifyExport(dropped)).toMatchObject({ ok: false });
    expect(payloadsOf(t.db, 'ledger.exported')[0]).toMatchObject({ from_seq: 1, to_seq: e.to_seq, sha256: e.sha256 });
    expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
  });

  it('J-05 HTTP : export réservé au titulaire ré-authentifié ; file visible par le pharmacien', async () => {
    const pharm = await createAndLogin(t, tit, 'pharm', 'pharmacien');
    expect((await t.app.inject({ url: '/api/v1/system/queue', headers: H(pharm) })).json()).toMatchObject({ oldest_seq: 1 });
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/system/ledger-export', headers: H(pharm) })).statusCode).toBe(403);
    await reauth(t, tit, STRONG, tit.totpSecret);
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/system/ledger-export', headers: H(tit) });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toContain('application/x-ndjson');
    expect(verifyExport(r.body)).toMatchObject({ ok: true });
  });
});
