import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Plus, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toast } from 'sonner';
import { LabelsButton } from '../components/Labels';
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
import { api, errorMessage } from '../lib/api';
import { dateTime, expiry, int, xaf } from '../lib/format';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { Page, Product, ProductDetail } from '../lib/types';

const t = fr.products;

interface Movement {
  id: string;
  lot_number: string;
  qty: number;
  kind: string;
  reason: string | null;
  at: string;
}

function useInvalidate(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['product', id] });
    void qc.invalidateQueries({ queryKey: ['movements', id] });
  };
}

function PriceCard({ p }: { p: ProductDetail }) {
  const { can } = useSession();
  const refresh = useInvalidate(p.id);
  const [price, setPrice] = useState(String(p.sale_price ?? ''));
  const [min, setMin] = useState(String(p.min_qty));
  const [max, setMax] = useState(String(p.max_qty));
  useEffect(() => {
    setPrice(String(p.sale_price ?? ''));
    setMin(String(p.min_qty));
    setMax(String(p.max_qty));
  }, [p]);
  const save = useMutation({
    mutationFn: async () => {
      if (price !== String(p.sale_price ?? '')) await api(`/products/${p.id}/price`, { method: 'PATCH', body: { sale_price: Number(price) } });
      if (min !== String(p.min_qty) || max !== String(p.max_qty)) {
        await api(`/products/${p.id}/thresholds`, { method: 'PATCH', body: { min_qty: Number(min), max_qty: Number(max) } });
      }
    },
    onSuccess: () => {
      toast.success(fr.common.saved);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const editable = can('price.edit');
  return (
    <Card>
      <CardHeader title={`${t.salePrice} · ${t.thresholds}`} actions={editable ? <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{fr.common.save}</Button> : null} />
      <CardBody className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field id="pp-price" label={t.salePrice} hint={`${t.suggested} : ${xaf(p.suggested_price)}`}>
          <Input id="pp-price" inputMode="numeric" className="tabular" disabled={!editable} value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field id="pp-min" label={t.min}><Input id="pp-min" inputMode="numeric" disabled={!editable} value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field id="pp-max" label={t.max}><Input id="pp-max" inputMode="numeric" disabled={!editable} value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /></Field>
      </CardBody>
    </Card>
  );
}

function StockDialogs({ lot, mode, onClose, productId }: { lot: ProductDetail['lots'][number] | null; mode: 'adjust' | 'destroy' | null; onClose: () => void; productId: string }) {
  const refresh = useInvalidate(productId);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('casse');
  const [text, setText] = useState('');
  const [pv, setPv] = useState('');
  useEffect(() => {
    setQty('');
    setText('');
    setPv('');
    setReason(mode === 'destroy' ? '' : 'casse');
  }, [mode, lot]);
  const run = useMutation({
    mutationFn: () =>
      mode === 'adjust'
        ? api('/stock/adjustments', { method: 'POST', body: { lot_id: lot?.id, qty: Number(qty), reason, reason_text: reason === 'autre' ? text : null } })
        : api('/stock/destructions', { method: 'POST', body: { lot_id: lot?.id, qty: Number(qty), reason, pv_number: pv } }),
    onSuccess: () => {
      toast.success(fr.common.saved);
      refresh();
      onClose();
    },
  });
  if (!lot || !mode) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'adjust' ? t.adjustTitle : t.destroyTitle}
      description={`${fr.common.lot} ${lot.lot_number} · ${fr.common.expiry} ${expiry(lot.expiry)} · ${fr.common.qty} ${lot.qty}`}
      footer={<><Button variant="ghost" onClick={onClose}>{fr.common.cancel}</Button><Button variant={mode === 'destroy' ? 'danger' : 'default'} onClick={() => run.mutate()} disabled={run.isPending || !qty || !reason}>{fr.common.confirm}</Button></>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="sd-qty" label={mode === 'adjust' ? t.adjustQty : fr.common.quantity}>
          <Input id="sd-qty" autoFocus className="tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(mode === 'adjust' ? /[^\d-]/g : /\D/g, ''))} />
        </Field>
        {mode === 'adjust' ? (
          <Field id="sd-reason" label={fr.common.reason}>
            <Select id="sd-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(t.reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        ) : (
          <Field id="sd-reason" label={fr.common.reason}><Input id="sd-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        )}
        {mode === 'adjust' && reason === 'autre' ? <Field id="sd-text" label={t.reasonText} className="md:col-span-2"><Input id="sd-text" value={text} onChange={(e) => setText(e.target.value)} /></Field> : null}
        {mode === 'destroy' ? <Field id="sd-pv" label={t.pv}><Input id="sd-pv" value={pv} onChange={(e) => setPv(e.target.value)} /></Field> : null}
        {run.error ? <Alert tone="block" className="md:col-span-2">{errorMessage(run.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}

function LinkBarcode({ productId, initial }: { productId: string; initial: string }) {
  const refresh = useInvalidate(productId);
  const [code, setCode] = useState(initial);
  const link = useMutation({
    mutationFn: () => api<{ created: boolean }>(`/products/${productId}/barcodes`, { method: 'POST', body: { code } }),
    onSuccess: () => {
      toast.success(fr.common.saved);
      setCode('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) link.mutate(); }}>
      <Input aria-label={t.link} placeholder={t.linkHelp} value={code} onChange={(e) => setCode(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={!code.trim() || link.isPending}><Barcode /> {t.link}</Button>
    </form>
  );
}

function Detail({ id, scanned }: { id: string; scanned: string | null }) {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<ProductDetail>(`/products/${id}`) });
  const moves = useQuery({ queryKey: ['movements', id], enabled: can('report.stock'), queryFn: () => api<Page<Movement>>('/stock/movements', { query: { product_id: id, limit: 50 } }) });
  const [dialog, setDialog] = useState<{ lot: ProductDetail['lots'][number]; mode: 'adjust' | 'destroy' } | null>(null);
  const withCost = can('cost.view');
  return (
    <QueryState q={q}>
      {(p) => (
        <div className="flex flex-col gap-4 p-4">
          <div>
            <h2 className="text-xl font-semibold">{p.name} {p.strength ?? ''}</h2>
            <p className="text-muted">{[p.dci, p.form, p.presentation, p.ref_code].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone={p.status === 'active' ? 'accent' : 'neutral'}>{t.status[p.status]}</Badge>
              <Badge>{t.categories[p.category] ?? p.category}</Badge>
              {p.rx_required ? <Badge tone="warning">{t.flags.rx}</Badge> : null}
              {p.sensitive ? <Badge tone="danger">{t.flags.sensitive}</Badge> : null}
              {p.local_only ? <Badge>{t.flags.local}</Badge> : null}
            </div>
          </div>
          <PriceCard p={p} />
          <Card>
            <CardHeader title={t.barcodes} actions={can('catalog.link') ? <LabelsButton productId={p.id} name={`${p.name} ${p.strength ?? ''}`.trim()} price={p.sale_price ?? p.suggested_price} onAssigned={() => void q.refetch()} /> : null} />
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">{p.barcodes.length ? p.barcodes.map((b) => <Badge key={b.code} className="font-mono">{b.code}</Badge>) : <span className="text-muted">—</span>}</div>
              {can('catalog.link') ? <LinkBarcode productId={p.id} initial={scanned ?? ''} /> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t.lots} />
            <Table>
              <thead><tr><Th>{fr.common.lot}</Th><Th>{fr.common.expiry}</Th><Th className="text-right">{fr.common.qty}</Th>{withCost ? <><Th className="text-right">{t.cost}</Th><Th className="text-right">{t.value}</Th></> : null}<Th /></tr></thead>
              <tbody>
                {p.lots.map((l) => (
                  <Tr key={l.id}>
                    <Td className="font-mono">{l.lot_number === '__REGUL__' ? fr.cashier.regul : l.lot_number}</Td>
                    <Td>{expiry(l.expiry)}</Td>
                    <Td className="text-right tabular">{int(l.qty)}</Td>
                    {withCost ? <><Td className="text-right tabular">{xaf(l.unit_cost)}</Td><Td className="text-right tabular">{l.unit_cost === null ? '—' : xaf(l.unit_cost * Math.max(0, l.qty))}</Td></> : null}
                    <Td className="text-right">
                      {can('stock.adjust') ? (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ lot: l, mode: 'adjust' })}><Wrench /> {t.adjust}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ lot: l, mode: 'destroy' })}><Trash2 /> {t.destroy}</Button>
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {p.lots.length === 0 ? <Empty title="—" /> : null}
          </Card>
          {can('report.stock') ? (
            <Card>
              <CardHeader title={t.movements} />
              <QueryState q={moves} empty={(d) => d.items.length === 0} emptyTitle="—">
                {(d) => (
                  <Table>
                    <thead><tr><Th>{fr.common.date}</Th><Th>{fr.common.lot}</Th><Th>Type</Th><Th className="text-right">{fr.common.qty}</Th><Th>{fr.common.reason}</Th></tr></thead>
                    <tbody>
                      {d.items.map((m) => (
                        <Tr key={m.id}><Td>{dateTime(m.at)}</Td><Td className="font-mono">{m.lot_number}</Td><Td>{t.kinds[m.kind] ?? m.kind}</Td><Td className="text-right tabular">{m.qty > 0 ? `+${m.qty}` : m.qty}</Td><Td>{m.reason ?? ''}</Td></Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </QueryState>
            </Card>
          ) : null}
          <StockDialogs lot={dialog?.lot ?? null} mode={dialog?.mode ?? null} productId={p.id} onClose={() => setDialog(null)} />
        </div>
      )}
    </QueryState>
  );
}

function LocalItem({ code, onCreated }: { code: string | null; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('medicament');
  const create = useMutation({
    mutationFn: () => api<Product>('/products/local', { method: 'POST', body: { name, category, ...(code ? { barcode: code } : {}) } }),
    onSuccess: (p) => {
      setOpen(false);
      onCreated(p.id);
    },
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Plus /> {t.local}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t.local} description={code ? `${fr.products.barcodes} : ${code}` : undefined}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{fr.common.cancel}</Button><Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>{fr.common.create}</Button></>}>
        <div className="flex flex-col gap-3">
          <Field id="li-name" label={t.localName}><Input id="li-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="li-cat" label={t.category}>
            <Select id="li-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(t.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {create.error ? <Alert tone="block">{errorMessage(create.error)}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}

/** UI-06 : produits et stock (C-01, C-03, C-06, S-05, S-07, S-09). */
export default function Products() {
  const { params, navigate } = useRouter();
  const { can } = useSession();
  const [id, setId] = useState<string | null>(params.get('id'));
  const scanned = params.get('code');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['products-list', q], queryFn: () => api<Page<Product>>('/products', { query: { q: q || undefined, limit: 50, status: q ? undefined : 'active' } }) });
  const open = (pid: string) => {
    setId(pid);
    navigate(`/produits?id=${pid}${scanned ? `&code=${encodeURIComponent(scanned)}` : ''}`, { replace: true });
  };
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t.title} description={t.description} actions={can('catalog.link') ? <LocalItem code={scanned} onCreated={open} /> : null} />
      {scanned ? <div className="px-6 pt-3"><Alert tone="warn" title={`${t.unknownCode} : ${scanned}`}>{t.unknownHelp}</Alert></div> : null}
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="36" minSize="25" className="flex flex-col border-r border-border">
          <div className="p-3"><ProductPicker label={t.search} placeholder={t.search} onPick={(p) => open(p.id)} onSubmitRaw={setQ} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <QueryState q={list} empty={(d) => d.items.length === 0}>
              {(d) => (
                <ul>
                  {d.items.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => open(p.id)} className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-surface-2 ${p.id === id ? 'bg-surface-2' : ''}`}>
                        <span className="min-w-0 truncate">{p.name} {p.strength ?? ''}</span>
                        <Badge tone={p.status === 'active' ? 'accent' : 'neutral'}>{t.status[p.status]}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </QueryState>
          </div>
        </Panel>
        <Separator className="w-1 bg-border hover:bg-accent" />
        <Panel defaultSize="64" minSize="40" className="overflow-y-auto">
          {id ? <Detail id={id} scanned={scanned} /> : <Empty title={t.none} />}
        </Panel>
      </Group>
    </div>
  );
}
