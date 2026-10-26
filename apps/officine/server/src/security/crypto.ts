import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Primitives du profil cryptographique (doc 06 §4.1). node:crypto uniquement. */

export function sha256hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Comparaison en temps constant de deux chaînes (longueurs différentes : faux, sans fuite de contenu). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** HKDF-SHA-256 (RFC 5869). Infos utilisées : vp-backup-v1, vp-blob-v1, vp-totp-v1. */
export function deriveKey(dataKey: Buffer, info: string, salt: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.from(hkdfSync('sha256', dataKey, salt, Buffer.from(info, 'utf8'), 32));
}

export interface Sealed {
  alg: 'A256GCM';
  kid: string;
  nonce: string;
  ct: string;
  tag: string;
}

/** AES-256-GCM, nonce aléatoire de 96 bits, étiquette 128 bits ; alg et kid portés par l'objet. */
export function seal(key: Buffer, kid: string, plaintext: Buffer, aad: Buffer = Buffer.alloc(0)): Sealed {
  if (key.length !== 32) throw new Error('Clé AES-256 attendue');
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(Buffer.concat([Buffer.from(`A256GCM|${kid}|`), aad]));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { alg: 'A256GCM', kid, nonce: b64url(nonce), ct: b64url(ct), tag: b64url(c.getAuthTag()) };
}

export function open(key: Buffer, s: Sealed, aad: Buffer = Buffer.alloc(0)): Buffer {
  if (s.alg !== 'A256GCM') throw new Error(`Algorithme non pris en charge : ${String(s.alg)}`);
  const d = createDecipheriv('aes-256-gcm', key, fromB64url(s.nonce), { authTagLength: 16 });
  d.setAAD(Buffer.concat([Buffer.from(`A256GCM|${s.kid}|`), aad]));
  d.setAuthTag(fromB64url(s.tag));
  return Buffer.concat([d.update(fromB64url(s.ct)), d.final()]);
}

/** Sérialisation compacte d'un objet scellé pour une colonne texte : v1.<base64url(JSON)>. */
export function sealedToString(s: Sealed): string {
  return 'v1.' + Buffer.from(JSON.stringify(s)).toString('base64url');
}

export function sealedFromString(v: string): Sealed {
  if (!v.startsWith('v1.')) throw new Error('Format scellé inconnu');
  return JSON.parse(Buffer.from(v.slice(3), 'base64url').toString('utf8')) as Sealed;
}

/** Base32 RFC 4648 sans remplissage (clé de récupération, secrets TOTP). */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Caractère base32 invalide');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
