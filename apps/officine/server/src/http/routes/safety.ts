import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../../domain/auth.js';
import {
  createPrescription, getPrescription, MAX_IMAGE_BYTES, prescriptionImage, type PrescriptionInput,
} from '../../domain/prescriptions.js';
import { closeRecall, createRecall, getRecall, importRecalls, listRecalls, RECALL_SOURCES, type RecallInput } from '../../domain/recalls.js';
import { AppError } from '../../errors.js';
import type { Services } from '../../services.js';
import { actorOf } from '../actor.js';
import { Obj, Password, TotpCode, Uuid, Username } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const IdParams = Obj({ id: Uuid });
const Opt = (max: number) => Type.Optional(Type.Union([Type.String({ maxLength: max }), Type.Null()]));
/** Photo en base64 : 8 Mo de binaire, soit environ 11,2 Mo de texte. */
const IMAGE_BODY_LIMIT = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;

const PrescriptionFields = {
  prescriber_name: Type.String({ minLength: 1, maxLength: 120 }),
  prescriber_reg: Opt(40),
  issued_on: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
  patient_ref: Opt(40),
  notes: Opt(1000),
  image_base64: Opt(IMAGE_BODY_LIMIT),
  age_override_reason: Opt(500),
};
const PrescriptionT = Obj({
  id: Type.String(), prescriber_name: Type.String(), prescriber_reg: NullableString, issued_on: Type.String(),
  patient_ref: NullableString, notes: NullableString, has_image: Type.Boolean(), age_days: Type.Integer(),
  age_override_reason: NullableString, validated_by: Type.String(), validated_by_name: Type.String(),
  validated_at: Type.String(), sale_id: NullableString,
});
const RecallT = Obj({
  id: Type.String(), reference: Type.String(), product_id: Type.String(), product_name: Type.String(),
  lot_number: NullableString, reason: Type.String(), source: Type.String(), active: Type.Boolean(),
  created_by: Type.String(), created_at: Type.String(), closed_at: NullableString,
  blocked_lots: Type.Array(Obj({ lot_id: Type.String(), lot_number: Type.String(), expiry: NullableString, qty: Type.Integer() })),
});

function prescriptionRoutes(app: FastifyInstance, s: Services, authSvc: AuthService): void {
  app.post('/api/v1/prescriptions', {
    bodyLimit: IMAGE_BODY_LIMIT,
    config: { permission: 'prescription.validate' },
    schema: { body: Obj(PrescriptionFields), response: { 201: PrescriptionT } },
  }, async (req, reply) => reply.status(201).send(createPrescription(s, actorOf(req), req.body as PrescriptionInput)));

  // O-02 : validation par un pharmacien sur le poste du caissier, avec ses propres identifiants.
  app.post('/api/v1/prescriptions/countersigned', {
    bodyLimit: IMAGE_BODY_LIMIT,
    config: { permission: 'sale.sell', rateLimited: true },
    schema: {
      body: Obj({ ...PrescriptionFields, validator: Obj({ username: Username, password: Password, code: Type.Optional(TotpCode) }) }),
      response: { 201: PrescriptionT },
    },
  }, async (req, reply) => {
    const { validator, ...input } = req.body as PrescriptionInput & { validator: { username: string; password: string; code?: string } };
    const id = await authSvc.verifyValidator(validator.username, validator.password, validator.code, {
      ip: req.ip, userAgent: req.headers['user-agent'] ?? null,
    });
    return reply.status(201).send(createPrescription(s, id, input, actorOf(req)));
  });

  app.get('/api/v1/prescriptions/:id', {
    config: { permission: 'prescription.view_image' },
    schema: { params: IdParams, response: { 200: PrescriptionT } },
  }, async (req) => getPrescription(s, (req.params as { id: string }).id));

  app.get('/api/v1/prescriptions/:id/image', {
    config: { permission: 'prescription.view_image' },
    schema: { params: IdParams },
  }, async (req, reply) => {
    const img = prescriptionImage(s, (req.params as { id: string }).id);
    return reply.type(img.mime).header('cache-control', 'no-store').header('content-disposition', 'inline').send(img.bytes);
  });
}

function recallRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/recalls', {
    config: { permission: 'report.stock' },
    schema: {
      querystring: Obj({ active: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])) }),
      response: { 200: Type.Array(RecallT) },
    },
  }, async (req) => listRecalls(s, (req.query as { active?: string }).active === 'true'));

  app.get('/api/v1/recalls/:id', {
    config: { permission: 'report.stock' },
    schema: { params: IdParams, response: { 200: RecallT } },
  }, async (req) => getRecall(s, (req.params as { id: string }).id));

  app.post('/api/v1/recalls', {
    config: { permission: 'recall.create' },
    schema: {
      body: Obj({
        reference: Type.String({ minLength: 1, maxLength: 80 }), product_id: Type.String({ minLength: 1, maxLength: 100 }),
        lot_number: Opt(60), reason: Type.String({ minLength: 1, maxLength: 500 }),
        source: Type.Union(RECALL_SOURCES.map((x) => Type.Literal(x))),
      }),
      response: { 201: RecallT },
    },
  }, async (req, reply) => reply.status(201).send(createRecall(s, actorOf(req), req.body as RecallInput)));

  app.post('/api/v1/recalls/:id/close', {
    config: { permission: 'recall.create' },
    schema: { params: IdParams, body: Obj({ reason: Type.String({ minLength: 1, maxLength: 500 }) }), response: { 200: RecallT } },
  }, async (req) => closeRecall(s, actorOf(req), (req.params as { id: string }).id, (req.body as { reason: string }).reason));

  app.post('/api/v1/recalls/import', {
    bodyLimit: 5 * 1024 * 1024,
    config: { permission: 'recall.create' },
    schema: { response: { 200: Obj({ sha256: Type.String(), created: Type.Integer(), rejected: Type.Array(Obj({ line: Type.Integer(), reason: Type.String() })) }) } },
  }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError('validation_failed', 'Fichier CSV attendu (text/csv)');
    return importRecalls(s, actorOf(req), req.body);
  });
}

/** O-01 à O-06, Q-01 à Q-05. */
export function safetyRoutes(app: FastifyInstance, s: Services, authSvc: AuthService): void {
  prescriptionRoutes(app, s, authSvc);
  recallRoutes(app, s);
}
