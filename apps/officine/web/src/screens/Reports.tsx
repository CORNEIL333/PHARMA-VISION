import { useQuery } from '@tanstack/react-query';
import { FileDown, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { Empty, PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime, dayRange, today, xaf } from '../lib/format';
import { useSession } from '../lib/session';
import type { CashSession, Row } from '../lib/types';
import { download } from './Orders';

const t = fr.reports;
const MONEY = /(amount|total|revenue|value_xaf|unit_cost|variance|discount|cash|price)/;

/** Impression de l'écran courant (rapports, clôture). */
export function printPage(): void {
  document.body.classList.add('vp-print-page');
  window.print();
  window.setTimeout(() => document.body.classList.remove('vp-print-page'), 500);
}

function cell(k: string, v: Row[string]): ReactNode {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return MONEY.test(k) ? xaf(v) : v;
  if (typeof v === 'boolean') return v ? fr.common.yes : fr.common.no;
  if (/_at$|^at$|created_at/.test(k) && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v);
  return v;
}

export function RowsTable({ title, rows }: { title?: string; rows: Row[] }) {
  const cols = rows[0] ? Object.keys(rows[0]).filter((c) => !c.endsWith('_id') && c !== 'lot_id') : [];
  return (
    <Card>
      {title ? <CardHeader title={title} /> : null}
      {rows.length === 0 ? <Empty title={fr.common.none} /> : (
        <Table>
          <thead><tr>{cols.map((c) => <Th key={c} className={typeof rows[0]?.[c] === 'number' ? 'text-right' : ''}>{c.replace(/_/g, ' ')}</Th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <Tr key={i}>{cols.map((c) => <Td key={c} className={typeof r[c] === 'number' ? 'text-right tabular' : ''}>{cell(c, r[c] ?? null)}</Td>)}</Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Kpis({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-vp border border-border bg-surface p-3">
          <p className="text-xs text-muted">{k}</p>
          <p className="tabular text-lg font-semibold">{v}</p>
        </div>
      ))}
    </div>
  );
}

function useReport<T>(path: string, query: Record<string, string | undefined>, enabled = true) {
  return useQuery({ queryKey: ['report', path, query], enabled, queryFn: () => api<T>(path, { query }) });
}

async function csv(path: string, query: Record<string, string | undefined>, name: string) {
  try {
    download(await api<Blob>(path, { query: { ...query, format: 'csv' }, as: 'blob' }), `${name}.csv`);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export function CashCloseReport({ sessionId }: { sessionId: string }) {
  const q = useReport<{ session: Row; provisional: boolean; tickets: number; gross: number; discounts: number; revenue: number; by_method: Row[]; voids: Row[]; discount_lines: Row[]; regul_sales: Row[]; expected_cash: number; counted_cash: number | null; variance: number | null }>(`/reports/cash-close/${sessionId}`, {});
  return (
    <QueryState q={q}>
      {(r) => (
        <div className="flex flex-col gap-3">
          {r.provisional ? <Alert tone="warn">{t.provisional}</Alert> : null}
          <Kpis items={[[t.tickets, r.tickets], [t.revenue, xaf(r.revenue)], [t.discounts, xaf(r.discounts)], [t.expected, xaf(r.expected_cash)], [t.counted, xaf(r.counted_cash)], [t.variance, xaf(r.variance)]]} />
          <RowsTable title={t.byMethod} rows={r.by_method.map((m) => ({ ...m, method: fr.payment.methods[String(m.method)] ?? m.method ?? null }))} />
          <RowsTable title={t.voids} rows={r.voids} />
          <RowsTable title={t.discounts} rows={r.discount_lines} />
          <RowsTable title={t.regul} rows={r.regul_sales} />
        </div>
      )}
    </QueryState>
  );
}

function Toolbar({ children, onCsv }: { children?: ReactNode; onCsv?: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
      {children}
      <span className="ml-auto flex gap-2">
        {onCsv ? <Button variant="secondary" onClick={onCsv}><FileDown /> {fr.common.exportCsv}</Button> : null}
        <Button variant="secondary" onClick={printPage}><Printer /> {fr.common.print}</Button>
      </span>
    </div>
  );
}

/** UI-12 : rapports P-01 à P-08 (consultables, imprimables, exportables en CSV). */
export default function Reports() {
  const { can } = useSession();
  const [day, setDay] = useState({ from: today(), to: today() });
  const [days, setDays] = useState('90');
  const [sessionId, setSessionId] = useState('');
  const [tab, setTab] = useState('cash');
  const range = { from: dayRange(day.from).from, to: dayRange(day.to).to };
  const sessions = useQuery({ queryKey: ['cash-sessions'], queryFn: () => api<CashSession[]>('/cash/sessions') });
  const sales = useReport<{ tickets: number; revenue: number; discounts: number; average_basket: number; top_products: Row[]; by_category: Row[]; by_user: Row[] }>('/reports/sales', range, can('report.sales') && tab === 'sales');
  const expiryQ = useReport<{ rows: Row[] }>('/reports/expiry', { days }, can('report.stock') && tab === 'expiry');
  const value = useReport<{ rows: Row[]; total_value_xaf: number | null; unknown_cost_qty: number }>('/reports/stock-value', {}, can('cost.view') && tab === 'value');
  const dead = useReport<{ rows: Row[] }>('/reports/dead-stock', { days }, can('report.stock') && tab === 'dead');
  const compliance = useReport<{ rx_sales: Row[]; sensitive_register: Row[]; recalls: Row[]; adjustments: Row[] }>('/reports/compliance', range, can('report.sales') && tab === 'compliance');
  const demand = useReport<{ rows: Row[] }>('/reports/unmet-demand', range, can('report.stock') && tab === 'demand');
  const fraud = useReport<{ voids: Row[]; out_of_hours: Row[]; repeated_variances: Row[]; void_threshold: number }>('/reports/fraud', range, can('settings.edit') && tab === 'fraud');
  const period = (
    <>
      <Field id="rp-from" label={fr.common.from}><Input id="rp-from" type="date" value={day.from} onChange={(e) => setDay({ ...day, from: e.target.value })} /></Field>
      <Field id="rp-to" label={fr.common.to}><Input id="rp-to" type="date" value={day.to} onChange={(e) => setDay({ ...day, to: e.target.value })} /></Field>
    </>
  );
  const horizon = <Field id="rp-days" label={t.days}><Input id="rp-days" inputMode="numeric" className="w-24" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '') || '90')} /></Field>;
  return (
    <div>
      <PageHeader title={t.title} description={t.description} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="print:hidden">
            <TabsTrigger value="cash">{t.tabs.cash}</TabsTrigger>
            {can('report.stock') ? <TabsTrigger value="expiry">{t.tabs.expiry}</TabsTrigger> : null}
            {can('report.sales') ? <TabsTrigger value="sales">{t.tabs.sales}</TabsTrigger> : null}
            {can('cost.view') ? <TabsTrigger value="value">{t.tabs.value}</TabsTrigger> : null}
            {can('report.stock') ? <TabsTrigger value="dead">{t.tabs.dead}</TabsTrigger> : null}
            {can('report.sales') ? <TabsTrigger value="compliance">{t.tabs.compliance}</TabsTrigger> : null}
            {can('report.stock') ? <TabsTrigger value="demand">{t.tabs.demand}</TabsTrigger> : null}
            {can('settings.edit') ? <TabsTrigger value="fraud">{t.tabs.fraud}</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="cash">
            <Toolbar onCsv={sessionId ? () => void csv(`/reports/cash-close/${sessionId}`, {}, 'cloture') : undefined}>
              <Field id="rp-session" label={t.session}>
                <Select id="rp-session" className="w-80" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  <option value="">—</option>
                  {sessions.data?.map((s) => <option key={s.id} value={s.id}>{dateTime(s.opened_at)} · {s.register} · {s.opened_by_name}{s.closed_at ? '' : ' (ouverte)'}</option>)}
                </Select>
              </Field>
            </Toolbar>
            {sessionId ? <CashCloseReport sessionId={sessionId} /> : <Empty title={t.session} />}
          </TabsContent>
          <TabsContent value="expiry">
            <Toolbar onCsv={() => void csv('/reports/expiry', { days }, 'peremptions')}>{horizon}</Toolbar>
            <QueryState q={expiryQ}>{(r) => <RowsTable rows={r.rows.map((x) => ({ ...x, bucket: x.bucket === 'perime' ? 'Périmé' : `≤ ${x.bucket} j` }))} />}</QueryState>
          </TabsContent>
          <TabsContent value="sales">
            <Toolbar onCsv={() => void csv('/reports/sales', range, 'ventes')}>{period}</Toolbar>
            <QueryState q={sales}>{(r) => (
              <div className="flex flex-col gap-3">
                <Kpis items={[[t.revenue, xaf(r.revenue)], [t.tickets, r.tickets], [t.basket, xaf(r.average_basket)], [t.discounts, xaf(r.discounts)]]} />
                <RowsTable title={t.top} rows={r.top_products} />
                <RowsTable title={t.byCategory} rows={r.by_category.map((c) => ({ ...c, category: fr.products.categories[String(c.category)] ?? c.category ?? null }))} />
                <RowsTable title={t.byUser} rows={r.by_user} />
              </div>
            )}</QueryState>
          </TabsContent>
          <TabsContent value="value">
            <Toolbar onCsv={() => void csv('/reports/stock-value', {}, 'stock-valorise')} />
            <QueryState q={value}>{(r) => (
              <div className="flex flex-col gap-3">
                <Kpis items={[[t.total, xaf(r.total_value_xaf)], ['Qté au coût inconnu', r.unknown_cost_qty]]} />
                <RowsTable rows={r.rows} />
              </div>
            )}</QueryState>
          </TabsContent>
          <TabsContent value="dead">
            <Toolbar onCsv={() => void csv('/reports/dead-stock', { days }, 'stock-immobilise')}>{horizon}</Toolbar>
            <QueryState q={dead}>{(r) => <RowsTable rows={r.rows} />}</QueryState>
          </TabsContent>
          <TabsContent value="compliance">
            <Toolbar onCsv={() => void csv('/reports/compliance', range, 'registre-sensibles')}>{period}</Toolbar>
            <QueryState q={compliance}>{(r) => (
              <div className="flex flex-col gap-3">
                <RowsTable title={t.rxSales} rows={r.rx_sales} />
                <RowsTable title={t.sensitive} rows={r.sensitive_register} />
                <RowsTable title={t.recalls} rows={r.recalls} />
                <RowsTable title={t.adjustments} rows={r.adjustments} />
              </div>
            )}</QueryState>
          </TabsContent>
          <TabsContent value="demand">
            <Toolbar onCsv={() => void csv('/reports/unmet-demand', range, 'demandes')}>{period}</Toolbar>
            <QueryState q={demand}>{(r) => <RowsTable rows={r.rows} />}</QueryState>
          </TabsContent>
          <TabsContent value="fraud">
            <Toolbar onCsv={() => void csv('/reports/fraud', range, 'alertes')}>{period}</Toolbar>
            <QueryState q={fraud}>{(r) => (
              <div className="flex flex-col gap-3">
                <RowsTable title={`${t.voids} (> ${r.void_threshold}/jour)`} rows={r.voids} />
                <RowsTable title={t.outOfHours} rows={r.out_of_hours} />
                <RowsTable title={t.variances} rows={r.repeated_variances} />
              </div>
            )}</QueryState>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
