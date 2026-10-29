import { Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input, Select } from '../../components/ui/input';
import { Field } from '../../components/ui/label';
import { fr } from '../../i18n/fr';
import { api } from '../../lib/api';
import { xaf } from '../../lib/format';

const t = fr.payment;
export type Method = 'especes' | 'mobile_money' | 'carte' | 'credit' | 'tiers_payant';
export interface PaymentLine {
  method: Method;
  amount: number;
  reference: string;
  payer: string;
}
export interface PaymentResult {
  payments: { method: Method; amount: number; reference: string | null; payer: string | null }[];
  cash_tendered: number | null;
  discount: { amount: number; reason: string } | null;
}

const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.floor(Number(v.replace(/\D/g, '')) || 0)));

/** UI-04 : paiement en une ou plusieurs méthodes (V-03), rendu de monnaie, remise (V-09). */
export function PaymentDialog({
  open, onOpenChange, gross, canDiscount, maxDiscountPct, busy, error, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  gross: number;
  canDiscount: boolean;
  maxDiscountPct: number | null;
  busy: boolean;
  error: string | null;
  onConfirm: (r: PaymentResult) => void;
}) {
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const total = Math.max(0, gross - discount);
  const [lines, setLines] = useState<PaymentLine[]>([{ method: 'especes', amount: total, reference: '', payer: '' }]);
  const [tendered, setTendered] = useState('');
  const payers = useQuery({ queryKey: ['payers'], enabled: open, queryFn: () => api<{ id: string; name: string }[]>('/payers') });
  useEffect(() => {
    if (open) {
      setDiscount(0);
      setDiscountReason('');
      setLines([{ method: 'especes', amount: gross, reference: '', payer: '' }]);
      setTendered('');
    }
  }, [open, gross]);
  useEffect(() => {
    // Une seule ligne : elle suit le total (après remise).
    setLines((ls) => (ls.length === 1 ? [{ ...ls[0]!, amount: total }] : ls));
  }, [total]);
  const paid = lines.reduce((n, l) => n + l.amount, 0);
  const cash = lines.find((l) => l.method === 'especes')?.amount ?? 0;
  const tenderedN = tendered === '' ? null : num(tendered);
  const change = tenderedN !== null ? tenderedN - cash : 0;
  const problems = useMemo(() => {
    const p: string[] = [];
    if (paid !== total) p.push(`${t.remaining} : ${xaf(total - paid)}`);
    for (const l of lines) {
      if ((l.method === 'mobile_money' || l.method === 'carte' || l.method === 'tiers_payant') && !l.reference.trim()) p.push(`${t.methods[l.method]} : ${t.reference}`);
      if ((l.method === 'credit' || l.method === 'tiers_payant') && !l.payer.trim()) p.push(`${t.methods[l.method]} : ${l.method === 'credit' ? t.payer : t.organism}`);
    }
    if (lines.filter((l) => l.method === 'especes').length > 1) p.push('Un seul paiement en espèces.');
    if (tenderedN !== null && tenderedN < cash) p.push(`${t.tendered} < ${xaf(cash)}`);
    if (discount > 0 && !discountReason.trim()) p.push(t.discountReason);
    return p;
  }, [paid, total, lines, tenderedN, cash, discount, discountReason]);
  const update = (i: number, patch: Partial<PaymentLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = () =>
    onConfirm({
      payments: lines.map((l) => ({ method: l.method, amount: l.amount, reference: l.reference.trim() || null, payer: l.payer.trim() || null })),
      cash_tendered: lines.some((l) => l.method === 'especes') ? tenderedN : null,
      discount: discount > 0 ? { amount: discount, reason: discountReason.trim() } : null,
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{fr.common.cancel}</Button>
          <Button onClick={submit} disabled={busy || problems.length > 0} data-testid="confirm-sale">{t.confirm}</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!problems.length) submit(); }}>
        <div className="flex items-baseline justify-between rounded-vp bg-surface-2 px-4 py-3">
          <span className="text-muted">{fr.cashier.total}</span>
          <span className="tabular text-3xl font-semibold" data-testid="payment-total">{xaf(total)}</span>
        </div>
        {canDiscount ? (
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Field id="p-discount" label={t.discount} hint={maxDiscountPct !== null ? `≤ ${maxDiscountPct} %` : undefined}>
              <Input id="p-discount" inputMode="numeric" className="tabular" value={discount || ''} onChange={(e) => setDiscount(Math.min(num(e.target.value), gross))} />
            </Field>
            <Field id="p-discount-reason" label={t.discountReason}>
              <Input id="p-discount-reason" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            </Field>
          </div>
        ) : null}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[150px_140px_1fr_auto] items-end gap-2">
            <Field id={`p-m-${i}`} label={t.method}>
              <Select id={`p-m-${i}`} value={l.method} onChange={(e) => update(i, { method: e.target.value as Method })}>
                {Object.entries(t.methods).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field id={`p-a-${i}`} label={t.amount}>
              <Input id={`p-a-${i}`} inputMode="numeric" className="tabular" value={l.amount || ''} onChange={(e) => update(i, { amount: num(e.target.value) })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {l.method === 'credit' || l.method === 'tiers_payant' ? (
                <Field id={`p-p-${i}`} label={l.method === 'credit' ? t.payer : t.organism}>
                  <Input id={`p-p-${i}`} list={l.method === 'tiers_payant' ? 'vp-payers' : undefined} value={l.payer} onChange={(e) => update(i, { payer: e.target.value })} />
                </Field>
              ) : null}
              {l.method === 'mobile_money' || l.method === 'carte' || l.method === 'tiers_payant' ? (
                <Field id={`p-r-${i}`} label={l.method === 'tiers_payant' ? t.number : t.reference}>
                  <Input id={`p-r-${i}`} value={l.reference} onChange={(e) => update(i, { reference: e.target.value })} />
                </Field>
              ) : null}
              {l.method === 'especes' ? (
                <Field id="p-tendered" label={t.tendered}>
                  <Input id="p-tendered" inputMode="numeric" autoFocus className="tabular" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/\D/g, ''))} />
                </Field>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" aria-label={fr.common.remove} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setLines([...lines, { method: 'mobile_money', amount: Math.max(0, total - paid), reference: '', payer: '' }])}>
            <Plus /> {t.addMethod}
          </Button>
          {tenderedN !== null && change >= 0 ? (
            <p className="text-lg">
              {t.change} : <strong className="tabular" data-testid="change">{xaf(change)}</strong>
            </p>
          ) : null}
        </div>
        {problems.length ? <Alert tone="warn">{problems.join(' · ')}</Alert> : null}
        {error ? <Alert tone="block">{error}</Alert> : null}
        <datalist id="vp-payers">{payers.data?.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
