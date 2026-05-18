import type { ReactNode } from 'react';
import { Label } from './label';
import { cn } from '@/lib/utils';

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>
          {label}
          {required ? <span className="ml-1 text-danger">*</span> : null}
        </Label>
        {hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
