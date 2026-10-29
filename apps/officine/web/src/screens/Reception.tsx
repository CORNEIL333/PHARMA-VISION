import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageMinus, Trash2, Truck } from 'lucide-react';
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
import { fr } from '../i18n/fr';
import { api, ApiError, errorMessage } from '../lib/api';
import { dateTime, expiry, today } from '../lib/format';
import { useSession } from '../lib/session';
import type { BarcodeLookup, Page, Product, ProductDetail, Supplier } from '../lib/types';

const t = fr.reception;

interface Line {
  product_id: string;
  name: string;
  lot_number: string;
  expiry: string;
  qty: string;
  unit_cost: string;
  confirm: boolean;
}
interface OrderSummary { id: string; number: string; supplier_id: string; supplier_name: string; status: string }
interface Order extends OrderSummary { lines: { product_id: string; product_name: string; qty_ordered: number; qty_received: number; unit_cost: number | null }[] }
interface Reception { id: string; po_number: string | null; supplier_name: string | null; received_at: string; lines: { product_name: string; lot_number: string; qty: number }[] }

const in90 = () => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString().slice(0, 10);
};

function SupplierReturn() {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [lotId, setLotId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const detail = useQuery({ queryKey: ['product', product?.id], enabled: !!product, queryFn: () => api<ProductDetail>(`/products/${product?.id}`) });
  const run = useMutation({
    mutationFn: () => api('/supplier-returns', { method: 'POST', body: { supplier_id: supplier, lot_id: lotId, qty: Number(qty), reason } }),
    onSuccess: () => { toast.success(fr.common.saved); setOpen(false); },
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><PackageMinus /> {t.returnTitle}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t.returnTitle}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{fr.common.cancel}</Button><Button onClick={() => run.mutate()} disabled={!supplier || !lotId || !qty || !reason.trim() || run.isPending}>{fr.common.confirm}</Button></>}>
        <div className="flex flex-col gap-3">
          <Field id="r-sup" label={t.supplier}>
            <Select id="r-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">—</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          {product ? <p className="font-medium">{product.name}</p> : <ProductPicker label={fr.common.product} onPick={setProduct} />}
          <Field id="r-lot" label={t.returnLot}>
            <Select id="r-lot" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">—</option>
              {detail.data?.lots.filter((l) => l.qty > 0 && l.lot_number !== '__REGUL__').map((l) => <option key={l.id} value={l.id}>{l.lot_number} · {expiry(l.expiry)} · {l.qty}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field id="r-qty" label={fr.common.quantity}><Input id="r-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field id="r-reason" label={t.returnReason}><Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
          {run.error ? <Alert tone="block">{errorMessage(run.error)}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}

/** UI-07 : réception (R-04, R-05), scan GS1, rapprochement avec le bon ; retour fournisseur (R-06). */
export default function Reception() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [poId, setPoId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['orders-receivable'],
    queryFn: async () => {
      const [a, b] = await Promise.all([api<Page<OrderSummary>>('/orders', { query: { status: 'sent' } }), api<Page<OrderSummary>>('/orders', { query: { status: 'partial' } })]);
      return [...a.items, ...b.items];
    },
  });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const order = useQuery({ queryKey: ['order', poId], enabled: !!poId, queryFn: () => api<Order>(`/orders/${poId}`) });
  const history = useQuery({ queryKey: ['receptions'], queryFn: () => api<Page<Reception>>('/receptions', { query: { limit: 10 } }) });
  const withCost = can('cost.view');

  const add = (p: { id: string; name: string; strength?: string | null }, gs1?: { lot: string | null; expiry: string | null }) => {
    const cost = order.data?.lines.find((l) => l.product_id === p.id)?.unit_cost;
    setLines((ls) => [...ls, {
      product_id: p.id, name: `${p.name} ${p.strength ?? ''}`.trim(), lot_number: gs1?.lot ?? '', expiry: gs1?.expiry ?? '',
      qty: '1', unit_cost: cost ? String(cost) : '', confirm: false,
    }]);
  };
  const scan = async (raw: string) => {
    try {
      const r = await api<BarcodeLookup>(`/products/by-barcode/${encodeURIComponent(raw.trim())}`);
      if (r.found && r.product) add(r.product, r.gs1 ?? undefined);
      else toast.warning(`${fr.cashier.unknownCode} : ${r.code}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = useMutation({
    mutationFn: () => api('/receptions', {
      method: 'POST',
      body: {
        po_id: poId || null, supplier_id: poId ? null : supplierId || null,
        lines: lines.map((l) => ({
          product_id: l.product_id, lot_number: l.lot_number.trim(), expiry: l.expiry, qty: Number(l.qty),
          ...(withCost || l.unit_cost ? { unit_cost: l.unit_cost === '' ? null : Number(l.unit_cost) } : {}), confirm_near_expiry: l.confirm,
        })),
      },
    }),
    onSuccess: () => {
      toast.success(t.saved);
      setLines([]);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['receptions'] });
      void qc.invalidateQueries({ queryKey: ['orders-receivable'] });
      void qc.invalidateQueries({ queryKey: ['order'] });
    },
    onError: (e) => setError(e instanceof ApiError ? errorMessage(e) : fr.common.unknownError),
  });
  const soon = in90();
  const valid = lines.length > 0 && lines.every((l) => l.lot_number.trim() && /^\d{4}-\d{2}-\d{2}$/.test(l.expiry) && Number(l.qty) > 0 && (l.expiry >= soon || l.confirm));

  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={<SupplierReturn />} />
      <div className="grid gap-4 p-6 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="grid gap-3 md:grid-cols-2">
              <Field id="rc-po" label={t.order}>
                <Select id="rc-po" value={poId} onChange={(e) => { setPoId(e.target.value); setLines([]); }}>
                  <option value="">{t.noOrder}</option>
                  {orders.data?.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.supplier_name} · {fr.orders.statuses[o.status]}</option>)}
                </Select>
              </Field>
              {!poId ? (
                <Field id="rc-sup" label={t.supplier}>
                  <Select id="rc-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">—</option>
                    {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
              ) : null}
              <ProductPicker className="md:col-span-2" label={t.scan} placeholder={t.scan} autoFocus onPick={(p) => add(p)} onSubmitRaw={(raw) => void scan(raw)} />
            </CardBody>
          </Card>
          {order.data ? (
            <Card>
              <CardHeader title={`${order.data.number} · ${order.data.supplier_name}`} />
              <Table>
                <thead><tr><Th>{fr.common.product}</Th><Th className="text-right">{t.ordered}</Th><Th /></tr></thead>
                <tbody>
                  {order.data.lines.map((l) => (
                    <Tr key={l.product_id}>
                      <Td>{l.product_name}</Td>
                      <Td className="text-right tabular">{l.qty_ordered} / {l.qty_received}</Td>
                      <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => add({ id: l.product_id, name: l.product_name })}>{fr.common.add}</Button></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={fr.orders.lines} actions={<Button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}><Truck /> {t.submit}</Button>} />
            {lines.length === 0 ? <Empty title={t.empty} /> : (
              <Table>
                <thead><tr><Th>{fr.common.product}</Th><Th>{t.lotNumber}</Th><Th>{t.expiry}</Th><Th>{t.qty}</Th>{withCost ? <Th>{t.cost}</Th> : null}<Th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <Tr key={i}>
                      <Td>{l.name}{l.expiry && l.expiry < soon ? (
                        <label className="mt-1 flex items-center gap-1 text-xs text-warning"><input type="checkbox" checked={l.confirm} onChange={(e) => update(i, { confirm: e.target.checked })} /> {t.near}</label>
                      ) : null}</Td>
                      <Td><Input aria-label={t.lotNumber} className="h-8 font-mono" value={l.lot_number} onChange={(e) => update(i, { lot_number: e.target.value })} /></Td>
                      <Td><Input aria-label={t.expiry} type="date" className="h-8" value={l.expiry} onChange={(e) => update(i, { expiry: e.target.value })} /></Td>
                      <Td><Input aria-label={t.qty} inputMode="numeric" className="h-8 w-20 tabular" value={l.qty} onChange={(e) => update(i, { qty: e.target.value.replace(/\D/g, '') })} /></Td>
                      {withCost ? <Td><Input aria-label={t.cost} inputMode="numeric" className="h-8 w-28 tabular" value={l.unit_cost} onChange={(e) => update(i, { unit_cost: e.target.value.replace(/\D/g, '') })} /></Td> : null}
                      <Td><Button variant="ghost" size="icon" aria-label={fr.common.remove} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {error ? <div className="p-3"><Alert tone="block">{error}</Alert></div> : null}
          </Card>
        </div>
        <Card>
          <CardHeader title={t.history} />
          <QueryState q={history} empty={(d) => d.items.length === 0}>
            {(d) => (
              <ul className="divide-y divide-border/60">
                {d.items.map((r) => (
                  <li key={r.id} className="px-4 py-2">
                    <p className="text-xs text-muted">{dateTime(r.received_at)} · {r.po_number ?? r.supplier_name ?? '—'}</p>
                    <p className="text-sm">{r.lines.map((l) => `${l.product_name} ×${l.qty}`).join(', ')}</p>
                    {r.po_number ? <Badge>{r.po_number}</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
