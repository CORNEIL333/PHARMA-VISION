import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPairingCode, pairDevice, revokeDevice, setBrowserClientsAllowed } from '../src/domain/devices.js';
import { makeApp, reauth, setupTitulaire, STRONG, type Agent, type TestApp } from './helpers.js';
import { payloadsOf } from './stock.helpers.js';

let t: TestApp;
let tit: Agent & { totpSecret: string; userId: string };
const H = (a: Agent) => ({ cookie: a.cookie, 'x-csrf-token': a.csrf });
const pair = () => pairDevice(t.s, { name: 'Comptoir 1', platform: 'windows', app_version: '0.1.0', code: createPairingCode(t.s, tit.userId).code });
beforeEach(async () => {
  t = await makeApp();
  tit = await setupTitulaire(t);
});
afterEach(() => t.cleanup());

describe('W-02 W-11 démarrage du poste : jeton à usage unique puis cookie de poste', () => {
  it('W-11 le cookie de poste ouvre l’interface quand l’accès navigateur est interdit', async () => {
    const d = pair();
    setBrowserClientsAllowed(t.s, tit.userId, false, d.secret);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/devices/session' })).statusCode).toBe(403);
    const s = await t.app.inject({ method: 'POST', url: '/api/v1/devices/session', headers: { 'x-vp-device': d.secret } });
    expect(s.statusCode, s.body).toBe(200);
    const { token } = s.json() as { token: string };
    const boot = await t.app.inject({ url: `/api/v1/devices/boot?token=${token}` });
    expect(boot.statusCode).toBe(303);
    expect(boot.headers.location).toBe('/caisse');
    const cookie = boot.cookies.find((c) => c.name === 'vp_dev')!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect((await t.app.inject({ url: `/api/v1/devices/boot?token=${token}` })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/v1/auth/me' })).statusCode).toBe(403);
    expect((await t.app.inject({ url: '/api/v1/auth/me', headers: { cookie: `vp_dev=${cookie.value}` } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/v1/devices/self', headers: { cookie: `vp_dev=${cookie.value}` } })).json()).toMatchObject({ id: d.id, kiosk: false });
    revokeDevice(t.s, tit.userId, d.id);
    expect((await t.app.inject({ url: '/api/v1/devices/self', headers: { cookie: `vp_dev=${cookie.value}` } })).statusCode).toBe(401);
  });

  it('W-02 un jeton expire après 60 secondes', async () => {
    const d = pair();
    const { token } = (await t.app.inject({ method: 'POST', url: '/api/v1/devices/session', headers: { 'x-vp-device': d.secret } })).json() as { token: string };
    t.clock.advance(61_000);
    expect((await t.app.inject({ url: `/api/v1/devices/boot?token=${token}` })).statusCode).toBe(401);
  });
});

describe('W-08 mode caisse plein écran', () => {
  it('W-08 le titulaire ré-authentifié active le kiosque d’un poste ; le poste le lit', async () => {
    const d = pair();
    const url = `/api/v1/devices/${d.id}`;
    t.clock.advance(6 * 60_000);
    expect((await t.app.inject({ method: 'PATCH', url, headers: H(tit), payload: { kiosk: true } })).json()).toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    expect((await t.app.inject({ method: 'PATCH', url, headers: H(tit), payload: { kiosk: true } })).json()).toMatchObject({ kiosk: true });
    expect((await t.app.inject({ url: '/api/v1/devices/self', headers: { 'x-vp-device': d.secret } })).json()).toEqual({ id: d.id, name: 'Comptoir 1', kiosk: true });
    expect((await t.app.inject({ url: '/api/v1/devices', headers: H(tit) })).json()).toEqual([expect.objectContaining({ id: d.id, kiosk: true })]);
    expect(payloadsOf(t.db, 'system.settings_changed').at(-1)).toMatchObject({ key: 'device.kiosk', device_id: d.id, new_value: true });
  });
});

describe('W-07 mises à jour servies par le serveur local', () => {
  it('W-07 sans publication : 204 ; avec publication : manifeste aux URL du serveur et paquet servi', async () => {
    expect((await t.app.inject({ url: '/api/v1/desktop/update' })).statusCode).toBe(204);
    const dir = path.join(t.dir, 'desktop');
    mkdirSync(path.join(dir, 'packages'), { recursive: true });
    writeFileSync(path.join(dir, 'packages', 'VisionPharma_0.2.0_x64-setup.exe'), 'binaire');
    writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({
      version: '0.2.0', pub_date: '2026-11-01T00:00:00Z',
      platforms: { 'windows-x86_64': { signature: 'c2lnbmF0dXJl', url: 'https://ailleurs.example/VisionPharma_0.2.0_x64-setup.exe' }, 'linux-x86_64': { signature: 'x', url: '../../keys/data.key' } },
    }));
    const m = await t.app.inject({ url: '/api/v1/desktop/update', headers: { host: 'officine.local:8443' } });
    expect(m.json()).toEqual({
      version: '0.2.0', pub_date: '2026-11-01T00:00:00Z',
      platforms: {
        'windows-x86_64': { signature: 'c2lnbmF0dXJl', url: 'http://officine.local:8443/api/v1/desktop/packages/VisionPharma_0.2.0_x64-setup.exe' },
        'linux-x86_64': { signature: 'x', url: 'http://officine.local:8443/api/v1/desktop/packages/data.key' },
      },
    });
    const pkg = await t.app.inject({ url: '/api/v1/desktop/packages/VisionPharma_0.2.0_x64-setup.exe' });
    expect(pkg.body).toBe('binaire');
    for (const bad of ['data.key', '..%2Fkeys%2Fdata.key', 'latest.json', '.hidden']) {
      expect((await t.app.inject({ url: `/api/v1/desktop/packages/${bad}` })).statusCode, bad).toBe(404);
    }
  });
});
