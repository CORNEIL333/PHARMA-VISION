/** J-04 : vérification du journal en ligne de commande. Code de sortie 0 = ok, 2 = défaut détecté. */
import { parseArgs } from 'node:util';
import path from 'node:path';
import Database from 'better-sqlite3';
import { verifyLedger } from '../server/src/domain/verify.js';
import { loadNodeKeys, paths } from '../server/src/security/keys.js';

const { values } = parseArgs({
  options: { data: { type: 'string', default: process.env.VP_DATA_DIR ?? './data-local' } },
});
const dataDir = path.resolve(values.data!);
const keys = loadNodeKeys(dataDir);
const db = new Database(paths(dataDir).db, { readonly: true, fileMustExist: true });
const t0 = Date.now();
const r = verifyLedger(db, keys.identity.node_id, new Map([[keys.identity.kid, keys.publicKey]]));
db.close();
console.log(JSON.stringify({ ...r, duration_ms: Date.now() - t0 }, null, 2));
process.exit(r.ok ? 0 : 2);
