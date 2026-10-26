/**
 * I-04 : import du catalogue en ligne de commande (installation, mise à jour du référentiel).
 * Le fichier est lu localement, jamais téléchargé ; l'acteur est le titulaire actif.
 * Codes de sortie : 0 = import complet, 3 = lignes rejetées, 2 = usage, 1 = erreur.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { systemClock } from '../server/src/clock.js';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db/index.js';
import { importCatalog } from '../server/src/domain/catalogImport.js';
import { Ledger } from '../server/src/domain/ledger.js';
import { loadNodeKeys, paths } from '../server/src/security/keys.js';
import type { Services } from '../server/src/services.js';

const MAX_BYTES = 50 * 1024 * 1024;

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    data: { type: 'string', default: process.env.VP_DATA_DIR ?? './data-local' },
  },
});

if (!values.file) {
  console.error('Usage : npm run import-catalog -- --file <catalogue.csv> [--data <répertoire>]');
  process.exit(2);
}

const dataDir = path.resolve(values.data!);
const file = path.resolve(values.file);
const size = statSync(file).size;
if (size > MAX_BYTES) {
  console.error(`Fichier trop volumineux : ${size} octets (limite ${MAX_BYTES}).`);
  process.exit(2);
}

const config = { ...loadConfig({ VP_DATA_DIR: dataDir }), dataDir };
const keys = loadNodeKeys(dataDir);
const db = openDb(paths(dataDir).db);
const ledger = new Ledger(
  db,
  { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey },
  systemClock,
  config.checkpointEvery,
);
const s: Services = { db, ledger, clock: systemClock, keys, config };

const titulaire = db
  .prepare("SELECT id FROM users WHERE role = 'titulaire' AND active = 1 ORDER BY created_at LIMIT 1")
  .get() as { id: string } | undefined;

if (!titulaire) {
  console.error('Aucun titulaire actif : exécutez `npm run init` et terminez la configuration.');
  db.close();
  process.exit(2);
}

try {
  const report = importCatalog(s, titulaire.id, readFileSync(file), path.basename(file));
  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(report.rejected > 0 ? 3 : 0);
} catch (e) {
  db.close();
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
