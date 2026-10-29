import { randomUUID } from 'node:crypto';
import { iso } from '../clock.js';
import { writeTx } from '../db/index.js';
import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getUser } from './users.js';

export interface DutyInput {
  starts_at: string;
  ends_at: string;
}
export interface DutyPeriod extends DutyInput {
  id: string;
  created_by: string;
  created_at: string;
}

/** Strict real calendar timestamp with a timezone, normalized to millisecond UTC for SQLite ordering. */
function normalizeInstant(value: string): string {
  const syntax = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  if (!syntax.test(value)) throw new AppError('validation_failed', 'Date avec fuseau horaire requise');
  const instant = Date.parse(value);
  const wall = Date.parse(value.slice(0, 19) + 'Z');
  if (!Number.isFinite(instant) || !Number.isFinite(wall) ||
      iso(new Date(wall)).slice(0, 19) !== value.slice(0, 19)) {
    throw new AppError('validation_failed', 'Date de garde invalide');
  }
  const normalized = iso(new Date(instant));
  if (normalized.length !== 24) throw new AppError('validation_failed', 'Année de garde invalide');
  return normalized;
}

/** G-01: authorization/reauth uses settings.edit in HTTP; enforce titulaire on domain writes too. */
export function declareDuty(s: Services, actor: string, input: DutyInput): DutyPeriod {
  const starts_at = normalizeInstant(input.starts_at);
  const ends_at = normalizeInstant(input.ends_at);
  if (starts_at >= ends_at) throw new AppError('validation_failed', 'La fin doit être postérieure au début');
  return writeTx(s.db, () => {
    const user = getUser(s, actor);
    if (!user.active || user.role !== 'titulaire') throw new AppError('forbidden', 'Action réservée au titulaire');
    const period: DutyPeriod = {
      id: randomUUID(), starts_at, ends_at, created_by: actor, created_at: iso(s.clock.now()),
    };
    s.db.prepare('INSERT INTO duty_periods (id, starts_at, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(period.id, starts_at, ends_at, actor, period.created_at);
    s.ledger.append('duty.declared', actor, { duty_id: period.id, starts_at, ends_at });
    return period;
  });
}

export function listDuty(s: Services): DutyPeriod[] {
  return s.db.prepare('SELECT id, starts_at, ends_at, created_by, created_at FROM duty_periods ORDER BY starts_at DESC, id')
    .all() as DutyPeriod[];
}

/** G-01: half-open intervals [start, end); overlapping declarations form a union, with no writes. */
export function isOnDuty(s: Services): boolean {
  const now = iso(s.clock.now());
  return !!s.db.prepare('SELECT 1 FROM duty_periods WHERE starts_at <= ? AND ends_at > ? LIMIT 1').get(now, now);
}
