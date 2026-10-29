import { buildApp } from './app.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { resolveTls, TLS12_CIPHERS } from './tls.js';
import { openDb, writeTx } from './db/index.js';
import { applyPendingRestore, recordAppliedRestore } from './domain/backup.js';
import { Ledger } from './domain/ledger.js';
import { loadStockPolicy } from './domain/stock.js';
import { scheduleDailyBackup } from './jobs/backup.js';
import { scheduleCloudSync } from './cloud/cycle.js';
import { scheduleDailyCatalogSweep } from './jobs/catalog.js';
import { scheduleDailyCheckpoint } from './jobs/checkpoints.js';
import { checkKeyPermissions, loadNodeKeys, paths } from './security/keys.js';
import type { Services } from './services.js';

async function start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadConfig(env);
  // B-04 : une restauration mise en attente est appliquée AVANT d'ouvrir la base et de charger les clés.
  const restored = applyPendingRestore(config.dataDir, new Date());
  const warnings = checkKeyPermissions(config.dataDir);
  const keys = loadNodeKeys(config.dataDir);
  const db = openDb(paths(config.dataDir).db);
  const ledger = new Ledger(
    db,
    { nodeId: keys.identity.node_id, kid: keys.identity.kid, privateKey: keys.privateKey },
    systemClock,
    config.checkpointEvery,
  );
  const s: Services = { db, ledger, clock: systemClock, keys, config, stockPolicy: loadStockPolicy(env) };
  let shutdown: (sig: string) => Promise<void> = async () => undefined;
  s.requestRestart = (reason) => void shutdown(`redémarrage demandé (${reason})`);
  recordAppliedRestore(s);
  const tls = resolveTls(config);

  const app = await buildApp(s, {
    logger: {
      level: config.logLevel,
      // Jamais de secret ni de donnée de santé dans les journaux techniques (GUARDRAILS 15).
      redact: [
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'req.headers.authorization',
        'req.headers["x-vp-device"]',
        'res.headers["set-cookie"]',
      ],
    },
    ...(tls
      ? { https: { ...tls, minVersion: 'TLSv1.2' as const, ciphers: TLS12_CIPHERS, honorCipherOrder: true } }
      : {}),
  });
  for (const w of warnings) app.log.warn(w);
  if (restored) app.log.warn(`Restauration appliquée : ${restored.archive} (seq ${restored.last_seq})`);
  if (!tls) app.log.warn('VP_REQUIRE_TLS=false : serveur en HTTP SIMPLE. Interdit en production (I-05).');

  const stopJob = scheduleDailyCheckpoint(s, (e) => app.log.error({ err: e }, 'point de contrôle quotidien'));
  const stopCatalogJob = scheduleDailyCatalogSweep(s, (e) =>
    app.log.error({ err: e }, 'mise en sommeil du catalogue'),
  );
  const stopBackupJob = scheduleDailyBackup(
    s,
    (r) => app.log.info({ backup: r }, 'sauvegarde quotidienne'),
    (e) => app.log.error({ err: e }, 'sauvegarde quotidienne'),
  );
  // NO-01 : aucune connexion sortante tant que le titulaire n'a pas activé la synchronisation.
  const cloud = scheduleCloudSync(s, (e) => app.log.error({ err: e }, 'synchronisation cloud'));
  s.cloudSync = cloud.now;
  shutdown = async (sig: string) => {
    app.log.info(`${sig} : arrêt propre`);
    stopJob();
    stopCatalogJob();
    stopBackupJob();
    cloud.stop();
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
