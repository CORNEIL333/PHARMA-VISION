import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserClientsAllowed,
  createPairingCode,
  deviceStatus,
  listDevices,
  lookupDevice,
  pairDevice,
  revokeDevice,
  setBrowserClientsAllowed,
} from '../src/domain/devices.js';
import { AppError } from '../src/errors.js';
import { sha256hex } from '../src/security/crypto.js';
import { enforceDevicePolicy } from '../src/security/device-policy.js';
import { verifyLedger } from '../src/domain/verify.js';
import {
  createAndLogin,
  keyMap,
  makeApp,
  reauth,
  setupTitulaire,
  STRONG,
  type Agent,
  type TestApp,
} from './helpers.js';

// Integration prerequisite: task 14 registers both route modules and the global device policy.
let t: TestApp;
let tit: Awaited<ReturnType<typeof setupTitulaire>>;
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => {
  vi.restoreAllMocks();
  t.cleanup();
});
const headers = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const input = (code: string) => ({ name: 'Poste comptoir', platform: 'windows' as const, app_version: '0.1.0', code });
const pair = () => pairDevice(t.s, input(createPairingCode(t.s, tit.userId).code));
const postPair = (code: string, ip = '127.0.0.1') => t.app.inject({
  method: 'POST', url: '/api/v1/devices/pair', payload: input(code), remoteAddress: ip,
});
const codeRow = (code: string) => t.db.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?')
  .get(sha256hex(code)) as { code_hash: string; attempts: number; used_at: string | null; expires_at: string };
const audit = (type: string) => t.db.prepare('SELECT actor, payload FROM events WHERE type = ? ORDER BY seq')
  .all(type) as { actor: string; payload: string }[];
const policy = (url: string, secret?: string, method = 'GET') => enforceDevicePolicy(t.s, {
  method, url, headers: secret === undefined ? {} : { 'x-vp-device': secret },
});

describe('W-02 pairing codes and devices', () => {
  it('W-02 generates eight digits for ten minutes and stores only SHA-256', () => {
    const issuedAt = t.clock.now().getTime();
    const c = createPairingCode(t.s, tit.userId);
    expect(c.code).toMatch(/^\d{8}$/);
    expect(Date.parse(c.expires_at) - issuedAt).toBe(600_000);
    expect(codeRow(c.code)).toMatchObject({ code_hash: sha256hex(c.code), attempts: 0, used_at: null });
    expect(JSON.stringify(t.db.prepare('SELECT * FROM pairing_codes').all())).not.toContain(c.code);
    expect(JSON.stringify(audit('device.pairing_code_created'))).not.toContain(c.code);
    expect(JSON.stringify(audit('device.pairing_code_created'))).not.toContain(sha256hex(c.code));
  });

  it('W-02 returns a 32-byte secret once; paired audit uses the code creator', () => {
    const code = createPairingCode(t.s, tit.userId).code;
    const d = pairDevice(t.s, input(code));
    expect(Buffer.from(d.secret, 'base64url')).toHaveLength(32);
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = t.db.prepare('SELECT secret_hash, paired_by FROM devices WHERE id = ?').get(d.id);
    expect(stored).toEqual({ secret_hash: sha256hex(d.secret), paired_by: tit.userId });
    expect(audit('device.paired')).toHaveLength(1);
    expect(audit('device.paired')[0]?.actor).toBe(tit.userId);
    expect(JSON.parse(audit('device.paired')[0]!.payload)).toMatchObject({ device_id: d.id, name: input(code).name, platform: 'windows' });
    expect(JSON.stringify(listDevices(t.s))).not.toContain(d.secret);
    expect(JSON.stringify(listDevices(t.s))).not.toContain(sha256hex(d.secret));
    expect(JSON.stringify(audit('device.paired'))).not.toContain(d.secret);
    expect(lookupDevice(t.s, sha256hex(d.secret))).toBeNull();
    expect(() => pairDevice(t.s, input(code))).toThrow(AppError);
    expect(audit('device.paired')).toHaveLength(1);
  });

  it('W-02 five unrelated wrong guesses exhaust the actual live code, including across IPs', async () => {
    const c = createPairingCode(t.s, tit.userId).code;
    let first: unknown;
    for (let i = 0; i < 5; i++) {
      const wrong = String((Number(c) + i + 1) % 100_000_000).padStart(8, '0');
      const r = await postPair(wrong, `192.0.2.${i + 1}`);
      expect(r.statusCode).toBe(401);
      if (i === 0) first = r.json();
      expect(r.json()).toEqual(first);
      expect(codeRow(c).attempts).toBe(i + 1);
    }
    expect(codeRow(c).used_at).not.toBeNull();
    const exhausted = await postPair(c);
    expect(exhausted.json()).toEqual(first);
    expect(codeRow(c).attempts).toBe(5);
    expect(audit('device.paired')).toHaveLength(0);
  });

  it('W-02 a valid fifth attempt succeeds after four failures; malformed guesses also count', () => {
    const c = createPairingCode(t.s, tit.userId).code;
    for (let i = 0; i < 4; i++) expect(() => pairDevice(t.s, input(`invalid-${i}`))).toThrow(AppError);
    expect(codeRow(c).attempts).toBe(4);
    expect(pairDevice(t.s, input(c)).id).toBeTruthy();
    expect(codeRow(c).used_at).not.toBeNull();
  });

  it('W-02 expires exactly at ten minutes and replacement invalidates the previous code', () => {
    const c1 = createPairingCode(t.s, tit.userId).code;
    const c2 = createPairingCode(t.s, tit.userId).code;
    expect(c2).not.toBe(c1);
    expect(codeRow(c1).used_at).not.toBeNull();
    expect(() => pairDevice(t.s, input(c1))).toThrow(AppError);
    expect(codeRow(c2).attempts).toBe(1);
    t.clock.advance(600_000);
    expect(() => pairDevice(t.s, input(c2))).toThrow(AppError);
    expect(audit('device.paired')).toHaveLength(0);
  });

  it('W-02 concurrent submissions consume the code once', async () => {
    const c = createPairingCode(t.s, tit.userId).code;
    const results = await Promise.all([postPair(c), postPair(c)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 401]);
    expect(audit('device.paired')).toHaveLength(1);
  });

  it('W-02 rate limits public pairing by IP before further work', async () => {
    for (let i = 0; i < 10; i++) expect((await postPair('invalid')).statusCode).toBe(401);
    expect((await postPair('invalid')).statusCode).toBe(429);
    t.clock.advance(60_000);
    expect((await postPair('invalid')).statusCode).toBe(401);
  });

  it('W-02 code creation is pharmacist/titulaire only, protected by CSRF', async () => {
    const url = '/api/v1/devices/pairing-code';
    expect((await t.app.inject({ method: 'POST', url })).statusCode).toBe(401);
    const missingCsrf = await t.app.inject({ method: 'POST', url, headers: { cookie: tit.cookie } });
    expect(missingCsrf.json()).toMatchObject({ code: 'csrf_failed' });
    for (const role of ['pharmacien', 'preparateur', 'caissier']) {
      const a = await createAndLogin(t, tit, `pair-${role}`, role);
      const r = await t.app.inject({ method: 'POST', url, headers: headers(a) });
      expect(r.statusCode, role).toBe(role === 'pharmacien' ? 201 : 403);
      if (role === 'pharmacien') {
        const code = (r.json() as { code: string }).code;
        const paired = await postPair(code);
        expect(paired.statusCode).toBe(201);
        expect(audit('device.paired').at(-1)?.actor).toBe(a.id);
      }
    }
  });

  it('W-02 rejects a code if its creator has since lost pairing authority', async () => {
    const a = await createAndLogin(t, tit, 'pair-author', 'pharmacien');
    const code = createPairingCode(t.s, a.id).code;
    // Simulate a concurrent account change; production user updates already invalidate sessions.
    t.db.prepare("UPDATE users SET role = 'caissier' WHERE id = ?").run(a.id);
    expect(() => pairDevice(t.s, input(code))).toThrow(AppError);
    expect(audit('device.paired')).toHaveLength(0);
  });

  it('W-02 rejects invalid metadata without consuming a valid code', async () => {
    const c = createPairingCode(t.s, tit.userId).code;
    const r = await t.app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { ...input(c), platform: 'other' } });
    expect(r.statusCode).toBe(400);
    expect(() => pairDevice(t.s, { ...input(c), name: ' ' })).toThrow(AppError);
    expect(codeRow(c).used_at).toBeNull();
    expect(pairDevice(t.s, input(c)).id).toBeTruthy();
  });

  it('W-02 pairing and failure budget roll back if ledger append fails', () => {
    const c = createPairingCode(t.s, tit.userId).code;
    const head = t.ledger.head();
    const append = vi.spyOn(t.ledger, 'append').mockImplementation(() => { throw new Error('audit unavailable'); });
    expect(() => pairDevice(t.s, input(c))).toThrow('audit unavailable');
    expect(codeRow(c).used_at).toBeNull();
    expect(listDevices(t.s)).toHaveLength(0);
    expect(() => pairDevice(t.s, input('invalid'))).toThrow('audit unavailable');
    expect(codeRow(c).attempts).toBe(0);
    expect(() => createPairingCode(t.s, tit.userId)).toThrow('audit unavailable');
    expect(codeRow(c).used_at).toBeNull();
    expect(t.ledger.head()).toEqual(head);
    append.mockRestore();
    expect(pairDevice(t.s, input(c)).id).toBeTruthy();
  });
});

describe('W-09 paired workstation management', () => {
  it('W-09 lists safe metadata, requires titulaire reauth, revokes once and treats revoked secrets as absent', async () => {
    const d = pair();
    const url = `/api/v1/devices/${d.id}/revoke`;
    expect((await t.app.inject({ url: '/api/v1/devices', headers: headers(tit) })).json()).toMatchObject({ code: 'reauth_required' });
    expect((await t.app.inject({ method: 'POST', url, headers: headers(tit) })).json()).toMatchObject({ code: 'reauth_required' });
    const pharmacist = await createAndLogin(t, tit, 'device-reader', 'pharmacien');
    expect((await t.app.inject({ url: '/api/v1/devices', headers: headers(pharmacist) })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url, headers: headers(pharmacist) })).statusCode).toBe(403);
    await reauth(t, tit, STRONG, tit.totpSecret);
    const listed = await t.app.inject({ url: '/api/v1/devices', headers: headers(tit) });
    expect(listed.json()).toEqual([expect.objectContaining({ id: d.id, name: 'Poste comptoir', paired_at: expect.any(String), last_seen_at: expect.any(String) })]);
    expect(listed.body).not.toContain('secret');
    expect((await t.app.inject({ url: `/api/v1/devices/${d.id}/status` })).json()).toEqual({ status: 'active' });
    expect((await t.app.inject({ method: 'POST', url, headers: headers(tit) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url, headers: headers(tit) })).statusCode).toBe(200);
    expect(lookupDevice(t.s, d.secret)).toBeNull();
    expect(deviceStatus(t.s, d.id)).toEqual({ status: 'revoked' });
    expect(deviceStatus(t.s, randomUUID())).toEqual({ status: 'revoked' });
    expect(audit('device.revoked')).toHaveLength(1);
    expect(audit('device.revoked')[0]?.actor).toBe(tit.userId);
    expect(policy('/api/v1/auth/me', d.secret)).toBeNull();
  });

  it('W-09 last_seen_at changes at most once per minute, without heartbeat audit events', () => {
    const d = pair();
    const first = listDevices(t.s)[0]!.last_seen_at;
    const head = t.ledger.head();
    for (let i = 0; i < 59; i++) {
      t.clock.advance(1_000);
      expect(policy('/api/v1/auth/me', d.secret)).toBe(d.id);
    }
    expect(listDevices(t.s)[0]!.last_seen_at).toBe(first);
    t.clock.advance(1_000);
    expect(policy('/api/v1/auth/me', d.secret)).toBe(d.id);
    expect(listDevices(t.s)[0]!.last_seen_at).toBe(t.clock.now().toISOString());
    expect(t.ledger.head()).toEqual(head);
  });
});

describe('W-11 browser-client policy', () => {
  it('W-11 defaults true, rejects unknown stored values and requires a working device to disable', () => {
    expect(browserClientsAllowed(t.s)).toBe(true);
    expect(policy('/api/v1/auth/me')).toBeNull();
    expect(() => setBrowserClientsAllowed(t.s, tit.userId, false)).toThrow(AppError);
    expect(browserClientsAllowed(t.s)).toBe(true);
    const d = pair();
    expect(() => setBrowserClientsAllowed(t.s, tit.userId, false, sha256hex(d.secret))).toThrow(AppError);
    expect(setBrowserClientsAllowed(t.s, tit.userId, false, d.secret)).toEqual({ allow_browser_clients: false });
    expect(t.db.prepare("SELECT value FROM settings WHERE key = 'allow_browser_clients'").get()).toEqual({ value: 'false' });
    t.db.prepare("UPDATE settings SET value = 'invalid' WHERE key = 'allow_browser_clients'").run();
    expect(browserClientsAllowed(t.s)).toBe(false);
  });

  it('W-11 exceptions are exactly health, POST pair and GET/HEAD update resources, never status/setup', () => {
    const d = pair();
    setBrowserClientsAllowed(t.s, tit.userId, false, d.secret);
    for (const url of ['/api/v1/health', '/api/v1/desktop/update', '/api/v1/desktop/packages/client.msi']) {
      expect(policy(url)).toBeNull();
      expect(policy(url, undefined, 'HEAD')).toBeNull();
      expect(() => policy(url, undefined, 'POST')).toThrow(AppError);
    }
    expect(policy('/api/v1/devices/pair', undefined, 'POST')).toBeNull();
    for (const url of ['/api/v1/devices/pair', `/api/v1/devices/${d.id}/status`, '/api/v1/setup/status', '/api/v1/setup', '/api/v1/health/extra', '/api/v1/desktop/update/extra', '/api/v1/desktop/packages', '/api/v1/desktop/packages/../keys', '/api/v1/desktop/packages/%2e%2e', '/api/v1/desktop/packages/a/b', '/api/v1/auth/login', '/index.html', '/missing']) {
      expect(() => policy(url), url).toThrow(AppError);
    }
    expect(policy('/api/v1/health?probe=1')).toBeNull();
    for (const secret of [randomBytes(32).toString('base64url'), sha256hex(d.secret), d.id]) {
      expect(() => policy('/api/v1/auth/me', secret)).toThrow(AppError);
    }
    expect(policy('/api/v1/auth/me', d.secret)).toBe(d.id);
  });

  it('W-11 HTTP policy permits authorized code issuance and public pairing, but not session/CSRF bypass', async () => {
    const d = pair();
    await reauth(t, tit, STRONG, tit.totpSecret);
    const H = { ...headers(tit), 'x-vp-device': d.secret };
    expect((await t.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: H, payload: { allow_browser_clients: false } })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/v1/health' })).statusCode).toBe(200);
    for (const url of ['/api/v1/auth/me', '/api/v1/setup/status', `/api/v1/devices/${d.id}/status`, '/missing']) {
      const r = await t.app.inject({ url, headers: headers(tit) });
      expect(r.statusCode, url).toBe(403);
      expect(r.json()).toMatchObject({ code: 'forbidden' });
    }
    expect((await t.app.inject({ url: '/api/v1/auth/me', headers: { 'x-vp-device': d.secret } })).statusCode).toBe(401);
    const csrf = await t.app.inject({ method: 'POST', url: '/api/v1/devices/pairing-code', headers: { cookie: tit.cookie, 'x-vp-device': d.secret } });
    expect(csrf.json()).toMatchObject({ code: 'csrf_failed' });
    const codeResponse = await t.app.inject({ method: 'POST', url: '/api/v1/devices/pairing-code', headers: H });
    expect(codeResponse.statusCode).toBe(201);
    expect((await postPair((codeResponse.json() as { code: string }).code)).statusCode).toBe(201);
    expect((await t.app.inject({ url: `/api/v1/devices/${d.id}/status`, headers: H })).json()).toEqual({ status: 'active' });
  });

  it('W-11 settings require titulaire reauth; last-device revocation atomically restores fallback', async () => {
    const d = pair();
    const request = () => t.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: { ...headers(tit), 'x-vp-device': d.secret }, payload: { allow_browser_clients: false } });
    expect((await request()).json()).toMatchObject({ code: 'reauth_required' });
    const a = await createAndLogin(t, tit, 'settings-reader', 'pharmacien');
    expect((await t.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: { ...headers(a), 'x-vp-device': d.secret }, payload: { allow_browser_clients: false } })).statusCode).toBe(403);
    await reauth(t, tit, STRONG, tit.totpSecret);
    expect((await request()).statusCode).toBe(200);
    const head = t.ledger.head();
    const append = vi.spyOn(t.ledger, 'append').mockImplementation(() => { throw new Error('audit unavailable'); });
    expect(() => revokeDevice(t.s, tit.userId, d.id)).toThrow('audit unavailable');
    expect(browserClientsAllowed(t.s)).toBe(false);
    expect(deviceStatus(t.s, d.id)).toEqual({ status: 'active' });
    expect(t.ledger.head()).toEqual(head);
    append.mockRestore();
    const revoked = await t.app.inject({ method: 'POST', url: `/api/v1/devices/${d.id}/revoke`, headers: { ...headers(tit), 'x-vp-device': d.secret } });
    expect(revoked.json()).toMatchObject({ status: 'revoked', allow_browser_clients: true });
    expect(browserClientsAllowed(t.s)).toBe(true);
    expect((await t.app.inject({ url: '/api/v1/auth/me', headers: headers(tit) })).statusCode).toBe(200);
    expect(audit('system.settings_changed')).toHaveLength(2);
    expect(verifyLedger(t.db, t.keys.identity.node_id, keyMap(t))).toMatchObject({ ok: true });
  });

  it('W-11 revoking one of multiple devices leaves policy enforced; settings changes are atomic', () => {
    const first = pair();
    const second = pair();
    setBrowserClientsAllowed(t.s, tit.userId, false, first.secret);
    revokeDevice(t.s, tit.userId, first.id);
    expect(browserClientsAllowed(t.s)).toBe(false);
    expect(() => policy('/api/v1/auth/me', first.secret)).toThrow(AppError);
    expect(policy('/api/v1/auth/me', second.secret)).toBe(second.id);
    const append = vi.spyOn(t.ledger, 'append').mockImplementation(() => { throw new Error('audit unavailable'); });
    expect(() => setBrowserClientsAllowed(t.s, tit.userId, true, second.secret)).toThrow('audit unavailable');
    expect(browserClientsAllowed(t.s)).toBe(false);
    append.mockRestore();
    setBrowserClientsAllowed(t.s, tit.userId, true, second.secret);
    setBrowserClientsAllowed(t.s, tit.userId, true, second.secret);
    expect(audit('system.settings_changed')).toHaveLength(2);
  });

  it('A-06 W-02 W-09 W-11 every new authenticated mutation requires CSRF', async () => {
    const d = pair();
    const routes = [
      { method: 'POST' as const, url: '/api/v1/devices/pairing-code' },
      { method: 'POST' as const, url: `/api/v1/devices/${d.id}/revoke` },
      { method: 'PATCH' as const, url: '/api/v1/settings' },
    ];
    for (const r of routes) {
      const res = await t.app.inject({ ...r, headers: { cookie: tit.cookie }, payload: {} });
      expect(res.statusCode, r.url).toBe(403);
      expect(res.json()).toMatchObject({ code: 'csrf_failed' });
    }
  });
});
