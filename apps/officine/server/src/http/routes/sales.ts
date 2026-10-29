import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { closeCashSession, currentSession, getCashSession, listCashSessions, MAX_AMOUNT, openCashSession } from '../../domain/cash.js';
import { buildReceipt } from '../../domain/receipt.js';
import {
  createSale, getSale, listSales, MAX_SALE_LINES, PAYMENT_METHODS, quoteSale, voidSale, type SaleInput,
  type SaleLineInput, type SaleListOptions,
} from '../../domain/sales.js';
import { MAX_QTY } from '../../domain/stock.js';
import { AppError } from '../../errors.js';
import type { Services } from '../../services.js';
import { actorOf, can } from '../actor.js';
import { Obj, Uuid } from '../schemas.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);
const IdParams = Obj({ id: Uuid });
const Ref = Type.String({ minLength: 1, maxLength: 100 });
const Amount = Type.Integer({ minimum: 0, maximum: MAX_AMOUNT });
const Register = Type.String({ minLength: 1, maxLength: 60 });
const MethodT = Type.Union(PAYMENT_METHODS.map((m) => Type.Literal(m)));
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const SessionT = Obj({
  id: Type.String(), register: Type.String(), kind: Type.Union([Type.Literal('jour'), Type.Literal('garde')]),
  opened_by: Type.String(), opened_by_name: Type.String(), opened_at: Type.String(), opening_float: Type.Integer(),
  closed_by: NullableString, closed_at: NullableString, counted_cash: NullableInt, expected_cash: NullableInt,
  variance: NullableInt, note: NullableString,
});
const LineInputT = Obj({ product_id: Ref, qty: Type.Integer({ minimum: 1, maximum: MAX_QTY }), lot_id: Type.Optional(Type.Union([Uuid, Type.Null()])) });
const LinesT = Type.Array(LineInputT, { minItems: 1, maxItems: MAX_SALE_LINES });
const AlertT = Obj({ level: Type.Union([Type.Literal('block'), Type.Literal('warn')]), code: Type.String(), message: Type.String() });
const QuoteT = Obj({
  lines: Type.Array(Obj({
    product_id: Type.String(), name: Type.String(), qty: Type.Integer(), unit_price: NullableInt, line_total: Type.Integer(),
    rx_required: Type.Boolean(), sensitive: Type.Boolean(), alerts: Type.Array(AlertT),
    allocations: Type.Array(Obj({ lot_id: Type.String(), lot_number: Type.String(), expiry: NullableString, qty: Type.Integer(), regul: Type.Boolean() })),
  })),
  gross: Type.Integer(), discount: Type.Integer(), total: Type.Integer(), rx_required: Type.Boolean(), sensitive: Type.Boolean(),
  regul_allowed: Type.Boolean(), prescription: Obj({ ok: Type.Boolean(), message: NullableString }), blocking: Type.Boolean(),
});
const SaleHead = {
  id: Type.String(), number: Type.String(), cash_session_id: Type.String(), register: Type.String(), user_id: Type.String(),
  user_name: Type.String(), prescription_id: NullableString, gross: Type.Integer(), discount_total: Type.Integer(),
  discount_reason: NullableString, total: Type.Integer(), status: Type.Union([Type.Literal('completed'), Type.Literal('voided')]),
  has_regul: Type.Boolean(), cash_tendered: NullableInt, change_given: Type.Integer(), created_at: Type.String(),
  voided_by: NullableString, voided_at: NullableString, void_reason: NullableString, short_hash: NullableString,
};
const SaleT = Obj({
  ...SaleHead,
  lines: Type.Array(Obj({
    product_id: Type.String(), name: Type.String(), lot_id: Type.String(), lot_number: Type.String(), expiry: NullableString,
    qty: Type.Integer(), unit_price: Type.Integer(), line_total: Type.Integer(), regul: Type.Boolean(),
  })),
  payments: Type.Array(Obj({ method: MethodT, amount: Type.Integer(), reference: NullableString, payer: NullableString })),
});
const ReceiptT = Obj({
  pharmacy: Obj({ name: Type.String(), address: Type.String(), phone: Type.String(), niu: NullableString, rccm: NullableString }),
  number: Type.String(), at: Type.String(), cashier: Type.String(), status: Type.String(),
  lines: Type.Array(Obj({ name: Type.String(), lot_number: Type.String(), expiry: NullableString, qty: Type.Integer(), unit_price: Type.Integer(), total: Type.Integer() })),
  gross: Type.Integer(), discount: Type.Integer(), total: Type.Integer(),
  payments: Type.Array(Obj({ label: Type.String(), amount: Type.Integer(), reference: NullableString })),
  tendered: NullableInt, change: Type.Integer(), has_regul: Type.Boolean(), short_hash: Type.String(), text: Type.String(),
});

/** Le caissier (et le préparateur) ne voient que leurs propres ventes ; pharmacien et titulaire voient tout. */
function assertSaleVisible(req: FastifyRequest, s: Services, id: string): void {
  if (can(req, 'report.sales')) return;
  if (getSale(s, id).user_id !== actorOf(req)) throw new AppError('forbidden', 'Vente d’un autre utilisateur');
}

function cashRoutes(app: FastifyInstance, s: Services): void {
  app.get('/api/v1/cash/sessions/current', {
    config: { permission: 'sale.sell' },
    schema: { querystring: Obj({ register: Register }), response: { 200: Obj({ session: Type.Union([SessionT, Type.Null()]) }) } },
  }, async (req) => ({ session: currentSession(s, (req.query as { register: string }).register) }));

  app.get('/api/v1/cash/sessions', {
    config: { permission: 'cash.own_close_report' },
    schema: { response: { 200: Type.Array(SessionT) } },
  }, async (req) => listCashSessions(s, can(req, 'report.sales') ? {} : { user_id: actorOf(req) }));

  app.post('/api/v1/cash/sessions', {
    config: { permission: 'sale.sell' },
    schema: { body: Obj({ register: Register, opening_float: Amount }), response: { 201: SessionT } },
  }, async (req, reply) => reply.status(201).send(openCashSession(s, actorOf(req), req.body as { register: string; opening_float: number })));

  app.post('/api/v1/cash/sessions/:id/close', {
    config: { permission: 'sale.sell' },
    schema: {
      params: IdParams,
      body: Obj({ counted_cash: Amount, note: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])) }),
      response: { 200: SessionT },
    },
  }, async (req) => closeCashSession(s, actorOf(req), (req.params as { id: string }).id, req.body as { counted_cash: number; note?: string | null }));

  app.get('/api/v1/cash/sessions/:id', {
    config: { permission: 'cash.own_close_report' },
    schema: { params: IdParams, response: { 200: SessionT } },
  }, async (req) => {
    const c = getCashSession(s, (req.params as { id: string }).id);
    if (c.opened_by !== actorOf(req) && !can(req, 'report.sales')) throw new AppError('forbidden', 'Caisse d’un autre utilisateur');
    return c;
  });
}

function saleRoutes(app: FastifyInstance, s: Services): void {
  app.post('/api/v1/sales/quote', {
    config: { permission: 'sale.sell' },
    schema: {
      body: Obj({ lines: LinesT, prescription_id: Type.Optional(Type.Union([Uuid, Type.Null()])), discount_amount: Type.Optional(Amount) }),
      response: { 200: QuoteT },
    },
  }, async (req) => quoteSale(s, req.body as { lines: SaleLineInput[]; prescription_id?: string | null; discount_amount?: number }));

  app.post('/api/v1/sales', {
    config: { permission: 'sale.sell' },
    schema: {
      body: Obj({
        cash_session_id: Uuid, lines: LinesT,
        payments: Type.Array(Obj({
          method: MethodT, amount: Type.Integer({ minimum: 1, maximum: MAX_AMOUNT }),
          reference: Type.Optional(Type.Union([Type.String({ maxLength: 80 }), Type.Null()])),
          payer: Type.Optional(Type.Union([Type.String({ maxLength: 120 }), Type.Null()])),
        }), { minItems: 1, maxItems: 10 }),
        prescription_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
        discount: Type.Optional(Type.Union([Obj({ amount: Amount, reason: Type.String({ maxLength: 200 }) }), Type.Null()])),
        cash_tendered: Type.Optional(Type.Union([Amount, Type.Null()])),
      }),
      response: { 201: SaleT },
    },
  }, async (req, reply) => reply.status(201).send(createSale(s, actorOf(req), req.body as SaleInput)));

  app.get('/api/v1/sales', {
    config: { permission: 'sale.sell' },
    schema: {
      querystring: Obj({
        from: Type.Optional(Type.String({ maxLength: 40 })), to: Type.Optional(Type.String({ maxLength: 40 })),
        cash_session_id: Type.Optional(Uuid), limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
        cursor: Type.Optional(Type.String({ maxLength: 400 })),
      }),
      response: { 200: Obj({ items: Type.Array(Obj(SaleHead)), next_cursor: NullableString }) },
    },
  }, async (req) => {
    const q = req.query as Omit<SaleListOptions, 'limit'> & { limit?: string };
    return listSales(s, { ...q, limit: num(q.limit), user_id: can(req, 'report.sales') ? undefined : actorOf(req) });
  });

  app.get('/api/v1/sales/:id', {
    config: { permission: 'sale.sell' },
    schema: { params: IdParams, response: { 200: SaleT } },
  }, async (req) => {
    const id = (req.params as { id: string }).id;
    assertSaleVisible(req, s, id);
    return getSale(s, id);
  });

  app.get('/api/v1/sales/:id/receipt', {
    config: { permission: 'sale.sell' },
    schema: { params: IdParams, response: { 200: ReceiptT } },
  }, async (req) => {
    const id = (req.params as { id: string }).id;
    assertSaleVisible(req, s, id);
    return buildReceipt(s, id);
  });

  app.post('/api/v1/sales/:id/void', {
    config: { permission: 'sale.void' },
    schema: { params: IdParams, body: Obj({ reason: Type.String({ minLength: 1, maxLength: 300 }) }), response: { 200: SaleT } },
  }, async (req) => voidSale(s, actorOf(req), (req.params as { id: string }).id, (req.body as { reason: string }).reason));
}

/** V-01 à V-10 : caisse, ventes, tickets, annulations. */
export function salesRoutes(app: FastifyInstance, s: Services): void {
  cashRoutes(app, s);
  saleRoutes(app, s);
}
