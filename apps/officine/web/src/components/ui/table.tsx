import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from './cn';

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...p} />
    </div>
  );
}

export function Th({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn('h-9 border-b border-border px-3 text-left text-xs font-medium text-muted', className)} {...p} />;
}

export function Td({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-[var(--vp-row)] border-b border-border/60 px-3 align-middle', className)} {...p} />;
}

export function Tr({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('vp-anim hover:bg-surface-2/60', className)} {...p} />;
}
