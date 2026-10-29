import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProductPicker } from '../components/ProductPicker';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime, expiry, xaf } from '../lib/format';
import { useSession } from '../lib/session';
import type { BarcodeLookup, Page, Product, ProductDetail } from '../lib/types';

const t = fr.inventory;

interface Session { id: string; scope: string; status: string; product_ids: string[]; opened_at: string; validated_at: string | null }
interface ReportLine { lot_id: string; product_name: string; lot_number: string; expiry: string | null; system_qty: number; counted_qty: number; delta: number; delta_value_xaf?: number | null }
interface Report { counted_lots: number; total_delta_qty: number; total_delta_value_xaf?: number | null; lines: ReportLine[] }

function NewSession({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [shelf, setShelf] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const create = useMutation({
    mutationFn: () => api<Session>('/inventories', { method: 'POST', body: shelf.trim() ? { scope: shelf.trim(), product_ids: products.map((p) => p.id) } : { scope: 'complet' } }),
    onSuccess: (s) => { setOpen(false); onCreated(s.id); },
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> {t.newSession}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t.newSession}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{fr.common.cancel}</Button><Button disabled={create.isPending || (!!shelf.trim() && products.length === 0)} onClick={() => create.mutate()}>{fr.common.create}</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-muted">{t.complete} : laissez le rayon vide.</p>
          <Field id="inv-shelf" label={t.shelf}><Input id="inv-shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} /></Field>
          {shelf.trim() ? (
            <>
              <ProductPicker label={t.shelfProducts} placeholder={t.shelfProducts} onPick={(p) => setProducts((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p]))} />
              <div className="flex flex-wrap gap-1">{products.map((p) => <Badge key={p.id}>{p.name}</Badge>)}</div>
            </>
          ) : null}
          {create.error ? <Alert tone="block">{errorMessage(create.error)}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}

function CountProduct({ sessionId, productId, onDone }: { sessionId: string; productId: string; onDone: () => void }) {
  const q = useQuery({ queryKey: ['product', productId], queryFn: () => api<ProductDetail>(`/products/${productId}`) });
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [found, setFound] = useState({ lot_number: '', expiry: '', qty: '' });
  const save = useMutation({
    mutationFn: async () => {
      for (const [lot_id, v] of Object.entries(counts)) {
        if (v !== '') await api(`/inventories/${sessionId}/counts`, { method: 'POST', body: { lot_id, counted_qty: Number(v) } });
      }
      if (found.lot_number.trim() && found.expiry && found.qty !== '') {
        await api(`/inventories/${sessionId}/counts`, { method: 'POST', body: { product_id: productId, lot_number: found.lot_number.trim(), expiry: found.expiry, counted_qty: Number(found.qty) } });
      }
    },
    onSuccess: () => { toast.success(fr.common.saved); onDone(); },
  });
  return (
    <QueryState q={q}>
      {(p) => (
        <Card>
          <CardHeader title={`${p.name} ${p.strength ?? ''}`} actions={<Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{t.count}</Button>} />
          <CardBody className="flex flex-col gap-2">
            {p.lots.filter((l) => l.lot_number !== '__REGUL__').map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                <span className="w-40 font-mono">{l.lot_number}</span>
                <span className="w-24 text-muted">{expiry(l.expiry)}</span>
                <Input aria-label={`${t.counted} ${l.lot_number}`} inputMode="numeric" className="w-28 tabular" placeholder={t.counted} value={counts[l.id] ?? ''} onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value.replace(/\D/g, '') })} />
              </div>
            ))}
            <fieldset className="mt-2 grid grid-cols-3 gap-2 rounded-vp border border-border p-2">
              <legend className="px-1 text-xs text-muted">{t.discovered}</legend>
              <Input aria-label={fr.common.lot} placeholder={fr.common.lot} value={found.lot_number} onChange={(e) => setFound({ ...found, lot_number: e.target.value })} />
              <Input aria-label={fr.common.expiry} type="date" value={found.expiry} onChange={(e) => setFound({ ...found, expiry: e.target.value })} />
              <Input aria-label={t.counted} inputMode="numeric" placeholder={t.counted} value={found.qty} onChange={(e) => setFound({ ...found, qty: e.target.value.replace(/\D/g, '') })} />
            </fieldset>
            {save.error ? <Alert tone="block">{errorMessage(save.error)}</Alert> : null}
          </CardBody>
        </Card>
      )}
    </QueryState>
  );
}

function SessionView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [product, setProduct] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['inventory', id], queryFn: () => api<{ session: Session; report: Report }>(`/inventories/${id}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['inventory', id] });
  const validate = useMutation({
    mutationFn: () => api(`/inventories/${id}/validate`, { method: 'POST' }),
    onSuccess: () => { toast.success(t.statuses.validated); refresh(); void qc.invalidateQueries({ queryKey: ['inventories'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const scan = async (raw: string) => {
    const r = await api<BarcodeLookup>(`/products/by-barcode/${encodeURIComponent(raw.trim())}`).catch(() => null);
    if (r?.product) setProduct(r.product.id);
    else toast.warning(fr.cashier.unknownCode);
  };
  return (
    <QueryState q={q}>
      {({ session, report }) => (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={`${session.scope === 'complet' ? t.complete : session.scope} · ${t.statuses[session.status]}`}
              description={dateTime(session.opened_at)}
              actions={session.status === 'open' && can('inventory.validate') ? <Button onClick={() => validate.mutate()} disabled={validate.isPending}><CheckCircle2 /> {t.validate}</Button> : null}
            />
            {session.status === 'open' ? (
              <CardBody><ProductPicker label={t.countPlaceholder} placeholder={t.countPlaceholder} autoFocus onPick={(p) => setProduct(p.id)} onSubmitRaw={(raw) => void scan(raw)} /></CardBody>
            ) : null}
          </Card>
          {product && session.status === 'open' ? <CountProduct sessionId={id} productId={product} onDone={() => { setProduct(null); refresh(); }} /> : null}
          <Card>
            <CardHeader title={t.report} description={`${report.counted_lots} lot(s) · ${t.delta} ${report.total_delta_qty}${report.total_delta_value_xaf !== undefined ? ` · ${t.deltaValue} ${xaf(report.total_delta_value_xaf)}` : ''}`} />
            <Table>
              <thead><tr><Th>{fr.common.product}</Th><Th>{fr.common.lot}</Th><Th className="text-right">{t.system}</Th><Th className="text-right">{t.counted}</Th><Th className="text-right">{t.delta}</Th>{report.total_delta_value_xaf !== undefined ? <Th className="text-right">{t.deltaValue}</Th> : null}</tr></thead>
              <tbody>
                {report.lines.map((l) => (
                  <Tr key={l.lot_id}>
                    <Td>{l.product_name}</Td><Td className="font-mono">{l.lot_number}</Td><Td className="text-right tabular">{l.system_qty}</Td><Td className="text-right tabular">{l.counted_qty}</Td>
                    <Td className={`text-right tabular ${l.delta < 0 ? 'text-danger' : l.delta > 0 ? 'text-success' : ''}`}>{l.delta}</Td>
                    {l.delta_value_xaf !== undefined ? <Td className="text-right tabular">{xaf(l.delta_value_xaf)}</Td> : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

/** UI-09 : inventaire (S-06). */
export default function Inventory() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['inventories'], queryFn: () => api<Page<Session>>('/inventories') });
  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={<NewSession onCreated={setSelected} />} />
      <div className="grid gap-4 p-6 xl:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader title={t.sessions} />
          <QueryState q={list} empty={(d) => d.items.length === 0}>
            {(d) => (
              <ul>
                {d.items.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSelected(s.id)} className={`flex w-full items-center justify-between px-4 py-2 text-left hover:bg-surface-2 ${s.id === selected ? 'bg-surface-2' : ''}`}>
                      <span>{s.scope === 'complet' ? t.complete : s.scope}<span className="block text-xs text-muted">{dateTime(s.opened_at)}</span></span>
                      <Badge tone={s.status === 'open' ? 'accent' : 'neutral'}>{t.statuses[s.status]}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>
        {selected ? <SessionView id={selected} /> : null}
      </div>
    </div>
  );
}
