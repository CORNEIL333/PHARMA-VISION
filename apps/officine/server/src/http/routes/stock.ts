import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import {
  countInventory, getInventory, inventoryReport, listInventories, listInventoryCounts, openInventory,
  validateInventory, type CountInput,
} from '../../domain/inventory.js';
import {
  adjustStock, ADJUST_REASONS, changeThresholds, destroyStock, listLots, listMovements, MAX_COST, MAX_QTY,
  MOVEMENT_KINDS, stockValue, type AdjustInput, type DestroyInput,
} from '../../domain/stock.js';
import type { Services } from '../../services.js';
import { actorOf, can } from '../actor.js';
import { Obj, Uuid } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);
const IdParams = Obj({ id: Uuid });
const Limit = Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' }));
const Cursor = Type.Optional(Type.String({ minLength: 1, maxLength: 400 }));
const Qty = Type.Integer({ minimum: 1, maximum: MAX_QTY });
const Page = <T extends ReturnType<typeof Obj>>(item: T) => Obj({ items: Type.Array(item), next_cursor: NullableString });
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const LotT = Obj({
  lot_id: Type.String(), product_id: Type.String(), product_name: Type.String(), lot_number: Type.String(),
  expiry: NullableString, qty: Type.Integer(), is_regul: Type.Boolean(), recalled: Type.Boolean(),
  expired: Type.Boolean(), created_at: Type.String(), unit_cost: Type.Optional(NullableInt),
});
const MovementT = Obj({
  id: Type.String(), product_id: Type.String(), product_name: Type.String(), lot_id: Type.String(),
  lot_number: Type.String(), qty: Type.Integer(), kind: Type.Union(MOVEMENT_KINDS.map((k) => Type.Literal(k))),
  ref_type: NullableString, ref_id: NullableString, reason: NullableString, user_id: Type.String(),
  event_seq: Type.Integer(), at: Type.String(),
});
const LotQtyT = Obj({ lot_id: Type.String(), qty: Type.Integer() });
const ValueT = Obj({
  product_id: NullableString, qty: Type.Integer(), known_value_xaf: Type.Integer(),
  total_value_xaf: NullableInt, unknown_cost_qty: Type.Integer(),
});
const SessionT = Obj({
  id: Type.String(), scope: Type.String(),
  status: Type.Union([Type.Literal('open'), Type.Literal('validated'), Type.Literal('cancelled')]),
  product_ids: Type.Array(Type.String()), opened_by: Type.String(), opened_at: Type.String(),
  validated_by: NullableString, validated_at: NullableString,
});
const CountFields = {
  lot_id: Type.String(), product_id: Type.String(), product_name: Type.String(), lot_number: Type.String(),
  expiry: NullableString, system_qty: Type.Integer(), counted_qty: Type.Integer(), delta: Type.Integer(),
};
const CountT = Obj({
  ...CountFields, id: Type.String(), session_id: Type.String(), counted_by: Type.String(), counted_at: Type.String(),
});
const ReportT = Obj({
  session_id: Type.String(), scope: Type.String(), status: Type.String(), counted_lots: Type.Integer(),
  total_delta_qty: Type.Integer(), total_delta_value_xaf: Type.Optional(NullableInt),
  lines: Type.Array(Obj({ ...CountFields, delta_value_xaf: Type.Optional(NullableInt) })),
});

function stockReadRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/stock/lots', {
    config: { permission: 'report.stock' },
    schema: {
      querystring: Obj({
        product_id: Type.Optional(Type.String({ maxLength: 100 })),
        in_stock: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
        limit: Limit, cursor: Cursor,
      }),
      response: { 200: Page(LotT) },
    },
  }, async (req) => {
    const q = req.query as { product_id?: string; in_stock?: string; limit?: string; cursor?: string };
    return listLots(s, { ...q, in_stock: q.in_stock === 'true', limit: num(q.limit) }, can(req, 'cost.view'));
  });

  app.get('/api/v1/stock/movements', {
    config: { permission: 'report.stock' },
    schema: {
      querystring: Obj({
        product_id: Type.Optional(Type.String({ maxLength: 100 })), lot_id: Type.Optional(Type.String({ maxLength: 100 })),
        from: Type.Optional(Type.String({ maxLength: 40 })), to: Type.Optional(Type.String({ maxLength: 40 })),
        limit: Limit, cursor: Cursor,
      }),
      response: { 200: Page(MovementT) },
    },
  }, async (req) => {
    const q = req.query as { limit?: string } & Record<string, string | undefined>;
    return listMovements(s, { ...q, limit: num(q.limit) });
  });

  app.get('/api/v1/stock/value', {
    config: { permission: 'cost.view' },
    schema: { querystring: Obj({ product_id: Type.Optional(Type.String({ maxLength: 100 })) }), response: { 200: ValueT } },
  }, async (req) => stockValue(s, (req.query as { product_id?: string }).product_id));
}

function stockWriteRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/stock/adjustments', {
    config: { permission: 'stock.adjust' },
    schema: {
      body: Obj({
        lot_id: Uuid,
        qty: Type.Integer({ minimum: -MAX_QTY, maximum: MAX_QTY, not: { const: 0 } }),
        reason: Type.Union(ADJUST_REASONS.map((r) => Type.Literal(r))),
        reason_text: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
      }),
      response: { 200: LotQtyT },
    },
  }, async (req) => adjustStock(s, actorOf(req), req.body as AdjustInput));

  app.post('/api/v1/stock/destructions', {
    config: { permission: 'stock.adjust' },
    schema: {
      body: Obj({
        lot_id: Uuid, qty: Qty, reason: Type.String({ minLength: 1, maxLength: 200 }),
        pv_number: Type.String({ minLength: 1, maxLength: 60 }),
      }),
      response: { 200: LotQtyT },
    },
  }, async (req) => destroyStock(s, actorOf(req), req.body as DestroyInput));

  app.patch('/api/v1/products/:id/thresholds', {
    config: { permission: 'price.edit' },
    schema: {
      params: IdParams,
      body: Obj({ min_qty: Type.Integer({ minimum: 0, maximum: MAX_QTY }), max_qty: Type.Integer({ minimum: 0, maximum: MAX_QTY }) }),
      response: { 200: Obj({ product_id: Type.String(), min_qty: Type.Integer(), max_qty: Type.Integer() }) },
    },
  }, async (req) => changeThresholds(s, actorOf(req), (req.params as { id: string }).id,
    req.body as { min_qty: number; max_qty: number }));
}

function inventoryRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/inventories', {
    config: { permission: 'inventory.count' },
    schema: { querystring: Obj({ limit: Limit, cursor: Cursor }), response: { 200: Page(SessionT) } },
  }, async (req) => {
    const q = req.query as { limit?: string; cursor?: string };
    return listInventories(s, { ...q, limit: num(q.limit) });
  });

  app.post('/api/v1/inventories', {
    config: { permission: 'inventory.count' },
    schema: {
      body: Obj({
        scope: Type.String({ minLength: 1, maxLength: 80 }),
        product_ids: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 5000 })),
      }),
      response: { 201: SessionT },
    },
  }, async (req, reply) =>
    reply.status(201).send(openInventory(s, actorOf(req), req.body as { scope: string; product_ids?: string[] })));

  app.get('/api/v1/inventories/:id', {
    config: { permission: 'inventory.count' },
    schema: { params: IdParams, response: { 200: Obj({ session: SessionT, report: ReportT }) } },
  }, async (req) => {
    const id = (req.params as { id: string }).id;
    return { session: getInventory(s, id), report: inventoryReport(s, id, can(req, 'cost.view')) };
  });

  app.get('/api/v1/inventories/:id/counts', {
    config: { permission: 'inventory.count' },
    schema: { params: IdParams, querystring: Obj({ limit: Limit, cursor: Cursor }), response: { 200: Page(CountT) } },
  }, async (req) => {
    const q = req.query as { limit?: string; cursor?: string };
    return listInventoryCounts(s, (req.params as { id: string }).id, { ...q, limit: num(q.limit) });
  });

  app.post('/api/v1/inventories/:id/counts', {
    config: { permission: 'inventory.count' },
    schema: {
      params: IdParams,
      body: Type.Union([
        Obj({ lot_id: Uuid, counted_qty: Type.Integer({ minimum: 0, maximum: MAX_QTY }) }),
        Obj({
          product_id: Type.String({ maxLength: 100 }), lot_number: Type.String({ minLength: 1, maxLength: 60 }),
          expiry: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }),
          unit_cost: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: MAX_COST }), Type.Null()])),
          counted_qty: Type.Integer({ minimum: 0, maximum: MAX_QTY }),
        }),
      ]),
      response: { 200: CountT },
    },
  }, async (req) => countInventory(s, actorOf(req), (req.params as { id: string }).id, req.body as CountInput));

  app.post('/api/v1/inventories/:id/validate', {
    config: { permission: 'inventory.validate' },
    schema: { params: IdParams, response: { 200: ReportT } },
  }, async (req) => validateInventory(s, actorOf(req), (req.params as { id: string }).id, can(req, 'cost.view')));
}

/** S-01 à S-09 : lots, mouvements, valorisation, ajustements, destructions, seuils, inventaires. */
export function stockRoutes(app: FastifyInstance, s: Services): void {
  stockReadRoutes(app, s);
  stockWriteRoutes(app, s);
  inventoryRoutes(app, s);
}
