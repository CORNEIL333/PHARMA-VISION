import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { schemaVersion, writeTx } from '../../db/index.js';
import { AppError } from '../../errors.js';
import { completeSetup, isSetupDone } from '../../domain/setup.js';
import { verifyLedger } from '../../domain/verify.js';
import { newTotpSecret, otpauthUri } from '../../security/totp.js';
import type { Services } from '../../services.js';
import { setSessionCookie } from '../cookies.js';
import { DisplayName, Obj, Password, TotpCode, Username } from '../schemas.js';

export const VERSION = '0.1.0';

export function systemRoutes(app: FastifyInstance, s: Services): void {
  app.get(
    '/api/v1/health',
    {
      config: { permission: 'public', beforeSetup: true },
      schema: {
        response: {
          200: Type.Object({
            status: Type.Literal('ok'),
            version: Type.String(),
            schema: Type.Integer(),
            setup_done: Type.Boolean(),
            last_seq: Type.Integer(),
            last_checkpoint_age_s: Type.Union([Type.Integer(), Type.Null()]),
            last_backup_age_s: Type.Union([Type.Integer(), Type.Null()]),
          }),
        },
      },
    },
    async () => {
      const cp = s.ledger.lastCheckpoint();
      const now = s.clock.now().getTime();
      return {
        status: 'ok' as const,
        version: VERSION,
        schema: schemaVersion(s.db),
        setup_done: isSetupDone(s),
        last_seq: s.ledger.head().seq,
        last_checkpoint_age_s: cp ? Math.floor((now - Date.parse(cp.at)) / 1000) : null,
        last_backup_age_s: null, // B-01 : renseigné quand la sauvegarde sera construite (J9)
      };
    },
  );

  app.get(
    '/api/v1/setup/status',
    {
      config: { permission: 'public', beforeSetup: true },
      schema: {
        response: {
          200: Type.Object({
            setup_done: Type.Boolean(),
            ca_fingerprint: Type.Union([Type.String(), Type.Null()]),
            pharmacy_name: Type.Union([Type.String(), Type.Null()]),
          }),
        },
      },
    },
    async () => {
      const name = s.db.prepare("SELECT value FROM settings WHERE key = 'pharmacy_name'").get() as
        { value: string } | undefined;
      return {
        setup_done: isSetupDone(s),
        ca_fingerprint: s.keys.caFingerprint,
        pharmacy_name: name?.value ?? null,
      };
    },
  );

  // Secret TOTP proposé pour l'enrôlement du titulaire ; n'est conservé qu'à la fin de la configuration.
  app.get(
    '/api/v1/setup/totp-secret',
    {
      config: { permission: 'public', beforeSetup: true, rateLimited: true },
      schema: { response: { 200: Type.Object({ secret: Type.String(), otpauth_uri: Type.String() }) } },
    },
    async () => {
      if (isSetupDone(s)) throw new AppError('setup_done', 'Configuration déjà faite');
      const secret = newTotpSecret();
      return { secret, otpauth_uri: otpauthUri(secret, 'titulaire') };
    },
  );

  app.post(
    '/api/v1/setup',
    {
      config: { permission: 'public', beforeSetup: true, rateLimited: true },
      schema: {
        body: Obj({
          pharmacy_name: Type.String({ minLength: 2, maxLength: 120 }),
          username: Username,
          display_name: DisplayName,
          password: Password,
          recovery_key: Type.String({ minLength: 40, maxLength: 80 }),
          totp_secret: Type.String({ pattern: '^[A-Z2-7]{32}$' }),
          totp_code: TotpCode,
        }),
        response: { 201: Type.Object({ user_id: Type.String(), csrf: Type.String() }) },
      },
    },
    async (req, reply) => {
      const body = req.body as Parameters<typeof completeSetup>[1];
      const r = await completeSetup(s, body, { ip: req.ip, userAgent: req.headers['user-agent'] ?? null });
      setSessionCookie(reply, r.token, s);
      return reply.status(201).send({ user_id: r.userId, csrf: r.csrf });
    },
  );

  app.get(
    '/api/v1/system/info',
    {
      config: { permission: 'ledger.verify' },
      schema: {
        response: {
          200: Type.Object({
            node_id: Type.String(),
            kid: Type.String(),
            public_key_pem: Type.String(),
            ca_fingerprint: Type.Union([Type.String(), Type.Null()]),
            version: Type.String(),
            schema: Type.Integer(),
          }),
        },
      },
    },
    async () => ({
      node_id: s.keys.identity.node_id,
      kid: s.keys.identity.kid,
      public_key_pem: s.keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ca_fingerprint: s.keys.caFingerprint,
      version: VERSION,
      schema: schemaVersion(s.db),
    }),
  );

  app.post(
    '/api/v1/system/verify-ledger',
    {
      config: { permission: 'ledger.verify' },
      schema: {
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            events: Type.Optional(Type.Integer()),
            checkpoints: Type.Optional(Type.Integer()),
            seq: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
            defect: Type.Optional(Type.String()),
            detail: Type.Optional(Type.String()),
          }),
        },
      },
    },
    async () => {
      // Point de contrôle avant vérification : la tête du journal est scellée.
      writeTx(s.db, () => s.ledger.checkpoint());
      return verifyLedger(s.db, s.keys.identity.node_id, new Map([[s.keys.identity.kid, s.keys.publicKey]]));
    },
  );
}
