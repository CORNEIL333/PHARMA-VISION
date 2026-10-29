import { randomInt, randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { randomToken, safeEqual, sha256hex } from '../security/crypto.js';
import type { Services } from '../services.js';
import { getUser } from './users.js';

export type DevicePlatform = 'windows' | 'linux' | 'macos';
export interface PairDeviceInput {
  name: string;
  platform: DevicePlatform;
  app_version: string;
  code: string;
}
export interface PublicDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  app_version: string | null;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}
interface PairingCodeRow {
  code_hash: string;
  created_by: string;
}
const DEVICE_FIELDS = 'id, name, platform, app_version, paired_at, last_seen_at, revoked_at';
const EMPTY_HASH = sha256hex('');

function assertPairingAuthor(s: Services, actor: string, managerOnly = false): void {
  const u = getUser(s, actor);
  if (!u.active || (u.role !== 'titulaire' && (managerOnly || u.role !== 'pharmacien'))) {
    throw new AppError('forbidden', 'Action non autorisée pour votre rôle');
  }
}

function freshCode(s: Services): string {
  for (let i = 0; i < 32; i++) {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    if (!s.db.prepare('SELECT 1 FROM pairing_codes WHERE code_hash = ?').get(sha256hex(code))) return code;
  }
  throw new AppError('internal_error', 'Impossible de générer un code d’appairage');
}

/** W-02: one live code per node gives every wrong guess an unambiguous persisted budget. */
export function createPairingCode(s: Services, actor: string): { code: string; expires_at: string } {
  return writeTx(s.db, () => {
    assertPairingAuthor(s, actor);
    const now = s.clock.now();
    const code = freshCode(s);
    const expires_at = iso(new Date(now.getTime() + 600_000));
    s.db.prepare('UPDATE pairing_codes SET used_at = ? WHERE used_at IS NULL').run(iso(now));
    s.db.prepare('INSERT INTO pairing_codes (code_hash, created_by, expires_at) VALUES (?, ?, ?)')
      .run(sha256hex(code), actor, expires_at);
    // Neither the low-entropy code nor its brute-forceable hash belongs in the ledger.
    s.ledger.append('device.pairing_code_created', actor, { expires_at });
    return { code, expires_at };
  });
}

function validateDeviceInput(input: PairDeviceInput): void {
  if (!input.name.trim() || input.name.length > 80 ||
      !['windows', 'linux', 'macos'].includes(input.platform) ||
      !input.app_version.trim() || input.app_version.length > 40) {
    throw new AppError('validation_failed', 'Informations du poste invalides');
  }
}

function liveCode(s: Services, now: string): PairingCodeRow | undefined {
  const rows = s.db.prepare(
    'SELECT code_hash, created_by FROM pairing_codes WHERE used_at IS NULL AND attempts < 5 AND expires_at > ? LIMIT 2',
  ).all(now) as PairingCodeRow[];
  // Fail closed if legacy/manual data violates the single-live-code invariant.
  return rows.length === 1 ? rows[0] : undefined;
}

function codeCreatorStillAuthorized(s: Services, code: PairingCodeRow): boolean {
  return !!s.db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('titulaire', 'pharmacien')")
    .get(code.created_by);
}

/** Called inside the pairing transaction; do not throw until the failure counter is committed. */
function failedPairing(s: Services, now: string): null {
  s.db.prepare(`UPDATE pairing_codes SET attempts = attempts + 1,
    used_at = CASE WHEN attempts + 1 >= 5 THEN ? ELSE used_at END
    WHERE used_at IS NULL AND attempts < 5 AND expires_at > ?`).run(now, now);
  s.ledger.append('security.device_pairing_failed', null, {});
  return null;
}

/** W-02: code consumption, workstation creation and device.paired commit together. */
export function pairDevice(s: Services, input: PairDeviceInput): { id: string; secret: string } {
  validateDeviceInput(input);
  const result = writeTx(s.db, () => {
    const now = iso(s.clock.now());
    const code = liveCode(s, now);
    const matches = safeEqual(sha256hex(input.code), code?.code_hash ?? EMPTY_HASH);
    if (!code || !matches || !/^\d{8}$/.test(input.code) || !codeCreatorStillAuthorized(s, code)) {
      return failedPairing(s, now);
    }
    const id = randomUUID();
    const secret = randomToken(32);
    const name = input.name.trim();
    s.db.prepare(`INSERT INTO devices
      (id, name, secret_hash, platform, app_version, paired_by, paired_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, name, sha256hex(secret), input.platform, input.app_version.trim(), code.created_by, now, now,
    );
    s.db.prepare('UPDATE pairing_codes SET used_at = ? WHERE code_hash = ?').run(now, code.code_hash);
    s.ledger.append('device.paired', code.created_by, { device_id: id, name, platform: input.platform });
    return { id, secret };
  });
  if (!result) throw new AppError('invalid_credentials', 'Appairage refusé', 'Code incorrect ou indisponible.');
  return result;
}

export function listDevices(s: Services): PublicDevice[] {
  return s.db.prepare(`SELECT ${DEVICE_FIELDS} FROM devices ORDER BY paired_at DESC, id`).all() as PublicDevice[];
}

/** W-09: unknown and revoked identifiers both describe an unusable workstation. */
export function deviceStatus(s: Services, id: string): { status: 'active' | 'revoked' } {
  const active = s.db.prepare('SELECT 1 FROM devices WHERE id = ? AND revoked_at IS NULL').get(id);
  return { status: active ? 'active' : 'revoked' };
}

/** No identifier prefix: X-VP-Device carries only the base64url-encoded 32-byte secret. */
export function lookupDevice(s: Services, secret: unknown, touch = false): { id: string } | null {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const hash = sha256hex(secret);
  const row = s.db.prepare('SELECT id, secret_hash, last_seen_at FROM devices WHERE secret_hash = ? AND revoked_at IS NULL')
    .get(hash) as { id: string; secret_hash: string; last_seen_at: string | null } | undefined;
  const matches = safeEqual(hash, row?.secret_hash ?? EMPTY_HASH);
  if (!row || !matches) return null;
  if (touch) touchDevice(s, row);
  return { id: row.id };
}

/** Operational heartbeat, not a business mutation: no event per request/minute. */
function touchDevice(s: Services, row: { id: string; last_seen_at: string | null }): void {
  const now = s.clock.now();
  if (row.last_seen_at && now.getTime() - Date.parse(row.last_seen_at) < 60_000) return;
  const cutoff = iso(new Date(now.getTime() - 60_000));
  writeTx(s.db, () => s.db.prepare(`UPDATE devices SET last_seen_at = ? WHERE id = ?
    AND revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at <= ?)`)
    .run(iso(now), row.id, cutoff));
}

/** W-11: absence means pilot default true; an unexpected stored value fails closed. */
export function browserClientsAllowed(s: Services): boolean {
  const row = s.db.prepare("SELECT value FROM settings WHERE key = 'allow_browser_clients'").get() as
    { value: string } | undefined;
  return !row || row.value === 'true';
}

function writeBrowserSetting(s: Services, actor: string, allow: boolean): void {
  const old_value = browserClientsAllowed(s);
  if (old_value === allow) return;
  s.db.prepare(`INSERT INTO settings (key, value) VALUES ('allow_browser_clients', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(allow));
  s.ledger.append('system.settings_changed', actor, { key: 'allow_browser_clients', old_value, new_value: allow });
}

/** The route requires settings.edit (titulaire + reauth); disabling additionally proves device possession. */
export function setBrowserClientsAllowed(
  s: Services, actor: string, allow: boolean, deviceSecret?: string,
): { allow_browser_clients: boolean } {
  return writeTx(s.db, () => {
    assertPairingAuthor(s, actor, true);
    if (typeof allow !== 'boolean') throw new AppError('validation_failed', 'Valeur de paramètre invalide');
    if (!allow && !lookupDevice(s, deviceSecret)) {
      throw new AppError('invalid_transition', 'Poste appairé requis',
        'Effectuez cette opération depuis un poste appairé pour conserver un accès aux réglages.');
    }
    writeBrowserSetting(s, actor, allow);
    return { allow_browser_clients: browserClientsAllowed(s) };
  });
}

/** W-09/W-11: never forbid revoking a compromised last device; restore audited browser fallback atomically. */
export function revokeDevice(
  s: Services, actor: string, id: string,
): { status: 'revoked'; allow_browser_clients: boolean } {
  return writeTx(s.db, () => {
    assertPairingAuthor(s, actor, true);
    const device = s.db.prepare(`SELECT ${DEVICE_FIELDS} FROM devices WHERE id = ?`).get(id) as PublicDevice | undefined;
    if (!device) throw new AppError('not_found', 'Poste introuvable');
    if (!device.revoked_at) {
      s.db.prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(iso(s.clock.now()), actor, id);
      s.ledger.append('device.revoked', actor, { device_id: id, name: device.name, platform: device.platform });
      const remaining = s.db.prepare('SELECT 1 FROM devices WHERE revoked_at IS NULL LIMIT 1').get();
      if (!remaining) writeBrowserSetting(s, actor, true);
    }
    return { status: 'revoked', allow_browser_clients: browserClientsAllowed(s) };
  });
}
