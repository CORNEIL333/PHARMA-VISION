import { buildApp } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { resolveTls, TLS12_CIPHERS } from './tls.js';
import { openDb, writeTx } from './db/index.js';
import { Ledger } from './domain/ledger.js';
import { scheduleDailyCatalogSweep } from './jobs/catalog.js';
import { scheduleDailyCheckpoint } from './jobs/checkpoints.js';
import { checkKeyPermissions, loadNodeKeys, paths } from './security/keys.js';
import type { Services } from './services.js';

async function start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadConfig(env);
  const warnings = checkKeyPermissions(config.dataDir);
  const keys = loadNodeKeys(config.dataDir);
  const db = openDb(paths(config.dataDir).db);
  const ledger = new Ledger(
    db,
    { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey },
    systemClock,
    config.checkpointEvery,
  );
  const s: Services = { db, ledger, clock: systemClock, keys, config };
  const tls = resolveTls(config);

  const app = await buildApp(s, {
    logger: {
      level: config.logLevel,
      // Jamais de secret ni de donnée de santé dans les journaux techniques (GUARDRAILS 15).
      redact: [
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
      ],
    },
    ...(tls
      ? { https: { ...tls, minVersion: 'TLSv1.2' as const, ciphers: TLS12_CIPHERS, honorCipherOrder: true } }
      : {}),
  });
  for (const w of warnings) app.log.warn(w);
  if (!tls) app.log.warn('VP_REQUIRE_TLS=false : serveur en HTTP SIMPLE. Interdit en production (I-05).');

  const stopJob = scheduleDailyCheckpoint(s, (e) => app.log.error({ err: e }, 'point de contrôle quotidien'));
  const stopCatalogJob = scheduleDailyCatalogSweep(s, (e) =>
    app.log.error({ err: e }, 'mise en sommeil du catalogue'),
  );
  const shutdown = async (sig: string) => {
    app.log.info(`${sig} reçu : arrêt propre`);
    stopJob();
    stopCatalogJob();
    try {
      writeTx(db, () => ledger.checkpoint());
    } catch (e) {
      app.log.error({ err: e }, 'point de contrôle d’arrêt');
    }
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `VisionPharma Officine écoute sur ${tls ? 'https' : 'http'}://${config.host}:${config.port} ; empreinte de l'autorité : ${keys.caFingerprint ?? 'absente'}`,
  );
}

start().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
