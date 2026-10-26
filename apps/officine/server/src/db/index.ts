import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../errors.js';

export type DB = Database.Database;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Ouvre la base avec les pragmas imposés (spec §2) et applique les migrations. */
export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('trusted_schema = OFF');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: number }).version),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const version = Number(f.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        f,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function schemaVersion(db: DB): number {
  const r = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return r.v ?? 0;
}

/**
 * Exécute fn dans une transaction BEGIN IMMEDIATE (verrou d'écriture pris tout de suite).
 * Toute écriture métier passe par ici (GUARDRAILS 6).
 */
export function writeTx<T>(db: DB, fn: () => T): T {
  if (db.inTransaction) throw new Error('Transaction imbriquée interdite');
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (e) {
    if (isBusy(e)) throw new AppError('db_busy', 'Base occupée', 'La base est occupée ; réessayez.');
    throw e;
  }
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    if (db.inTransaction) db.exec('ROLLBACK');
    if (isBusy(e)) throw new AppError('db_busy', 'Base occupée', 'La base est occupée ; réessayez.');
    throw e;
  }
}

function isBusy(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    String((e as { code: unknown }).code).startsWith('SQLITE_BUSY')
  );
}
