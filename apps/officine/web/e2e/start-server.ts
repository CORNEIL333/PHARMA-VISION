/**
 * Serveur réel pour les tests de bout en bout : nœud initialisé dans un répertoire temporaire,
 * HTTP simple sur 127.0.0.1 (VP_REQUIRE_TLS=false, journalisé ; réservé aux tests), interface buildée.
 * La clé de récupération est écrite dans e2e/.state.json pour que le test de configuration la recopie.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initNode } from '../../server/src/security/keys.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'vp-e2e-'));
const init = initNode(dir, new Date(), { names: ['localhost', '127.0.0.1'] });
writeFileSync(path.join(here, '.state.json'), JSON.stringify({ dataDir: dir, recoveryKey: init.recoveryKey, fingerprint: init.caFingerprint }));

process.env.VP_DATA_DIR = dir;
process.env.VP_REQUIRE_TLS = 'false';
process.env.VP_HOST = '127.0.0.1';
process.env.VP_PORT = process.env.VP_E2E_PORT ?? '18443';
process.env.VP_WEB_DIST = path.resolve(here, '../dist');
process.env.VP_LOG_LEVEL = 'warn';
await import('../../server/src/main.js');
