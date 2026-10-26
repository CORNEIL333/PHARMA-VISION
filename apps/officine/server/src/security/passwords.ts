import { randomBytes, scrypt as scryptCb, timingSafeEqual, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  pw: string | Buffer,
  salt: Buffer,
  len: number,
  o: object,
) => Promise<Buffer>;

/** A-03 : scrypt N=2^17 r=8 p=1, sel 16 octets, sortie 32 octets, format scrypt$N$r$p$sel$empreinte. */
export const SCRYPT = { N: 2 ** 17, r: 8, p: 1 } as const;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(
  pw: string,
  params: { N: number; r: number; p: number } = SCRYPT,
): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(pw.normalize('NFC'), salt, 32, { ...params, maxmem: MAXMEM });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every(Number.isInteger) || N < 2 ** 14) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  if (expected.length !== 32) return false;
  const dk = await scrypt(pw.normalize('NFC'), Buffer.from(saltB64, 'base64url'), 32, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return timingSafeEqual(dk, expected);
}

/** Hachage factice pour égaliser le temps de réponse quand l'identifiant n'existe pas (A-01). */
let dummy: Promise<string> | null = null;
export async function burnPasswordTime(pw: string): Promise<void> {
  dummy ??= hashPassword('visionpharma-dummy-password');
  await verifyPassword(pw, await dummy);
}

let common: Set<string> | null = null;
function commonPasswords(): Set<string> {
  if (!common) {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'common-passwords.txt');
    common = new Set(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return common;
}

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_username' | 'too_simple';

/**
 * A-02 : 12 caractères minimum, absent de la liste des 10 000 mots de passe les plus courants (SecLists, MIT),
 * ne contient pas l'identifiant. Hypothèse plus sûre (PROGRESS.md) : on refuse aussi une entrée de la liste
 * suivie de chiffres ou de symboles (« password2026! ») et les mots de passe de moins de 5 caractères distincts.
 */
export function checkPasswordPolicy(pw: string, username: string): PasswordProblem | null {
  const n = [...pw.normalize('NFC')].length;
  if (n < 12) return 'too_short';
  if (n > 128) return 'too_long';
  const lower = pw.toLowerCase();
  const list = commonPasswords();
  if (list.has(lower)) return 'common';
  const base = lower.replace(/[^a-z]+$/u, '').replace(/^[^a-z]+/u, '');
  if (base.length >= 4 && list.has(base)) return 'common';
  if (username.length >= 3 && lower.includes(username.toLowerCase())) return 'contains_username';
  if (new Set(lower).size < 5) return 'too_simple';
  return null;
}

export const PASSWORD_PROBLEM_FR: Record<PasswordProblem, string> = {
  too_short: 'Le mot de passe doit contenir au moins 12 caractères.',
  too_long: 'Le mot de passe ne doit pas dépasser 128 caractères.',
  common: 'Ce mot de passe est trop courant.',
  contains_username: "Le mot de passe ne doit pas contenir l'identifiant.",
  too_simple: 'Le mot de passe est trop simple.',
};

/** Mot de passe temporaire (U-01, réinitialisation) : 16 caractères sans ambiguïté visuelle. */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}
