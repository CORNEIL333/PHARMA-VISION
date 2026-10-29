import * as T from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const Tabs = T.Root;

export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn('inline-flex flex-wrap gap-1 rounded-vp border border-border bg-surface p-1', className)} {...p} />;
}

export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'vp-anim rounded-[6px] px-3 py-1.5 text-xs font-medium text-muted hover:text-fg data-[state=active]:bg-surface-2 data-[state=active]:text-fg',
        className,
      )}
      {...p}
    />
  );
}

export function TabsContent({ className, ...p }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn('mt-3 focus-visible:outline-none', className)} {...p} />;
}
