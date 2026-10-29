import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { openDb, writeTx, type DB } from '../src/db/index.js';
import { AppError } from '../src/errors.js';
import { Ledger } from '../src/domain/ledger.js';
import { appendStockEvent, enterLot, withdrawFefo, type Movement } from '../src/domain/stock.js';
import { loadNodeKeys } from '../src/security/keys.js';
import type { Services } from '../src/services.js';
import { FixedClock } from '../src/clock.js';

/** Application de test complète : les routes du stock sont montées par buildApp. */
export { makeApp as makeStockApp } from './helpers.js';

/** Aides du module Stock (J4) : préparation d'état et course réelle à deux processus (S-04). */

export interface SeedLot {
  id: string;
  productId: string;
  lotNumber: string;
  expiry?: string | null;
  unitCost?: number | null;
  isRegul?: number;
}

/** Insère un lot vide directement en base (aucune règle métier testée ici). */
export function seedLot(db: DB, l: SeedLot, at = '2026-10-27T08:00:00.000Z'): void {
  db.prepare(
    'INSERT INTO lots (id, product_id, lot_number, expiry, unit_cost, is_regul, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(l.id, l.productId, l.lotNumber, l.expiry ?? null, l.unitCost ?? null, l.isRegul ?? 0, at);
}

export interface ReceiveInput {
  productId: string;
  lotNumber: string;
  expiry?: string | null;
  unitCost?: number | null;
  qty: number;
  /** R-05 : confirmation d'un lot qui périme dans moins de 90 jours. */
  confirmNearExpiry?: boolean;
}

/** Entrée de stock « comme une réception » : entrée de lot + événement reception.recorded, une transaction. */
export function receive(s: Services, actor: string, input: ReceiveInput): { lotId: string; movement: Movement } {
  return writeTx(s.db, () => {
    const r = enterLot(
      s,
      actor,
      {
        product_id: input.productId,
        lot_number: input.lotNumber,
        expiry: input.expiry ?? null,
        unit_cost: input.unitCost ?? null,
        qty: input.qty,
        kind: 'reception',
        ref_type: 'test',
        ref_id: null,
        reason: null,
        confirm_near_expiry: input.confirmNearExpiry ?? false,
      },
      'reception',
    );
    appendStockEvent(s, 'reception.recorded', actor, { lines: [] }, [r.movement]);
    return { lotId: r.lot.id, movement: r.movement };
  });
}

export function lotQty(db: DB, lotId: string): number {
  const r = db.prepare('SELECT qty FROM lot_stock WHERE lot_id = ?').get(lotId) as { qty: number } | undefined;
  if (!r) throw new Error(`lot ${lotId} inconnu`);
  return r.qty;
}

export function payloadsOf(db: DB, type: string): Record<string, unknown>[] {
  return (db.prepare('SELECT payload FROM events WHERE type = ? ORDER BY seq').all(type) as { payload: string }[]).map(
    (e) => JSON.parse(e.payload) as Record<string, unknown>,
  );
}

export function movementsOf(db: DB, lotId: string): { qty: number; kind: string; event_seq: number }[] {
  return db
    .prepare('SELECT qty, kind, event_seq FROM stock_movements WHERE lot_id = ? ORDER BY rowid')
    .all(lotId) as { qty: number; kind: string; event_seq: number }[];
}

// ---------------------------------------------------------------- S-04 : course réelle à deux processus

export interface RaceArgs {
  dir: string;
  productId: string;
  userId: string;
  qty: number;
}

export type RaceResult = { ok: true; lots: string[] } | { ok: false; code: string };

const THIS_FILE = fileURLToPath(import.meta.url);

/**
 * Lance `n` processus Node indépendants (connexions SQLite distinctes) qui tentent, au même signal,
 * de prélever `qty` unités en FEFO. Chaque processus écrit dans sa propre transaction BEGIN IMMEDIATE.
 */
export async function raceFefo(args: RaceArgs, n = 2): Promise<RaceResult[]> {
  const children: ChildProcess[] = [];
  const results: Promise<RaceResult>[] = [];
  for (let i = 0; i < n; i++) {
    const child = fork(THIS_FILE, [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, VP_RACE_CHILD: '1', VP_RACE_ARGS: JSON.stringify(args) },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    children.push(child);
    results.push(waitForResult(child));
  }
  await Promise.all(children.map((c) => waitForMessage(c, 'ready')));
  for (const c of children) c.send('go');
  return Promise.all(results);
}

function waitForMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMsg = (m: unknown) => {
      if (m === expected) {
        child.off('message', onMsg);
        resolve();
      }
    };
    child.on('message', onMsg);
    child.once('exit', (code) => reject(new Error(`processus terminé (${code}) avant « ${expected} »`)));
  });
}

function waitForResult(child: ChildProcess): Promise<RaceResult> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('message', (m: unknown) => {
      if (typeof m === 'object' && m !== null && 'ok' in m) resolve(m as RaceResult);
    });
    child.once('exit', (code) => {
      if (code !== 0) reject(new Error(`processus de course terminé avec ${code}\n${stderr}`));
    });
  });
}

/** Corps du processus enfant : ouvre sa propre connexion et vend au signal « go ». */
function runRaceChild(): void {
  const args = JSON.parse(process.env.VP_RACE_ARGS ?? '{}') as RaceArgs;
  const db = openDb(path.join(args.dir, 'officine.db'));
  const keys = loadNodeKeys(args.dir);
  const clock = new FixedClock('2026-10-27T09:00:00.000Z');
  const s: Services = {
    db,
    ledger: new Ledger(db, { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey }, clock),
    clock,
    keys,
    config: { ...loadConfig({ VP_DATA_DIR: args.dir }), dataDir: args.dir },
  };
  const finish = (r: RaceResult) => {
    db.close();
    process.send?.(r, () => process.exit(0));
  };
  process.on('message', (m) => {
    if (m !== 'go') return;
    try {
      const lots = writeTx(db, () => {
        const movements = withdrawFefo(s, {
          product_id: args.productId,
          qty: args.qty,
          kind: 'sale',
          ref_type: 'race',
          ref_id: null,
          user_id: args.userId,
        });
        appendStockEvent(s, 'sale.completed', args.userId, { sale_id: 'race' }, movements);
        return movements.map((m) => m.lot_id);
      });
      finish({ ok: true, lots });
    } catch (e) {
      if (e instanceof AppError) finish({ ok: false, code: e.code });
      else throw e;
    }
  });
  process.send?.('ready');
}

if (process.env.VP_RACE_CHILD === '1' && process.send) runRaceChild();
