import type { HTMLAttributes } from 'react';
import { cn } from './cn';

const tones = {
  neutral: 'bg-surface-2 text-muted border-border',
  accent: 'bg-accent/15 text-accent border-accent/40',
  danger: 'bg-danger-bg text-danger border-danger/40',
  warning: 'bg-warning-bg text-warning border-warning/40',
  success: 'bg-success-bg text-success border-success/40',
} as const;

export function Badge({ tone = 'neutral', className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...p} />;
}
