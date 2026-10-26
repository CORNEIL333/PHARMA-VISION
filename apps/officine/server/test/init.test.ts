import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:https';
import { connect } from 'node:tls';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkKeyPermissions,
  initNode,
  loadNodeKeys,
  paths,
  readRecoveryWrap,
  unwrapDataKey,
} from '../src/security/keys.js';
import { fingerprint } from '../src/security/x509.js';
import { chmodSync } from 'node:fs';

const dirs: string[] = [];
function fresh() {
  const d = mkdtempSync(path.join(tmpdir(), 'vp-init-'));
  dirs.push(d);
  return d;
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const NOW = new Date('2026-10-27T08:00:00.000Z');
const posix = process.platform !== 'win32';

describe('I-01 initialisation du nœud', () => {
  it('I-01 crée tous les éléments avec les bons droits', () => {
    const d = fresh();
    initNode(d, NOW, { names: ['officine.local', '192.168.1.10', 'localhost'] });
    const p = paths(d);
    for (const f of [
      p.dataKey,
      p.recoveryWrap,
      p.nodePriv,
      p.nodePub,
      p.nodeJson,
      p.caKey,
      p.caCert,
      p.tlsKey,
      p.tlsCert,
    ]) {
      expect(existsSync(f), f).toBe(true);
    }
    if (posix) {
      for (const dir of [p.dataDir, p.keys, p.tls, p.blobs, p.backups])
        expect(statSync(dir).mode & 0o777).toBe(0o700);
      for (const f of [p.dataKey, p.recoveryWrap, p.nodePriv, p.nodeJson, p.caKey, p.tlsKey])
        expect(statSync(f).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(p.dataKey).length).toBe(32);
    const k = loadNodeKeys(d);
    expect(k.identity.node_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(k.privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('I-01 relancé, refuse d’écraser sans --force', () => {
    const d = fresh();
    initNode(d, NOW, { names: ['localhost'] });
    expect(() => initNode(d, NOW, { names: ['localhost'] })).toThrow(/déjà initialisé/);
  });

  it('I-01 autorité locale ECDSA P-256 de 10 ans qui signe le certificat serveur de 2 ans', () => {
    const d = fresh();
    initNode(d, NOW, { names: ['officine.local', '192.168.1.10', 'localhost'] });
    const p = paths(d);
    const ca = new X509Certificate(readFileSync(p.caCert));
    const srv = new X509Certificate(readFileSync(p.tlsCert));
    expect(ca.ca).toBe(true);
    expect(srv.ca).toBe(false);
    expect(ca.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(srv.verify(ca.publicKey)).toBe(true);
    expect(srv.checkIssued(ca)).toBe(true);
    expect(srv.checkHost('officine.local')).toBe('officine.local');
    expect(srv.checkIP('192.168.1.10')).toBe('192.168.1.10');
    const years = (c: X509Certificate) =>
      (Date.parse(c.validTo) - Date.parse(c.validFrom)) / (365 * 86_400_000);
    expect(Math.round(years(ca))).toBe(10);
    expect(Math.round(years(srv))).toBe(2);
  });

  it.runIf(hasOpenssl())('I-01 openssl valide la chaîne et l’usage serveur', () => {
    const d = fresh();
    initNode(d, NOW, { names: ['localhost', '127.0.0.1'] });
    const p = paths(d);
    const out = execFileSync('openssl', [
      'verify',
      '-purpose',
      'sslserver',
      '-CAfile',
      p.caCert,
      p.tlsCert,
    ]).toString();
    expect(out).toContain('OK');
  });

  it('I-01 une poignée de main TLS réussit avec l’autorité locale seulement', async () => {
    const d = fresh();
    initNode(d, NOW, { names: ['localhost', '127.0.0.1'] });
    const p = paths(d);
    const srv = createServer(
      { key: readFileSync(p.tlsKey), cert: readFileSync(p.tlsCert), minVersion: 'TLSv1.2' },
      (_q, r) => r.end('ok'),
    );
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const port = (srv.address() as { port: number }).port;
    const authorized = await new Promise<boolean>((res, rej) => {
      const s = connect(
        { host: '127.0.0.1', port, servername: 'localhost', ca: readFileSync(p.caCert) },
        () => {
          res(s.authorized);
          s.end();
        },
      );
      s.on('error', rej);
    });
    srv.close();
    expect(authorized).toBe(true);
  });

  it('I-03 la clé de récupération déchiffre la copie de la clé de données ; une autre clé échoue', () => {
    const d = fresh();
    const r = initNode(d, NOW, { names: ['localhost'] });
    const w = readRecoveryWrap(d);
    expect(unwrapDataKey(w, r.recoveryKey).equals(readFileSync(paths(d).dataKey))).toBe(true);
    const other = r.recoveryKey.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    expect(() => unwrapDataKey(w, other)).toThrow();
  });

  it('I-06 l’empreinte publiée est celle du fichier de l’autorité', () => {
    const d = fresh();
    const r = initNode(d, NOW, { names: ['localhost'] });
    expect(r.caFingerprint).toBe(fingerprint(readFileSync(paths(d).caCert, 'utf8')));
    expect(loadNodeKeys(d).caFingerprint).toBe(r.caFingerprint);
    expect(r.caFingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it.runIf(posix)('Doc 06 §4.2 refuse de démarrer si une clé est lisible par d’autres', () => {
    const d = fresh();
    initNode(d, NOW, { names: ['localhost'] });
    expect(() => checkKeyPermissions(d)).not.toThrow();
    chmodSync(paths(d).nodePriv, 0o644);
    expect(() => checkKeyPermissions(d)).toThrow(/0600/);
  });
});

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
}
