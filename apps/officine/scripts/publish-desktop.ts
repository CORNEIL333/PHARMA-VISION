/**
 * W-07 : publie sur le serveur local une version signée de l'application de bureau.
 *   npm run publish-desktop -- --data ./data-local --version 0.2.0 --dir <dossier des paquets signés>
 * Le dossier contient les paquets produits par la CI (`tauri build` avec la clé de signature du coffre)
 * et leurs signatures `<paquet>.sig`. Le serveur ne signe rien : il sert ce qui a été signé en CI ;
 * l'application refuse tout paquet dont la signature Ed25519 ne correspond pas à sa clé publique.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { systemClock } from '../server/src/clock.js';
import { openDb, writeTx } from '../server/src/db/index.js';
import { Ledger } from '../server/src/domain/ledger.js';
import { sha256hex } from '../server/src/security/crypto.js';
import { loadNodeKeys, paths } from '../server/src/security/keys.js';

const { values } = parseArgs({
  options: {
    data: { type: 'string', default: process.env.VP_DATA_DIR ?? './data-local' },
    version: { type: 'string' },
    dir: { type: 'string' },
    notes: { type: 'string', default: '' },
  },
});
if (!values.version || !/^\d+\.\d+\.\d+$/.test(values.version) || !values.dir) {
  console.error('Usage : --version X.Y.Z --dir <dossier> [--notes "…"]');
  process.exit(2);
}
const PLATFORM: [RegExp, string][] = [
  [/\.(msi|exe)$/i, 'windows-x86_64'],
  [/\.(deb|AppImage)$/i, 'linux-x86_64'],
  [/\.app\.tar\.gz$/i, 'darwin-aarch64'],
];
const dataDir = path.resolve(values.data!);
const src = path.resolve(values.dir);
const out = path.join(dataDir, 'desktop', 'packages');
mkdirSync(out, { recursive: true, mode: 0o700 });
const platforms: Record<string, { signature: string; url: string }> = {};
const files: { name: string; sha256: string }[] = [];
for (const name of readdirSync(src)) {
  const platform = PLATFORM.find(([re]) => re.test(name))?.[1];
  if (!platform || !existsSync(path.join(src, `${name}.sig`))) continue;
  copyFileSync(path.join(src, name), path.join(out, name));
  platforms[platform] = { signature: readFileSync(path.join(src, `${name}.sig`), 'utf8').trim(), url: name };
  files.push({ name, sha256: sha256hex(readFileSync(path.join(out, name))) });
}
if (files.length === 0) {
  console.error('Aucun paquet signé (<paquet> + <paquet>.sig) dans ce dossier.');
  process.exit(2);
}
writeFileSync(path.join(dataDir, 'desktop', 'latest.json'), JSON.stringify({
  version: values.version, notes: values.notes, pub_date: new Date().toISOString(), platforms,
}, null, 2));
const keys = loadNodeKeys(dataDir);
const db = openDb(paths(dataDir).db);
const ledger = new Ledger(db, { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey }, systemClock);
writeTx(db, () => ledger.append('device.update_published', null, { version: values.version!, files }));
db.close();
console.log(`Version ${values.version} publiée : ${files.map((f) => f.name).join(', ')}`);
