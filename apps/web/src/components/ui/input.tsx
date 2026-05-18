import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional leading icon — renders inside the input chrome on the left. */
  leading?: React.ReactNode;
  /** Optional trailing slot — icon, button, or unit suffix on the right. */
  trailing?: React.ReactNode;
  /** Render the input in error state (red border + ring). */
  invalid?: boolean;
  /** Make the input full-width (default true). */
  fullWidth?: boolean;
}

/**
 * Input — supports leading/trailing slots without breaking native input semantics.
 * The wrapper handles focus styling so the chrome reads as a single unit.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', leading, trailing, invalid, fullWidth = true, ...props }, ref) => {
    if (!leading && !trailing) {
      return (
        <input
          type={type}
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-10 rounded-md border bg-surface-1 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-4 transition-[border-color,box-shadow] duration-fast',
            'focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
            invalid && 'border-danger focus-visible:border-danger focus-visible:ring-danger/30',
            fullWidth && 'w-full',
            className,
          )}
          {...props}
        />
      );
    }

    return (
      <div
        className={cn(
          'group flex h-10 items-center gap-2 rounded-md border bg-surface-1 px-3 text-sm transition-[border-color,box-shadow] duration-fast',
          'focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-ring',
          invalid && 'border-danger focus-within:border-danger focus-within:ring-danger/30',
          props.disabled && 'cursor-not-allowed bg-surface-2 opacity-60',
          fullWidth && 'w-full',
          className,
        )}
      >
        {leading ? <span className="text-ink-3">{leading}</span> : null}
        <input
          type={type}
          ref={ref}
          aria-invalid={invalid || undefined}
          className="min-w-0 flex-1 bg-transparent py-2 text-ink-1 placeholder:text-ink-4 focus:outline-none disabled:cursor-not-allowed"
          {...props}
        />
        {trailing ? <span className="text-ink-3">{trailing}</span> : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
