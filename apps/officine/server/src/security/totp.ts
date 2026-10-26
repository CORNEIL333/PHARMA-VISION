import { createHmac, randomBytes } from 'node:crypto';
import { base32Decode, base32Encode } from './crypto.js';

/** RFC 6238 : HMAC-SHA-1, 6 chiffres, pas de 30 s, tolérance ±1 pas. */

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = (h[h.length - 1] ?? 0) & 0x0f;
  const bin =
    (((h[off] ?? 0) & 0x7f) << 24) | ((h[off + 1] ?? 0) << 16) | ((h[off + 2] ?? 0) << 8) | (h[off + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, '0');
}

export function totpAt(secretB32: string, t: Date, step = 30): string {
  return hotp(base32Decode(secretB32), Math.floor(t.getTime() / 1000 / step));
}

/**
 * Vérifie un code ; renvoie le compteur accepté (pour refuser la réutilisation du même code), ou null.
 * `lastUsedCounter` : dernier compteur accepté pour cet utilisateur.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  t: Date,
  lastUsedCounter: number | null = null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const c = Math.floor(t.getTime() / 1000 / 30);
  let match: number | null = null;
  for (const d of [-1, 0, 1]) {
    const candidate = hotp(secret, c + d);
    // Comparaison sur toutes les fenêtres, sans sortie anticipée.
    if (candidate === code && (lastUsedCounter === null || c + d > lastUsedCounter)) match = c + d;
  }
  return match;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'VisionPharma'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
