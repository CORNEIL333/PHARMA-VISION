import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { randomToken, sha256hex } from '../security/crypto.js';
import type { Services } from '../services.js';
import { lookupDevice } from './devices.js';
import { getUser } from './users.js';

/**
 * Application de bureau (spec §8 bis) côté serveur :
 * - démarrage d'un poste appairé (W-02, W-11) : le cœur Rust échange son secret contre un jeton
 *   à usage unique (60 s) ; la fenêtre ouvre /api/v1/devices/boot?token=… qui pose le cookie de poste
 *   `vp_dev` (HttpOnly, Secure, SameSite=Strict) : les requêtes de la WebView portent alors le poste ;
 * - mode caisse plein écran par poste (W-08) ;
 * - manifeste et paquets de mise à jour signés (W-07), publiés dans <données>/desktop/.
 */

export const DEVICE_COOKIE = 'vp_dev';
const BOOT_TTL_MS = 60_000;
const boots = new Map<string, { secret: string; expires: number }>();

export function issueBootToken(s: Services, secret: unknown): { token: string } {
  if (!lookupDevice(s, secret) || typeof secret !== 'string') throw new AppError('unauthenticated', 'Poste inconnu ou révoqué');
  const now = s.clock.now().getTime();
  for (const [k, v] of boots) if (v.expires <= now) boots.delete(k);
  const token = randomToken(32);
  boots.set(sha256hex(token), { secret, expires: now + BOOT_TTL_MS });
  return { token };
}

/** Usage unique : le jeton est retiré dès la première lecture, valide ou non. */
export function consumeBootToken(s: Services, token: string): string | null {
  const key = sha256hex(token);
  const b = boots.get(key);
  boots.delete(key);
  if (!b || b.expires <= s.clock.now().getTime()) return null;
  return lookupDevice(s, b.secret) ? b.secret : null;
}

export interface DeviceSelf {
  id: string;
  name: string;
  kiosk: boolean;
}

export function deviceSelf(s: Services, secret: unknown): DeviceSelf {
  const d = lookupDevice(s, secret);
  if (!d) throw new AppError('unauthenticated', 'Poste inconnu ou révoqué');
  const r = s.db.prepare('SELECT id, name, kiosk FROM devices WHERE id = ?').get(d.id) as { id: string; name: string; kiosk: number };
  return { id: r.id, name: r.name, kiosk: r.kiosk === 1 };
}

/** W-08 : mode caisse plein écran activé par le titulaire pour un poste. */
export function setKiosk(s: Services, actor: string, id: string, kiosk: boolean): DeviceSelf {
  return writeTx(s.db, () => {
    if (getUser(s, actor).role !== 'titulaire') throw new AppError('forbidden', 'Action réservée au titulaire');
    const r = s.db.prepare('SELECT id, name, kiosk FROM devices WHERE id = ? AND revoked_at IS NULL').get(id) as
      { id: string; name: string; kiosk: number } | undefined;
    if (!r) throw new AppError('not_found', 'Poste introuvable');
    if ((r.kiosk === 1) !== kiosk) {
      s.db.prepare('UPDATE devices SET kiosk = ? WHERE id = ?').run(kiosk ? 1 : 0, id);
      s.ledger.append('system.settings_changed', actor, { key: `device.kiosk`, device_id: id, old_value: r.kiosk === 1, new_value: kiosk });
    }
    return { id: r.id, name: r.name, kiosk };
  });
}

export function kioskOf(s: Services): Map<string, boolean> {
  const rows = s.db.prepare('SELECT id, kiosk FROM devices').all() as { id: string; kiosk: number }[];
  return new Map(rows.map((r) => [r.id, r.kiosk === 1]));
}

// ---------------------------------------------------------------- W-07 mises à jour

export interface UpdateManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, { signature: string; url: string }>;
}

const desktopDir = (dataDir: string) => path.join(dataDir, 'desktop');
export const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Manifeste au format du plugin updater de Tauri ; les URL pointent vers ce serveur. Null = pas de mise à jour. */
export function updateManifest(dataDir: string, origin: string): UpdateManifest | null {
  const file = path.join(desktopDir(dataDir), 'latest.json');
  if (!existsSync(file)) return null;
  const m = JSON.parse(readFileSync(file, 'utf8')) as UpdateManifest;
  const platforms: UpdateManifest['platforms'] = {};
  for (const [k, v] of Object.entries(m.platforms ?? {})) {
    const name = path.basename(v.url);
    if (PACKAGE_NAME.test(name) && typeof v.signature === 'string') {
      platforms[k] = { signature: v.signature, url: `${origin}/api/v1/desktop/packages/${encodeURIComponent(name)}` };
    }
  }
  return { version: m.version, notes: m.notes, pub_date: m.pub_date, platforms };
}

export function updatePackage(dataDir: string, name: string): Buffer {
  if (!PACKAGE_NAME.test(name) || name === 'latest.json') throw new AppError('not_found', 'Paquet introuvable');
  const file = path.join(desktopDir(dataDir), 'packages', name);
  if (!existsSync(file)) throw new AppError('not_found', 'Paquet introuvable');
  return readFileSync(file);
}
