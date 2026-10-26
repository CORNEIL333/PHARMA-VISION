import { iso } from '../clock.js';
import type { Services } from '../services.js';
import { randomToken, sha256hex } from './crypto.js';
import type { Role } from './rbac.js';

/** A-05 : jeton de 32 octets, seule l'empreinte SHA-256 est stockée ; inactivité 30 min ; durée max 12 h. */

export interface AuthContext {
  tokenHash: string;
  csrf: string;
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  reauthAt: string | null;
  /** Session limitée : changement de mot de passe ou enrôlement TOTP obligatoire avant tout le reste. */
  restriction: 'password_change' | 'totp_enrollment' | null;
}

export function createSession(
  s: Services,
  userId: string,
  ip: string | null,
  ua: string | null,
): { token: string; csrf: string } {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const now = s.clock.now();
  const expires = new Date(now.getTime() + s.config.sessionMaxHours * 3_600_000);
  s.db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, csrf, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sha256hex(token), userId, csrf, iso(now), iso(now), iso(expires), ip, ua?.slice(0, 200) ?? null);
  return { token, csrf };
}

interface Row {
  token_hash: string;
  csrf: string;
  user_id: string;
  last_seen_at: string;
  expires_at: string;
  reauth_at: string | null;
  username: string;
  display_name: string;
  role: Role;
  active: number;
  must_change_pw: number;
  totp_enabled: number;
}

export function lookupSession(s: Services, token: string | undefined): AuthContext | null {
  if (!token || token.length > 100) return null;
  const h = sha256hex(token);
  const r = s.db
    .prepare(
      `SELECT s.token_hash, s.csrf, s.user_id, s.last_seen_at, s.expires_at, s.reauth_at,
              u.username, u.display_name, u.role, u.active, u.must_change_pw, u.totp_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(h) as Row | undefined;
  if (!r) return null;
  const now = s.clock.now();
  const idleLimit = Date.parse(r.last_seen_at) + s.config.sessionIdleMinutes * 60_000;
  if (!r.active || now.getTime() >= Date.parse(r.expires_at) || now.getTime() >= idleLimit) {
    s.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    return null;
  }
  s.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(iso(now), h);
  const restriction = r.must_change_pw
    ? 'password_change'
    : r.role === 'titulaire' && !r.totp_enabled
      ? 'totp_enrollment'
      : null;
  return {
    tokenHash: h,
    csrf: r.csrf,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    reauthAt: r.reauth_at,
    restriction,
  };
}

export function reauthValid(s: Services, a: AuthContext): boolean {
  return (
    a.reauthAt !== null && s.clock.now().getTime() - Date.parse(a.reauthAt) < s.config.reauthMinutes * 60_000
  );
}

export function deleteSession(s: Services, tokenHash: string): void {
  s.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteUserSessions(s: Services, userId: string, exceptTokenHash?: string): number {
  return s.db
    .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
    .run(userId, exceptTokenHash ?? '').changes;
}
