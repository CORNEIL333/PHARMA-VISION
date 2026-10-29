import { AppError } from '../errors.js';
import type { Services } from '../services.js';
import { getCashSession, expectedCash, type CashSession } from './cash.js';
import { addDays, doualaDate, doualaMidnightUtc, normalizeIso } from './dates.js';
import { summarizeDemand } from './demand.js';
import { getSettings } from './settings.js';

/**
 * P-01 à P-08. Tous les chiffres viennent de requêtes ; les lignes sont des objets plats
 * (exportables en CSV tels quels). Les valeurs au coût n'apparaissent qu'avec `cost.view`.
 */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface Period {
  from: string;
  to: string;
}

/** Période : bornes ISO fournies, sinon la journée en cours (Douala). */
export function period(s: Services, from?: string, to?: string): Period {
  const today = doualaDate(s.clock.now());
  const f = from === undefined ? doualaMidnightUtc(today).toISOString() : normalizeIso(from);
  const t = to === undefined ? new Date(doualaMidnightUtc(addDays(today, 1)).getTime() - 1).toISOString() : normalizeIso(to);
  if (!f || !t || f > t) throw new AppError('validation_failed', 'Période invalide');
  if (Date.parse(t) - Date.parse(f) > 400 * 86_400_000) throw new AppError('validation_failed', 'Période de 400 jours au plus');
  return { from: f, to: t };
}

const all = (s: Services, sql: string, ...p: unknown[]) => s.db.prepare(sql).all(...p) as Row[];
const one = (s: Services, sql: string, ...p: unknown[]) => s.db.prepare(sql).get(...p) as Row;

// ---------------------------------------------------------------- P-01 clôture de caisse

export interface CashCloseReport {
  session: CashSession;
  provisional: boolean;
  tickets: number;
  gross: number;
  discounts: number;
  revenue: number;
  by_method: Row[];
  voids: Row[];
  discount_lines: Row[];
  regul_sales: Row[];
  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
}

export function cashCloseReport(s: Services, sessionId: string): CashCloseReport {
  const session = getCashSession(s, sessionId);
  const totals = one(s, `SELECT COUNT(*) AS tickets, COALESCE(SUM(total + discount_total), 0) AS gross,
      COALESCE(SUM(discount_total), 0) AS discounts, COALESCE(SUM(total), 0) AS revenue
    FROM sales WHERE cash_session_id = ? AND status = 'completed'`, sessionId);
  return {
    session,
    provisional: session.closed_at === null,
    tickets: totals.tickets as number,
    gross: totals.gross as number,
    discounts: totals.discounts as number,
    revenue: totals.revenue as number,
    by_method: all(s, `SELECT p.method, COUNT(*) AS count, SUM(p.amount) AS amount FROM payments p JOIN sales sa ON sa.id = p.sale_id
      WHERE sa.cash_session_id = ? AND sa.status = 'completed' GROUP BY p.method ORDER BY p.method`, sessionId),
    voids: all(s, `SELECT sa.number, sa.total, sa.void_reason AS reason, u.display_name AS voided_by, sa.voided_at
      FROM sales sa JOIN users u ON u.id = sa.voided_by WHERE sa.cash_session_id = ? AND sa.status = 'voided' ORDER BY sa.voided_at`, sessionId),
    discount_lines: all(s, `SELECT sa.number, sa.discount_total AS amount, sa.discount_reason AS reason, u.display_name AS granted_by
      FROM sales sa JOIN users u ON u.id = sa.discount_by WHERE sa.cash_session_id = ? AND sa.discount_total > 0 AND sa.status = 'completed'
      ORDER BY sa.created_at`, sessionId),
    regul_sales: all(s, `SELECT sa.number, sa.total, sa.created_at FROM sales sa
      WHERE sa.cash_session_id = ? AND sa.has_regul = 1 AND sa.status = 'completed' ORDER BY sa.created_at`, sessionId),
    expected_cash: session.expected_cash ?? expectedCash(s, sessionId),
    counted_cash: session.counted_cash,
    variance: session.variance,
  };
}

// ---------------------------------------------------------------- P-02 péremptions, P-04 stock valorisé, P-05 immobilisé

const LOTS_SQL = `SELECT * FROM (
  SELECT l.id AS lot_id, p.id AS product_id, p.name AS product, l.lot_number, l.expiry, l.unit_cost,
         (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m WHERE m.lot_id = l.id) AS qty
  FROM lots l JOIN products p ON p.id = l.product_id WHERE l.is_regul = 0) WHERE qty > 0`;

function withValue(r: Row, withCost: boolean): Row {
  const { unit_cost, ...rest } = r;
  if (!withCost) return rest;
  const cost = unit_cost ?? null;
  return { ...rest, unit_cost: cost, value_xaf: cost === null ? null : (r.qty as number) * (cost as number) };
}

/** P-02 : lots déjà périmés et lots à 30, 60 et 90 jours. */
export function expiryReport(s: Services, days: number, withCost: boolean): { today: string; rows: Row[] } {
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new AppError('validation_failed', 'Horizon invalide');
  const today = doualaDate(s.clock.now());
  const rows = all(s, `${LOTS_SQL} AND expiry IS NOT NULL AND expiry <= ? ORDER BY expiry, product`, addDays(today, days));
  return {
    today,
    rows: rows.map((r) => {
      const e = r.expiry as string;
      const bucket = e < today ? 'perime' : e <= addDays(today, 30) ? '30' : e <= addDays(today, 60) ? '60' : '90+';
      return withValue({ ...r, bucket }, withCost);
    }),
  };
}

/** P-04 : stock valorisé par lot, au coût d'achat du lot. */
export function stockValueReport(s: Services): { rows: Row[]; total_value_xaf: number | null; unknown_cost_qty: number } {
  const rows = all(s, `${LOTS_SQL} ORDER BY product, expiry`).map((r) => withValue(r, true));
  const unknown = rows.filter((r) => r.value_xaf === null).reduce((n, r) => n + (r.qty as number), 0);
  const known = rows.reduce((n, r) => n + ((r.value_xaf as number | null) ?? 0), 0);
  return { rows, total_value_xaf: unknown > 0 ? null : known, unknown_cost_qty: unknown };
}

/** P-05 : produits en stock sans vente depuis N jours (90 par défaut), valeur immobilisée. */
export function deadStockReport(s: Services, days: number, withCost: boolean): { since: string; rows: Row[] } {
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new AppError('validation_failed', 'Durée invalide');
  const since = new Date(s.clock.now().getTime() - days * 86_400_000).toISOString();
  const rows = all(s, `SELECT p.id AS product_id, p.name AS product, SUM(x.qty) AS qty,
      CASE WHEN SUM(x.unit_cost IS NULL) > 0 THEN NULL ELSE SUM(x.qty * x.unit_cost) END AS value_xaf,
      (SELECT MAX(sa.created_at) FROM sale_lines sl JOIN sales sa ON sa.id = sl.sale_id
        WHERE sl.product_id = p.id AND sa.status = 'completed') AS last_sale_at
    FROM (${LOTS_SQL}) x JOIN products p ON p.id = x.product_id
    GROUP BY p.id HAVING last_sale_at IS NULL OR last_sale_at < ? ORDER BY value_xaf DESC, product`, since);
  return { since, rows: withCost ? rows : rows.map(({ value_xaf: _v, ...r }) => r) };
}

// ---------------------------------------------------------------- P-03 ventes

export function salesReport(s: Services, p: Period) {
  const t = one(s, `SELECT COUNT(*) AS tickets, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(discount_total), 0) AS discounts
    FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?`, p.from, p.to);
  const tickets = t.tickets as number;
  const LINES = `FROM sale_lines sl JOIN sales sa ON sa.id = sl.sale_id JOIN products pr ON pr.id = sl.product_id
    WHERE sa.status = 'completed' AND sa.created_at BETWEEN ? AND ?`;
  return {
    period: p,
    tickets,
    revenue: t.revenue as number,
    discounts: t.discounts as number,
    average_basket: tickets ? Math.round((t.revenue as number) / tickets) : 0,
    top_products: all(s, `SELECT pr.id AS product_id, pr.name AS product, SUM(sl.qty) AS qty, SUM(sl.line_total) AS amount
      ${LINES} GROUP BY pr.id ORDER BY qty DESC, amount DESC LIMIT 20`, p.from, p.to),
    by_category: all(s, `SELECT pr.category, SUM(sl.qty) AS qty, SUM(sl.line_total) AS amount ${LINES}
      GROUP BY pr.category ORDER BY amount DESC`, p.from, p.to),
    by_user: all(s, `SELECT u.display_name AS user, COUNT(*) AS tickets, SUM(sa.total) AS revenue
      FROM sales sa JOIN users u ON u.id = sa.user_id WHERE sa.status = 'completed' AND sa.created_at BETWEEN ? AND ?
      GROUP BY sa.user_id ORDER BY revenue DESC`, p.from, p.to),
  };
}

// ---------------------------------------------------------------- P-06 conformité

export function complianceReport(s: Services, p: Period) {
  return {
    period: p,
    rx_sales: all(s, `SELECT sa.number, sa.created_at, sa.status, pr.prescriber_name, pr.prescriber_reg, pr.issued_on,
        pr.patient_ref, u.display_name AS validated_by, pr.age_override_reason
      FROM sales sa JOIN prescriptions pr ON pr.id = sa.prescription_id JOIN users u ON u.id = pr.validated_by
      WHERE sa.created_at BETWEEN ? AND ? ORDER BY sa.created_at`, p.from, p.to),
    sensitive_register: all(s, `SELECT sa.number, sa.created_at, sa.status, p2.name AS product, l.lot_number, sl.qty,
        pr.prescriber_name, pr.prescriber_reg, pr.patient_ref, u.display_name AS sold_by
      FROM sale_lines sl JOIN sales sa ON sa.id = sl.sale_id JOIN products p2 ON p2.id = sl.product_id
      JOIN lots l ON l.id = sl.lot_id JOIN users u ON u.id = sa.user_id LEFT JOIN prescriptions pr ON pr.id = sa.prescription_id
      WHERE p2.sensitive = 1 AND sa.created_at BETWEEN ? AND ? ORDER BY sa.created_at`, p.from, p.to),
    recalls: all(s, `SELECT r.reference, p2.name AS product, COALESCE(r.lot_number, 'tous') AS lot_number, r.reason, r.source,
        r.active, r.created_at, r.closed_at,
        (SELECT COALESCE(SUM(m.qty), 0) FROM stock_movements m JOIN lots l ON l.id = m.lot_id
          WHERE l.product_id = r.product_id AND l.is_regul = 0 AND (r.lot_number IS NULL OR l.lot_number = r.lot_number)) AS blocked_qty
      FROM recalls r JOIN products p2 ON p2.id = r.product_id ORDER BY r.active DESC, r.created_at DESC`),
    adjustments: all(s, `SELECT m.at, m.kind, p2.name AS product, l.lot_number, m.qty, m.reason, m.ref_id AS pv_number,
        u.display_name AS user
      FROM stock_movements m JOIN products p2 ON p2.id = m.product_id JOIN lots l ON l.id = m.lot_id JOIN users u ON u.id = m.user_id
      WHERE m.kind IN ('adjustment', 'destroy') AND m.at BETWEEN ? AND ? ORDER BY m.at`, p.from, p.to),
  };
}

// ---------------------------------------------------------------- P-07 demande non satisfaite

export function unmetDemandReport(s: Services, p: Period) {
  return { period: p, rows: summarizeDemand(s, p.from, p.to) as unknown as Row[] };
}

// ---------------------------------------------------------------- P-08 fraude interne

/** Heure locale de Douala (HH:MM) d'un instant ISO. */
function doualaClock(at: string): string {
  return new Date(Date.parse(at) + 3_600_000).toISOString().slice(11, 16);
}

export function fraudReport(s: Services, p: Period) {
  const st = getSettings(s);
  const voids = all(s, `SELECT u.display_name AS user, substr(datetime(sa.voided_at, '+1 hour'), 1, 10) AS day, COUNT(*) AS voids
    FROM sales sa JOIN users u ON u.id = sa.voided_by WHERE sa.status = 'voided' AND sa.voided_at BETWEEN ? AND ?
    GROUP BY sa.voided_by, day HAVING COUNT(*) > ? ORDER BY voids DESC`, p.from, p.to, st.fraud_void_threshold);
  const candidates = all(s, `SELECT sa.number, sa.created_at, sa.total, u.display_name AS user, c.kind
    FROM sales sa JOIN users u ON u.id = sa.user_id JOIN cash_sessions c ON c.id = sa.cash_session_id
    WHERE sa.created_at BETWEEN ? AND ? AND c.kind = 'jour' ORDER BY sa.created_at`, p.from, p.to);
  const outOfHours = candidates.filter((r) => {
    const t = doualaClock(r.created_at as string);
    return t < st.opening_time || t >= st.closing_time;
  });
  const variances = all(s, `SELECT u.display_name AS user, COUNT(*) AS sessions, SUM(c.variance) AS total_variance,
      MIN(c.variance) AS worst_shortfall
    FROM cash_sessions c JOIN users u ON u.id = c.opened_by
    WHERE c.closed_at BETWEEN ? AND ? AND c.variance <> 0 GROUP BY c.opened_by HAVING COUNT(*) >= 2 ORDER BY sessions DESC`, p.from, p.to);
  return { period: p, void_threshold: st.fraud_void_threshold, voids, out_of_hours: outOfHours, repeated_variances: variances };
}

// ---------------------------------------------------------------- CSV

function csvCell(v: Cell): string {
  if (v === null) return '';
  const t = String(v);
  // Neutralise les formules des tableurs (injection CSV) et protège les séparateurs.
  const safe = /^[=+\-@\t\r]/.test(t) && typeof v === 'string' ? `'${t}` : t;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Export CSV `;` UTF-8 avec BOM (ouverture directe dans un tableur). */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '﻿\n';
  const cols = Object.keys(rows[0]!);
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => csvCell(r[c] ?? null)).join(';'))].join('\n') + '\n';
}
