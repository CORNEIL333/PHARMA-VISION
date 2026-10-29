import { Type, type TSchema } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  cashCloseReport, complianceReport, deadStockReport, expiryReport, fraudReport, period, salesReport, stockValueReport,
  toCsv, unmetDemandReport, type Row,
} from '../../domain/reports.js';
import { AppError } from '../../errors.js';
import type { RoutePermission } from '../types.js';
import type { Services } from '../../services.js';
import { actorOf, can } from '../actor.js';
import { Obj, Uuid } from '../schemas.js';

const Cell = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const RowT = Type.Record(Type.String(), Cell);
const Rows = Type.Array(RowT);
const PeriodT = Obj({ from: Type.String(), to: Type.String() });
const NullableInt = Type.Union([Type.Integer(), Type.Null()]);
const Format = Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv')]));
const When = Type.Optional(Type.String({ maxLength: 40 }));
const Days = Type.Optional(Type.String({ pattern: '^[0-9]{1,4}$' }));

type Query = { format?: 'json' | 'csv'; from?: string; to?: string; days?: string };

/** Réponse JSON, ou CSV de la table principale du rapport (`?format=csv`). */
function respond(reply: FastifyReply, q: Query, name: string, body: object, rows: Row[]) {
  if (q.format !== 'csv') return body;
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}.csv"`)
    .send(toCsv(rows));
}

function route(
  app: FastifyInstance,
  url: string,
  permission: RoutePermission,
  schema: TSchema,
  handler: (req: FastifyRequest, reply: FastifyReply, q: Query) => unknown,
  params?: TSchema,
): void {
  app.get(url, {
    config: { permission },
    schema: {
      ...(params ? { params } : {}),
      querystring: Obj({ format: Format, from: When, to: When, days: Days }),
      response: { 200: { content: { 'application/json': { schema }, 'text/csv': { schema: Type.String() } } } },
    },
  }, async (req, reply) => handler(req, reply, req.query as Query));
}

const SessionT = Type.Record(Type.String(), Cell);

/** P-01 à P-08 (annexe D) ; `?format=csv` sur chacun. */
export function reportsRoutes(app: FastifyInstance, s: Services): void {
  route(app, '/api/v1/reports/cash-close/:session_id', 'cash.own_close_report', Obj({
    session: SessionT, provisional: Type.Boolean(), tickets: Type.Integer(), gross: Type.Integer(), discounts: Type.Integer(),
    revenue: Type.Integer(), by_method: Rows, voids: Rows, discount_lines: Rows, regul_sales: Rows,
    expected_cash: Type.Integer(), counted_cash: NullableInt, variance: NullableInt,
  }), (req, reply, q) => {
    const r = cashCloseReport(s, (req.params as { session_id: string }).session_id);
    if (r.session.opened_by !== actorOf(req) && !can(req, 'report.sales')) throw new AppError('forbidden', 'Caisse d’un autre utilisateur');
    return respond(reply, q, 'cloture', r, r.by_method);
  }, Obj({ session_id: Uuid }));

  route(app, '/api/v1/reports/expiry', 'report.stock', Obj({ today: Type.String(), rows: Rows }), (req, reply, q) => {
    const r = expiryReport(s, q.days === undefined ? 90 : Number(q.days), can(req, 'cost.view'));
    return respond(reply, q, 'peremptions', r, r.rows);
  });

  route(app, '/api/v1/reports/sales', 'report.sales', Obj({
    period: PeriodT, tickets: Type.Integer(), revenue: Type.Integer(), discounts: Type.Integer(), average_basket: Type.Integer(),
    top_products: Rows, by_category: Rows, by_user: Rows,
  }), (_req, reply, q) => {
    const r = salesReport(s, period(s, q.from, q.to));
    return respond(reply, q, 'ventes', r, r.top_products);
  });

  route(app, '/api/v1/reports/stock-value', 'cost.view', Obj({ rows: Rows, total_value_xaf: NullableInt, unknown_cost_qty: Type.Integer() }),
    (_req, reply, q) => {
      const r = stockValueReport(s);
      return respond(reply, q, 'stock-valorise', r, r.rows);
    });

  route(app, '/api/v1/reports/dead-stock', 'report.stock', Obj({ since: Type.String(), rows: Rows }), (req, reply, q) => {
    const r = deadStockReport(s, q.days === undefined ? 90 : Number(q.days), can(req, 'cost.view'));
    return respond(reply, q, 'stock-immobilise', r, r.rows);
  });

  route(app, '/api/v1/reports/compliance', 'report.sales', Obj({
    period: PeriodT, rx_sales: Rows, sensitive_register: Rows, recalls: Rows, adjustments: Rows,
  }), (_req, reply, q) => {
    const r = complianceReport(s, period(s, q.from, q.to));
    return respond(reply, q, 'registre-sensibles', r, r.sensitive_register);
  });

  route(app, '/api/v1/reports/unmet-demand', 'report.stock', Obj({ period: PeriodT, rows: Rows }), (_req, reply, q) => {
    const r = unmetDemandReport(s, period(s, q.from, q.to));
    return respond(reply, q, 'demandes', r, r.rows);
  });

  route(app, '/api/v1/reports/fraud', 'settings.edit', Obj({
    period: PeriodT, void_threshold: Type.Integer(), voids: Rows, out_of_hours: Rows, repeated_variances: Rows,
  }), (_req, reply, q) => {
    const r = fraudReport(s, period(s, q.from, q.to));
    return respond(reply, q, 'alertes-annulations', r, r.voids);
  });
}
