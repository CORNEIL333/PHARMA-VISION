import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const base =
  'w-full rounded-vp border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted vp-anim focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, 'h-9', className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, 'min-h-20 py-2', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(base, 'h-9 pr-8', className)} {...p} />;
});
