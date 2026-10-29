import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { sha256hex } from '../security/crypto.js';
import type { Services } from '../services.js';
import { isCalendarDate } from './dates.js';
import { jcs, type Json } from './jcs.js';

/**
 * Dossier d'installation de l'officine (docs/11-dossier-installation.md) : ce que l'officine fournit
 * au gestionnaire au démarrage. Chaque rubrique est validée champ par champ. Le journal reçoit la
 * rubrique, les noms des champs modifiés et l'empreinte du contenu, jamais les valeurs (données
 * personnelles du titulaire et du personnel : loi n° 2024/017, minimisation).
 */

export const REGIONS = [
  'Adamaoua', 'Centre', 'Est', 'Extrême-Nord', 'Littoral', 'Nord', 'Nord-Ouest', 'Ouest', 'Sud', 'Sud-Ouest',
] as const;
export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

type FieldType =
  | { t: 'text'; max: number }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'date' }
  | { t: 'bool' }
  | { t: 'phone' }
  | { t: 'email' }
  | { t: 'coord'; min: number; max: number }
  | { t: 'pattern'; re: RegExp; hint: string };

interface Field {
  type: FieldType;
  required?: boolean;
}

const text = (max: number, required = false): Field => ({ type: { t: 'text', max }, required });
const req = (f: Field): Field => ({ ...f, required: true });

/** Rubriques simples (champ → règle). Les rubriques « horaires » et « personnel » ont leur propre forme. */
export const SECTIONS = {
  identite: {
    enseigne: text(120, true),
    raison_sociale: text(160),
    forme_juridique: req({ type: { t: 'enum', values: ['entreprise_individuelle', 'sarl', 'selarl', 'autre'] } }),
    date_ouverture: { type: { t: 'date' } },
  },
  autorisation: {
    numero_autorisation: text(80, true),
    date_autorisation: req({ type: { t: 'date' } }),
    autorite: text(120, true),
    reference_localisation: text(80),
  },
  titulaire: {
    nom: text(120, true),
    numero_onpc: text(40, true),
    section_onpc: text(40),
    date_inscription_onpc: { type: { t: 'date' } },
    telephone: { type: { t: 'phone' } },
    email: { type: { t: 'email' } },
  },
  localisation: {
    region: req({ type: { t: 'enum', values: REGIONS } }),
    departement: text(80, true),
    arrondissement: text(80, true),
    ville: text(80, true),
    quartier: text(80, true),
    repere: text(200),
    boite_postale: text(40),
    district_sante: text(80, true),
    aire_sante: text(80),
    latitude: { type: { t: 'coord', min: 1.6, max: 13.1 } },
    longitude: { type: { t: 'coord', min: 8.4, max: 16.2 } },
  },
  contacts: {
    telephone: req({ type: { t: 'phone' } }),
    mobile: { type: { t: 'phone' } },
    whatsapp: { type: { t: 'phone' } },
    email: { type: { t: 'email' } },
  },
  fiscal: {
    niu: req({ type: { t: 'pattern', re: /^[A-Z0-9]{10,20}$/, hint: '10 à 20 lettres majuscules ou chiffres' } }),
    rccm: text(60),
    regime: req({ type: { t: 'enum', values: ['reel', 'simplifie', 'impot_liberatoire', 'autre'] } }),
    centre_impots: text(120, true),
    assujetti_tva: { type: { t: 'bool' } },
    numero_cnps: text(40),
  },
  donnees: {
    responsable_nom: text(120, true),
    responsable_contact: text(120, true),
    dpo_designe: { type: { t: 'bool' } },
    numero_autorisation_apdp: text(80),
    date_autorisation_apdp: { type: { t: 'date' } },
  },
} as const satisfies Record<string, Record<string, Field>>;

export type SimpleSection = keyof typeof SECTIONS;
export const SECTION_IDS = [...(Object.keys(SECTIONS) as SimpleSection[]), 'horaires', 'personnel'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const STAFF_ROLES = ['pharmacien_assistant', 'preparateur', 'caissier', 'autre'] as const;

type Value = string | number | boolean | null;
const bad = (field: string, why: string) => new AppError('validation_failed', 'Champ invalide', `${field} : ${why}.`, { field });

function checkField(name: string, f: Field, v: unknown): Value {
  if (v === undefined || v === null || v === '') {
    if (f.required) throw bad(name, 'obligatoire');
    return null;
  }
  const ty = f.type;
  if (ty.t === 'bool') {
    if (typeof v !== 'boolean') throw bad(name, 'oui ou non attendu');
    return v;
  }
  if (ty.t === 'coord') {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < ty.min || n > ty.max) throw bad(name, `entre ${ty.min} et ${ty.max} (Cameroun)`);
    return String(Math.round(n * 1e6) / 1e6);
  }
  if (typeof v !== 'string' || /\p{Cc}/u.test(v)) throw bad(name, 'texte attendu');
  const s = v.trim();
  if (ty.t === 'text' && s.length > ty.max) throw bad(name, `${ty.max} caractères au plus`);
  if (ty.t === 'enum' && !ty.values.includes(s)) throw bad(name, 'valeur hors liste');
  if (ty.t === 'date' && !isCalendarDate(s)) throw bad(name, 'date AAAA-MM-JJ');
  if (ty.t === 'phone' && !/^(\+?237)?[26]\d{8}$/.test(s.replace(/[\s.-]/g, ''))) throw bad(name, 'numéro camerounais à 9 chiffres (2… ou 6…)');
  if (ty.t === 'email' && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s)) throw bad(name, 'adresse de courriel invalide');
  if (ty.t === 'pattern' && !ty.re.test(s.toUpperCase())) throw bad(name, ty.hint);
  return ty.t === 'pattern' ? s.toUpperCase() : s;
}

function checkSimple(section: SimpleSection, input: Record<string, unknown>): Record<string, Value> {
  const fields = SECTIONS[section] as Record<string, Field>;
  for (const k of Object.keys(input)) if (!(k in fields)) throw bad(k, 'champ inconnu');
  return Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, checkField(k, f, input[k])]));
}

function checkHours(input: Record<string, unknown>): Record<string, Json> {
  const days = input.jours as Record<string, unknown> | undefined;
  if (!days || typeof days !== 'object') throw bad('jours', 'obligatoire');
  const out: Record<string, Json> = {};
  for (const d of DAYS) {
    const day = (days[d] ?? {}) as { ouvert?: unknown; ouverture?: unknown; fermeture?: unknown };
    if (day.ouvert !== true) {
      out[d] = { ouvert: false, ouverture: null, fermeture: null };
      continue;
    }
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof day.ouverture !== 'string' || !hhmm.test(day.ouverture) || typeof day.fermeture !== 'string' || !hhmm.test(day.fermeture)) {
      throw bad(d, 'heures HH:MM attendues');
    }
    if (day.fermeture <= day.ouverture) throw bad(d, 'la fermeture suit l’ouverture');
    out[d] = { ouvert: true, ouverture: day.ouverture, fermeture: day.fermeture };
  }
  if (!DAYS.some((d) => (out[d] as { ouvert: boolean }).ouvert)) throw bad('jours', 'au moins un jour d’ouverture');
  const zone = checkField('zone_garde', text(120), input.zone_garde);
  return { jours: out, zone_garde: zone };
}

function checkStaff(input: Record<string, unknown>): Record<string, Json> {
  const list = input.membres;
  if (!Array.isArray(list) || list.length > 100) throw bad('membres', 'liste de 0 à 100 personnes');
  const membres = list.map((m: Record<string, unknown>, i) => {
    const nom = checkField(`membres[${i}].nom`, text(120, true), m?.nom);
    const fonction = checkField(`membres[${i}].fonction`, req({ type: { t: 'enum', values: STAFF_ROLES } }), m?.fonction);
    const onpc = checkField(`membres[${i}].numero_onpc`, text(40), m?.numero_onpc);
    if (fonction === 'pharmacien_assistant' && !onpc) throw bad(`membres[${i}].numero_onpc`, "obligatoire pour un pharmacien (inscription à l'Ordre)");
    return { nom, fonction, numero_onpc: onpc };
  });
  return { membres };
}

export function validateSection(section: string, input: unknown): Record<string, Json> {
  if (!(SECTION_IDS as readonly string[]).includes(section)) throw new AppError('not_found', 'Rubrique inconnue');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('validation_failed', 'Objet attendu');
  const o = input as Record<string, unknown>;
  if (section === 'horaires') return checkHours(o);
  if (section === 'personnel') return checkStaff(o);
  return checkSimple(section as SimpleSection, o);
}

export interface ProfileSection {
  id: SectionId;
  data: Record<string, Json> | null;
  complete: boolean;
  missing: string[];
  updated_at: string | null;
}

/** Champs obligatoires encore vides (rubrique non saisie = tous ses champs obligatoires). */
function missingOf(id: SectionId, data: Record<string, Json> | null): string[] {
  if (id === 'personnel') return data ? [] : ['membres'];
  if (id === 'horaires') return data ? [] : ['jours'];
  const fields = SECTIONS[id] as Record<string, Field>;
  return Object.entries(fields).filter(([k, f]) => f.required && (data?.[k] === null || data?.[k] === undefined)).map(([k]) => k);
}

export function getProfile(s: Services): ProfileSection[] {
  const rows = new Map(
    (s.db.prepare('SELECT section, data, updated_at FROM pharmacy_profile').all() as { section: string; data: string; updated_at: string }[])
      .map((r) => [r.section, r]),
  );
  return SECTION_IDS.map((id) => {
    const r = rows.get(id);
    const data = r ? (JSON.parse(r.data) as Record<string, Json>) : null;
    const missing = missingOf(id, data);
    return { id, data, complete: missing.length === 0, missing, updated_at: r?.updated_at ?? null };
  });
}

export function profileStatus(s: Services): { complete: boolean; done: number; total: number; sections: { id: SectionId; complete: boolean }[] } {
  const p = getProfile(s);
  return { complete: p.every((x) => x.complete), done: p.filter((x) => x.complete).length, total: p.length, sections: p.map(({ id, complete }) => ({ id, complete })) };
}

/** Enregistre une rubrique ; met à jour les paramètres utilisés par le ticket (nom, adresse, téléphone). */
export function saveSection(s: Services, actor: string, section: string, input: unknown): ProfileSection {
  const data = validateSection(section, input);
  return writeTx(s.db, () => {
    const before = s.db.prepare('SELECT data FROM pharmacy_profile WHERE section = ?').get(section) as { data: string } | undefined;
    const old = before ? (JSON.parse(before.data) as Record<string, Json>) : {};
    const changed = Object.keys(data).filter((k) => jcs(old[k] ?? null) !== jcs(data[k] ?? null));
    if (changed.length > 0 || !before) {
      const at = iso(s.clock.now());
      s.db
        .prepare(`INSERT INTO pharmacy_profile (section, data, updated_by, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(section) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(section, JSON.stringify(data), actor, at);
      syncTicketSettings(s, section, data);
      s.ledger.append('system.profile_updated', actor, { section, fields: changed, sha256: sha256hex(jcs(data)) });
    }
    return getProfile(s).find((x) => x.id === section)!;
  });
}

/** Le ticket (V-06) lit pharmacy_name, pharmacy_address et pharmacy_phone dans les paramètres. */
function syncTicketSettings(s: Services, section: string, d: Record<string, Json>): void {
  const put = s.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  if (section === 'identite' && typeof d.enseigne === 'string') put.run('pharmacy_name', d.enseigne);
  if (section === 'contacts' && typeof d.telephone === 'string') put.run('pharmacy_phone', d.telephone);
  if (section === 'localisation') {
    const addr = [d.quartier, d.repere, d.ville].filter((x) => typeof x === 'string' && x).join(', ');
    if (addr) put.run('pharmacy_address', addr.slice(0, 200));
  }
}

/** Mentions fiscales du ticket (NIU, RCCM), si le dossier les contient. */
export function fiscalMentions(s: Services): { niu: string | null; rccm: string | null } {
  const r = s.db.prepare("SELECT data FROM pharmacy_profile WHERE section = 'fiscal'").get() as { data: string } | undefined;
  const d = r ? (JSON.parse(r.data) as { niu?: string | null; rccm?: string | null }) : {};
  return { niu: d.niu ?? null, rccm: d.rccm ?? null };
}

// ---------------------------------------------------------------- organismes de tiers payant

export const PAYER_KINDS = ['assurance', 'mutuelle', 'employeur', 'etat', 'autre'] as const;

export interface Payer {
  id: string;
  name: string;
  kind: (typeof PAYER_KINDS)[number];
  code: string | null;
  convention_ref: string | null;
  default_coverage_pct: number | null;
  active: boolean;
}

export interface PayerInput {
  name: string;
  kind: string;
  code?: string | null;
  convention_ref?: string | null;
  default_coverage_pct?: number | null;
  active?: boolean;
}

function checkPayer(p: PayerInput) {
  const name = checkField('name', text(120, true), p.name) as string;
  const kind = checkField('kind', req({ type: { t: 'enum', values: PAYER_KINDS } }), p.kind) as string;
  const pct = p.default_coverage_pct ?? null;
  if (pct !== null && (!Number.isSafeInteger(pct) || pct < 0 || pct > 100)) throw bad('default_coverage_pct', 'entier de 0 à 100');
  return { name, kind, code: checkField('code', text(40), p.code), convention_ref: checkField('convention_ref', text(80), p.convention_ref), pct };
}

export function listPayers(s: Services, activeOnly = false): Payer[] {
  return (s.db.prepare('SELECT * FROM payers WHERE (? = 0 OR active = 1) ORDER BY name').all(activeOnly ? 1 : 0) as (Omit<Payer, 'active'> & { active: number })[])
    .map((p) => ({ ...p, active: p.active === 1 }));
}

export function savePayer(s: Services, actor: string, input: PayerInput, id?: string): Payer {
  const p = checkPayer(input);
  return writeTx(s.db, () => {
    const pid = id ?? randomUUID();
    const exists = s.db.prepare('SELECT 1 FROM payers WHERE id = ?').get(pid);
    if (id && !exists) throw new AppError('not_found', 'Organisme introuvable');
    const clash = s.db.prepare('SELECT id FROM payers WHERE name = ? COLLATE NOCASE AND id <> ?').get(p.name, pid);
    if (clash) throw new AppError('validation_failed', 'Organisme déjà enregistré', p.name);
    if (exists) {
      s.db.prepare('UPDATE payers SET name = ?, kind = ?, code = ?, convention_ref = ?, default_coverage_pct = ?, active = ? WHERE id = ?')
        .run(p.name, p.kind, p.code, p.convention_ref, p.pct, input.active === false ? 0 : 1, pid);
    } else {
      s.db.prepare('INSERT INTO payers (id, name, kind, code, convention_ref, default_coverage_pct, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
        .run(pid, p.name, p.kind, p.code, p.convention_ref, p.pct, iso(s.clock.now()));
    }
    s.ledger.append(exists ? 'payer.updated' : 'payer.created', actor, { payer_id: pid, name: p.name, kind: p.kind, active: input.active !== false });
    return listPayers(s).find((x) => x.id === pid)!;
  });
}
