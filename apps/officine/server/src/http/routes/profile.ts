import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  getProfile, listPayers, PAYER_KINDS, profileStatus, saveSection, savePayer, SECTION_IDS, type PayerInput,
} from '../../domain/profile.js';
import type { Services } from '../../services.js';
import { actorOf } from '../actor.js';
import { Obj, Uuid } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const Scalar = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const SectionT = Obj({
  id: Type.String(),
  data: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  complete: Type.Boolean(),
  missing: Type.Array(Type.String()),
  updated_at: NullableString,
});
const PayerT = Obj({
  id: Type.String(), name: Type.String(), kind: Type.String(), code: NullableString, convention_ref: NullableString,
  default_coverage_pct: Type.Union([Type.Integer(), Type.Null()]), active: Type.Boolean(),
});
const PayerBody = Obj({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  kind: Type.Union(PAYER_KINDS.map((k) => Type.Literal(k))),
  code: Type.Optional(Type.Union([Type.String({ maxLength: 40 }), Type.Null()])),
  convention_ref: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
  default_coverage_pct: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()])),
  active: Type.Optional(Type.Boolean()),
});

/** Dossier d'installation (titulaire ré-authentifié) et organismes de tiers payant. */
export function profileRoutes(app: FastifyInstance, s: Services): void {
  // Avancement seulement (aucune donnée) : sert au bandeau « dossier incomplet ».
  app.get('/api/v1/profile/status', {
    config: { permission: 'session' },
    schema: {
      response: {
        200: Obj({
          complete: Type.Boolean(), done: Type.Integer(), total: Type.Integer(),
          sections: Type.Array(Obj({ id: Type.String(), complete: Type.Boolean() })),
        }),
      },
    },
  }, async () => profileStatus(s));

  app.get('/api/v1/profile', {
    config: { permission: 'settings.edit' },
    schema: { response: { 200: Type.Array(SectionT) } },
  }, async () => getProfile(s));

  app.put('/api/v1/profile/:section', {
    config: { permission: 'settings.edit' },
    schema: {
      params: Obj({ section: Type.Union(SECTION_IDS.map((x) => Type.Literal(x))) }),
      body: Type.Record(Type.String({ maxLength: 40 }), Type.Union([Scalar, Type.Array(Type.Unknown(), { maxItems: 100 }), Type.Record(Type.String(), Type.Unknown())])),
      response: { 200: SectionT },
    },
  }, async (req) => saveSection(s, actorOf(req), (req.params as { section: string }).section, req.body));

  // Lecture des organismes : tout vendeur (sélection au paiement tiers payant).
  app.get('/api/v1/payers', {
    config: { permission: 'sale.sell' },
    schema: { response: { 200: Type.Array(PayerT) } },
  }, async (req) => listPayers(s, (req.query as { all?: string }).all !== 'true'));

  app.post('/api/v1/payers', {
    config: { permission: 'settings.edit' },
    schema: { body: PayerBody, response: { 201: PayerT } },
  }, async (req, reply) => reply.status(201).send(savePayer(s, actorOf(req), req.body as PayerInput)));

  app.put('/api/v1/payers/:id', {
    config: { permission: 'settings.edit' },
    schema: { params: Obj({ id: Uuid }), body: PayerBody, response: { 200: PayerT } },
  }, async (req) => savePayer(s, actorOf(req), req.body as PayerInput, (req.params as { id: string }).id));
}
