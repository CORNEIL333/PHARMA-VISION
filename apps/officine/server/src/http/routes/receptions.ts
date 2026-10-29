import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  demandToOrder, listDemand, recordDemand, summarizeDemand, type DemandInput, type DemandListOptions,
} from '../../domain/demand.js';
import {
  getReception, listReceptions, MAX_RECEPTION_LINES, recordReception, returnToSupplier,
  type ReceptionInput, type SupplierReturnInput,
} from '../../domain/receptions.js';
import { MAX_COST, MAX_QTY } from '../../domain/stock.js';
import type { Services } from '../../services.js';
import { actorOf, can } from '../actor.js';
import { Obj, Uuid } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);
const IdParams = Obj({ id: Uuid });
const Ref = Type.String({ minLength: 1, maxLength: 100 });
const Limit = Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' }));
const Cursor = Type.Optional(Type.String({ minLength: 1, maxLength: 400 }));
const When = Type.Optional(Type.String({ maxLength: 40 }));
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const ReceptionT = Obj({
  id: Type.String(), po_id: NullableString, po_number: NullableString, order_status: NullableString,
  supplier_id: NullableString, supplier_name: NullableString, note: NullableString,
  received_by: Type.String(), received_at: Type.String(),
  lines: Type.Array(Obj({
    product_id: Type.String(), product_name: Type.String(), lot_id: Type.String(), lot_number: Type.String(),
    expiry: NullableString, qty: Type.Integer(), unit_cost: Type.Optional(NullableInt),
  })),
});
const DemandT = Obj({
  id: Type.String(), product_id: NullableString, product_name: NullableString, free_text: NullableString,
  qty: Type.Integer(), source: Type.String(), criticity: Type.Integer(), note: NullableString,
  user_id: Type.String(), at: Type.String(), resolved_at: NullableString, resolved_cause: NullableString,
});
const SummaryT = Obj({
  product_id: NullableString, label: Type.String(), criticity: Type.Integer(), requests: Type.Integer(),
  qty: Type.Integer(), open: Type.Integer(), last_at: Type.String(),
});

function receptionRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/receptions', {
    config: { permission: 'stock.receive' },
    schema: {
      body: Obj({
        po_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
        supplier_id: Type.Optional(Type.Union([Ref, Type.Null()])),
        note: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
        lines: Type.Array(Obj({
          product_id: Ref,
          lot_number: Type.String({ minLength: 1, maxLength: 60 }),
          expiry: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
          qty: Type.Integer({ minimum: 1, maximum: MAX_QTY }),
          unit_cost: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: MAX_COST }), Type.Null()])),
          confirm_near_expiry: Type.Optional(Type.Boolean()),
        }), { minItems: 1, maxItems: MAX_RECEPTION_LINES }),
      }),
      response: { 201: ReceptionT },
    },
  }, async (req, reply) =>
    reply.status(201).send(recordReception(s, actorOf(req), req.body as ReceptionInput, can(req, 'cost.view'))));

  app.get('/api/v1/receptions', {
    config: { permission: 'stock.receive' },
    schema: {
      querystring: Obj({ po_id: Type.Optional(Uuid), limit: Limit, cursor: Cursor }),
      response: { 200: Obj({ items: Type.Array(ReceptionT), next_cursor: NullableString }) },
    },
  }, async (req) => {
    const q = req.query as { po_id?: string; limit?: string; cursor?: string };
    return listReceptions(s, { ...q, limit: num(q.limit) }, can(req, 'cost.view'));
  });

  app.get('/api/v1/receptions/:id', {
    config: { permission: 'stock.receive' },
    schema: { params: IdParams, response: { 200: ReceptionT } },
  }, async (req) => getReception(s, (req.params as { id: string }).id, can(req, 'cost.view')));

  app.post('/api/v1/supplier-returns', {
    config: { permission: 'stock.receive' },
    schema: {
      body: Obj({
        supplier_id: Ref, lot_id: Uuid, qty: Type.Integer({ minimum: 1, maximum: MAX_QTY }),
        reason: Type.String({ minLength: 1, maxLength: 200 }),
      }),
      response: { 200: Obj({ lot_id: Type.String(), qty: Type.Integer() }) },
    },
  }, async (req) => returnToSupplier(s, actorOf(req), req.body as SupplierReturnInput));
}

function demandRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/demand', {
    config: { permission: 'demand.record' },
    schema: {
      body: Obj({
        product_id: Type.Optional(Type.Union([Ref, Type.Null()])),
        free_text: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
        qty: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_QTY })),
        note: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
      }),
      response: { 201: DemandT },
    },
  }, async (req, reply) => reply.status(201).send(recordDemand(s, actorOf(req), req.body as DemandInput)));

  // D-02 : la liste et l'ajout à la commande relèvent de la gestion des commandes.
  app.get('/api/v1/demand', {
    config: { permission: 'order.manage' },
    schema: {
      querystring: Obj({
        status: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('resolved'), Type.Literal('all')])),
        product_id: Type.Optional(Ref), from: When, to: When, limit: Limit, cursor: Cursor,
      }),
      response: { 200: Obj({ items: Type.Array(DemandT), next_cursor: NullableString }) },
    },
  }, async (req) => {
    const q = req.query as Omit<DemandListOptions, 'limit'> & { limit?: string };
    return listDemand(s, { ...q, limit: num(q.limit) });
  });

  app.get('/api/v1/demand/summary', {
    config: { permission: 'order.manage' },
    schema: { querystring: Obj({ from: When, to: When }), response: { 200: Type.Array(SummaryT) } },
  }, async (req) => {
    const q = req.query as { from?: string; to?: string };
    return summarizeDemand(s, q.from, q.to);
  });

  app.post('/api/v1/demand/:id/to-order', {
    config: { permission: 'order.manage' },
    schema: {
      params: IdParams,
      body: Obj({ supplier_id: Ref }),
      response: { 200: Obj({ id: Type.String(), number: Type.String(), status: Type.String() }) },
    },
  }, async (req) => {
    const id = (req.params as { id: string }).id;
    const o = demandToOrder(s, actorOf(req), id, (req.body as { supplier_id: string }).supplier_id);
    return { id: o.id, number: o.number, status: o.status };
  });
}

/** R-04 à R-06 et D-01 à D-03. */
export function receptionsRoutes(app: FastifyInstance, s: Services): void {
  receptionRoutes(app, s);
  demandRoutes(app, s);
}
