import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../src/security/passwords.js';
import { hotp, totpAt, verifyTotp } from '../src/security/totp.js';
import { base32Encode } from '../src/security/crypto.js';

describe('A-02 politique de mot de passe', () => {
  it.each([
    ['court1!', 'too_short'],
    ['qwerty123456789!', 'common'],
    ['password2026!', 'common'],
    ['MOTDEPASSE-mballa-99', 'contains_username'],
    ['aaaaaaaaaaaaaaaa', 'too_simple'],
  ])('A-02 refuse %s', (pw, reason) => {
    expect(checkPasswordPolicy(pw, 'mballa')).toBe(reason);
  });
  it('A-02 refuse une entrée exacte de la liste, quelle que soit la casse', () => {
    expect(checkPasswordPolicy('unbelievable', 'x')).toBe('common');
    expect(checkPasswordPolicy('ScandinaviaN', 'x')).toBe('common');
  });
  it.each(['Bissap-Ndole-2026!', 'tres longue phrase de passe camerounaise', 'Kribi plage 237 soleil'])(
    'A-02 accepte %s',
    (pw) => {
      expect(checkPasswordPolicy(pw, 'mballa')).toBeNull();
    },
  );
});

describe('A-03 hachage scrypt', () => {
  it('A-03 format scrypt$N$r$p$sel$empreinte avec N=2^17 r=8 p=1 et vérification', async () => {
    const h = await hashPassword('Bissap-Ndole-2026!');
    expect(h).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await verifyPassword('Bissap-Ndole-2026!', h)).toBe(true);
    expect(await verifyPassword('Bissap-Ndole-2026?', h)).toBe(false);
  });
  it('A-03 un hachage modifié échoue', async () => {
    const h = await hashPassword('Bissap-Ndole-2026!');
    const parts = h.split('$');
    const last = parts[5]!;
    parts[5] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1);
    expect(await verifyPassword('Bissap-Ndole-2026!', parts.join('$'))).toBe(false);
    expect(await verifyPassword('Bissap-Ndole-2026!', 'n_importe_quoi')).toBe(false);
  });
});

describe('A-01 TOTP RFC 6238', () => {
  // RFC 6238 annexe B (SHA-1), secret ASCII « 12345678901234567890 », 8 chiffres → on compare les 6 derniers.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('A-01 vecteur RFC 6238 t=%i', (t, code8) => {
    expect(totpAt(secret, new Date(t * 1000))).toBe(code8.slice(-6));
  });
  it('A-01 RFC 4226 HOTP compteur 0', () =>
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224'));
  it('A-01 tolérance d’un pas, refus du rejeu', () => {
    const t = new Date('2026-10-27T08:00:10.000Z');
    const prev = totpAt(secret, new Date(t.getTime() - 30_000));
    const c = verifyTotp(secret, prev, t);
    expect(c).not.toBeNull();
    expect(verifyTotp(secret, prev, t, c)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, new Date(t.getTime() - 90_000)), t)).toBeNull();
  });
});
