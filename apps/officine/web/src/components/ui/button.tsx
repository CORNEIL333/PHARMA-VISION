import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

const variants = {
  default: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'bg-surface-2 text-fg border border-border hover:bg-border/60',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'bg-danger text-bg hover:opacity-90',
  outline: 'border border-border text-fg hover:bg-surface-2',
} as const;
const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm', lg: 'h-11 px-5 text-base', icon: 'h-9 w-9' } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', asChild, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'vp-anim inline-flex items-center justify-center gap-2 rounded-vp font-medium whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
