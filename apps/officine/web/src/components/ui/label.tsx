import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export function Label({ className, ...p }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-xs font-medium text-muted', className)} {...p} />;
}

/** Champ de formulaire : libellé, contrôle, aide ou erreur. */
export function Field({
  id, label, hint, error, children, className,
}: { id: string; label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
