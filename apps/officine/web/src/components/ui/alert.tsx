import { AlertTriangle, Ban, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

const tones = {
  block: { cls: 'border-danger/50 bg-danger-bg text-danger', icon: Ban },
  warn: { cls: 'border-warning/50 bg-warning-bg text-warning', icon: AlertTriangle },
  success: { cls: 'border-success/50 bg-success-bg text-success', icon: CheckCircle2 },
  info: { cls: 'border-border bg-surface-2 text-fg', icon: Info },
} as const;

/** Alerte en ligne. Les alertes bloquantes (rappel, périmé, ordonnance) restent affichées : jamais une simple notification. */
export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof tones; title?: ReactNode; children?: ReactNode; className?: string }) {
  const T = tones[tone];
  return (
    <div role={tone === 'block' ? 'alert' : 'status'} className={cn('flex gap-2 rounded-vp border px-3 py-2 text-sm', T.cls, className)}>
      <T.icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-fg">{children}</div> : null}
      </div>
    </div>
  );
}
