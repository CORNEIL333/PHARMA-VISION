import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedClock } from '../src/clock.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { Ledger } from '../src/domain/ledger.js';
import { createSale } from '../src/domain/sales.js';
import { loadNodeKeys } from '../src/security/keys.js';
import type { Services } from '../src/services.js';

/**
 * RC-14 : coupure brutale. Un processus indépendant lance une vente et se tue (SIGKILL) juste après
 * l'écriture de l'événement, au milieu de la transaction : rien n'est validé, rien ne doit rester.
 */
export interface CrashArgs {
  dir: string;
  userId: string;
  sessionId: string;
  productId: string;
}

const THIS_FILE = fileURLToPath(import.meta.url);

export function crashDuringSale(args: CrashArgs): Promise<number | null> {
  return new Promise((resolve) => {
    const child = fork(THIS_FILE, [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, VP_CRASH_CHILD: '1', VP_CRASH_ARGS: JSON.stringify(args) },
      stdio: 'ignore',
    });
    child.once('exit', (code, signal) => resolve(signal ? -1 : code));
  });
}

function runChild(): void {
  const a = JSON.parse(process.env.VP_CRASH_ARGS ?? '{}') as CrashArgs;
  const db = openDb(path.join(a.dir, 'officine.db'));
  const keys = loadNodeKeys(a.dir);
  const clock = new FixedClock('2026-10-27T10:00:00.000Z');
  const ledger = new Ledger(db, { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey }, clock);
  const original = ledger.append.bind(ledger);
  ledger.append = (type, actor, payload) => {
    const ev = original(type, actor, payload);
    if (type === 'sale.completed') process.kill(process.pid, 'SIGKILL');
    return ev;
  };
  const s: Services = { db, ledger, clock, keys, config: { ...loadConfig({ VP_DATA_DIR: a.dir }), dataDir: a.dir } };
  createSale(s, a.userId, { cash_session_id: a.sessionId, lines: [{ product_id: a.productId, qty: 1 }], payments: [{ method: 'especes', amount: 1000 }] });
  process.exit(0);
}

if (process.env.VP_CRASH_CHILD === '1') runChild();
