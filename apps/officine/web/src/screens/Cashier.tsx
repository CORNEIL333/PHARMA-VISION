import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, HelpCircle, Minus, Plus, Trash2, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toast } from 'sonner';
import { ProductPicker } from '../components/ProductPicker';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { cn } from '../components/ui/cn';
import { Input } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { Empty, Kbd, LoadingRows } from '../components/ui/misc';
import { fr } from '../i18n/fr';
import { api, ApiError, errorMessage } from '../lib/api';
import { isDesktop, printReceipt, registerName, saveRegisterName } from '../lib/desktop';
import { expiry, xaf } from '../lib/format';
import { useSession } from '../lib/session';
import type { BarcodeLookup, CashSession, Prescription, Product, ProductDetail, Quote, Receipt, Sale } from '../lib/types';
import { DemandDialog } from './cashier/DemandDialog';
import { PaymentDialog, type PaymentResult } from './cashier/PaymentDialog';
import { PrescriptionDialog } from './cashier/PrescriptionDialog';

const t = fr.cashier;

interface CartLine {
  key: string;
  product_id: string;
  name: string;
  qty: number;
  lot_id: string | null;
  lot_label: string | null;
}

const CART_KEY = 'vp.cart';

function loadCart(): CartLine[] {
  try {
    return JSON.parse(sessionStorage.getItem(CART_KEY) ?? '[]') as CartLine[];
  } catch {
    return [];
  }
}

/** Impression du ticket : ESC/POS par l'application de bureau, sinon impression du système (V-06). */
export async function printSaleReceipt(saleId: string): Promise<void> {
  const r = await api<Receipt>(`/sales/${saleId}/receipt`);
  if (await printReceipt({ lines: r.text.split('\n'), open_drawer: true }).catch(() => false)) return;
  const area = document.getElementById('print-area');
  if (area) {
    area.textContent = r.text;
    window.print();
    toast.message(t.printFallback);
  }
}

function OpenRegister({ register, onRegister }: { register: string; onRegister: (r: string) => void }) {
  const qc = useQueryClient();
  const [float, setFloat] = useState('');
  const [name, setName] = useState(register);
  const open = useMutation({
    mutationFn: () => api<CashSession>('/cash/sessions', { method: 'POST', body: { register: name.trim(), opening_float: Number(float || 0) } }),
    onSuccess: () => {
      saveRegisterName(name.trim());
      onRegister(name.trim());
      void qc.invalidateQueries({ queryKey: ['cash-current'] });
    },
  });
  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader title={t.openTitle} description={t.openHelp} />
        <CardBody>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
            <Field id="c-register" label={t.register}>
              <Input id="c-register" value={name} disabled={isDesktop()} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="c-float" label={t.float}>
              <Input id="c-float" inputMode="numeric" autoFocus className="tabular" value={float} onChange={(e) => setFloat(e.target.value.replace(/\D/g, ''))} />
            </Field>
            {open.error ? <Alert tone="block">{errorMessage(open.error)}</Alert> : null}
            <Button type="submit" disabled={open.isPending || !name.trim()}>
              <Wallet /> {t.open}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function ProductPanel({ productId, quoteLine }: { productId: string | null; quoteLine: Quote['lines'][number] | undefined }) {
  const q = useQuery({ queryKey: ['product', productId], enabled: !!productId, queryFn: () => api<ProductDetail>(`/products/${productId}`) });
  if (!productId) return <Empty title={t.noSelection} />;
  if (q.isLoading || !q.data) return <LoadingRows rows={4} />;
  const p = q.data;
  const sellable = p.lots.filter((l) => l.qty > 0 && l.lot_number !== '__REGUL__');
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-lg font-semibold">{p.name} {p.strength ?? ''}</h2>
        <p className="text-xs text-muted">{[p.dci, p.form, p.presentation].filter(Boolean).join(' · ')}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {p.rx_required ? <Badge tone="warning">Ordonnance</Badge> : null}
          {p.sensitive ? <Badge tone="danger">Sensible</Badge> : null}
          <Badge>Criticité {p.criticity}</Badge>
          <Badge tone="accent">{xaf(p.sale_price ?? p.suggested_price)}</Badge>
        </div>
      </div>
      {quoteLine?.alerts.map((a, i) => (
        <Alert key={i} tone={a.level === 'block' ? 'block' : 'warn'}>{a.message}</Alert>
      ))}
      <div>
        <h3 className="mb-1 text-xs font-medium text-muted">{t.lotsTitle}</h3>
        <ul className="flex flex-col gap-1">
          {sellable.map((l) => (
            <li key={l.id} className="flex justify-between rounded-vp bg-surface-2 px-2 py-1 text-xs">
              <span>{l.lot_number}</span>
              <span className="tabular">exp. {expiry(l.expiry)} · {l.qty}</span>
            </li>
          ))}
          {sellable.length === 0 ? <li className="text-xs text-muted">—</li> : null}
        </ul>
      </div>
    </div>
  );
}

/** UI-03 : caisse entièrement au clavier (F2, F4, F8, F9, Échap, ↑/↓). */
export default function Cashier() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [register, setRegister] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>(loadCart);
  const [sel, setSel] = useState(0);
  const [prescription, setPrescription] = useState<Prescription | null>(null);
  const [dialog, setDialog] = useState<null | 'pay' | 'rx' | 'demand'>(null);
  const [demandFor, setDemandFor] = useState<{ id: string; name: string } | null>(null);
  const [unknown, setUnknown] = useState<BarcodeLookup | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void registerName().then(setRegister);
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* stockage indisponible : le panier reste en mémoire */
    }
  }, [cart]);

  const session = useQuery({
    queryKey: ['cash-current', register],
    enabled: register !== null,
    queryFn: () => api<{ session: CashSession | null }>('/cash/sessions/current', { query: { register: register ?? '' } }),
  });
  const lines = useMemo(() => cart.map((l) => ({ product_id: l.product_id, qty: l.qty, ...(l.lot_id ? { lot_id: l.lot_id } : {}) })), [cart]);
  const quote = useQuery({
    queryKey: ['quote', lines, prescription?.id ?? null],
    enabled: lines.length > 0,
    placeholderData: (prev) => prev,
    queryFn: () => api<Quote>('/sales/quote', { method: 'POST', body: { lines, prescription_id: prescription?.id ?? null } }),
  });
  const focusScan = useCallback(() => window.setTimeout(() => scanRef.current?.focus(), 0), []);

  const addProduct = useCallback((p: { id: string; name: string; strength?: string | null }, lot?: { id: string; label: string }) => {
    setCart((c) => {
      const key = `${p.id}|${lot?.id ?? ''}`;
      const i = c.findIndex((l) => l.key === key);
      if (i >= 0) {
        setSel(i);
        return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      }
      setSel(c.length);
      return [...c, { key, product_id: p.id, name: `${p.name} ${p.strength ?? ''}`.trim(), qty: 1, lot_id: lot?.id ?? null, lot_label: lot?.label ?? null }];
    });
    focusScan();
  }, [focusScan]);

  const onScan = useCallback(async (raw: string) => {
    try {
      const r = await api<BarcodeLookup>(`/products/by-barcode/${encodeURIComponent(raw.trim())}`);
      if (!r.found || !r.product) {
        setUnknown(r);
        return;
      }
      let lot: { id: string; label: string } | undefined;
      if (r.gs1?.lot) {
        const d = await api<ProductDetail>(`/products/${r.product.id}`);
        const match = d.lots.find((l) => l.lot_number === r.gs1?.lot);
        if (match) lot = { id: match.id, label: match.lot_number };
      }
      addProduct(r.product, lot);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [addProduct]);

  const sale = useMutation({
    mutationFn: (p: PaymentResult) =>
      api<Sale>('/sales', {
        method: 'POST',
        body: { cash_session_id: session.data?.session?.id, lines, payments: p.payments, prescription_id: prescription?.id ?? null, discount: p.discount, cash_tendered: p.cash_tendered },
      }),
    onSuccess: (s) => {
      setDialog(null);
      setCart([]);
      setPrescription(null);
      setSaleError(null);
      toast.success(`${t.sold} ${s.number}`, { description: s.change_given ? `${fr.payment.change} : ${xaf(s.change_given)}` : undefined });
      void printSaleReceipt(s.id).catch((e: unknown) => toast.error(errorMessage(e)));
      void qc.invalidateQueries({ queryKey: ['product'] });
      focusScan();
    },
    onError: (e) => setSaleError(e instanceof ApiError ? errorMessage(e) : fr.common.unknownError),
  });

  const removeLine = useCallback((i: number) => {
    setCart((c) => c.filter((_, j) => j !== i));
    setSel((s) => Math.max(0, Math.min(s, cart.length - 2)));
  }, [cart.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus(); }
      else if (e.key === 'F4' && cart.length) { e.preventDefault(); qtyRef.current?.focus(); qtyRef.current?.select(); }
      else if (e.key === 'F8') { e.preventDefault(); const l = cart[sel]; setDemandFor(l ? { id: l.product_id, name: l.name } : null); setDialog('demand'); }
      else if (e.key === 'F9' && cart.length) { e.preventDefault(); if (quote.data && !quote.data.blocking) { setSaleError(null); setDialog('pay'); } }
      else if (e.key === 'Escape' && cart.length && document.activeElement === scanRef.current) { e.preventDefault(); removeLine(sel); }
      else if (e.key === 'ArrowDown' && cart.length && document.activeElement === scanRef.current) { e.preventDefault(); setSel((s) => Math.min(s + 1, cart.length - 1)); }
      else if (e.key === 'ArrowUp' && cart.length && document.activeElement === scanRef.current) { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, cart, sel, quote.data, removeLine]);
  useEffect(() => { if (!dialog) focusScan(); }, [dialog, focusScan]);

  if (register === null || session.isLoading) return <LoadingRows rows={6} />;
  if (!session.data?.session) return <OpenRegister register={register} onRegister={setRegister} />;
  const cs = session.data.session;
  const ql = (pid: string) => quote.data?.lines.find((l) => l.product_id === pid);
  const selected = cart[sel] ?? null;
  const missing = quote.data?.lines.find((l) => l.alerts.some((a) => a.code === 'insufficient_stock'));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <ProductPicker ref={scanRef} autoFocus className="min-w-72 flex-1" label={t.scan} placeholder={t.scan} onPick={(p: Product) => addProduct(p)} onSubmitRaw={(raw) => void onScan(raw)} />
        <Badge tone={cs.kind === 'garde' ? 'accent' : 'neutral'}>{cs.kind === 'garde' ? t.garde : t.session} · {cs.register}</Badge>
        <Button variant="secondary" onClick={() => { const l = cart[sel]; setDemandFor(l ? { id: l.product_id, name: l.name } : null); setDialog('demand'); }}>
          <HelpCircle /> {t.demand}
        </Button>
      </div>
      {unknown ? (
        <div className="px-4 pt-3">
          <Alert tone="warn" title={`${t.unknownCode} : ${unknown.code}`}>
            {t.unknownCodeHelp} {can('catalog.link') ? <a className="underline" href={`/produits?code=${encodeURIComponent(unknown.code)}`}>{t.linkCode}</a> : null}
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => setUnknown(null)}>{fr.common.close}</Button>
          </Alert>
        </div>
      ) : null}
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="62" minSize="40" className="flex flex-col">
          <section aria-label={t.lines} className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <Empty title={t.emptyCart}>{t.emptyCartHelp}</Empty>
            ) : (
              <ul aria-label={t.lines} className="divide-y divide-border/60">
                {cart.map((l, i) => {
                  const q = ql(l.product_id);
                  const blocking = q?.alerts.some((a) => a.level === 'block');
                  return (
                    <li key={l.key} aria-current={i === sel ? 'true' : undefined} onClick={() => setSel(i)}
                      className={cn('flex cursor-pointer items-center gap-3 px-4 py-2', i === sel && 'bg-surface-2', blocking && 'border-l-4 border-danger')}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.name}</p>
                        <p className="truncate text-xs text-muted">
                          {q?.allocations.map((a) => (a.regul ? t.regul : `${a.lot_number} · exp. ${expiry(a.expiry)}`) + ` ×${a.qty}`).join(' — ') ?? l.lot_label ?? ''}
                        </p>
                        {q?.alerts.map((a, k) => (
                          <p key={k} className={cn('text-xs', a.level === 'block' ? 'text-danger' : 'text-warning')}>{a.message}</p>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label="Moins" onClick={(e) => { e.stopPropagation(); setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))); }}><Minus /></Button>
                        <Input
                          ref={i === sel ? qtyRef : undefined}
                          aria-label={`${t.qty} ${l.name}`}
                          inputMode="numeric"
                          className="h-8 w-14 text-center tabular"
                          value={l.qty}
                          onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')); setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, v || 1) } : x))); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusScan(); } }}
                        />
                        <Button variant="ghost" size="icon" aria-label="Plus" onClick={(e) => { e.stopPropagation(); setCart(cart.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x))); }}><Plus /></Button>
                      </div>
                      <span className="w-28 text-right tabular font-medium">{xaf(q?.line_total)}</span>
                      <Button variant="ghost" size="icon" aria-label={t.removeLine} onClick={(e) => { e.stopPropagation(); removeLine(i); }}><Trash2 /></Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <footer className="border-t border-border p-4">
            {quote.data?.rx_required ? (
              prescription ? (
                <Alert tone="success" title={t.rxLinked} className="mb-3">{prescription.prescriber_name} · {prescription.issued_on}</Alert>
              ) : (
                <Alert tone="block" title={t.rxNeeded} className="mb-3">
                  {quote.data.prescription.message ?? t.rxNeededHelp}{' '}
                  <Button size="sm" variant="secondary" className="ml-2" onClick={() => setDialog('rx')}><FileText /> {t.rxEnter}</Button>
                </Alert>
              )
            ) : null}
            {missing ? (
              <Alert tone="warn" className="mb-3">
                {fr.demand.autoSuggest}{' '}
                <Button size="sm" variant="secondary" onClick={() => { setDemandFor({ id: missing.product_id, name: missing.name }); setDialog('demand'); }}>{t.demand}</Button>
              </Alert>
            ) : null}
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span><Kbd>F2</Kbd> recherche</span><span><Kbd>F4</Kbd> quantité</span><span><Kbd>F8</Kbd> demande</span><span><Kbd>F9</Kbd> paiement</span><span><Kbd>Échap</Kbd> retirer</span>
                {cart.length ? <Button variant="ghost" size="sm" onClick={() => { setCart([]); setPrescription(null); }}>{t.clear}</Button> : null}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">{t.total}</p>
                <p className="tabular text-total font-bold leading-none" data-testid="cart-total">{xaf(quote.data?.total ?? 0)}</p>
              </div>
            </div>
            <Button size="lg" className="mt-3 w-full" disabled={!cart.length || !quote.data || quote.data.blocking || quote.isFetching}
              onClick={() => { setSaleError(null); setDialog('pay'); }}>
              <Wallet /> {t.pay}
            </Button>
          </footer>
        </Panel>
        <Separator className="w-1 bg-border hover:bg-accent" />
        <Panel defaultSize="38" minSize="25" className="overflow-y-auto">
          <h2 className="sr-only">{t.product}</h2>
          <ProductPanel productId={selected?.product_id ?? null} quoteLine={selected ? ql(selected.product_id) : undefined} />
        </Panel>
      </Group>
      <PaymentDialog open={dialog === 'pay'} onOpenChange={(o) => setDialog(o ? 'pay' : null)} gross={quote.data?.gross ?? 0}
        canDiscount={can('sale.discount')} maxDiscountPct={null} busy={sale.isPending} error={saleError} onConfirm={(p) => sale.mutate(p)} />
      <PrescriptionDialog open={dialog === 'rx'} onOpenChange={(o) => setDialog(o ? 'rx' : null)} canValidate={can('prescription.validate')}
        sensitive={quote.data?.sensitive ?? false} onDone={(p) => setPrescription(p)} />
      <DemandDialog open={dialog === 'demand'} onOpenChange={(o) => setDialog(o ? 'demand' : null)} initial={demandFor} />
    </div>
  );
}
