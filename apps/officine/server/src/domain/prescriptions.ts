import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { deriveKey, open, seal, sealedFromString, sealedToString, sha256hex } from '../security/crypto.js';
import { paths } from '../security/keys.js';
import type { Services } from '../services.js';
import { daysBetween, doualaDate, isCalendarDate } from './dates.js';
import { getSetting } from './settings.js';

/**
 * O-03 à O-05 : ordonnances. Saisies et validées par un pharmacien ou le titulaire ; photo
 * chiffrée en AES-256-GCM hors base (O-04) ; ancienneté au-delà du seuil = levée motivée (O-05).
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface PrescriptionInput {
  prescriber_name: string;
  prescriber_reg?: string | null;
  issued_on: string;
  patient_ref?: string | null;
  notes?: string | null;
  /** Photo en base64 (JPEG ou PNG, type vérifié par signature). */
  image_base64?: string | null;
  /** O-05 : motif obligatoire si l'ordonnance dépasse l'âge maximal. */
  age_override_reason?: string | null;
}

export interface Prescription {
  id: string;
  prescriber_name: string;
  prescriber_reg: string | null;
  issued_on: string;
  patient_ref: string | null;
  notes: string | null;
  has_image: boolean;
  age_days: number;
  age_override_reason: string | null;
  validated_by: string;
  validated_by_name: string;
  validated_at: string;
  sale_id: string | null;
}

function text(v: unknown, max: number, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max || /\p{Cc}/u.test(v)) throw new AppError('validation_failed', `${what} invalide`);
  return v.trim() || null;
}

/** O-04 : type réel par signature de fichier (jamais le nom ni le type déclaré). */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length > 8 && buf.subarray(0, 8).equals(png)) return 'image/png';
  return null;
}

function decodeImage(b64: string): { bytes: Buffer; mime: 'image/jpeg' | 'image/png' } {
  if (b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new AppError('validation_failed', 'Image invalide', 'JPEG ou PNG de 8 Mo au plus.');
  }
  const bytes = Buffer.from(b64, 'base64');
  const mime = sniffImage(bytes);
  if (!mime || bytes.length > MAX_IMAGE_BYTES) throw new AppError('validation_failed', 'Image invalide', 'JPEG ou PNG de 8 Mo au plus.');
  return { bytes, mime };
}

const blobKey = (s: Services) => deriveKey(s.keys.dataKey, 'vp-blob-v1');
const blobFile = (s: Services, name: string) => path.join(paths(s.config.dataDir).blobs, name);

/** Écrit le fichier chiffré de façon durable (fsync puis renommage atomique) ; renvoie son nom. */
function writeBlob(s: Services, id: string, bytes: Buffer): { name: string; sha256: string } {
  const dir = paths(s.config.dataDir).blobs;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const data = Buffer.from(sealedToString(seal(blobKey(s), s.keys.identity.data_kid, bytes, Buffer.from(id))), 'utf8');
  const name = `rx-${id}.vpb`;
  const tmp = path.join(dir, `${name}.tmp`);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path.join(dir, name));
  return { name, sha256: sha256hex(data) };
}

function checkInput(s: Services, input: PrescriptionInput) {
  const prescriber = text(input.prescriber_name, 120, 'Prescripteur');
  if (!prescriber) throw new AppError('validation_failed', 'Nom du prescripteur obligatoire');
  if (!isCalendarDate(input.issued_on)) throw new AppError('validation_failed', 'Date de prescription invalide');
  const age = daysBetween(input.issued_on, doualaDate(s.clock.now()));
  if (age < 0) throw new AppError('validation_failed', 'Date de prescription dans le futur');
  const override = text(input.age_override_reason, 500, 'Motif');
  const max = getSetting(s, 'prescription_max_age_days');
  if (age > max && !override) {
    throw new AppError('stale_prescription', 'Ordonnance ancienne', `Ordonnance de ${age} jours (maximum ${max}) : motif de levée requis.`, {
      age_days: age, max_age_days: max,
    });
  }
  return {
    prescriber,
    reg: text(input.prescriber_reg, 40, "Numéro d'inscription"),
    patient: text(input.patient_ref, 40, 'Référence patient'),
    notes: text(input.notes, 1000, 'Notes'),
    override: age > max ? override : null,
  };
}

/** O-02, O-03 : saisie et validation par `validator` (pharmacien ou titulaire, contrôlé en amont). */
export function createPrescription(s: Services, validator: string, input: PrescriptionInput, createdBy = validator): Prescription {
  const c = checkInput(s, input);
  const image = input.image_base64 ? decodeImage(input.image_base64) : null;
  const id = randomUUID();
  const blob = image ? writeBlob(s, id, image.bytes) : null;
  try {
    return writeTx(s.db, () => {
      const at = iso(s.clock.now());
      s.db
        .prepare(
          `INSERT INTO prescriptions (id, prescriber_name, prescriber_reg, issued_on, patient_ref, image_blob, validated_by,
             validated_at, notes, age_override_reason, image_sha256, image_mime, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, c.prescriber, c.reg, input.issued_on, c.patient, blob?.name ?? null, validator, at, c.notes, c.override,
          blob?.sha256 ?? null, image?.mime ?? null, createdBy);
      s.ledger.append('prescription.validated', validator, {
        prescription_id: id, prescriber_name: c.prescriber, prescriber_reg: c.reg, issued_on: input.issued_on,
        patient_ref: c.patient, image_sha256: blob?.sha256 ?? null, age_override_reason: c.override,
      });
      return getPrescription(s, id);
    });
  } catch (e) {
    if (blob) rmSync(blobFile(s, blob.name), { force: true });
    throw e;
  }
}

export function getPrescription(s: Services, id: string): Prescription {
  const r = s.db
    .prepare(
      `SELECT p.id, p.prescriber_name, p.prescriber_reg, p.issued_on, p.patient_ref, p.notes, p.image_blob IS NOT NULL AS has_image,
              p.age_override_reason, p.validated_by, u.display_name AS validated_by_name, p.validated_at,
              (SELECT sa.id FROM sales sa WHERE sa.prescription_id = p.id AND sa.status = 'completed' LIMIT 1) AS sale_id
       FROM prescriptions p JOIN users u ON u.id = p.validated_by WHERE p.id = ?`,
    )
    .get(id) as (Omit<Prescription, 'has_image' | 'age_days'> & { has_image: number }) | undefined;
  if (!r) throw new AppError('not_found', 'Ordonnance introuvable');
  return { ...r, has_image: r.has_image === 1, age_days: daysBetween(r.issued_on, doualaDate(s.clock.now())) };
}

/** O-04 : image déchiffrée à la volée (droit `prescription.view_image` contrôlé par la route). */
export function prescriptionImage(s: Services, id: string): { mime: string; bytes: Buffer } {
  const r = s.db.prepare('SELECT image_blob, image_mime FROM prescriptions WHERE id = ?').get(id) as
    { image_blob: string | null; image_mime: string | null } | undefined;
  if (!r?.image_blob || !r.image_mime) throw new AppError('not_found', 'Image introuvable');
  const sealed = sealedFromString(readFileSync(blobFile(s, path.basename(r.image_blob)), 'utf8'));
  return { mime: r.image_mime, bytes: open(blobKey(s), sealed, Buffer.from(id)) };
}
