import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { b64url, deriveKey, fromB64url, sha256hex } from '../security/crypto.js';
import { paths, unwrapDataKey, type RecoveryWrap } from '../security/keys.js';
import type { Services } from '../services.js';
import { getSetting } from './settings.js';
import { readTar, writeTar, type TarEntry } from './tar.js';
import { verifyLedger, type VerifyResult } from './verify.js';

/**
 * B-01 à B-05 (doc 06 §4.3) : archive « VPBAK1 » = en-tête JSON en clair (données associées)
 * + tar chiffré AES-256-GCM { officine.db, blobs/, keys/node_ed25519.pem, keys/node.json } + étiquette.
 * Clé de sauvegarde = HKDF(clé de données, "vp-backup-v1"). Restauration : vérification complète du
 * journal de l'archive, mise en attente, puis remplacement atomique au redémarrage du service.
 */

export const MAGIC = Buffer.from('VPBAK1', 'ascii');
export const KEEP_BACKUPS = 14;
export const BACKUP_EXT = '.vpbak';

export interface BackupHeader {
  v: 1;
  node_id: string;
  created_at: string;
  last_seq: number;
  last_hash: string;
  kid: string;
  nonce: string;
  recovery_wrap: string;
  recovery_salt: string;
}

export interface BackupInfo {
  file: string;
  size: number;
  created_at: string;
  last_seq: number;
}

const backupKey = (dataKey: Buffer) => deriveKey(dataKey, 'vp-backup-v1');

/** Écriture durable : fichier temporaire, fsync, renommage atomique. */
export function writeDurable(file: string, data: Buffer, mode = 0o600): void {
  const tmp = `${file}.tmp-${randomUUID()}`;
  const fd = openSync(tmp, 'w', mode);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

export function sealArchive(dataKey: Buffer, h: Omit<BackupHeader, 'nonce'>, plaintext: Buffer): Buffer {
  const nonce = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ ...h, nonce: b64url(nonce) }), 'utf8');
  const c = createCipheriv('aes-256-gcm', backupKey(dataKey), nonce, { authTagLength: 16 });
  c.setAAD(header);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, len, header, ct, c.getAuthTag()]);
}

export function readHeader(buf: Buffer): { header: BackupHeader; headerBytes: Buffer; body: Buffer } {
  if (buf.length < 30 || !buf.subarray(0, 6).equals(MAGIC)) throw new AppError('backup_invalid', 'Archive invalide', 'Signature VPBAK1 absente.');
  const len = buf.readUInt32BE(6);
  if (len > 64 * 1024 || 10 + len + 16 > buf.length) throw new AppError('backup_invalid', 'Archive invalide', 'En-tête illisible.');
  const headerBytes = buf.subarray(10, 10 + len);
  let header: BackupHeader;
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as BackupHeader;
  } catch {
    throw new AppError('backup_invalid', 'Archive invalide', 'En-tête illisible.');
  }
  if (header.v !== 1) throw new AppError('backup_invalid', 'Version d’archive inconnue');
  return { header, headerBytes, body: buf.subarray(10 + len) };
}

/** Déchiffre ; une archive modifiée d'un seul octet échoue sur l'étiquette GCM (B-01). */
export function openArchive(buf: Buffer, key: { dataKey: Buffer } | { recoveryKey: string }): { header: BackupHeader; entries: TarEntry[]; dataKey: Buffer } {
  const { header, headerBytes, body } = readHeader(buf);
  let dataKey: Buffer;
  try {
    dataKey = 'dataKey' in key
      ? key.dataKey
      : unwrapDataKey(JSON.parse(fromB64url(header.recovery_wrap).toString('utf8')) as RecoveryWrap, key.recoveryKey);
  } catch {
    throw new AppError('backup_invalid', 'Clé de récupération incorrecte');
  }
  try {
    const d = createDecipheriv('aes-256-gcm', backupKey(dataKey), fromB64url(header.nonce), { authTagLength: 16 });
    d.setAAD(headerBytes);
    d.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    return { header, entries: readTar(plain), dataKey };
  } catch {
    throw new AppError('backup_invalid', 'Archive altérée ou clé incorrecte', "L'étiquette d'authentification ne correspond pas.");
  }
}

function blobEntries(dataDir: string): TarEntry[] {
  const dir = paths(dataDir).blobs;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[A-Za-z0-9._-]+\.vpb$/.test(f))
    .sort()
    .map((f) => ({ name: `blobs/${f}`, data: readFileSync(path.join(dir, f)) }));
}

/** Instantané cohérent de la base par l'API de sauvegarde de SQLite (en ligne). */
async function snapshot(s: Services): Promise<{ db: Buffer; head: { seq: number; hash: string } }> {
  const tmp = path.join(paths(s.config.dataDir).backups, `.snapshot-${randomUUID()}.db`);
  try {
    await s.db.backup(tmp);
    const snap = new Database(tmp, { readonly: true, fileMustExist: true });
    const head = (snap.prepare('SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined) ??
      { seq: 0, hash: '0'.repeat(64) };
    snap.close();
    return { db: readFileSync(tmp), head };
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(BACKUP_EXT) && /^[A-Za-z0-9._-]+$/.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const { header } = readHeader(readFileSync(full).subarray(0, 64 * 1024 + 10));
        return { file: f, size: statSync(full).size, created_at: header.created_at, last_seq: header.last_seq };
      } catch {
        return null;
      }
    })
    .filter((x): x is BackupInfo => x !== null)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.file < b.file ? 1 : -1));
}

/** B-02 : conservation des 14 dernières archives. */
function prune(dir: string, keep = KEEP_BACKUPS): void {
  for (const b of listBackups(dir).slice(keep)) rmSync(path.join(dir, b.file), { force: true });
}

/** B-02 : copie miroir ; un miroir absent ou en erreur produit une alerte, jamais un arrêt. */
function mirror(s: Services, file: string, data: Buffer): 'disabled' | 'ok' | 'absent' | 'error' {
  const dir = getSetting(s, 'backup_mirror_dir');
  if (!dir) return 'disabled';
  if (!existsSync(dir)) return 'absent';
  try {
    writeDurable(path.join(dir, file), data);
    prune(dir);
    return 'ok';
  } catch {
    return 'error';
  }
}

function archiveName(at: Date, seq: number): string {
  const d = new Date(at.getTime() + 3_600_000).toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `vp-${d}-${seq}${BACKUP_EXT}`;
}

/** B-01, B-03 : sauvegarde en ligne, chiffrée, journalisée (`system.backup_created`). */
export async function createBackup(s: Services, actor: string | null, reason: 'manual' | 'scheduled'): Promise<BackupInfo & { mirror: string; sha256: string }> {
  const p = paths(s.config.dataDir);
  mkdirSync(p.backups, { recursive: true, mode: 0o700 });
  writeTx(s.db, () => s.ledger.checkpoint());
  const snap = await snapshot(s);
  const entries: TarEntry[] = [
    { name: 'officine.db', data: snap.db },
    ...blobEntries(s.config.dataDir),
    { name: 'keys/node_ed25519.pem', data: readFileSync(p.nodePriv) },
    { name: 'keys/node.json', data: readFileSync(p.nodeJson) },
  ];
  const wrapRaw = readFileSync(p.recoveryWrap);
  const wrap = JSON.parse(wrapRaw.toString('utf8')) as RecoveryWrap;
  const at = s.clock.now();
  const archive = sealArchive(s.keys.dataKey, {
    v: 1, node_id: s.keys.identity.node_id, created_at: at.toISOString(), last_seq: snap.head.seq, last_hash: snap.head.hash,
    kid: s.keys.identity.data_kid, recovery_wrap: b64url(wrapRaw), recovery_salt: wrap.salt,
  }, writeTar(entries, Math.floor(at.getTime() / 1000)));
  const file = archiveName(at, snap.head.seq);
  writeDurable(path.join(p.backups, file), archive);
  const sha256 = sha256hex(archive);
  const mirrored = mirror(s, file, archive);
  prune(p.backups);
  writeTx(s.db, () => s.ledger.append('system.backup_created', actor, {
    file, size: archive.length, last_seq: snap.head.seq, sha256, reason, mirror: mirrored,
  }));
  return { file, size: archive.length, created_at: at.toISOString(), last_seq: snap.head.seq, mirror: mirrored, sha256 };
}

/** Âge de la dernière sauvegarde (santé, écran Système). */
export function lastBackup(s: Services): { at: string; file: string; mirror: string } | null {
  const r = s.db.prepare("SELECT at, payload FROM events WHERE type = 'system.backup_created' ORDER BY seq DESC LIMIT 1").get() as
    { at: string; payload: string } | undefined;
  if (!r) return null;
  const p = JSON.parse(r.payload) as { file: string; mirror: string };
  return { at: r.at, file: p.file, mirror: p.mirror };
}

// ---------------------------------------------------------------- Vérification et restauration

const ALLOWED = (n: string) => n === 'officine.db' || n === 'keys/node_ed25519.pem' || n === 'keys/node.json' || /^blobs\/[A-Za-z0-9._-]+\.vpb$/.test(n);

/** J-04 sur la base de l'archive, avec la clé publique du nœud dérivée de l'archive elle-même. */
export function verifyArchiveLedger(stagingDir: string, header: BackupHeader): VerifyResult {
  const identity = JSON.parse(readFileSync(path.join(stagingDir, 'keys', 'node.json'), 'utf8')) as { node_id: string; kid: string };
  const pub = createPublicKey(createPrivateKey(readFileSync(path.join(stagingDir, 'keys', 'node_ed25519.pem'))));
  const db = new Database(path.join(stagingDir, 'officine.db'), { readonly: true, fileMustExist: true });
  try {
    const r = verifyLedger(db, identity.node_id, new Map([[identity.kid, pub]]));
    if (r.ok && (r.head.seq !== header.last_seq || r.head.hash !== header.last_hash)) {
      return { ok: false, seq: r.head.seq, defect: 'chain_break', detail: "La tête du journal ne correspond pas à l'en-tête de l'archive" };
    }
    if (identity.node_id !== header.node_id) return { ok: false, seq: null, defect: 'unknown_key', detail: 'Archive d’un autre nœud' };
    return r;
  } finally {
    db.close();
  }
}

export interface PendingRestore {
  archive: string;
  node_id: string;
  last_seq: number;
  last_hash: string;
  actor: string | null;
  staged_at: string;
  new_machine: boolean;
}

const stagingDir = (dataDir: string) => path.join(dataDir, 'restore.staging');
const pendingFile = (dataDir: string) => path.join(dataDir, 'restore.pending.json');
const appliedFile = (dataDir: string) => path.join(dataDir, 'restore.applied.json');

/**
 * B-04, étape 1 : déchiffrement, extraction en zone d'attente, vérification complète du journal.
 * Rien n'est remplacé ici : le remplacement se fait au redémarrage (applyPendingRestore).
 */
export function stageRestore(
  dataDir: string,
  archivePath: string,
  key: { dataKey: Buffer } | { recoveryKey: string },
  actor: string | null,
  now: Date,
): PendingRestore {
  const { header, entries, dataKey } = openArchive(readFileSync(archivePath), key);
  const dir = stagingDir(dataDir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'keys'), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dir, 'blobs'), { recursive: true, mode: 0o700 });
  for (const e of entries) {
    if (!ALLOWED(e.name)) throw new AppError('backup_invalid', 'Archive invalide', `Entrée inattendue : ${e.name}`);
    writeFileSync(path.join(dir, ...e.name.split('/')), e.data, { mode: 0o600 });
  }
  if (!entries.some((e) => e.name === 'officine.db')) throw new AppError('backup_invalid', 'Archive sans base');
  const check = verifyArchiveLedger(dir, header);
  if (!check.ok) {
    rmSync(dir, { recursive: true, force: true });
    throw new AppError('backup_invalid', 'Journal de la sauvegarde invalide', `${check.defect} (seq ${check.seq ?? '?'}) : ${check.detail}`);
  }
  const newMachine = 'recoveryKey' in key;
  if (newMachine) {
    writeFileSync(path.join(dir, 'keys', 'data.key'), dataKey, { mode: 0o600 });
    writeFileSync(path.join(dir, 'keys', 'recovery.wrap'), fromB64url(header.recovery_wrap), { mode: 0o600 });
  }
  const pending: PendingRestore = {
    archive: path.basename(archivePath), node_id: header.node_id, last_seq: header.last_seq, last_hash: header.last_hash,
    actor, staged_at: now.toISOString(), new_machine: newMachine,
  };
  writeDurable(pendingFile(dataDir), Buffer.from(JSON.stringify(pending)));
  return pending;
}

function moveIfExists(from: string, to: string): void {
  if (existsSync(from)) {
    mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    renameSync(from, to);
  }
}

/**
 * B-04, étape 2 (au démarrage, base fermée) : l'existant part dans `pre-restore-<horodatage>/`,
 * les fichiers en attente prennent sa place par renommage. Renvoie l'attente appliquée, ou null.
 */
export function applyPendingRestore(dataDir: string, now: Date): PendingRestore | null {
  if (!existsSync(pendingFile(dataDir))) return null;
  const pending = JSON.parse(readFileSync(pendingFile(dataDir), 'utf8')) as PendingRestore;
  const p = paths(dataDir);
  const staged = stagingDir(dataDir);
  const keep = path.join(dataDir, `pre-restore-${now.toISOString().replace(/[-:.]/g, '')}`);
  mkdirSync(keep, { recursive: true, mode: 0o700 });
  for (const suffix of ['', '-wal', '-shm']) moveIfExists(`${p.db}${suffix}`, path.join(keep, `officine.db${suffix}`));
  moveIfExists(p.blobs, path.join(keep, 'blobs'));
  const keyFiles = ['node_ed25519.pem', 'node.json', ...(pending.new_machine ? ['data.key', 'recovery.wrap'] : [])];
  for (const k of keyFiles) moveIfExists(path.join(p.keys, k), path.join(keep, 'keys', k));
  renameSync(path.join(staged, 'officine.db'), p.db);
  renameSync(path.join(staged, 'blobs'), p.blobs);
  for (const k of keyFiles) renameSync(path.join(staged, 'keys', k), path.join(p.keys, k));
  const pub = createPublicKey(createPrivateKey(readFileSync(p.nodePriv)));
  if (existsSync(p.nodePub)) {
    mkdirSync(path.join(keep, 'keys'), { recursive: true, mode: 0o700 });
    copyFileSync(p.nodePub, path.join(keep, 'keys', 'node_ed25519.pub.pem'));
  }
  writeFileSync(p.nodePub, pub.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  rmSync(staged, { recursive: true, force: true });
  writeDurable(appliedFile(dataDir), Buffer.from(JSON.stringify({ ...pending, previous_dir: path.basename(keep) })));
  rmSync(pendingFile(dataDir), { force: true });
  return pending;
}

/** B-04, étape 3 (base rouverte avec les clés restaurées) : événement `system.restored` (J-06). */
export function recordAppliedRestore(s: Services): boolean {
  const file = appliedFile(s.config.dataDir);
  if (!existsSync(file)) return false;
  const a = JSON.parse(readFileSync(file, 'utf8')) as PendingRestore & { previous_dir: string };
  writeTx(s.db, () => {
    s.ledger.append('system.restored', a.actor, {
      archive: a.archive, last_seq: a.last_seq, last_hash: a.last_hash, new_machine: a.new_machine, previous_dir: a.previous_dir,
    });
    s.ledger.checkpoint();
  });
  rmSync(file, { force: true });
  return true;
}

/** Nom d'archive fourni par l'interface : un simple nom de fichier du répertoire des sauvegardes. */
export function backupPath(dataDir: string, file: string): string {
  if (!/^[A-Za-z0-9._-]+\.vpbak$/.test(file)) throw new AppError('validation_failed', 'Nom de sauvegarde invalide');
  const full = path.join(paths(dataDir).backups, file);
  if (!existsSync(full)) throw new AppError('not_found', 'Sauvegarde introuvable');
  return full;
}
