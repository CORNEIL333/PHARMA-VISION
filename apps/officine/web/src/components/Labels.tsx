import { Printer, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { ean13Modules } from '../lib/ean13';
import { xaf } from '../lib/format';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';
import { Field } from './ui/label';

const t = fr.labels;

/** Étiquette 50 × 30 mm : nom, prix, code-barres EAN-13 et chiffres lisibles. */
export function Label({ name, price, code }: { name: string; price: number | null; code: string }) {
  const modules = ean13Modules(code);
  return (
    <div className="vp-label flex w-[50mm] flex-col items-center gap-0.5 border border-border p-1 text-[9px] leading-tight text-fg">
      <span className="w-full truncate text-center font-semibold">{name}</span>
      <svg viewBox={`0 0 ${modules.length + 18} 40`} className="h-[14mm] w-full" role="img" aria-label={`${t.barcode} ${code}`}>
        <rect width="100%" height="100%" fill="#fff" />
        {[...modules].map((m, i) => (m === '1' ? <rect key={i} x={i + 9} y={0} width={1} height={40} fill="#000" /> : null))}
      </svg>
      <span className="tabular tracking-widest">{code}</span>
      {price !== null ? <span className="font-semibold">{xaf(price)}</span> : null}
    </div>
  );
}

/** C-07 : attribue un code interne (si besoin) puis imprime N étiquettes. */
export function LabelsButton({ productId, name, price, onAssigned }: { productId: string; name: string; price: number | null; onAssigned: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const open = async () => {
    try {
      const r = await api<{ ean13: string; created: boolean }>(`/products/${productId}/internal-barcode`, { method: 'POST' });
      setCode(r.ean13);
      if (r.created) onAssigned();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const print = () => {
    document.body.classList.add('vp-print-labels');
    window.print();
    window.setTimeout(() => document.body.classList.remove('vp-print-labels'), 500);
  };
  return (
    <>
      <Button variant="secondary" onClick={() => void open()}><Tag /> {t.button}</Button>
      <Dialog open={code !== null} onOpenChange={(o) => !o && setCode(null)} title={t.title} description={t.help}
        footer={<><Button variant="ghost" onClick={() => setCode(null)}>{fr.common.close}</Button><Button onClick={print}><Printer /> {fr.common.print}</Button></>}>
        <Field id="lb-copies" label={t.copies}>
          <Input id="lb-copies" type="number" min={1} max={100} className="w-24" value={copies} onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
        </Field>
        {code ? (
          <div className="vp-labels mt-3 flex flex-wrap gap-1">
            {Array.from({ length: copies }, (_, i) => <Label key={i} name={name} price={price} code={code} />)}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
