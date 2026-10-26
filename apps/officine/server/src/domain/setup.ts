import { randomUUID, timingSafeEqual } from 'node:crypto';
import { iso } from '../clock.js';
import { schemaVersion, writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { readRecoveryWrap, unwrapDataKey } from '../security/keys.js';
import { hashPassword } from '../security/passwords.js';
import { createSession } from '../security/sessions.js';
import { verifyTotp } from '../security/totp.js';
import type { Services } from '../services.js';
import { assertPassword, assertUsername, encryptTotpSecret } from './users.js';

/** Configuration initiale (I-02, I-03) : création du titulaire, TOTP obligatoire, confirmation de la clé de récupération. */

export function isSetupDone(s: Services): boolean {
  return (
    (s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'titulaire'").get() as { n: number }).n > 0
  );
}

export interface SetupInput {
  pharmacy_name: string;
  username: string;
  display_name: string;
  password: string;
  recovery_key: string;
  totp_secret: string;
  totp_code: string;
}

/** Contrôles préalables (hors transaction : scrypt est asynchrone). Renvoie le compteur TOTP accepté. */
function validateSetup(s: Services, input: SetupInput): number {
  if (isSetupDone(s)) throw new AppError('setup_done', 'Configuration déjà faite');
  assertUsername(input.username);
  assertPassword(input.password, input.username);
  let recovered: Buffer;
  try {
    recovered = unwrapDataKey(readRecoveryWrap(s.config.dataDir), input.recovery_key);
  } catch {
    throw new AppError(
      'validation_failed',
      'Clé de récupération incorrecte',
      'Recopiez la clé affichée par la commande init.',
    );
  }
  if (recovered.length !== 32 || !timingSafeEqual(recovered, s.keys.dataKey)) {
    throw new AppError('validation_failed', 'Clé de récupération incorrecte');
  }
  const counter = verifyTotp(input.totp_secret, input.totp_code, s.clock.now());
  if (counter === null)
    throw new AppError(
      'invalid_totp',
      'Code incorrect',
      'Le code de l’application d’authentification ne correspond pas.',
    );
  return counter;
}

export async function completeSetup(
  s: Services,
  input: SetupInput,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; csrf: string; userId: string }> {
  const counter = validateSetup(s, input);
  const hash = await hashPassword(input.password, s.scryptParams);
  return writeTx(s.db, () => {
    if (isSetupDone(s)) throw new AppError('setup_done', 'Configuration déjà faite');
    const now = iso(s.clock.now());
    const id = randomUUID();
    if ((s.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n === 0) {
      s.ledger.append('system.initialized', null, {
        node_id: s.keys.identity.node_id,
        schema: schemaVersion(s.db),
        pharmacy_name: input.pharmacy_name,
      });
    }
    s.db.prepare("INSERT INTO settings (key, value) VALUES ('pharmacy_name', ?)").run(input.pharmacy_name);
    s.db
      .prepare(
        `INSERT INTO users (id, username, display_name, role, pw_hash, totp_secret_enc, totp_enabled, totp_last_counter, created_at, pw_changed_at)
         VALUES (?, ?, ?, 'titulaire', ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.username,
        input.display_name,
        hash,
        encryptTotpSecret(s, id, input.totp_secret),
        counter,
        now,
        now,
      );
    s.ledger.append('user.created', null, {
      user_id: id,
      username: input.username,
      role: 'titulaire',
      via: 'setup',
    });
    const { token, csrf } = createSession(s, id, meta.ip, meta.userAgent);
    s.ledger.append('security.login_succeeded', id, { user_id: id, ip: meta.ip, method: 'setup' });
    return { token, csrf, userId: id };
  });
}
