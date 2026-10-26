/**
 * I-01 : initialisation du nœud.
 *   npm run init -- --data ./data-local [--name officine.local] [--ip 192.168.1.10] [--force]
 * Affiche UNE SEULE FOIS la clé de récupération (I-03) : à recopier sur papier, à conserver hors de l'officine.
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { openDb, schemaVersion } from '../server/src/db/index.js';
import { initNode, lanNames, paths } from '../server/src/security/keys.js';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: process.env.VP_DATA_DIR ?? './data-local' },
    name: { type: 'string', multiple: true },
    ip: { type: 'string', multiple: true },
    force: { type: 'boolean', default: false },
  },
});

const dataDir = path.resolve(values.data!);
const extra = [...(values.name ?? []), ...(values.ip ?? [])];
const names = [...new Set([...extra, ...lanNames()])];

try {
  const r = initNode(dataDir, new Date(), { force: values.force, names });
  const db = openDb(paths(dataDir).db);
  const schema = schemaVersion(db);
  db.close();
  const line = '─'.repeat(72);
  console.log(`
${line}
 VisionPharma Officine — nœud initialisé
${line}
 Répertoire        : ${dataDir}
 Identifiant nœud  : ${r.identity.node_id}
 Clé du nœud (kid) : ${r.identity.kid}
 Schéma            : ${schema}
 Noms du certificat: ${r.tlsNames.join(', ')}

 EMPREINTE DE L'AUTORITÉ LOCALE (à vérifier sur chaque poste) :
   ${r.caFingerprint}

 CLÉ DE RÉCUPÉRATION — affichée UNE SEULE FOIS :
   ${r.recoveryKey}

 → Recopiez-la sur papier et rangez-la HORS de l'officine.
 → Elle sera demandée à la configuration initiale, puis pour restaurer
   une sauvegarde sur une nouvelle machine.
${line}
`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
