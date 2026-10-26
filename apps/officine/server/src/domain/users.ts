import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { deriveKey, open, seal, sealedFromString, sealedToString } from '../security/crypto.js';
import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_PROBLEM_FR,
  temporaryPassword,
} from '../security/passwords.js';
import type { Role } from '../security/rbac.js';
import { deleteUserSessions } from '../security/sessions.js';
import type { Services } from '../services.js';

/** Comptes (U-01, U-02) et règles de mot de passe (A-02). */

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  pw_hash: string;
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_last_counter: number | null;
  failed_attempts: number;
  locked_until: string | null;
  must_change_pw: number;
  active: number;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  active: boolean;
  totp_enabled: boolean;
  must_change_pw: boolean;
  created_at: string;
}

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    active: !!u.active,
    totp_enabled: !!u.totp_enabled,
    must_change_pw: !!u.must_change_pw,
    created_at: u.created_at,
  };
}

export function getUser(s: Services, id: string): UserRow {
  const u = s.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!u) throw new AppError('not_found', 'Compte introuvable');
  return u;
}

export function findByUsername(s: Services, username: string): UserRow | undefined {
  return s.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function listUsers(s: Services): PublicUser[] {
  return (s.db.prepare('SELECT * FROM users ORDER BY active DESC, username').all() as UserRow[]).map(
    toPublic,
  );
}

export function assertPassword(pw: string, username: string): void {
  const p = checkPasswordPolicy(pw, username);
  if (p) throw new AppError('weak_password', 'Mot de passe refusé', PASSWORD_PROBLEM_FR[p], { reason: p });
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/i;
export function assertUsername(u: string): void {
  if (!USERNAME.test(u)) {
    throw new AppError(
      'validation_failed',
      'Identifiant invalide',
      '3 à 32 caractères : lettres, chiffres, point, tiret, souligné.',
    );
  }
}

function activeTitulaires(s: Services): number {
  return (
    s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'titulaire' AND active = 1").get() as {
      n: number;
    }
  ).n;
}

/** U-01 : création avec un mot de passe temporaire (changement imposé à la première connexion). */
export async function createUser(
  s: Services,
  actor: string,
  input: { username: string; display_name: string; role: Role },
): Promise<{ user: PublicUser; temporary_password: string }> {
  assertUsername(input.username);
  const temp = temporaryPassword();
  const hash = await hashPassword(temp, s.scryptParams);
  const user = writeTx(s.db, () => {
    if (findByUsername(s, input.username)) throw new AppError('username_taken', 'Identifiant déjà utilisé');
    const id = randomUUID();
    const now = iso(s.clock.now());
    s.db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, pw_hash, must_change_pw, created_at, pw_changed_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, input.username, input.display_name, input.role, hash, now, now);
    s.ledger.append('user.created', actor, { user_id: id, username: input.username, role: input.role });
    return toPublic(getUser(s, id));
  });
  return { user, temporary_password: temp };
}

/** U-01 / U-02 : changement de nom ou de rôle ; le dernier titulaire actif ne peut pas être rétrogradé. */
export function updateUser(
  s: Services,
  actor: string,
  id: string,
  patch: { display_name?: string; role?: Role },
): PublicUser {
  return writeTx(s.db, () => {
    const u = getUser(s, id);
    const fields: string[] = [];
    if (patch.role && patch.role !== u.role) {
      if (u.role === 'titulaire' && u.active && activeTitulaires(s) <= 1) {
        throw new AppError(
          'last_titulaire',
          'Dernier titulaire',
          'Le dernier titulaire actif ne peut pas être rétrogradé.',
        );
      }
      s.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(patch.role, id);
      deleteUserSessions(s, id); // les droits changent : nouvelle connexion obligatoire
      fields.push('role');
    }
    if (patch.display_name !== undefined && patch.display_name !== u.display_name) {
      s.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.display_name, id);
      fields.push('display_name');
    }
    if (fields.length) {
      s.ledger.append('user.updated', actor, {
        user_id: id,
        fields,
        ...(patch.role ? { role: patch.role, old_role: u.role } : {}),
      });
    }
    return toPublic(getUser(s, id));
  });
}

export function setActive(s: Services, actor: string, id: string, active: boolean): PublicUser {
  return writeTx(s.db, () => {
    const u = getUser(s, id);
    if (!!u.active === active) return toPublic(u);
    if (!active && u.role === 'titulaire' && activeTitulaires(s) <= 1) {
      throw new AppError(
        'last_titulaire',
        'Dernier titulaire',
        'Le dernier titulaire actif ne peut pas être désactivé.',
      );
    }
    s.db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (!active) deleteUserSessions(s, id);
    s.ledger.append(active ? 'user.enabled' : 'user.disabled', actor, { user_id: id });
    return toPublic(getUser(s, id));
  });
}

export async function resetPassword(
  s: Services,
  actor: string,
  id: string,
): Promise<{ temporary_password: string }> {
  const temp = temporaryPassword();
  const hash = await hashPassword(temp, s.scryptParams);
  writeTx(s.db, () => {
    getUser(s, id);
    s.db
      .prepare(
        'UPDATE users SET pw_hash = ?, must_change_pw = 1, failed_attempts = 0, locked_until = NULL, pw_changed_at = ? WHERE id = ?',
      )
      .run(hash, iso(s.clock.now()), id);
    deleteUserSessions(s, id);
    s.ledger.append('user.password_reset', actor, { user_id: id });
  });
  return { temporary_password: temp };
}

export function revokeSessions(s: Services, actor: string, id: string): number {
  return writeTx(s.db, () => {
    getUser(s, id);
    const n = deleteUserSessions(s, id);
    s.ledger.append('user.sessions_revoked', actor, { user_id: id, count: n });
    return n;
  });
}

/** Changement de son propre mot de passe : les autres sessions de l'utilisateur sont coupées. */
export async function changeOwnPassword(
  s: Services,
  userId: string,
  keepTokenHash: string,
  newPw: string,
): Promise<void> {
  const u = getUser(s, userId);
  assertPassword(newPw, u.username);
  const hash = await hashPassword(newPw, s.scryptParams);
  writeTx(s.db, () => {
    s.db
      .prepare('UPDATE users SET pw_hash = ?, must_change_pw = 0, pw_changed_at = ? WHERE id = ?')
      .run(hash, iso(s.clock.now()), userId);
    deleteUserSessions(s, userId, keepTokenHash);
    s.ledger.append('user.updated', userId, { user_id: userId, fields: ['password'] });
  });
}

// ---------------------------------------------------------------- Secret TOTP chiffré (doc 06 §4.1)
const totpKey = (s: Services) => deriveKey(s.keys.dataKey, 'vp-totp-v1');

export function encryptTotpSecret(s: Services, userId: string, secretB32: string): string {
  return sealedToString(
    seal(totpKey(s), s.keys.identity.data_kid, Buffer.from(secretB32), Buffer.from(userId)),
  );
}

export function decryptTotpSecret(s: Services, userId: string, enc: string): string {
  return open(totpKey(s), sealedFromString(enc), Buffer.from(userId)).toString('utf8');
}
