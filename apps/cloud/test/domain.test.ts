import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  eventHash, GENESIS_PREV_HASH, signCheckpoint, toCloudEvent, type Json, type LedgerEvent, type SyncBatch,
} from '@visionpharma/protocol';
import { describe, expect, it } from 'vitest';
import { freshness, lotDeltas, sellable } from '../src/domain/availability.js';
import { decideBatch } from '../src/domain/batch.js';
import { criticity, dispatchDelayMs } from '../src/domain/criticity.js';
import { checkConsistency, checkInclusion, consistencyBundle, inclusionBundle, leafOf, signSth } from '../src/domain/transparency.js';
import { verifyStaffToken } from '../src/security/oidc.js';
import { boGrant, BO_MATRIX } from '../src/security/rbac.js';

const NODE = randomUUID();
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function chain(n: number, from: { seq: number; hash: string } = { seq: 0, hash: GENESIS_PREV_HASH }, payload: (i: number) => { [k: string]: Json } = (i) => ({ i })): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  let prev = from;
  for (let k = 1; k <= n; k++) {
    const base = { seq: prev.seq + 1, id: randomUUID(), type: 'test.noise', at: '2026-10-29T10:00:00.000Z', actor: null, payload: payload(prev.seq + 1), prev_hash: prev.hash };
    const e = { ...base, hash: eventHash(base) };
    out.push(e);
    prev = { seq: e.seq, hash: e.hash };
  }
  return out;
}
function batch(events: LedgerEvent[]): SyncBatch {
  const last = events.at(-1)!;
  return {
    node_id: NODE, events: events.map((e) => toCloudEvent(NODE, e)), products: [], lots: [],
    checkpoint: { seq: last.seq, hash: last.hash, signature: signCheckpoint(privateKey, NODE, last.seq, last.hash), kid: 'k' },
  };
}
const GENESIS = { seq: 0, hash: GENESIS_PREV_HASH };

describe('annexe C dans apps/cloud (B6)', () => {
  it('J-02 empreinte de l’événement 1 identique au nœud et au protocole', () => {
    expect(eventHash({
      seq: 1, id: '0b8f8a4e-3f5c-4c1e-9a43-6a0d1f6e2b11', type: 'system.initialized', at: '2026-10-26T08:00:00.000Z', actor: null,
      payload: { node_id: '7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01', schema: 1 }, prev_hash: GENESIS_PREV_HASH,
    })).toBe('6d46c2ac7215c5609c4bc96c9e9453e041025608e72e32ef436b573a0b8d0e88');
  });
});

describe('SY-02 SY-03 SY-04 décision sur un lot', () => {
  const evs = chain(5);
  it('SY-02 lot valide accepté, tête avancée', () => {
    expect(decideBatch(batch(evs), publicKey, GENESIS, [])).toMatchObject({ kind: 'accept', duplicates: [], head: { seq: 5, hash: evs[4]!.hash } });
  });
  it('SY-03 lot rejoué : tout en double, rien de neuf, même tête', () => {
    const known = evs.map((e) => ({ id: e.id, seq: e.seq, hash: e.hash }));
    const d = decideBatch(batch(evs), publicKey, { seq: 5, hash: evs[4]!.hash }, known);
    expect(d).toMatchObject({ kind: 'accept', fresh: [], duplicates: evs.map((e) => e.id), head: { seq: 5 } });
  });
  it('SY-03 lot à cheval : la partie connue est accusée, la suite est ajoutée', () => {
    const more = chain(3, { seq: 5, hash: evs[4]!.hash });
    const known = evs.slice(3).map((e) => ({ id: e.id, seq: e.seq, hash: e.hash }));
    const d = decideBatch(batch([...evs.slice(3), ...more]), publicKey, { seq: 5, hash: evs[4]!.hash }, known);
    expect(d).toMatchObject({ kind: 'accept', duplicates: [evs[3]!.id, evs[4]!.id], head: { seq: 8 } });
  });
  it('SY-02 octet modifié refusé avec le seq ; point de contrôle faux refusé ; lot vide refusé', () => {
    const tampered = evs.map((e) => (e.seq === 3 ? { ...e, payload: { i: 999 } } : e));
    const b = batch(tampered);
    b.checkpoint = batch(evs).checkpoint;
    expect(decideBatch(b, publicKey, GENESIS, [])).toMatchObject({ kind: 'reject', code: 'hash_mismatch', seq: 3 });
    const other = generateKeyPairSync('ed25519').publicKey;
    expect(decideBatch(batch(evs), other, GENESIS, [])).toMatchObject({ kind: 'reject', code: 'bad_checkpoint' });
    expect(decideBatch({ ...batch(evs), events: [] }, publicKey, GENESIS, [])).toMatchObject({ kind: 'reject', status: 400 });
  });
  it('SY-04 fourche, trou ou rupture : quarantaine, rien n’est fusionné', () => {
    const fork = chain(5);
    const known = evs.map((e) => ({ id: e.id, seq: e.seq, hash: e.hash }));
    expect(decideBatch(batch(fork), publicKey, { seq: 5, hash: evs[4]!.hash }, known)).toMatchObject({ kind: 'quarantine', code: 'chain_fork', seq: 1 });
    const later = chain(2, { seq: 7, hash: 'a'.repeat(64) });
    expect(decideBatch(batch(later), publicKey, { seq: 5, hash: evs[4]!.hash }, [])).toMatchObject({ kind: 'quarantine', code: 'gap', seq: 8 });
    const wrong = chain(1, { seq: 5, hash: 'b'.repeat(64) });
    expect(decideBatch(batch(wrong), publicKey, { seq: 5, hash: evs[4]!.hash }, [])).toMatchObject({ kind: 'quarantine', code: 'chain_break', seq: 6 });
  });
});

describe('DI-01 DI-02 disponibilité et fraîcheur', () => {
  const now = new Date('2026-10-29T12:00:00.000Z');
  it('DI-02 bornes : < 1 h disponible ; 1 à 24 h à confirmer ; au-delà ou jamais : masquée', () => {
    expect(freshness('2026-10-29T11:00:00.001Z', now)).toBe('disponible');
    expect(freshness('2026-10-29T11:00:00.000Z', now)).toBe('a_confirmer');
    expect(freshness('2026-10-28T12:00:00.000Z', now)).toBe('a_confirmer');
    expect(freshness('2026-10-28T11:59:59.999Z', now)).toBe('masquee');
    expect(freshness(null, now)).toBe('masquee');
  });
  it('DI-01 mouvements cumulés par lot ; lots de régularisation, périmés et rappelés exclus', () => {
    const d = lotDeltas([
      { payload: { movements: [{ lot_id: 'A', qty: 10, kind: 'reception' }] } },
      { payload: { movements: [{ lot_id: 'A', qty: -3, kind: 'sale' }, { lot_id: 'B', qty: -1, kind: 'sale' }] } },
      { payload: { movements: [{ lot_id: 'A', qty: 1, kind: 'void' }] } },
      { payload: { autre: true } },
    ]);
    expect(Object.fromEntries(d)).toEqual({ A: 8, B: -1 });
    const lot = { lot_id: 'A', product_id: 'p', lot_number: 'L', expiry: '2027-01-01', is_regul: false };
    expect(sellable(lot, '2026-10-29', false)).toBe(true);
    expect(sellable({ ...lot, is_regul: true, expiry: null }, '2026-10-29', false)).toBe(false);
    expect(sellable({ ...lot, expiry: '2026-10-28' }, '2026-10-29', false)).toBe(false);
    expect(sellable(lot, '2026-10-29', true)).toBe(false);
  });
});

describe('CR-01 CR-02 criticité', () => {
  it('CR-01 cas chiffrés et niveaux', () => {
    expect(criticity({ productCriticity: 1, pharmaciesWithStock: 0, distinctRequests24h: 6 })).toEqual({ score: 70, level: 1 });
    expect(criticity({ productCriticity: 1, pharmaciesWithStock: 5, distinctRequests24h: 0 })).toEqual({ score: 35, level: 1 });
    expect(criticity({ productCriticity: 2, pharmaciesWithStock: 1, distinctRequests24h: 2 })).toEqual({ score: 34, level: 2 });
    expect(criticity({ productCriticity: 3, pharmaciesWithStock: 0, distinctRequests24h: 5 })).toEqual({ score: 35, level: 2 });
    expect(criticity({ productCriticity: 3, pharmaciesWithStock: 4, distinctRequests24h: 1 })).toEqual({ score: 3, level: 3 });
  });
  it('CR-02 délais : immédiat, horaire, quotidien', () => {
    expect([1, 2, 3].map((l) => dispatchDelayMs(l as 1 | 2 | 3))).toEqual([0, 3_600_000, 86_400_000]);
  });
});

describe('TL-02 à TL-04 journal de transparence', () => {
  const log = generateKeyPairSync('ed25519');
  const cps = Array.from({ length: 13 }, (_, i) => ({ node_id: NODE, seq: (i + 1) * 100, hash: String(i).padStart(64, '0'), signature: `sig${i}`, kid: 'k' }));
  const leaves = cps.map(leafOf);
  it('TL-02 TL-03 inclusion et cohérence vérifiées ; tête ou feuille falsifiées refusées', () => {
    const sth7 = signSth(log.privateKey, leaves.slice(0, 7), '2026-10-29T10:00:00.000Z');
    const sth13 = signSth(log.privateKey, leaves, '2026-10-29T10:01:00.000Z');
    expect(checkInclusion(log.publicKey, sth13, cps[4]!, inclusionBundle(leaves, 4))).toEqual({ ok: true });
    expect(checkInclusion(log.publicKey, sth13, { ...cps[4]!, seq: 501 }, inclusionBundle(leaves, 4)).ok).toBe(false);
    expect(checkInclusion(log.publicKey, { ...sth13, tree_size: 12 }, cps[4]!, inclusionBundle(leaves, 4)).ok).toBe(false);
    expect(checkConsistency(log.publicKey, sth7, sth13, consistencyBundle(leaves, 7, 13))).toEqual({ ok: true });
    expect(checkConsistency(log.publicKey, sth7, { ...sth13, root_hash: 'f'.repeat(64) }, consistencyBundle(leaves, 7, 13)).ok).toBe(false);
  });

  it('TL-04 vérificateur indépendant en ligne de commande : 0 si valide, 2 si refusé', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vp-tl-'));
    try {
      writeFileSync(path.join(dir, 'log.pem'), log.publicKey.export({ type: 'spki', format: 'pem' }));
      const sth = signSth(log.privateKey, leaves, '2026-10-29T10:01:00.000Z');
      writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ sth, leaf: cps[9], proof: inclusionBundle(leaves, 9) }));
      writeFileSync(path.join(dir, 'ko.json'), JSON.stringify({ sth, leaf: { ...cps[9], hash: 'e'.repeat(64) }, proof: inclusionBundle(leaves, 9) }));
      const tsx = path.resolve(import.meta.dirname, '../node_modules/tsx/dist/cli.mjs');
      const cli = path.resolve(import.meta.dirname, '../scripts/tl-verify.ts');
      const run = (f: string) => spawnSync(process.execPath, [tsx, cli, '--key', path.join(dir, 'log.pem'), '--inclusion', path.join(dir, f)], { encoding: 'utf8' });
      expect(run('ok.json').status).toBe(0);
      const ko = run('ko.json');
      expect(ko.status).toBe(2);
      expect(ko.stdout).toContain('preuve d’inclusion invalide');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('BO-01 BO-02 identité de l’équipe', () => {
  it('BO-01 jeton valide avec second facteur ; sans MFA, expiré, autre émetteur ou sans rôle : refusé', async () => {
    const { privateKey: rsa, publicKey: rsaPub } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(rsaPub)), kid: 'k1', alg: 'RS256' };
    const keys = createLocalJWKSet({ keys: [jwk] });
    const opts = { issuer: 'https://auth.test/realms/visionpharma', audience: 'visionpharma-api' };
    const token = (claims: Record<string, unknown>, exp = '5m', iss = opts.issuer) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(opts.audience).setSubject('u1').setIssuedAt().setExpirationTime(exp).sign(rsa);
    const ok = await verifyStaffToken(await token({ amr: ['pwd', 'otp'], realm_access: { roles: ['support', 'offline_access'] }, preferred_username: 'awa' }), keys, opts);
    expect(ok).toEqual({ ok: true, identity: { sub: 'u1', username: 'awa', roles: ['support'] } });
    expect(await verifyStaffToken(await token({ amr: ['pwd'], realm_access: { roles: ['admin'] } }), keys, opts)).toEqual({ ok: false, reason: 'mfa_required' });
    expect(await verifyStaffToken(await token({ amr: ['otp'], realm_access: { roles: ['admin'] } }, '-1h'), keys, opts)).toEqual({ ok: false, reason: 'invalid_token' });
    expect(await verifyStaffToken(await token({ amr: ['otp'], realm_access: { roles: ['admin'] } }, '5m', 'https://autre'), keys, opts)).toEqual({ ok: false, reason: 'invalid_token' });
    expect(await verifyStaffToken(await token({ amr: ['otp'], realm_access: { roles: ['offline_access'] } }), keys, opts)).toEqual({ ok: false, reason: 'no_role' });
  });

  it('BO-02 moindre privilège : cellules clés de la matrice', () => {
    expect(boGrant(['lecture'], 'node.revoke')).toBe('-');
    expect(boGrant(['support'], 'enrolment.issue')).toBe('O');
    expect(boGrant(['support'], 'pharmacy.read_personal')).toBe('J');
    expect(boGrant(['referentiel'], 'pharmacy.read_personal')).toBe('-');
    expect(boGrant(['referentiel', 'support'], 'recall.broadcast')).toBe('O');
    expect(boGrant(['admin'], 'audit.read')).toBe('O');
    for (const [action, cells] of Object.entries(BO_MATRIX)) {
      expect(cells[0], `${action} : l'admin a toujours au moins un droit justifié`).not.toBe('-');
      if (action.endsWith('.read') && action !== 'audit.read') expect(cells[3], action).toBe('O');
    }
  });
});
