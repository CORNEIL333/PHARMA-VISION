import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProductPicker } from '../components/ProductPicker';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime, expiry } from '../lib/format';
import { useRouter } from '../lib/router';
import { useSession } from '../lib/session';
import type { Product } from '../lib/types';

const t = fr.recalls;

interface Recall {
  id: string;
  reference: string;
  product_name: string;
  lot_number: string | null;
  reason: string;
  source: string;
  active: boolean;
  created_at: string;
  blocked_lots: { lot_id: string; lot_number: string; expiry: string | null; qty: number }[];
}

function CreateRecall({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [f, setF] = useState({ reference: '', lot_number: '', reason: '', source: 'DPML' });
  const create = useMutation({
    mutationFn: () => api('/recalls', { method: 'POST', body: { ...f, lot_number: f.lot_number || null, product_id: product?.id } }),
    onSuccess: () => { toast.success(fr.common.saved); onOpenChange(false); setProduct(null); void qc.invalidateQueries({ queryKey: ['recalls'] }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.create}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>{fr.common.cancel}</Button><Button variant="danger" disabled={!product || !f.reference.trim() || !f.reason.trim() || create.isPending} onClick={() => create.mutate()}>{t.create}</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="rc-ref" label={t.reference}><Input id="rc-ref" autoFocus value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field id="rc-src" label={t.source}>
          <Select id="rc-src" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            {Object.entries(t.sources).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <div className="md:col-span-2">{product ? <p className="font-medium">{product.name} {product.strength ?? ''}</p> : <ProductPicker label={t.product} placeholder={t.product} onPick={setProduct} />}</div>
        <Field id="rc-lot" label={t.lot}><Input id="rc-lot" value={f.lot_number} onChange={(e) => setF({ ...f, lot_number: e.target.value })} /></Field>
        <Field id="rc-reason" label={t.reason}><Input id="rc-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {create.error ? <Alert tone="block" className="md:col-span-2">{errorMessage(create.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}

/** UI-10 : rappels (Q-01, Q-02, Q-05), lots bloqués. */
export default function Recalls() {
  const { can } = useSession();
  const { params } = useRouter();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(params.get('nouveau') === '1');
  const [closing, setClosing] = useState<Recall | null>(null);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['recalls'], queryFn: () => api<Recall[]>('/recalls') });
  const close = useMutation({
    mutationFn: () => api(`/recalls/${closing?.id}/close`, { method: 'POST', body: { reason } }),
    onSuccess: () => { setClosing(null); setReason(''); void qc.invalidateQueries({ queryKey: ['recalls'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await api<{ created: number }>('/recalls/import', { method: 'POST', raw: { data: await file.text(), type: 'text/csv' } });
      toast.success(`${r.created} rappel(s) importé(s)`);
      void qc.invalidateQueries({ queryKey: ['recalls'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={can('recall.create') ? (
        <>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-vp border border-border px-3 text-sm hover:bg-surface-2" title={t.importHelp}>
            <Upload className="size-4" /> {t.import}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void importFile(e.target.files?.[0])} />
          </label>
          <Button variant="danger" onClick={() => setCreating(true)}><Plus /> {t.create}</Button>
        </>
      ) : null} />
      <div className="p-6">
        <Card>
          <CardHeader title={t.title} />
          <QueryState q={q} empty={(d) => d.length === 0}>
            {(d) => (
              <Table>
                <thead><tr><Th>{t.reference}</Th><Th>{t.product}</Th><Th>{fr.common.lot}</Th><Th>{t.reason}</Th><Th>{t.source}</Th><Th>{t.blocked}</Th><Th>{fr.common.status}</Th><Th /></tr></thead>
                <tbody>
                  {d.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-mono">{r.reference}</Td><Td>{r.product_name}</Td><Td>{r.lot_number ?? 'tous'}</Td><Td>{r.reason}</Td><Td>{t.sources[r.source] ?? r.source}</Td>
                      <Td className="text-xs">{r.blocked_lots.filter((l) => l.qty > 0).map((l) => `${l.lot_number} (${expiry(l.expiry)}) ×${l.qty}`).join(', ') || '—'}</Td>
                      <Td><Badge tone={r.active ? 'danger' : 'neutral'}>{r.active ? t.active : t.closed}</Badge><span className="block text-xs text-muted">{dateTime(r.created_at)}</span></Td>
                      <Td>{r.active && can('recall.create') ? <Button size="sm" variant="ghost" onClick={() => setClosing(r)}>{t.close}</Button> : null}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryState>
        </Card>
      </div>
      <CreateRecall open={creating} onOpenChange={setCreating} />
      <Dialog open={closing !== null} onOpenChange={(o) => !o && setClosing(null)} title={t.close}
        footer={<><Button variant="ghost" onClick={() => setClosing(null)}>{fr.common.cancel}</Button><Button disabled={!reason.trim()} onClick={() => close.mutate()}>{fr.common.confirm}</Button></>}>
        <Field id="rc-close" label={t.closeReason}><Input id="rc-close" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
