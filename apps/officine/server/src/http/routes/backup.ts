import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { backupPath, createBackup, lastBackup, listBackups, stageRestore } from '../../domain/backup.js';
import { exportQueue } from '../../domain/ledgerExport.js';
import { paths } from '../../security/keys.js';
import type { Services } from '../../services.js';
import { actorOf } from '../actor.js';
import { Obj } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const BackupT = Obj({ file: Type.String(), size: Type.Integer(), created_at: Type.String(), last_seq: Type.Integer() });

/** B-01 à B-04, J-05 : sauvegardes, restauration, file d'envoi et son export signé. */
export function backupRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/system/backups', {
    config: { permission: 'backup.create' },
    schema: {
      response: {
        200: Obj({
          items: Type.Array(BackupT),
          last: Type.Union([Obj({ at: Type.String(), file: Type.String(), mirror: Type.String() }), Type.Null()]),
          mirror_dir: NullableString,
        }),
      },
    },
  }, async () => ({
    items: listBackups(paths(s.config.dataDir).backups),
    last: lastBackup(s),
    mirror_dir: (s.db.prepare("SELECT value FROM settings WHERE key = 'backup_mirror_dir'").get() as { value: string } | undefined)?.value ?? null,
  }));

  app.post('/api/v1/system/backups', {
    config: { permission: 'backup.create' },
    schema: { response: { 201: Obj({ file: Type.String(), size: Type.Integer(), created_at: Type.String(), last_seq: Type.Integer(), mirror: Type.String(), sha256: Type.String() }) } },
  }, async (req, reply) => reply.status(201).send(await createBackup(s, actorOf(req), 'manual')));

  // B-04 : vérification complète puis remplacement au redémarrage du service (systemd Restart=always).
  app.post('/api/v1/system/restore', {
    config: { permission: 'backup.restore' },
    schema: {
      body: Obj({ file: Type.String({ minLength: 1, maxLength: 120 }) }),
      response: { 202: Obj({ archive: Type.String(), last_seq: Type.Integer(), restart: Type.Boolean() }) },
    },
  }, async (req, reply) => {
    const file = backupPath(s.config.dataDir, (req.body as { file: string }).file);
    const pending = stageRestore(s.config.dataDir, file, { dataKey: s.keys.dataKey }, actorOf(req), s.clock.now());
    reply.raw.once('finish', () => s.requestRestart?.('restauration'));
    return reply.status(202).send({ archive: pending.archive, last_seq: pending.last_seq, restart: Boolean(s.requestRestart) });
  });

  app.get('/api/v1/system/queue', {
    config: { permission: 'ledger.verify' },
    schema: { response: { 200: Obj({ pending: Type.Integer(), oldest_seq: Type.Union([Type.Integer(), Type.Null()]), head_seq: Type.Integer() }) } },
  }, async () => {
    const r = s.db.prepare('SELECT COUNT(*) AS n, MIN(seq) AS oldest FROM events WHERE synced_at IS NULL').get() as { n: number; oldest: number | null };
    return { pending: r.n, oldest_seq: r.oldest, head_seq: s.ledger.head().seq };
  });

  app.post('/api/v1/system/ledger-export', {
    config: { permission: 'ledger.export' },
    schema: { response: { 200: { content: { 'application/x-ndjson': { schema: Type.String() } } } } },
  }, async (req, reply) => {
    const e = exportQueue(s, actorOf(req));
    return reply
      .type('application/x-ndjson; charset=utf-8')
      .header('content-disposition', `attachment; filename="${e.filename}"`)
      .header('x-vp-sha256', e.sha256)
      .send(e.body);
  });
}
