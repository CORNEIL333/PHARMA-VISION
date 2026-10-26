import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { totpAt } from '../src/security/totp.js';
import { createAndLogin, makeApp, reauth, setupTitulaire, sidOf, STRONG, type TestApp } from './helpers.js';

let t: TestApp;
beforeEach(async () => (t = await makeApp()));
afterEach(() => t.cleanup());

const events = (type: string) =>
  (t.db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as { n: number }).n;
const login = (username: string, password: string) =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });

describe('I-02 configuration initiale', () => {
  it('I-02 sans titulaire, les routes renvoient setup_required ; health et setup restent accessibles', async () => {
    expect((await t.app.inject({ url: '/api/v1/health' })).statusCode).toBe(200);
    const st = await t.app.inject({ url: '/api/v1/setup/status' });
    expect(st.json()).toMatchObject({ setup_done: false });
    const r = await login('x', 'y');
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'setup_required' });
  });

  it('I-02 création du titulaire avec TOTP ; ensuite l’écran de configuration n’est plus accessible', async () => {
    await setupTitulaire(t);
    expect(events('system.initialized')).toBe(1);
    expect(events('user.created')).toBe(1);
    const again = await t.app.inject({ url: '/api/v1/setup/totp-secret' });
    expect(again.json()).toMatchObject({ code: 'setup_done' });
    const st = await t.app.inject({ url: '/api/v1/setup/status' });
    expect(st.json()).toMatchObject({ setup_done: true, pharmacy_name: 'Pharmacie du Centre' });
  });

  it('I-03 configuration refusée si la clé de récupération recopiée est fausse', async () => {
    const sec = await t.app.inject({ url: '/api/v1/setup/totp-secret' });
    const { secret } = sec.json() as { secret: string };
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: {
        pharmacy_name: 'P',
        username: 'titulaire',
        display_name: 'T',
        password: STRONG,
        recovery_key: t.recoveryKey.startsWith('AAAA')
          ? t.recoveryKey.replace(/^.{4}/, 'BBBB')
          : t.recoveryKey.replace(/^.{4}/, 'AAAA'),
        totp_secret: secret,
        totp_code: totpAt(secret, t.clock.now()),
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('I-06 l’empreinte de l’autorité locale est publique (écran de connexion)', async () => {
    const st = (await t.app.inject({ url: '/api/v1/setup/status' })).json() as { ca_fingerprint: string };
    expect(st.ca_fingerprint).toBe(t.keys.caFingerprint);
  });
});

describe('A-01 connexion et TOTP', () => {
  it('A-01 mot de passe puis code TOTP ; message générique identique en cas d’erreur', async () => {
    const tit = await setupTitulaire(t);
    const bad1 = await login('titulaire', 'mauvais-mot-de-passe');
    const bad2 = await login('inconnu', STRONG);
    expect(bad1.statusCode).toBe(401);
    expect(bad1.json()).toEqual(bad2.json());
    const step1 = await login('titulaire', STRONG);
    expect(step1.json()).toMatchObject({ status: 'totp_required' });
    expect(step1.cookies.find((c) => c.name === 'vp_sid')).toBeUndefined();
    const { challenge } = step1.json() as { challenge: string };
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp',
      payload: { challenge, code: '000000' },
    });
    expect(wrong.json()).toEqual(bad1.json());
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/totp',
      payload: { challenge, code: totpAt(tit.totpSecret, t.clock.now()) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.find((c) => c.name === 'vp_sid')).toBeDefined();
  });
});

describe('A-04 verrouillage et limitation de débit', () => {
  it('A-04 5 échecs verrouillent 15 minutes, puis levée automatique', async () => {
    const tit = await setupTitulaire(t);
    await createAndLogin(t, tit, 'paul', 'preparateur');
    for (let i = 0; i < 5; i++) {
      expect((await login('paul', 'mauvais-mot-de-passe-' + i)).statusCode).toBe(401);
      t.clock.advance(7_000); // reste sous 10 tentatives/minute
    }
    expect(events('security.account_locked')).toBe(1);
    expect((await login('paul', STRONG)).statusCode).toBe(401); // bon mot de passe refusé pendant le verrouillage
    t.clock.advance(15 * 60_000);
    expect((await login('paul', STRONG)).statusCode).toBe(200);
  });

  it('A-04 plus de 10 tentatives par minute et par adresse IP : 429', async () => {
    await setupTitulaire(t);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await login('inconnu' + i, 'x')).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    t.clock.advance(61_000);
    expect((await login('inconnu', 'x')).statusCode).toBe(401);
  });
});

describe('A-05 sessions', () => {
  it('A-05 cookie HttpOnly Secure SameSite=Strict Path=/ ; seule l’empreinte du jeton est en base', async () => {
    const tit = await setupTitulaire(t);
    const token = tit.cookie.split('=')[1]!;
    const rows = t.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    // Un jeton « volé » en base (empreinte) ne permet pas de se connecter.
    for (const r of rows) {
      const stolen = await t.app.inject({
        url: '/api/v1/auth/me',
        headers: { cookie: `vp_sid=${r.token_hash}` },
      });
      expect(stolen.statusCode).toBe(401);
    }
    expect((await t.app.inject({ url: '/api/v1/auth/me', headers: { cookie: tit.cookie } })).statusCode).toBe(
      200,
    );
  });

  it('A-05 attributs du cookie', async () => {
    const tit = await setupTitulaire(t);
    await createAndLogin(t, tit, 'carine', 'caissier');
    const l = await login('carine', STRONG);
    const c = l.cookies.find((x) => x.name === 'vp_sid');
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
  });

  it('A-05 inactivité de 30 minutes et durée maximale de 12 heures', async () => {
    const tit = await setupTitulaire(t);
    const me = () => t.app.inject({ url: '/api/v1/auth/me', headers: { cookie: tit.cookie } });
    t.clock.advance(29 * 60_000);
    expect((await me()).statusCode).toBe(200);
    t.clock.advance(31 * 60_000);
    expect((await me()).statusCode).toBe(401);
  });

  it('A-05 durée maximale de 12 heures même avec activité continue', async () => {
    const tit = await setupTitulaire(t);
    const me = () => t.app.inject({ url: '/api/v1/auth/me', headers: { cookie: tit.cookie } });
    for (let i = 0; i < 12 * 3 - 1; i++) {
      t.clock.advance(20 * 60_000);
      expect((await me()).statusCode).toBe(200);
    }
    t.clock.advance(20 * 60_000);
    expect((await me()).statusCode).toBe(401);
  });
});

describe('A-06 CSRF', () => {
  it('A-06 une requête modifiante sans jeton ou avec un mauvais jeton : 403', async () => {
    const tit = await setupTitulaire(t);
    const no = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: tit.cookie },
    });
    expect(no.json()).toMatchObject({ code: 'csrf_failed' });
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: tit.cookie, 'x-csrf-token': 'x' },
    });
    expect(bad.statusCode).toBe(403);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: tit.cookie, 'x-csrf-token': tit.csrf },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('A-06 toutes les routes POST/PUT/PATCH/DELETE authentifiées exigent le jeton', async () => {
    const tit = await setupTitulaire(t);
    const mutating = t.app.routeTable.filter(
      (r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.permission !== 'public',
    );
    expect(mutating.length).toBeGreaterThan(5);
    for (const r of mutating) {
      const url = r.url.replace(':id', '00000000-0000-4000-8000-000000000000');
      const res = await t.app.inject({
        method: r.method as 'POST',
        url,
        headers: { cookie: tit.cookie },
        payload: {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
      expect((res.json() as { code: string }).code, `${r.method} ${r.url}`).toBe('csrf_failed');
    }
  });
});

describe('A-07 ré-authentification', () => {
  it('A-07 l’action échoue avec reauth_required puis réussit après ré-authentification, valable 5 minutes', async () => {
    const tit = await setupTitulaire(t);
    const create = () =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { cookie: tit.cookie, 'x-csrf-token': tit.csrf },
        payload: {
          username: 'jean' + Math.floor(t.clock.now().getTime() / 1000),
          display_name: 'Jean',
          role: 'caissier',
        },
      });
    // La configuration ouvre une session sans ré-authentification préalable.
    const r1 = await create();
    expect(r1.json()).toMatchObject({ code: 'reauth_required' });
    await reauth(t, tit, STRONG, tit.totpSecret);
    expect((await create()).statusCode).toBe(201);
    t.clock.advance(5 * 60_000);
    expect((await create()).json()).toMatchObject({ code: 'reauth_required' });
  });
});

describe('A-08 en-têtes de sécurité', () => {
  it('A-08 présents sur toutes les réponses, no-store sur l’API, y compris les erreurs', async () => {
    for (const url of ['/api/v1/health', '/api/v1/inexistant', '/rien']) {
      const r = await t.app.inject({ url });
      expect(r.headers['content-security-policy']).toBe(
        "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
      );
      expect(r.headers['strict-transport-security']).toContain('max-age=');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['permissions-policy']).toBeDefined();
      if (url.startsWith('/api/')) expect(r.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('U-01 / U-02 comptes', () => {
  it('U-01 création, désactivation (sessions supprimées), réactivation, réinitialisation, coupure ; un événement par action', async () => {
    const tit = await setupTitulaire(t);
    const caissier = await createAndLogin(t, tit, 'carine', 'caissier');
    await reauth(t, tit, STRONG, tit.totpSecret);
    const H = { cookie: tit.cookie, 'x-csrf-token': tit.csrf };
    const off = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${caissier.id}`,
      headers: H,
      payload: { active: false },
    });
    expect(off.json()).toMatchObject({ active: false });
    expect(
      (await t.app.inject({ url: '/api/v1/auth/me', headers: { cookie: caissier.cookie } })).statusCode,
    ).toBe(401);
    expect((await login('carine', STRONG)).statusCode).toBe(401);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${caissier.id}`,
      headers: H,
      payload: { active: true },
    });
    const reset = await t.app.inject({
      method: 'POST',
      url: `/api/v1/users/${caissier.id}/reset-password`,
      headers: H,
    });
    const temp = (reset.json() as { temporary_password: string }).temporary_password;
    const l = await login('carine', temp);
    const a = { cookie: sidOf(l), csrf: (l.json() as { csrf: string }).csrf };
    // Changement imposé : tout le reste est refusé tant que le mot de passe n'est pas changé.
    const blocked = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reauth',
      headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
      payload: { password: temp },
    });
    expect(blocked.json()).toMatchObject({ code: 'password_change_required' });
    const rv = await t.app.inject({
      method: 'POST',
      url: `/api/v1/users/${caissier.id}/revoke-sessions`,
      headers: H,
    });
    expect(rv.json()).toMatchObject({ revoked: 1 });
    for (const ty of [
      'user.created',
      'user.disabled',
      'user.enabled',
      'user.password_reset',
      'user.sessions_revoked',
    ]) {
      expect(events(ty), ty).toBeGreaterThanOrEqual(1);
    }
  });

  it('U-02 le dernier titulaire actif ne peut être ni désactivé ni rétrogradé', async () => {
    const tit = await setupTitulaire(t);
    await reauth(t, tit, STRONG, tit.totpSecret);
    const H = { cookie: tit.cookie, 'x-csrf-token': tit.csrf };
    const d = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${tit.userId}`,
      headers: H,
      payload: { active: false },
    });
    expect(d.json()).toMatchObject({ code: 'last_titulaire' });
    const r = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${tit.userId}`,
      headers: H,
      payload: { role: 'pharmacien' },
    });
    expect(r.json()).toMatchObject({ code: 'last_titulaire' });
  });

  it('A-02 la création d’un mot de passe faible est refusée', async () => {
    const tit = await setupTitulaire(t);
    const c = await createAndLogin(t, tit, 'paul', 'preparateur');
    const p = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: c.cookie, 'x-csrf-token': c.csrf },
      payload: { current_password: STRONG, new_password: 'password2026!' },
    });
    expect(p.json()).toMatchObject({ code: 'weak_password', reason: 'common' });
  });
});

describe('J-06 événements de sécurité dans la chaîne', () => {
  it('J-06 connexion, échec, ré-authentification sont des événements du journal vérifiable', async () => {
    const tit = await setupTitulaire(t);
    await login('titulaire', 'faux-faux-faux');
    await reauth(t, tit, STRONG, tit.totpSecret);
    for (const ty of ['security.login_succeeded', 'security.login_failed', 'security.reauth'])
      expect(events(ty), ty).toBeGreaterThanOrEqual(1);
    await reauth(t, tit, STRONG, tit.totpSecret);
    const v = await t.app.inject({
      method: 'POST',
      url: '/api/v1/system/verify-ledger',
      headers: { cookie: tit.cookie, 'x-csrf-token': tit.csrf },
    });
    expect(v.json()).toMatchObject({ ok: true });
  });
});
