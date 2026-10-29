import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShoppingBasket } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession } from '../lib/session';
import type { Page, Supplier } from '../lib/types';
import { DemandDialog } from './cashier/DemandDialog';

const t = fr.demandList;

interface Demand { id: string; product_id: string | null; product_name: string | null; free_text: string | null; qty: number; criticity: number; note: string | null; at: string; resolved_at: string | null }
interface Summary { product_id: string | null; label: string; criticity: number; requests: number; qty: number; open: number; last_at: string }

const critTone = (c: number) => (c === 1 ? 'danger' : c === 2 ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral';

/** UI-11 : demandes non satisfaites (D-01, D-02). */
export default function DemandScreen() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [toOrder, setToOrder] = useState<Demand | null>(null);
  const [supplier, setSupplier] = useState('');
  const canList = can('order.manage');
  const summary = useQuery({ queryKey: ['demand-summary'], enabled: canList, queryFn: () => api<Summary[]>('/demand/summary') });
  const list = useQuery({ queryKey: ['demand-list'], enabled: canList, queryFn: () => api<Page<Demand>>('/demand', { query: { status: 'all', limit: 100 } }) });
  const suppliers = useQuery({ queryKey: ['suppliers'], enabled: canList, queryFn: () => api<Supplier[]>('/suppliers') });
  const add = useMutation({
    mutationFn: () => api<{ number: string }>(`/demand/${toOrder?.id}/to-order`, { method: 'POST', body: { supplier_id: supplier } }),
    onSuccess: (o) => { toast.success(`${t.added} ${o.number}`); setToOrder(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={<Button onClick={() => setRecording(true)}><Plus /> {t.record}</Button>} />
      <div className="p-6">
        {!canList ? <Alert>{t.onlyRecord}</Alert> : (
          <Tabs defaultValue="summary">
            <TabsList><TabsTrigger value="summary">{t.summary}</TabsTrigger><TabsTrigger value="detail">{t.detail}</TabsTrigger></TabsList>
            <TabsContent value="summary">
              <Card>
                <QueryState q={summary} empty={(d) => d.length === 0}>
                  {(d) => (
                    <Table>
                      <thead><tr><Th>{fr.common.product}</Th><Th>{t.criticity}</Th><Th className="text-right">{t.requests}</Th><Th className="text-right">{fr.common.qty}</Th><Th className="text-right">{t.open}</Th><Th>{fr.common.date}</Th></tr></thead>
                      <tbody>
                        {d.map((s, i) => (
                          <Tr key={`${s.product_id ?? s.label}-${i}`}><Td>{s.label}</Td><Td><Badge tone={critTone(s.criticity)}>{s.criticity}</Badge></Td><Td className="text-right tabular">{s.requests}</Td><Td className="text-right tabular">{s.qty}</Td><Td className="text-right tabular">{s.open}</Td><Td>{dateTime(s.last_at)}</Td></Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </QueryState>
              </Card>
            </TabsContent>
            <TabsContent value="detail">
              <Card>
                <CardHeader title={t.detail} />
                <QueryState q={list} empty={(d) => d.items.length === 0}>
                  {(d) => (
                    <Table>
                      <thead><tr><Th>{fr.common.date}</Th><Th>{fr.common.product}</Th><Th className="text-right">{fr.common.qty}</Th><Th>{t.criticity}</Th><Th>{fr.common.note}</Th><Th>{fr.common.status}</Th><Th /></tr></thead>
                      <tbody>
                        {d.items.map((x) => (
                          <Tr key={x.id}>
                            <Td>{dateTime(x.at)}</Td><Td>{x.product_name ?? x.free_text}</Td><Td className="text-right tabular">{x.qty}</Td><Td><Badge tone={critTone(x.criticity)}>{x.criticity}</Badge></Td><Td>{x.note ?? ''}</Td>
                            <Td>{x.resolved_at ? <Badge tone="success">{t.resolved}</Badge> : <Badge tone="accent">{t.open}</Badge>}</Td>
                            <Td>{!x.resolved_at && x.product_id ? <Button size="sm" variant="ghost" onClick={() => setToOrder(x)}><ShoppingBasket /> {t.toOrder}</Button> : null}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </QueryState>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
      <DemandDialog open={recording} onOpenChange={(o) => { setRecording(o); if (!o) { void qc.invalidateQueries({ queryKey: ['demand-summary'] }); void qc.invalidateQueries({ queryKey: ['demand-list'] }); } }} initial={null} />
      <Dialog open={toOrder !== null} onOpenChange={(o) => !o && setToOrder(null)} title={t.toOrder} description={toOrder?.product_name ?? ''}
        footer={<><Button variant="ghost" onClick={() => setToOrder(null)}>{fr.common.cancel}</Button><Button disabled={!supplier || add.isPending} onClick={() => add.mutate()}>{t.toOrder}</Button></>}>
        <Field id="dm-sup" label={t.supplier}>
          <Select id="dm-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">—</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </Dialog>
    </div>
  );
}
