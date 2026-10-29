import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import type { Json } from './jcs.js';

/**
 * Paramètres de l'officine (table `settings`, valeurs texte). Chaque changement produit
 * `system.settings_changed` (clé, ancienne et nouvelle valeur) dans la même transaction.
 * `allow_browser_clients` (W-11) reste géré par domain/devices.ts (preuve de possession d'un poste).
 */

/** V-05 : ventes en régularisation actives par défaut pendant 30 jours après l'installation. */
export const REGUL_DEFAULT_DAYS = 30;

type Def =
  | { kind: 'text'; max: number; def: string }
  | { kind: 'enum'; values: readonly string[]; def: string }
  | { kind: 'int'; min: number; max: number; def: number }
  | { kind: 'time'; def: string }
  | { kind: 'auto_bool' }
  | { kind: 'path'; def: null }
  | { kind: 'bool'; def: boolean }
  | { kind: 'pattern'; re: RegExp; def: null };

export const SETTINGS = {
  pharmacy_name: { kind: 'text', max: 120, def: '' },
  pharmacy_address: { kind: 'text', max: 200, def: '' },
  pharmacy_phone: { kind: 'text', max: 40, def: '' },
  /** O-01 : `all_medicines` (règle nationale 2024) ou `flagged` (rx_required=1). */
  rx_policy: { kind: 'enum', values: ['all_medicines', 'flagged'], def: 'all_medicines' },
  /** V-05 : absent = automatique (30 jours après l'installation). */
  allow_regul_sales: { kind: 'auto_bool' },
  /** V-09 : plafond de remise en pourcentage du panier. */
  discount_max_pct: { kind: 'int', min: 0, max: 100, def: 10 },
  /** O-05 : âge maximal d'une ordonnance, en jours. */
  prescription_max_age_days: { kind: 'int', min: 1, max: 3650, def: 90 },
  /** P-08 : nombre d'annulations par utilisateur et par jour au-delà duquel une alerte est levée. */
  fraud_void_threshold: { kind: 'int', min: 1, max: 1000, def: 3 },
  /** P-08 : horaires d'ouverture (heure de Douala) ; une vente hors horaires et hors garde est signalée. */
  opening_time: { kind: 'time', def: '07:30' },
  closing_time: { kind: 'time', def: '21:00' },
  /** B-02 : heure de la sauvegarde quotidienne (Douala) et copie miroir facultative. */
  backup_hour: { kind: 'int', min: 0, max: 23, def: 2 },
  backup_mirror_dir: { kind: 'path', def: null },
  /** NO-01 : synchronisation avec le cloud, désactivée par défaut (seul appel sortant autorisé, ADR-012). */
  cloud_sync_enabled: { kind: 'bool', def: false },
  cloud_url: { kind: 'pattern', re: /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/, def: null },
  /** Empreinte SHA-256 (hexadécimal) de la clé publique SPKI du certificat du cloud, épinglée. */
  cloud_spki_sha256: { kind: 'pattern', re: /^[0-9a-f]{64}$/, def: null },
} as const satisfies Record<string, Def>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingsValues = {
  pharmacy_name: string;
  pharmacy_address: string;
  pharmacy_phone: string;
  rx_policy: 'all_medicines' | 'flagged';
  allow_regul_sales: boolean | null;
  discount_max_pct: number;
  prescription_max_age_days: number;
  fraud_void_threshold: number;
  opening_time: string;
  closing_time: string;
  backup_hour: number;
  backup_mirror_dir: string | null;
  cloud_sync_enabled: boolean;
  cloud_url: string | null;
  cloud_spki_sha256: string | null;
};

function raw(s: Services, key: string): string | undefined {
  return (s.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

function decode(def: Def, v: string | undefined): Json {
  switch (def.kind) {
    case 'int': {
      const n = v === undefined ? NaN : Number(v);
      return Number.isSafeInteger(n) && n >= def.min && n <= def.max ? n : def.def;
    }
    case 'enum':
      return v !== undefined && def.values.includes(v) ? v : def.def;
    case 'auto_bool':
      return v === 'true' ? true : v === 'false' ? false : null;
    case 'path':
    case 'pattern':
      return v ?? null;
    case 'bool':
      return v === undefined ? def.def : v === 'true';
    default:
      return v ?? def.def;
  }
}

export function getSettings(s: Services): SettingsValues {
  const out: Record<string, Json> = {};
  for (const [k, def] of Object.entries(SETTINGS)) out[k] = decode(def, raw(s, k));
  return out as unknown as SettingsValues;
}

export function getSetting<K extends SettingKey>(s: Services, key: K): SettingsValues[K] {
  return decode(SETTINGS[key], raw(s, key)) as SettingsValues[K];
}

/** Date d'installation : premier événement du journal (system.initialized). */
export function installedAt(s: Services): string | null {
  return (s.db.prepare('SELECT at FROM events ORDER BY seq LIMIT 1').get() as { at: string } | undefined)?.at ?? null;
}

/** V-05 : paramètre explicite, sinon actif pendant 30 jours après l'installation. */
export function regulSalesAllowed(s: Services): { allowed: boolean; auto_until: string | null } {
  const explicit = getSetting(s, 'allow_regul_sales');
  const start = installedAt(s);
  const until = start ? new Date(Date.parse(start) + REGUL_DEFAULT_DAYS * 86_400_000).toISOString() : null;
  if (explicit !== null) return { allowed: explicit, auto_until: until };
  return { allowed: until !== null && s.clock.now().toISOString() < until, auto_until: until };
}

function encode(key: SettingKey, value: unknown): string | null {
  const def: Def = SETTINGS[key];
  const bad = () => new AppError('validation_failed', 'Paramètre invalide', `Valeur refusée pour ${key}.`);
  switch (def.kind) {
    case 'int':
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < def.min || value > def.max) throw bad();
      return String(value);
    case 'enum':
      if (typeof value !== 'string' || !def.values.includes(value)) throw bad();
      return value;
    case 'time':
      if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad();
      return value;
    case 'auto_bool':
      if (value !== null && typeof value !== 'boolean') throw bad();
      return value === null ? null : String(value);
    case 'bool':
      if (typeof value !== 'boolean') throw bad();
      return String(value);
    case 'pattern':
      if (value === null) return null;
      if (typeof value !== 'string' || !def.re.test(value)) throw bad();
      return value;
    case 'path':
      if (value === null) return null;
      if (typeof value !== 'string' || !/^(\/|[A-Za-z]:\\)/.test(value) || value.length > 300 || /\p{Cc}/u.test(value)) throw bad();
      return value;
    default:
      if (typeof value !== 'string' || value.trim().length > def.max || /\p{Cc}/u.test(value)) throw bad();
      return value.trim();
  }
}

/** Mise à jour partielle (titulaire ré-authentifié, contrôlé par la route) ; un événement par clé changée. */
export function updateSettings(s: Services, actor: string, patch: Partial<Record<SettingKey, unknown>>): SettingsValues {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [SettingKey, unknown][];
  for (const [k] of entries) if (!(k in SETTINGS)) throw new AppError('validation_failed', `Paramètre inconnu : ${k}`);
  const encoded = entries.map(([k, v]) => [k, encode(k, v)] as const);
  return writeTx(s.db, () => {
    for (const [key, value] of encoded) {
      const before = raw(s, key) ?? null;
      if (before === value) continue;
      if (value === null) s.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      else {
        s.db
          .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(key, value);
      }
      s.ledger.append('system.settings_changed', actor, { key, old_value: before, new_value: value });
    }
    return getSettings(s);
  });
}
