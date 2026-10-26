import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FixedClock } from '../src/clock.js';
import { openDb, type DB } from '../src/db/index.js';
import { Ledger } from '../src/domain/ledger.js';
import { initNode, loadNodeKeys, type NodeKeys } from '../src/security/keys.js';

export interface TestNode {
  dir: string;
  db: DB;
  keys: NodeKeys;
  clock: FixedClock;
  ledger: Ledger;
  recoveryKey: string;
  cleanup(): void;
}

/** Nœud complet dans un répertoire temporaire (vraies clés, vraie base SQLite sur disque). */
export function makeNode(opts: { checkpointEvery?: number } = {}): TestNode {
  const dir = mkdtempSync(path.join(tmpdir(), 'vp-test-'));
  const clock = new FixedClock('2026-10-27T08:00:00.000Z');
  const init = initNode(dir, clock.now(), { names: ['localhost', '127.0.0.1'] });
  const keys = loadNodeKeys(dir);
  const db = openDb(path.join(dir, 'officine.db'));
  const ledger = new Ledger(
    db,
    { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey },
    clock,
    opts.checkpointEvery ?? 100,
  );
  return {
    dir,
    db,
    keys,
    clock,
    ledger,
    recoveryKey: init.recoveryKey,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function keyMap(n: TestNode) {
  return new Map([[n.keys.identity.kid, n.keys.publicKey]]);
}

// ---------------------------------------------------------------- Application HTTP de test
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';
import { newTotpSecret, totpAt } from '../src/security/totp.js';

/** Paramètres scrypt réduits : AUTORISÉS UNIQUEMENT DANS test/ (GUARDRAILS 12). La production utilise N=2^17. */
export const FAST_SCRYPT = { N: 2 ** 14, r: 8, p: 1 };

export interface TestApp extends TestNode {
  app: FastifyInstance;
  s: Services;
}

export async function makeApp(): Promise<TestApp> {
  const n = makeNode();
  const config = { ...loadConfig({ VP_DATA_DIR: n.dir }), dataDir: n.dir };
  const s: Services = {
    db: n.db,
    ledger: n.ledger,
    clock: n.clock,
    keys: n.keys,
    config,
    scryptParams: FAST_SCRYPT,
  };
  const app = await buildApp(s);
  return {
    ...n,
    app,
    s,
    cleanup: () => {
      void app.close();
      n.cleanup();
    },
  };
}

export const STRONG = 'Bissap-Ndole-2026!';

export interface Agent {
  cookie: string;
  csrf: string;
}

export function sidOf(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'vp_sid');
  if (!c) throw new Error('pas de cookie vp_sid');
  return `vp_sid=${c.value}`;
}

/** Configuration initiale complète : renvoie la session du titulaire et son secret TOTP. */
export async function setupTitulaire(t: TestApp): Promise<Agent & { totpSecret: string; userId: string }> {
  const totpSecret = newTotpSecret();
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: {
      pharmacy_name: 'Pharmacie du Centre',
      username: 'titulaire',
      display_name: 'Dr Mballa',
      password: STRONG,
      recovery_key: t.recoveryKey,
      totp_secret: totpSecret,
      totp_code: totpAt(totpSecret, t.clock.now()),
    },
  });
  if (res.statusCode !== 201) throw new Error(`setup: ${res.statusCode} ${res.body}`);
  const body = res.json() as { csrf: string; user_id: string };
  // Les codes TOTP ne se réutilisent pas : on avance d'un pas pour les connexions suivantes.
  t.clock.advance(30_000);
  return { cookie: sidOf(res), csrf: body.csrf, totpSecret, userId: body.user_id };
}

export async function reauth(t: TestApp, a: Agent, password = STRONG, totpSecret?: string): Promise<void> {
  if (totpSecret) t.clock.advance(30_000);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/reauth',
    headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
    payload: { password, ...(totpSecret ? { code: totpAt(totpSecret, t.clock.now()) } : {}) },
  });
  if (res.statusCode !== 200) throw new Error(`reauth: ${res.statusCode} ${res.body}`);
}

/** Crée un compte (titulaire ré-authentifié) puis le connecte avec un mot de passe définitif. */
export async function createAndLogin(
  t: TestApp,
  tit: Agent & { totpSecret: string },
  username: string,
  role: string,
): Promise<Agent & { id: string }> {
  await reauth(t, tit, STRONG, tit.totpSecret);
  const c = await t.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { cookie: tit.cookie, 'x-csrf-token': tit.csrf },
    payload: { username, display_name: username, role },
  });
  if (c.statusCode !== 201) throw new Error(`create: ${c.statusCode} ${c.body}`);
  const { user, temporary_password } = c.json() as { user: { id: string }; temporary_password: string };
  const l = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password: temporary_password },
  });
  const a = { cookie: sidOf(l), csrf: (l.json() as { csrf: string }).csrf };
  const p = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
    payload: { current_password: temporary_password, new_password: STRONG },
  });
  if (p.statusCode !== 200) throw new Error(`password: ${p.statusCode} ${p.body}`);
  return { ...a, id: user.id };
}
