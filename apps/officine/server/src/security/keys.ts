import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import {
  b64url,
  base32Encode,
  base32Decode,
  fromB64url,
  open,
  seal,
  sha256hex,
  type Sealed,
} from './crypto.js';
import { createLocalCa, createServerCert, fingerprint } from './x509.js';

/** Fichiers de clés du nœud (doc 06 §4.2) et initialisation (I-01, I-03). */

export interface NodeIdentity {
  node_id: string;
  kid: string;
  data_kid: string;
  alg: 'Ed25519';
  created_at: string;
}

export interface NodeKeys {
  identity: NodeIdentity;
  dataKey: Buffer;
  privateKey: KeyObject;
  publicKey: KeyObject;
  caFingerprint: string | null;
}

export const paths = (dataDir: string) => ({
  dataDir,
  db: path.join(dataDir, 'officine.db'),
  keys: path.join(dataDir, 'keys'),
  dataKey: path.join(dataDir, 'keys', 'data.key'),
  recoveryWrap: path.join(dataDir, 'keys', 'recovery.wrap'),
  nodePriv: path.join(dataDir, 'keys', 'node_ed25519.pem'),
  nodePub: path.join(dataDir, 'keys', 'node_ed25519.pub.pem'),
  nodeJson: path.join(dataDir, 'keys', 'node.json'),
  tls: path.join(dataDir, 'tls'),
  caKey: path.join(dataDir, 'tls', 'ca.key.pem'),
  caCert: path.join(dataDir, 'tls', 'ca.pem'),
  tlsKey: path.join(dataDir, 'tls', 'key.pem'),
  tlsCert: path.join(dataDir, 'tls', 'cert.pem'),
  blobs: path.join(dataDir, 'blobs'),
  backups: path.join(dataDir, 'backups'),
});

const SECRET_FILES = ['dataKey', 'recoveryWrap', 'nodePriv', 'nodeJson', 'caKey', 'tlsKey'] as const;

/** Identifiant de clé : 16 premiers caractères hexadécimaux du SHA-256 de la clé publique (SPKI DER). */
export function keyIdOf(pub: KeyObject): string {
  return 'ed25519-' + sha256hex(pub.export({ type: 'spki', format: 'der' })).slice(0, 16);
}

// scrypt de la clé de récupération : mêmes paramètres que les mots de passe (doc 06 §4.1).
const RECOVERY_SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export interface RecoveryWrap {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  sealed: Sealed;
}

export function wrapDataKey(dataKey: Buffer, recoverySecret: Buffer, dataKid: string): RecoveryWrap {
  const salt = randomBytes(16);
  const k = scryptSync(recoverySecret, salt, 32, RECOVERY_SCRYPT);
  return {
    v: 1,
    kdf: 'scrypt',
    N: RECOVERY_SCRYPT.N,
    r: RECOVERY_SCRYPT.r,
    p: RECOVERY_SCRYPT.p,
    salt: b64url(salt),
    sealed: seal(k, dataKid, dataKey),
  };
}

export function unwrapDataKey(w: RecoveryWrap, recoveryKeyText: string): Buffer {
  const secret = base32Decode(recoveryKeyText);
  if (secret.length !== 32) throw new Error('Clé de récupération invalide');
  const k = scryptSync(secret, fromB64url(w.salt), 32, {
    N: w.N,
    r: w.r,
    p: w.p,
    maxmem: RECOVERY_SCRYPT.maxmem,
  });
  return open(k, w.sealed);
}

/** Affichage de la clé de récupération : base32 en groupes de 4 (52 caractères). */
export function formatRecoveryKey(secret: Buffer): string {
  return base32Encode(secret)
    .match(/.{1,4}/g)!
    .join('-');
}

export function lanNames(): string[] {
  const names = new Set<string>(['localhost', '127.0.0.1', hostname()]);
  for (const ifs of Object.values(networkInterfaces())) {
    for (const i of ifs ?? []) if (i.family === 'IPv4' && !i.internal) names.add(i.address);
  }
  return [...names];
}

export interface InitResult {
  identity: NodeIdentity;
  recoveryKey: string;
  caFingerprint: string;
  tlsNames: string[];
}

/** I-01 : crée répertoires (0700), clés, identité et TLS. Refuse d'écraser sans force. */
export function initNode(
  dataDir: string,
  now: Date,
  opts: { force?: boolean; names?: string[] } = {},
): InitResult {
  const p = paths(dataDir);
  if (existsSync(p.nodeJson) && !opts.force) {
    throw new Error(`Le répertoire ${dataDir} est déjà initialisé (utiliser --force pour écraser).`);
  }
  if (opts.force) {
    // On n'efface rien de façon silencieuse : --force n'est accepté que sans base existante.
    if (existsSync(p.db))
      throw new Error('--force refusé : une base existe. Restaurer ou déplacer les données d’abord.');
  }
  for (const d of [p.dataDir, p.keys, p.tls, p.blobs, p.backups]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
  const flag = opts.force ? 'w' : 'wx';
  const put = (file: string, data: string | Buffer, mode: number) => {
    writeFileSync(file, data, { mode, flag });
    chmodSync(file, mode);
  };

  const dataKey = randomBytes(32);
  const dataKid = 'dk-' + sha256hex(randomBytes(16)).slice(0, 12);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const identity: NodeIdentity = {
    node_id: randomUUID(),
    kid: keyIdOf(publicKey),
    data_kid: dataKid,
    alg: 'Ed25519',
    created_at: now.toISOString(),
  };
  const recoverySecret = randomBytes(32);
  const wrap = wrapDataKey(dataKey, recoverySecret, dataKid);

  const names = opts.names ?? lanNames();
  const ca = createLocalCa(`VisionPharma CA ${identity.node_id.slice(0, 8)}`, now);
  const server = createServerCert(ca, names, now);

  put(p.dataKey, dataKey, 0o600);
  put(p.recoveryWrap, JSON.stringify(wrap), 0o600);
  put(p.nodePriv, privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600);
  put(p.nodePub, publicKey.export({ type: 'spki', format: 'pem' }), 0o644);
  put(p.nodeJson, JSON.stringify(identity, null, 2), 0o600);
  put(p.caKey, ca.keyPem, 0o600);
  put(p.caCert, ca.certPem, 0o644);
  put(p.tlsKey, server.keyPem, 0o600);
  put(p.tlsCert, server.certPem, 0o644);

  return {
    identity,
    recoveryKey: formatRecoveryKey(recoverySecret),
    caFingerprint: fingerprint(ca.certPem),
    tlsNames: names,
  };
}

/**
 * Refuse de démarrer si un fichier secret est lisible par le groupe ou les autres (doc 06 §4.2).
 * Sous Windows (poste de développement uniquement), les droits POSIX n'existent pas : avertissement.
 */
export function checkKeyPermissions(dataDir: string, platform = process.platform): string[] {
  const p = paths(dataDir);
  const problems: string[] = [];
  if (platform === 'win32')
    return [
      'Droits POSIX non vérifiés sous Windows (développement seulement ; la production tourne sous Ubuntu).',
    ];
  for (const k of SECRET_FILES) {
    const f = p[k];
    if (!existsSync(f)) continue;
    const mode = statSync(f).mode & 0o777;
    if (mode & 0o077) throw new Error(`Droits trop ouverts sur ${f} (${mode.toString(8)}) : 0600 exigé.`);
  }
  return problems;
}

export function loadNodeKeys(dataDir: string): NodeKeys {
  const p = paths(dataDir);
  if (!existsSync(p.nodeJson))
    throw new Error(`Nœud non initialisé : lancer « npm run init -- --data ${dataDir} ».`);
  const identity = JSON.parse(readFileSync(p.nodeJson, 'utf8')) as NodeIdentity;
  const dataKey = readFileSync(p.dataKey);
  if (dataKey.length !== 32) throw new Error('keys/data.key invalide');
  const privateKey = createPrivateKey(readFileSync(p.nodePriv));
  const publicKey = createPublicKey(privateKey);
  if (keyIdOf(publicKey) !== identity.kid) throw new Error('La clé du nœud ne correspond pas à node.json');
  const caFingerprint = existsSync(p.caCert) ? fingerprint(readFileSync(p.caCert, 'utf8')) : null;
  return { identity, dataKey, privateKey, publicKey, caFingerprint };
}

export function readRecoveryWrap(dataDir: string): RecoveryWrap {
  return JSON.parse(readFileSync(paths(dataDir).recoveryWrap, 'utf8')) as RecoveryWrap;
}
