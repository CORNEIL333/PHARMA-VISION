import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-vp border border-border bg-surface', className)} {...p} />;
}

export function CardHeader({ title, description, actions, level = 2 }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; level?: 1 | 2 }) {
  const H = level === 1 ? 'h1' : 'h2';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <H className="text-base font-semibold">{title}</H>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...p} />;
}
