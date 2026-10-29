/**
 * B-04 : restauration hors ligne (service ARRÊTÉ).
 *   Même machine      : npm run restore -- --data ./data-local --file ./data-local/backups/vp-….vpbak
 *   Nouvelle machine  : npm run init -- --data ./data-neuve   (certificats du nouveau serveur)
 *                       npm run restore -- --data ./data-neuve --file /media/usb/vp-….vpbak --recovery-key XXXX-…
 * Étapes : déchiffrement, vérification complète du journal de l'archive, remplacement atomique
 * (l'existant part dans pre-restore-<horodatage>/), événement system.restored, vérification finale.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { systemClock } from '../server/src/clock.js';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db/index.js';
import { applyPendingRestore, recordAppliedRestore, stageRestore } from '../server/src/domain/backup.js';
import { Ledger } from '../server/src/domain/ledger.js';
import { verifyLedger } from '../server/src/domain/verify.js';
import { loadNodeKeys, paths } from '../server/src/security/keys.js';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: process.env.VP_DATA_DIR ?? './data-local' },
    file: { type: 'string' },
    'recovery-key': { type: 'string' },
  },
});
const dataDir = path.resolve(values.data!);
if (!values.file) {
  console.error('--file obligatoire');
  process.exit(2);
}
if (!existsSync(paths(dataDir).nodeJson)) {
  console.error(`${dataDir} n'est pas initialisé : lancez d'abord « npm run init -- --data ${values.data} ».`);
  process.exit(2);
}
try {
  const key = values['recovery-key'] ? { recoveryKey: values['recovery-key'] } : { dataKey: readFileSync(paths(dataDir).dataKey) };
  const staged = stageRestore(dataDir, path.resolve(values.file), key, null, new Date());
  console.log(`Archive vérifiée : ${staged.archive} (seq ${staged.last_seq}).`);
  applyPendingRestore(dataDir, new Date());
  const keys = loadNodeKeys(dataDir);
  const db = openDb(paths(dataDir).db);
  const ledger = new Ledger(db, { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey }, systemClock);
  recordAppliedRestore({ db, ledger, clock: systemClock, keys, config: { ...loadConfig({ VP_DATA_DIR: dataDir }), dataDir } });
  const check = verifyLedger(db, keys.identity.node_id, new Map([[keys.identity.kid, keys.publicKey]]));
  db.close();
  console.log(JSON.stringify(check, null, 2));
  process.exitCode = check.ok ? 0 : 3;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
