import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { Empty, LoadingRows, PageHeader } from '../components/ui/misc';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { openCashDrawer, registerName } from '../lib/desktop';
import { dateTime, xaf } from '../lib/format';
import type { CashSession } from '../lib/types';
import { CashCloseReport, printPage } from './Reports';

const t = fr.close;

/** UI-15 : clôture de caisse (V-08, P-01, G-01). */
export default function CashClose() {
  const qc = useQueryClient();
  const [register, setRegister] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [closedId, setClosedId] = useState<string | null>(null);
  useEffect(() => void registerName().then(setRegister), []);
  const current = useQuery({
    queryKey: ['cash-current', register],
    enabled: register !== null,
    queryFn: () => api<{ session: CashSession | null }>('/cash/sessions/current', { query: { register: register ?? '' } }),
  });
  const close = useMutation({
    mutationFn: (id: string) => api<CashSession>(`/cash/sessions/${id}/close`, { method: 'POST', body: { counted_cash: Number(counted || 0), note: note || null } }),
    onSuccess: (s) => {
      toast.success(`${t.done} · ${fr.reports.variance} ${xaf(s.variance)}`);
      setClosedId(s.id);
      setCounted('');
      void qc.invalidateQueries({ queryKey: ['cash-current'] });
    },
  });
  if (register === null || current.isLoading) return <LoadingRows rows={6} />;
  const s = current.data?.session ?? null;
  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={closedId ? <Button variant="secondary" onClick={printPage}><Printer /> {fr.common.print}</Button> : null} />
      <div className="grid gap-4 p-6 xl:grid-cols-[360px_1fr]">
        <Card className="print:hidden">
          <CardHeader title={s ? `${s.register} · ${s.kind === 'garde' ? fr.cashier.garde : fr.cashier.session}` : t.title} description={s ? `${dateTime(s.opened_at)} · ${s.opened_by_name} · fond ${xaf(s.opening_float)}` : undefined} />
          <CardBody>
            {s ? (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); close.mutate(s.id); }}>
                <Field id="cl-counted" label={t.counted}>
                  <Input id="cl-counted" inputMode="numeric" autoFocus className="h-12 text-xl tabular" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Field id="cl-note" label={t.note}><Input id="cl-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                {close.error ? <Alert tone="block">{errorMessage(close.error)}</Alert> : null}
                <Button type="submit" size="lg" disabled={close.isPending || counted === ''}><Lock /> {t.submit}</Button>
                <Button variant="ghost" onClick={() => void openCashDrawer()}>Ouvrir le tiroir</Button>
              </form>
            ) : (
              <Empty title={t.none} />
            )}
          </CardBody>
        </Card>
        <div>{closedId ? <CashCloseReport sessionId={closedId} /> : s ? <CashCloseReport sessionId={s.id} /> : null}</div>
      </div>
    </div>
  );
}
