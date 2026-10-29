import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import { grant } from '../security/rbac.js';
import type { Services } from '../services.js';
import { isOnDuty } from './duty.js';
import { getUser } from './users.js';

/**
 * V-01, V-08, G-01 : sessions de caisse. Au plus une session ouverte par poste (`register`).
 * Une session ouverte pendant une garde est une caisse « garde » : elle se clôture à part.
 */

export const MAX_AMOUNT = 1_000_000_000;

export interface CashSession {
  id: string;
  register: string;
  kind: 'jour' | 'garde';
  opened_by: string;
  opened_by_name: string;
  opened_at: string;
  opening_float: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  note: string | null;
}

const SESSION_SQL = `SELECT c.id, c.register, c.kind, c.opened_by, u.display_name AS opened_by_name, c.opened_at,
  c.opening_float, c.closed_by, c.closed_at, c.counted_cash, c.expected_cash, c.variance, c.note
  FROM cash_sessions c JOIN users u ON u.id = c.opened_by`;

export function normalizeRegister(v: unknown): string {
  const r = typeof v === 'string' ? v.trim() : '';
  if (!r || r.length > 60 || /\p{Cc}/u.test(r)) throw new AppError('validation_failed', 'Poste de caisse invalide');
  return r;
}

export function assertAmount(v: unknown, what: string): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_AMOUNT) {
    throw new AppError('validation_failed', `${what} invalide`, 'Montant entier en XAF, positif ou nul.');
  }
}

export function getCashSession(s: Services, id: string): CashSession {
  const r = s.db.prepare(`${SESSION_SQL} WHERE c.id = ?`).get(id) as CashSession | undefined;
  if (!r) throw new AppError('not_found', 'Session de caisse introuvable');
  return r;
}

export function currentSession(s: Services, register: string): CashSession | null {
  return (
    (s.db.prepare(`${SESSION_SQL} WHERE c.register = ? AND c.closed_at IS NULL`).get(normalizeRegister(register)) as
      CashSession | undefined) ?? null
  );
}

/** V-01 : ouverture avec fond de caisse ; 409 `register_busy` si le poste a déjà une session ouverte. */
export function openCashSession(s: Services, actor: string, input: { register: string; opening_float: number }): CashSession {
  const register = normalizeRegister(input.register);
  assertAmount(input.opening_float, 'Fond de caisse');
  return writeTx(s.db, () => {
    if (currentSession(s, register)) {
      throw new AppError('register_busy', 'Caisse déjà ouverte', 'Une session est déjà ouverte sur ce poste.');
    }
    const id = randomUUID();
    const kind = isOnDuty(s) ? 'garde' : 'jour';
    s.db
      .prepare('INSERT INTO cash_sessions (id, register, opened_by, opened_at, opening_float, kind) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, register, actor, iso(s.clock.now()), input.opening_float, kind);
    s.ledger.append('cash.opened', actor, { session_id: id, register, opening_float: input.opening_float, kind });
    return getCashSession(s, id);
  });
}

/** Session utilisable pour une vente : ouverte, et du même type que la période (jour ou garde). */
export function requireSellableSession(s: Services, id: string): CashSession {
  const c = getCashSession(s, id);
  if (c.closed_at) throw new AppError('invalid_transition', 'Caisse fermée', 'Ouvrez une session de caisse.');
  const duty = isOnDuty(s) ? 'garde' : 'jour';
  if (c.kind !== duty) {
    throw new AppError('invalid_transition', 'Changement de période', `Clôturez la caisse de ${c.kind} avant de vendre en ${duty}.`);
  }
  return c;
}

/** V-08 : fond + espèces encaissées (montants affectés, rendu déduit) des ventes non annulées. */
export function expectedCash(s: Services, sessionId: string): number {
  const c = getCashSession(s, sessionId);
  const r = s.db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS cash FROM payments p JOIN sales sa ON sa.id = p.sale_id
       WHERE sa.cash_session_id = ? AND sa.status = 'completed' AND p.method = 'especes'`,
    )
    .get(sessionId) as { cash: number };
  return c.opening_float + r.cash;
}

/** Fermer sa caisse : son auteur, ou un pharmacien / le titulaire. */
function assertCanClose(s: Services, actor: string, c: CashSession): void {
  if (c.opened_by === actor) return;
  const role = getUser(s, actor).role;
  if (grant(role, 'cost.view') === '-') {
    throw new AppError('forbidden', 'Caisse d’un autre utilisateur', 'Seul son auteur, un pharmacien ou le titulaire la clôture.');
  }
}

/** V-08 : clôture avec espèces comptées, écart, événement `cash.closed` puis point de contrôle (J-03). */
export function closeCashSession(
  s: Services,
  actor: string,
  id: string,
  input: { counted_cash: number; note?: string | null },
): CashSession {
  assertAmount(input.counted_cash, 'Espèces comptées');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) || null : null;
  return writeTx(s.db, () => {
    const c = getCashSession(s, id);
    if (c.closed_at) throw new AppError('invalid_transition', 'Caisse déjà clôturée');
    assertCanClose(s, actor, c);
    const expected = expectedCash(s, id);
    const variance = input.counted_cash - expected;
    s.db
      .prepare(
        `UPDATE cash_sessions SET closed_by = ?, closed_at = ?, counted_cash = ?, expected_cash = ?, variance = ?, note = ?
         WHERE id = ?`,
      )
      .run(actor, iso(s.clock.now()), input.counted_cash, expected, variance, note, id);
    s.ledger.append('cash.closed', actor, {
      session_id: id, register: c.register, kind: c.kind, opening_float: c.opening_float,
      counted: input.counted_cash, expected, variance,
    });
    s.ledger.checkpoint();
    return getCashSession(s, id);
  });
}

export function listCashSessions(s: Services, opts: { user_id?: string; limit?: number } = {}): CashSession[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  return s.db
    .prepare(`${SESSION_SQL} WHERE (? IS NULL OR c.opened_by = ?) ORDER BY c.opened_at DESC LIMIT ?`)
    .all(opts.user_id ?? null, opts.user_id ?? null, limit) as CashSession[];
}
