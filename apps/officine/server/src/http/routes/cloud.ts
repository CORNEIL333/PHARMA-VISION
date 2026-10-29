import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { cloudStatus, syncCycle } from '../../cloud/cycle.js';
import { enrol } from '../../cloud/sync.js';
import type { Services } from '../../services.js';
import { actorOf } from '../actor.js';
import { Obj } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const StatusT = Obj({
  enabled: Type.Boolean(), configured: Type.Boolean(), enrolled: Type.Boolean(), pharmacy_id: NullableString, url: NullableString,
  last_sync_at: NullableString, last_attempt_at: NullableString, last_error: NullableString, queue: Type.Integer(),
  referential_version: Type.Integer(), recall_version: Type.Integer(),
  recalls: Type.Array(Obj({
    cloud_id: Type.String(), ref_code: Type.String(), lot_number: NullableString, active: Type.Boolean(), applied: Type.Boolean(),
    acked_at: NullableString, received_at: Type.String(),
  })),
});

/** NO-01, NO-05 : état de la synchronisation, enrôlement (titulaire ré-authentifié), cycle immédiat. */
export function cloudRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/cloud/status', {
    config: { permission: 'ledger.verify' },
    schema: { response: { 200: StatusT } },
  }, async () => cloudStatus(s));

  app.post('/api/v1/cloud/enrol', {
    config: { permission: 'settings.edit' },
    schema: {
      body: Obj({ token: Type.String({ minLength: 20, maxLength: 100 }) }),
      response: { 200: Obj({ pharmacy_id: Type.String(), enrolled_at: Type.String() }) },
    },
  }, async (req) => {
    const e = await enrol(s, actorOf(req), (req.body as { token: string }).token);
    return { pharmacy_id: e.pharmacy_id, enrolled_at: e.enrolled_at };
  });

  app.post('/api/v1/cloud/sync-now', {
    config: { permission: 'ledger.verify' },
    schema: {
      response: { 200: Obj({ ran: Type.Boolean(), recalls: Type.Integer(), sent: Type.Integer(), versions: Type.Integer(), error: NullableString }) },
    },
  }, async () => (s.cloudSync ? s.cloudSync() : syncCycle(s)));
}
