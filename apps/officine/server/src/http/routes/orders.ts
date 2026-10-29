import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  cancelOrder, createOrder, getOrder, listOrders, sendOrder, suggestOrder, updateOrder,
  MAX_ORDER_LINES, MAX_ORDER_QTY, MAX_UNIT_COST, ORDER_STATUSES,
  type OrderInput, type OrderListOptions, type OrderPatch,
} from '../../domain/orders.js';
import { exportOrder, type OrderExportFormat, type OrderPaper } from '../../domain/orderExport.js';
import {
  createSupplier, getSupplier, listSuppliers, updateSupplier, MAX_LEAD_DAYS,
  type SupplierInput, type SupplierPatch,
} from '../../domain/suppliers.js';
import { AppError } from '../../errors.js';
import { grant } from '../../security/rbac.js';
import type { Services } from '../../services.js';
import { Obj, Uuid } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);
const Reference = Type.String({ minLength: 1, maxLength: 100 });
const IdParams = Obj({ id: Uuid });
const StatusT = Type.Union(ORDER_STATUSES.map((value) => Type.Literal(value)));
const SupplierFields = {
  name: Type.String({ minLength: 1, maxLength: 200 }),
  phone: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
  email: Type.Optional(Type.Union([Type.String({ maxLength: 254 }), Type.Null()])),
  lead_days: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_LEAD_DAYS })),
};
const SupplierT = Obj({
  id: Type.String(), name: Type.String(), phone: NullableString, email: NullableString,
  lead_days: Type.Integer(), active: Type.Boolean(), created_at: Type.String(),
});
const SupplierPatchT = Type.Partial(Obj({ ...SupplierFields, active: Type.Boolean() }));
const LineInputT = Obj({
  product_id: Reference,
  qty: Type.Integer({ minimum: 1, maximum: MAX_ORDER_QTY }),
  unit_cost: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: MAX_UNIT_COST }), Type.Null()])),
});
const LinesInputT = Type.Array(LineInputT, { minItems: 1, maxItems: MAX_ORDER_LINES });
const SummaryFields = {
  id: Type.String(), number: Type.String(), supplier_id: Type.String(), supplier_name: Type.String(),
  status: StatusT, created_by: Type.String(), created_at: Type.String(),
  sent_at: NullableString, closed_at: NullableString,
};
const SummaryT = Obj(SummaryFields);
const OrderT = Obj({
  ...SummaryFields,
  lines: Type.Array(Obj({
    id: Type.String(), product_id: Type.String(), product_name: Type.String(),
    strength: NullableString, form: NullableString, presentation: NullableString,
    qty_ordered: Type.Integer(), qty_received: Type.Integer(), unit_cost: NullableInteger,
  })),
});
const SuggestionT = Obj({
  supplier: SupplierT,
  items: Type.Array(Obj({
    product_id: Type.String(), name: Type.String(), stock: Type.Integer(), on_order: Type.Integer(),
    sales_30d: Type.Integer(), min_qty: Type.Integer(), max_qty: Type.Integer(), qty: Type.Integer(),
    rule: Type.Union([Type.Literal('thresholds'), Type.Literal('sales')]),
  })),
});

function actor(req: FastifyRequest): string {
  if (!req.auth) throw new AppError('unauthenticated', 'Session absente ou expirée');
  return req.auth.userId;
}

function withCost(req: FastifyRequest): boolean {
  return req.auth !== null && grant(req.auth.role, 'cost.view') === 'O';
}

function supplierRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/suppliers', {
    config: { permission: 'order.manage' },
    schema: {
      querystring: Obj({ include_inactive: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])) }),
      response: { 200: Type.Array(SupplierT) },
    },
  }, async (req) => listSuppliers(s, (req.query as { include_inactive?: string }).include_inactive === 'true'));

  app.get('/api/v1/suppliers/:id', {
    config: { permission: 'order.manage' },
    schema: { params: IdParams, response: { 200: SupplierT } },
  }, async (req) => getSupplier(s, (req.params as { id: string }).id));

  app.post('/api/v1/suppliers', {
    config: { permission: 'order.manage' },
    schema: { body: Obj(SupplierFields), response: { 201: SupplierT } },
  }, async (req, reply) => reply.status(201).send(createSupplier(s, actor(req), req.body as SupplierInput)));

  app.patch('/api/v1/suppliers/:id', {
    config: { permission: 'order.manage' },
    schema: { params: IdParams, body: SupplierPatchT, response: { 200: SupplierT } },
  }, async (req) => updateSupplier(s, actor(req), (req.params as { id: string }).id, req.body as SupplierPatch));
}

function orderReadRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/orders/suggestions', {
    config: { permission: 'order.manage' },
    schema: { querystring: Obj({ supplier_id: Reference }), response: { 200: SuggestionT } },
  }, async (req) => suggestOrder(s, (req.query as { supplier_id: string }).supplier_id));

  app.get('/api/v1/orders', {
    config: { permission: 'order.manage' },
    schema: {
      querystring: Obj({
        status: Type.Optional(StatusT), supplier_id: Type.Optional(Reference),
        cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
      }),
      response: { 200: Obj({ items: Type.Array(SummaryT), next_cursor: NullableString }) },
    },
  }, async (req) => {
    const query = req.query as Omit<OrderListOptions, 'limit'> & { limit?: string };
    return listOrders(s, { ...query, limit: query.limit === undefined ? undefined : Number(query.limit) });
  });

  app.get('/api/v1/orders/:id', {
    config: { permission: 'order.manage' },
    schema: { params: IdParams, response: { 200: OrderT } },
  }, async (req) => getOrder(s, (req.params as { id: string }).id, withCost(req)));
}

function orderWriteRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/orders', {
    config: { permission: 'order.manage' },
    schema: { body: Obj({ supplier_id: Reference, lines: LinesInputT }), response: { 201: OrderT } },
  }, async (req, reply) => reply.status(201).send(createOrder(s, actor(req), req.body as OrderInput, withCost(req))));

  app.patch('/api/v1/orders/:id', {
    config: { permission: 'order.manage' },
    schema: { params: IdParams, body: Obj({ lines: LinesInputT }), response: { 200: OrderT } },
  }, async (req) => updateOrder(s, actor(req), (req.params as { id: string }).id, req.body as OrderPatch, withCost(req)));

  app.post('/api/v1/orders/:id/send', {
    config: { permission: 'order.manage' },
    schema: { params: IdParams, response: { 200: OrderT } },
  }, async (req) => sendOrder(s, actor(req), (req.params as { id: string }).id, withCost(req)));

  app.post('/api/v1/orders/:id/cancel', {
    config: { permission: 'order.manage' },
    schema: { params: IdParams, body: Obj({ reason: Type.String({ minLength: 1, maxLength: 500 }) }), response: { 200: OrderT } },
  }, async (req) => cancelOrder(s, actor(req), (req.params as { id: string }).id,
    (req.body as { reason: string }).reason, withCost(req)));
}

function orderExportRoute(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/orders/:id/export', {
    config: { permission: 'order.manage' },
    schema: {
      params: IdParams,
      querystring: Obj({
        format: Type.Union([Type.Literal('text'), Type.Literal('pdf')]),
        paper: Type.Optional(Type.Union([Type.Literal('A4'), Type.Literal('80mm')])),
      }),
      response: { 200: { content: {
        'application/pdf': { schema: Type.String({ format: 'binary' }) },
        'text/plain': { schema: Type.String() },
      } } },
    },
  }, async (req, reply) => {
    const query = req.query as { format: OrderExportFormat; paper?: OrderPaper };
    const result = exportOrder(s, (req.params as { id: string }).id, query.format, withCost(req), query.paper);
    return reply.type(result.contentType).header('cache-control', 'no-store')
      .header('content-disposition', `inline; filename="${result.filename}"`).send(result.body);
  });
}

/** Task 14 registers this once, after shared auth/error hooks and before app.ready(). */
export function ordersRoutes(app: FastifyInstance, s: Services): void {
  supplierRoutes(app, s);
  orderReadRoutes(app, s);
  orderWriteRoutes(app, s);
  orderExportRoute(app, s);
}
