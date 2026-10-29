import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { AlertOctagon, Inbox, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-vp bg-surface-2', className)} />;
}

/** État de chargement explicite (spec §8.1). */
export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Chargement" className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/** État vide explicite. */
export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Inbox aria-hidden className="size-8 text-muted" />
      <p className="font-medium">{title}</p>
      {children ? <div className="text-xs text-muted">{children}</div> : null}
    </div>
  );
}

/** État d'erreur explicite, avec une action. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <AlertOctagon aria-hidden className="size-8 text-danger" />
      <p className="max-w-md text-sm">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          <RotateCw /> Réessayer
        </Button>
      ) : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Tip({ label, children, side = 'right' }: { label: ReactNode; children: ReactNode; side?: 'right' | 'top' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-50 rounded-vp border border-border bg-surface-2 px-2 py-1 text-xs text-fg shadow-lg">
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** En-tête d'écran. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Lecture d'un état de requête : chargement, erreur, vide ou contenu. */
export function QueryState<T>({
  q, empty, emptyTitle = 'Rien à afficher', children,
}: {
  q: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (d: T) => boolean;
  emptyTitle?: ReactNode;
  children: (d: T) => ReactNode;
}) {
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState message={q.error instanceof Error ? q.error.message : 'Erreur'} onRetry={() => void q.refetch()} />;
  if (q.data === undefined) return null;
  if (empty?.(q.data)) return <Empty title={emptyTitle} />;
  return <>{children(q.data)}</>;
}
