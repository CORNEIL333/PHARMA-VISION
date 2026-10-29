import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { declareDuty, listDuty, type DutyInput } from '../../domain/duty.js';
import type { Services } from '../../services.js';
import { actorOf } from '../actor.js';
import { Obj } from '../schemas.js';

const DutyT = Obj({
  id: Type.String(),
  starts_at: Type.String(),
  ends_at: Type.String(),
  created_by: Type.String(),
  created_at: Type.String(),
});

/** G-01 : périodes de garde, déclarées par le titulaire (paramètre de l'officine, R). */
export function dutyRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/duty', {
    config: { permission: 'settings.edit' },
    schema: { response: { 200: Type.Array(DutyT) } },
  }, async () => listDuty(s));

  app.post('/api/v1/duty', {
    config: { permission: 'settings.edit' },
    schema: {
      body: Obj({ starts_at: Type.String({ maxLength: 40 }), ends_at: Type.String({ maxLength: 40 }) }),
      response: { 201: DutyT },
    },
  }, async (req, reply) => reply.status(201).send(declareDuty(s, actorOf(req), req.body as DutyInput)));
}
