import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ProductPicker } from '../../components/ProductPicker';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Field } from '../../components/ui/label';
import { fr } from '../../i18n/fr';
import { api, errorMessage } from '../../lib/api';

const t = fr.demand;

/** D-01 : « Client demandait… » (F8), produit du catalogue ou texte libre. */
export function DemandDialog({
  open, onOpenChange, initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { id: string; name: string } | null;
}) {
  const [product, setProduct] = useState<{ id: string; name: string } | null>(initial);
  const [freeText, setFreeText] = useState('');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setProduct(initial);
      setFreeText('');
      setQty(1);
      setNote('');
      setError(null);
    }
  }, [open, initial]);
  const submit = async () => {
    try {
      await api('/demand', { method: 'POST', body: { product_id: product?.id ?? null, free_text: product ? null : freeText, qty, note: note || null } });
      toast.success(t.saved);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{fr.common.cancel}</Button>
          <Button onClick={() => void submit()} disabled={!product && !freeText.trim()}>{t.submit}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {product ? (
          <div className="flex items-center justify-between rounded-vp border border-border px-3 py-2">
            <span>{product.name}</span>
            <Button variant="ghost" size="sm" onClick={() => setProduct(null)}>{fr.common.edit}</Button>
          </div>
        ) : (
          <>
            <ProductPicker label={t.product} placeholder={t.product} onPick={(p) => setProduct({ id: p.id, name: `${p.name} ${p.strength ?? ''}`.trim() })} />
            <Field id="d-free" label={t.freeText}><Input id="d-free" value={freeText} onChange={(e) => setFreeText(e.target.value)} /></Field>
          </>
        )}
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <Field id="d-qty" label={t.qty}><Input id="d-qty" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></Field>
          <Field id="d-note" label={t.note}><Input id="d-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {initial ? <Badge tone="warning">{t.autoSuggest}</Badge> : null}
        {error ? <Alert tone="block">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
