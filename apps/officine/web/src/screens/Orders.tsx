import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Copy, FileDown, Plus, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProductPicker } from '../components/ProductPicker';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { Empty, PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime, xaf } from '../lib/format';
import { useSession } from '../lib/session';
import type { Page, Supplier } from '../lib/types';

const t = fr.orders;

interface OrderSummary { id: string; number: string; supplier_name: string; status: string; created_at: string; sent_at: string | null }
interface OrderLine { id: string; product_id: string; product_name: string; strength: string | null; qty_ordered: number; qty_received: number; unit_cost: number | null }
interface Order extends OrderSummary { supplier_id: string; lines: OrderLine[] }
interface Suggestion { supplier: Supplier; items: { product_id: string; name: string; stock: number; on_order: number; sales_30d: number; min_qty: number; max_qty: number; qty: number; rule: string }[] }

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function useSuppliers(all = false) {
  return useQuery({ queryKey: ['suppliers', all], queryFn: () => api<Supplier[]>('/suppliers', { query: all ? { include_inactive: 'true' } : {} }) });
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`/orders/${id}`) });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const send = useMutation({ mutationFn: () => api(`/orders/${id}/send`, { method: 'POST' }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const cancel = useMutation({ mutationFn: () => api(`/orders/${id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: () => { setCancelOpen(false); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const exportPdf = async (paper: 'A4' | '80mm') => {
    try {
      download(await api<Blob>(`/orders/${id}/export`, { query: { format: 'pdf', paper }, as: 'blob' }), `${q.data?.number ?? 'bon'}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const copyText = async () => {
    try {
      const text = await api<string>(`/orders/${id}/export`, { query: { format: 'text' }, as: 'text' });
      await navigator.clipboard.writeText(text);
      toast.success(t.copied);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <QueryState q={q}>
      {(o) => (
        <Card>
          <CardHeader
            title={`${o.number} · ${o.supplier_name}`}
            description={`${t.statuses[o.status]} · ${dateTime(o.created_at)}`}
            actions={
              <>
                {o.status === 'draft' ? <Button size="sm" onClick={() => send.mutate()}><Send /> {t.send}</Button> : null}
                {o.status === 'draft' || o.status === 'sent' ? <Button size="sm" variant="secondary" onClick={() => setCancelOpen(true)}><X /> {t.cancelOrder}</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => void exportPdf('A4')}><FileDown /> {t.pdfA4}</Button>
                <Button size="sm" variant="ghost" onClick={() => void exportPdf('80mm')}><FileDown /> {t.pdf80}</Button>
                <Button size="sm" variant="ghost" onClick={() => void copyText()}><Copy /> {t.whatsapp}</Button>
                <Button size="icon" variant="ghost" aria-label={fr.common.close} onClick={onClose}><X /></Button>
              </>
            }
          />
          <Table>
            <thead><tr><Th>{fr.common.product}</Th><Th className="text-right">{fr.common.qty}</Th><Th className="text-right">{fr.reception.ordered}</Th>{can('cost.view') ? <Th className="text-right">{fr.products.cost}</Th> : null}</tr></thead>
            <tbody>
              {o.lines.map((l) => (
                <Tr key={l.id}><Td>{l.product_name} {l.strength ?? ''}</Td><Td className="text-right tabular">{l.qty_ordered}</Td><Td className="text-right tabular">{l.qty_received}</Td>{can('cost.view') ? <Td className="text-right tabular">{xaf(l.unit_cost)}</Td> : null}</Tr>
              ))}
            </tbody>
          </Table>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title={t.cancelOrder}
            footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>{fr.common.cancel}</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => cancel.mutate()}>{fr.common.confirm}</Button></>}>
            <Field id="oc-reason" label={t.cancelReason}><Input id="oc-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </Dialog>
        </Card>
      )}
    </QueryState>
  );
}

function NewOrder({ initial, onCreated }: { initial?: { supplier_id: string; lines: { product_id: string; name: string; qty: number }[] }; onCreated: (id: string) => void }) {
  const suppliers = useSuppliers();
  const [supplier, setSupplier] = useState(initial?.supplier_id ?? '');
  const [lines, setLines] = useState(initial?.lines ?? []);
  const create = useMutation({
    mutationFn: () => api<Order>('/orders', { method: 'POST', body: { supplier_id: supplier, lines: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) } }),
    onSuccess: (o) => onCreated(o.id),
  });
  return (
    <Card>
      <CardHeader title={t.newOrder} actions={<Button onClick={() => create.mutate()} disabled={!supplier || !lines.length || create.isPending}>{fr.common.create}</Button>} />
      <CardBody className="flex flex-col gap-3">
        <Field id="no-sup" label={fr.reception.supplier}>
          <Select id="no-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">—</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <ProductPicker label={fr.common.product} onPick={(p) => setLines((ls) => (ls.some((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, name: `${p.name} ${p.strength ?? ''}`, qty: 1 }]))} />
        {lines.map((l, i) => (
          <div key={l.product_id} className="flex items-center gap-2">
            <span className="flex-1">{l.name}</span>
            <Input aria-label={fr.common.qty} inputMode="numeric" className="w-24 tabular" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) } : x)))} />
            <Button variant="ghost" size="icon" aria-label={fr.common.remove} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        {create.error ? <Alert tone="block">{errorMessage(create.error)}</Alert> : null}
      </CardBody>
    </Card>
  );
}

function Suggestions({ onUse }: { onUse: (v: { supplier_id: string; lines: { product_id: string; name: string; qty: number }[] }) => void }) {
  const suppliers = useSuppliers();
  const [supplier, setSupplier] = useState('');
  const q = useQuery({ queryKey: ['suggest', supplier], enabled: false, queryFn: () => api<Suggestion>('/orders/suggestions', { query: { supplier_id: supplier } }) });
  return (
    <Card>
      <CardHeader title={t.suggestions} actions={
        <>
          <Select aria-label={fr.reception.supplier} className="w-56" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{fr.reception.supplier}</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.lead_days} j)</option>)}
          </Select>
          <Button variant="secondary" disabled={!supplier} onClick={() => void q.refetch()}><Calculator /> {t.suggest}</Button>
        </>
      } />
      {q.data ? (
        q.data.items.length === 0 ? <Empty title={fr.common.none} /> : (
          <>
            <Table>
              <thead><tr><Th>{fr.common.product}</Th><Th className="text-right">{t.stock}</Th><Th className="text-right">{t.onOrder}</Th><Th className="text-right">{t.sales30}</Th><Th>Règle</Th><Th className="text-right">{fr.common.qty}</Th></tr></thead>
              <tbody>
                {q.data.items.map((i) => (
                  <Tr key={i.product_id}><Td>{i.name}</Td><Td className="text-right tabular">{i.stock}</Td><Td className="text-right tabular">{i.on_order}</Td><Td className="text-right tabular">{i.sales_30d}</Td><Td><Badge>{t.rule[i.rule]}</Badge></Td><Td className="text-right tabular font-semibold">{i.qty}</Td></Tr>
                ))}
              </tbody>
            </Table>
            <div className="p-3 text-right">
              <Button onClick={() => onUse({ supplier_id: supplier, lines: q.data.items.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty })) })}>{t.createFromSuggestion}</Button>
            </div>
          </>
        )
      ) : <CardBody className="text-muted">{fr.common.none}</CardBody>}
    </Card>
  );
}

function Suppliers() {
  const qc = useQueryClient();
  const q = useSuppliers(true);
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: edit?.name, phone: edit?.phone || null, email: edit?.email || null, lead_days: Number(edit?.lead_days ?? 2) };
      return edit?.id ? api(`/suppliers/${edit.id}`, { method: 'PATCH', body: { ...body, active: edit.active } }) : api('/suppliers', { method: 'POST', body });
    },
    onSuccess: () => { setEdit(null); void qc.invalidateQueries({ queryKey: ['suppliers'] }); },
  });
  return (
    <Card>
      <CardHeader title={t.suppliers} actions={<Button size="sm" onClick={() => setEdit({ name: '', lead_days: 2, active: true })}><Plus /> {t.newSupplier}</Button>} />
      <QueryState q={q} empty={(d) => d.length === 0}>
        {(d) => (
          <Table>
            <thead><tr><Th>{t.name}</Th><Th>{t.phone}</Th><Th>{t.lead}</Th><Th>{fr.common.status}</Th><Th /></tr></thead>
            <tbody>
              {d.map((s) => (
                <Tr key={s.id}><Td>{s.name}</Td><Td>{s.phone ?? '—'}</Td><Td className="tabular">{s.lead_days}</Td><Td><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? fr.accounts.active : fr.accounts.disabled}</Badge></Td>
                  <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(s)}>{fr.common.edit}</Button></Td></Tr>
              ))}
            </tbody>
          </Table>
        )}
      </QueryState>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? fr.common.edit : t.newSupplier}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{fr.common.cancel}</Button><Button disabled={!edit?.name?.trim() || save.isPending} onClick={() => save.mutate()}>{fr.common.save}</Button></>}>
        {edit ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field id="sp-name" label={t.name} className="md:col-span-2"><Input id="sp-name" autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field id="sp-phone" label={t.phone}><Input id="sp-phone" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field id="sp-email" label={t.email}><Input id="sp-email" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field id="sp-lead" label={t.lead}><Input id="sp-lead" inputMode="numeric" value={edit.lead_days ?? 2} onChange={(e) => setEdit({ ...edit, lead_days: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
            {edit.id ? <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {fr.accounts.active}</label> : null}
            {save.error ? <Alert tone="block" className="md:col-span-2">{errorMessage(save.error)}</Alert> : null}
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

/** UI-08 : commandes (R-01 à R-03). */
export default function Orders() {
  const [tab, setTab] = useState('orders');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ supplier_id: string; lines: { product_id: string; name: string; qty: number }[] } | undefined>();
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['orders', status], queryFn: () => api<Page<OrderSummary>>('/orders', { query: { status: status || undefined, limit: 50 } }) });
  return (
    <div>
      <PageHeader title={t.title} description={t.description} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="orders">{t.list}</TabsTrigger>
            <TabsTrigger value="new">{t.newOrder}</TabsTrigger>
            <TabsTrigger value="suggest">{t.suggestions}</TabsTrigger>
            <TabsTrigger value="suppliers">{t.suppliers}</TabsTrigger>
          </TabsList>
          <TabsContent value="orders" className="flex flex-col gap-4">
            <Select aria-label={fr.common.status} className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{fr.common.status} : tous</option>
              {Object.entries(t.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {selected ? <OrderDetail id={selected} onClose={() => setSelected(null)} /> : null}
            <Card>
              <QueryState q={list} empty={(d) => d.items.length === 0}>
                {(d) => (
                  <Table>
                    <thead><tr><Th>N°</Th><Th>{fr.reception.supplier}</Th><Th>{fr.common.status}</Th><Th>{fr.common.date}</Th></tr></thead>
                    <tbody>
                      {d.items.map((o) => (
                        <Tr key={o.id} className="cursor-pointer" onClick={() => setSelected(o.id)}>
                          <Td><button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => setSelected(o.id)}>{o.number}</button></Td>
                          <Td>{o.supplier_name}</Td><Td><Badge tone={o.status === 'received' ? 'success' : o.status === 'cancelled' ? 'neutral' : 'accent'}>{t.statuses[o.status]}</Badge></Td><Td>{dateTime(o.created_at)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </QueryState>
            </Card>
          </TabsContent>
          <TabsContent value="new">
            <NewOrder key={JSON.stringify(draft ?? null)} initial={draft} onCreated={(id) => { setDraft(undefined); setSelected(id); setTab('orders'); }} />
          </TabsContent>
          <TabsContent value="suggest"><Suggestions onUse={(v) => { setDraft(v); setTab('new'); }} /></TabsContent>
          <TabsContent value="suppliers"><Suppliers /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
