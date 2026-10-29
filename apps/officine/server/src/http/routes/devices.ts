import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createPairingCode,
  deviceStatus,
  listDevices,
  pairDevice,
  revokeDevice,
  type PairDeviceInput,
} from '../../domain/devices.js';
import {
  consumeBootToken, DEVICE_COOKIE, deviceSelf, issueBootToken, kioskOf, setKiosk, updateManifest, updatePackage,
} from '../../domain/desktop.js';
import { AppError } from '../../errors.js';
import type { Services } from '../../services.js';
import { Obj, Uuid } from '../schemas.js';

const actor = (request: FastifyRequest): string => {
  if (!request.auth) throw new AppError('unauthenticated', 'Session absente ou expirée');
  return request.auth.userId;
};
const IdParams = Obj({ id: Uuid });
const Platform = Type.Union([Type.Literal('windows'), Type.Literal('linux'), Type.Literal('macos')]);
const NullableTime = Type.Union([Type.String({ format: 'date-time' }), Type.Null()]);
const Device = Obj({
  id: Uuid,
  name: Type.String(),
  platform: Platform,
  app_version: Type.Union([Type.String(), Type.Null()]),
  paired_at: Type.String({ format: 'date-time' }),
  last_seen_at: NullableTime,
  revoked_at: NullableTime,
  kiosk: Type.Boolean(),
});
const SelfT = Obj({ id: Uuid, name: Type.String(), kiosk: Type.Boolean() });

/** Task 14: register after registerHooks and before app.ready; existing device/settings permissions only. */
export function devicesRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/devices/pairing-code', {
    config: { permission: 'device.pairing_code', rateLimited: true },
    schema: { response: { 201: Obj({ code: Type.String({ pattern: '^[0-9]{8}$' }), expires_at: Type.String({ format: 'date-time' }) }) } },
  }, async (req, reply) => reply.status(201).send(createPairingCode(s, actor(req))));

  app.post('/api/v1/devices/pair', {
    config: { permission: 'public', rateLimited: true },
    schema: {
      body: Obj({
        name: Type.String({ minLength: 1, maxLength: 80 }),
        platform: Platform,
        app_version: Type.String({ minLength: 1, maxLength: 40 }),
        // A malformed string still reaches the domain and consumes the live code's failure budget.
        code: Type.String({ maxLength: 128 }),
      }),
      response: { 201: Obj({ id: Uuid, secret: Type.String({ pattern: '^[A-Za-z0-9_-]{43}$' }) }) },
    },
  }, async (req, reply) => reply.status(201).send(pairDevice(s, req.body as PairDeviceInput)));

  app.get('/api/v1/devices/:id/status', {
    config: { permission: 'public', rateLimited: true },
    schema: { params: IdParams, response: { 200: Obj({ status: Type.Union([Type.Literal('active'), Type.Literal('revoked')]) }) } },
  }, async (req) => deviceStatus(s, (req.params as { id: string }).id));

  // Current device.manage is R for titulaire, including reads. Do not silently weaken the matrix.
  app.get('/api/v1/devices', {
    config: { permission: 'device.manage' },
    schema: { response: { 200: Type.Array(Device) } },
  }, async () => {
    const kiosk = kioskOf(s);
    return listDevices(s).map((d) => ({ ...d, kiosk: kiosk.get(d.id) ?? false }));
  });

  app.post('/api/v1/devices/:id/revoke', {
    config: { permission: 'device.manage' },
    schema: {
      params: IdParams,
      response: { 200: Obj({ status: Type.Literal('revoked'), allow_browser_clients: Type.Boolean() }) },
    },
  }, async (req) => revokeDevice(s, actor(req), (req.params as { id: string }).id));

  desktopRoutes(app, s);
}

/** Application de bureau : démarrage du poste (cookie de poste), kiosque (W-08), mises à jour (W-07). */
function desktopRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/devices/session', {
    config: { permission: 'public', rateLimited: true },
    schema: { response: { 200: Obj({ token: Type.String() }) } },
  }, async (req) => issueBootToken(s, req.headers['x-vp-device']));

  app.get('/api/v1/devices/boot', {
    config: { permission: 'public', rateLimited: true },
    schema: { querystring: Obj({ token: Type.String({ minLength: 1, maxLength: 100 }) }) },
  }, async (req, reply) => {
    const secret = consumeBootToken(s, (req.query as { token: string }).token);
    if (!secret) throw new AppError('unauthenticated', 'Jeton de démarrage invalide ou expiré');
    reply.setCookie(DEVICE_COOKIE, secret, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 12 * 3600 });
    return reply.header('referrer-policy', 'no-referrer').redirect('/caisse', 303);
  });

  app.get('/api/v1/devices/self', {
    config: { permission: 'public' },
    schema: { response: { 200: SelfT } },
  }, async (req) => deviceSelf(s, req.headers['x-vp-device'] ?? req.cookies[DEVICE_COOKIE]));

  app.patch('/api/v1/devices/:id', {
    config: { permission: 'device.manage' },
    schema: { params: IdParams, body: Obj({ kiosk: Type.Boolean() }), response: { 200: SelfT } },
  }, async (req) => setKiosk(s, actor(req), (req.params as { id: string }).id, (req.body as { kiosk: boolean }).kiosk));

  app.get('/api/v1/desktop/update', {
    config: { permission: 'public' },
  }, async (req, reply) => {
    const origin = `${req.protocol}://${req.headers.host ?? 'localhost'}`;
    const m = updateManifest(s.config.dataDir, origin);
    return m ? reply.type('application/json').send(m) : reply.status(204).send();
  });

  app.get('/api/v1/desktop/packages/:file', {
    config: { permission: 'public' },
    schema: { params: Obj({ file: Type.String({ minLength: 1, maxLength: 200 }) }) },
  }, async (req, reply) =>
    reply.type('application/octet-stream').send(updatePackage(s.config.dataDir, (req.params as { file: string }).file)));
}
