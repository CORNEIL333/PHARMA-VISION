import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { randomToken } from '../security/crypto.js';
import { burnPasswordTime, verifyPassword } from '../security/passwords.js';
import { createSession, type AuthContext } from '../security/sessions.js';
import { grant } from '../security/rbac.js';
import { newTotpSecret, otpauthUri, verifyTotp } from '../security/totp.js';
import type { Services } from '../services.js';
import { decryptTotpSecret, encryptTotpSecret, findByUsername, getUser, type UserRow } from './users.js';

/** Connexion (A-01), verrouillage (A-04), ré-authentification (A-07), enrôlement TOTP. */

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
const CHALLENGE_MS = 5 * 60_000;

const GENERIC = () =>
  new AppError(
    'invalid_credentials',
    'Connexion refusée',
    'Identifiant, mot de passe ou code incorrect, ou compte temporairement verrouillé.',
  );

interface Challenge {
  userId: string;
  expires: number;
}

export interface LoginMeta {
  ip: string | null;
  userAgent: string | null;
}

export type LoginResult =
  { kind: 'session'; token: string; csrf: string; userId: string } | { kind: 'totp'; challenge: string };

export class AuthService {
  private readonly challenges = new Map<string, Challenge>();
  constructor(private readonly s: Services) {}

  private isLocked(u: UserRow): boolean {
    return u.locked_until !== null && Date.parse(u.locked_until) > this.s.clock.now().getTime();
  }

  /** Enregistre un échec ; verrouille le compte après MAX_FAILURES échecs consécutifs (A-04). */
  private recordFailure(u: UserRow | undefined, username: string, meta: LoginMeta, reason: string): void {
    writeTx(this.s.db, () => {
      this.s.ledger.append('security.login_failed', null, { username, ip: meta.ip, reason });
      if (!u) return;
      const failures = u.failed_attempts + 1;
      if (failures >= MAX_FAILURES) {
        const until = iso(new Date(this.s.clock.now().getTime() + LOCK_MINUTES * 60_000));
        this.s.db
          .prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?')
          .run(until, u.id);
        this.s.ledger.append('security.account_locked', null, {
          user_id: u.id,
          until,
          minutes: LOCK_MINUTES,
        });
      } else {
        this.s.db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(failures, u.id);
      }
    });
  }

  private openSession(u: UserRow, meta: LoginMeta, method: string): LoginResult {
    return writeTx(this.s.db, () => {
      this.s.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);
      const { token, csrf } = createSession(this.s, u.id, meta.ip, meta.userAgent);
      this.s.ledger.append('security.login_succeeded', u.id, { user_id: u.id, ip: meta.ip, method });
      return { kind: 'session' as const, token, csrf, userId: u.id };
    });
  }

  async login(username: string, password: string, meta: LoginMeta): Promise<LoginResult> {
    const u = findByUsername(this.s, username);
    if (!u || !u.active) {
      await burnPasswordTime(password);
      this.recordFailure(undefined, username, meta, u ? 'disabled' : 'unknown_user');
      throw GENERIC();
    }
    if (this.isLocked(u)) {
      await burnPasswordTime(password);
      writeTx(this.s.db, () =>
        this.s.ledger.append('security.login_failed', null, { username, ip: meta.ip, reason: 'locked' }),
      );
      throw GENERIC();
    }
    if (!(await verifyPassword(password, u.pw_hash))) {
      this.recordFailure(u, username, meta, 'bad_password');
      throw GENERIC();
    }
    if (u.totp_enabled) {
      this.sweep();
      const challenge = randomToken(32);
      this.challenges.set(challenge, { userId: u.id, expires: this.s.clock.now().getTime() + CHALLENGE_MS });
      return { kind: 'totp', challenge };
    }
    return this.openSession(u, meta, 'password');
  }

  async totp(challenge: string, code: string, meta: LoginMeta): Promise<LoginResult> {
    const c = this.challenges.get(challenge);
    if (!c || c.expires <= this.s.clock.now().getTime()) {
      this.challenges.delete(challenge);
      throw GENERIC();
    }
    const u = getUser(this.s, c.userId);
    if (!u.active || this.isLocked(u) || !u.totp_secret_enc) {
      this.challenges.delete(challenge);
      throw GENERIC();
    }
    const counter = verifyTotp(
      decryptTotpSecret(this.s, u.id, u.totp_secret_enc),
      code,
      this.s.clock.now(),
      u.totp_last_counter,
    );
    if (counter === null) {
      this.recordFailure(u, u.username, meta, 'bad_totp');
      if (this.isLocked(getUser(this.s, u.id))) this.challenges.delete(challenge);
      throw GENERIC();
    }
    this.challenges.delete(challenge);
    this.s.db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(counter, u.id);
    return this.openSession(u, meta, 'password+totp');
  }

  /** A-07 : ré-authentification (mot de passe, plus TOTP si activé). */
  async reauth(
    a: AuthContext,
    password: string,
    code: string | undefined,
    meta: LoginMeta,
    purpose: string | undefined,
  ): Promise<void> {
    const u = getUser(this.s, a.userId);
    let ok = !this.isLocked(u) && (await verifyPassword(password, u.pw_hash));
    let counter: number | null = null;
    if (ok && u.totp_enabled) {
      counter = u.totp_secret_enc
        ? verifyTotp(
            decryptTotpSecret(this.s, u.id, u.totp_secret_enc),
            code ?? '',
            this.s.clock.now(),
            u.totp_last_counter,
          )
        : null;
      ok = counter !== null;
    }
    if (!ok) {
      this.recordFailure(u, u.username, meta, 'bad_reauth');
      throw GENERIC();
    }
    writeTx(this.s.db, () => {
      if (counter !== null)
        this.s.db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(counter, u.id);
      this.s.db
        .prepare('UPDATE sessions SET reauth_at = ? WHERE token_hash = ?')
        .run(iso(this.s.clock.now()), a.tokenHash);
      this.s.ledger.append('security.reauth', u.id, { user_id: u.id, purpose: purpose ?? null });
    });
  }

  /**
   * O-02 : un pharmacien (ou le titulaire) valide sur le poste d'un autre utilisateur avec ses propres
   * identifiants (mot de passe, plus TOTP si activé). Mêmes règles d'échec et de verrouillage qu'une connexion.
   */
  async verifyValidator(username: string, password: string, code: string | undefined, meta: LoginMeta): Promise<string> {
    const u = findByUsername(this.s, username);
    if (!u || !u.active || this.isLocked(u) || grant(u.role, 'prescription.validate') === '-') {
      await burnPasswordTime(password);
      this.recordFailure(undefined, username, meta, 'bad_countersign');
      throw GENERIC();
    }
    let ok = await verifyPassword(password, u.pw_hash);
    let counter: number | null = null;
    if (ok && u.totp_enabled) {
      counter = u.totp_secret_enc
        ? verifyTotp(decryptTotpSecret(this.s, u.id, u.totp_secret_enc), code ?? '', this.s.clock.now(), u.totp_last_counter)
        : null;
      ok = counter !== null;
    }
    if (!ok) {
      this.recordFailure(u, u.username, meta, 'bad_countersign');
      throw GENERIC();
    }
    writeTx(this.s.db, () => {
      if (counter !== null) this.s.db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(counter, u.id);
      this.s.ledger.append('security.reauth', u.id, { user_id: u.id, purpose: 'prescription_countersign' });
    });
    return u.id;
  }

  /** Début d'enrôlement TOTP : secret chiffré stocké, inactif jusqu'à confirmation. */
  beginTotpEnrollment(a: AuthContext): { secret: string; otpauth_uri: string } {
    const u = getUser(this.s, a.userId);
    if (u.totp_enabled) throw new AppError('invalid_transition', 'TOTP déjà activé');
    const secret = newTotpSecret();
    this.s.db
      .prepare('UPDATE users SET totp_secret_enc = ? WHERE id = ?')
      .run(encryptTotpSecret(this.s, u.id, secret), u.id);
    return { secret, otpauth_uri: otpauthUri(secret, u.username) };
  }

  confirmTotpEnrollment(a: AuthContext, code: string): void {
    const u = getUser(this.s, a.userId);
    if (u.totp_enabled) throw new AppError('invalid_transition', 'TOTP déjà activé');
    if (!u.totp_secret_enc) throw new AppError('invalid_transition', 'Enrôlement non commencé');
    const counter = verifyTotp(decryptTotpSecret(this.s, u.id, u.totp_secret_enc), code, this.s.clock.now());
    if (counter === null)
      throw new AppError(
        'invalid_totp',
        'Code incorrect',
        'Le code saisi ne correspond pas. Vérifiez l’heure du téléphone.',
      );
    writeTx(this.s.db, () => {
      this.s.db
        .prepare('UPDATE users SET totp_enabled = 1, totp_last_counter = ? WHERE id = ?')
        .run(counter, u.id);
      this.s.ledger.append('user.updated', u.id, { user_id: u.id, fields: ['totp_enabled'] });
    });
  }

  private sweep(): void {
    const t = this.s.clock.now().getTime();
    for (const [k, c] of this.challenges) if (c.expires <= t) this.challenges.delete(k);
  }
}
