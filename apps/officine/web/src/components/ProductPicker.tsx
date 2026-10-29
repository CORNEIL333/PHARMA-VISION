import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { forwardRef, useEffect, useId, useState } from 'react';
import { fr } from '../i18n/fr';
import { api } from '../lib/api';
import { xaf } from '../lib/format';
import type { Page, Product } from '../lib/types';
import { Badge } from './ui/badge';
import { cn } from './ui/cn';
import { Input } from './ui/input';

/** Recherche dans tout le catalogue (C-01), dormant compris, avec une liste navigable au clavier. */
export const ProductPicker = forwardRef<HTMLInputElement, {
  onPick: (p: Product) => void;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  /** Entrée sans résultat choisi (code-barres scanné, par exemple). */
  onSubmitRaw?: (text: string) => void;
  className?: string;
}>(function ProductPicker({ onPick, placeholder, label, autoFocus, onSubmitRaw, className }, ref) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const term = q.trim();
  const looksLikeCode = /^[\d\u001d\]]/.test(term) && term.length >= 8 && !/\s/.test(term);
  const res = useQuery({
    queryKey: ['product-search', term],
    enabled: term.length >= 2 && !looksLikeCode,
    queryFn: () => api<Page<Product>>('/products', { query: { q: term, limit: 12 } }),
  });
  const items = res.data?.items ?? [];
  useEffect(() => setActive(0), [term]);
  const pick = (p: Product) => {
    onPick(p);
    setQ('');
    setOpen(false);
  };
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input
        ref={ref}
        role="combobox"
        aria-label={label ?? fr.common.search}
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        className="h-11 pl-9 text-base"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const chosen = open && !looksLikeCode ? items[active] : undefined;
            if (chosen) pick(chosen);
            else if (term && onSubmitRaw) {
              onSubmitRaw(q);
              setQ('');
            }
          } else if (e.key === 'Escape' && open && items.length) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && items.length > 0 ? (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-vp border border-border bg-surface p-1 shadow-xl">
          {items.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2 py-2', i === active && 'bg-surface-2')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {p.name} {p.strength ?? ''}
                </span>
                <span className="block truncate text-xs text-muted">
                  {[p.dci, p.form, p.presentation].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.status !== 'active' ? <Badge>{p.status === 'dormant' ? 'dormant' : 'en sommeil'}</Badge> : null}
                <span className="tabular text-xs">{xaf(p.sale_price ?? p.suggested_price)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
