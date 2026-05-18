import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold leading-none tracking-tight',
  {
    variants: {
      variant: {
        neutral: 'border-strong bg-surface-2 text-ink-2',
        brand: 'border-brand-500/20 bg-brand-50 text-brand-700',
        accent: 'border-accent-500/30 bg-accent-50 text-accent-700',
        success: 'border-success/25 bg-success-soft text-success',
        warning: 'border-warning/30 bg-warning-soft text-warning',
        danger: 'border-danger/25 bg-danger-soft text-danger',
        info: 'border-info/20 bg-info-soft text-info',
        outline: 'border-strong bg-transparent text-ink-2',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a coloured leading dot. Set `pulse` for a "live" pulsing dot. */
  dot?: boolean;
  pulse?: boolean;
}

export function Badge({ className, variant, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', pulse && 'live-dot')}
        />
      ) : null}
      {children}
    </span>
  );
}
