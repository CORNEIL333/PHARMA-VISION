import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export function Dialog({
  open, onOpenChange, title, description, children, footer, wide, closable = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closable?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={(o) => (closable || o ? onOpenChange(o) : undefined)}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content
          onEscapeKeyDown={(e) => {
            if (!closable) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!closable) e.preventDefault();
          }}
          className={cn(
            'fixed left-1/2 top-[8vh] z-50 max-h-[84vh] w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-vp border border-border bg-surface shadow-2xl',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              <D.Description className={description ? 'mt-0.5 text-xs text-muted' : 'sr-only'}>
                {description ?? (typeof title === 'string' ? title : '')}
              </D.Description>
            </div>
            {closable ? (
              <D.Close aria-label="Fermer" className="rounded-vp p-1 text-muted hover:bg-surface-2 hover:text-fg">
                <X className="size-4" />
              </D.Close>
            ) : null}
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
