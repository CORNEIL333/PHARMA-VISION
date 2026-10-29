/**
 * B-01, B-03 : sauvegarde immédiate en ligne de commande (le service peut tourner : SQLite en WAL).
 *   npm run backup -- --data ./data-local
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { systemClock } from '../server/src/clock.js';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db/index.js';
import { createBackup } from '../server/src/domain/backup.js';
import { Ledger } from '../server/src/domain/ledger.js';
import { loadNodeKeys, paths } from '../server/src/security/keys.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: process.env.VP_DATA_DIR ?? './data-local' } } });
const dataDir = path.resolve(values.data!);
const keys = loadNodeKeys(dataDir);
const db = openDb(paths(dataDir).db);
const ledger = new Ledger(db, { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey }, systemClock);
try {
  const r = await createBackup({ db, ledger, clock: systemClock, keys, config: { ...loadConfig({ VP_DATA_DIR: dataDir }), dataDir } }, null, 'manual');
  console.log(JSON.stringify(r, null, 2));
  if (r.mirror === 'absent' || r.mirror === 'error') console.warn(`ALERTE : copie miroir ${r.mirror}.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  db.close();
}
