import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Three elevation tiers — flat (default), raised (modals/featured), interactive (links/clickable).
const cardVariants = cva(
  'relative rounded-lg border bg-surface-1 transition-[border-color,box-shadow,transform] duration-normal ease-out',
  {
    variants: {
      elevation: {
        flat: 'shadow-xs',
        raised: 'shadow-md',
        floating: 'shadow-lg',
      },
      interactive: {
        true: 'cursor-pointer hover:shadow-md hover:border-ink-5 hover:-translate-y-px',
        false: '',
      },
      tone: {
        default: '',
        // Subtle brand wash for KPI hero cards
        brand: 'bg-gradient-to-br from-brand-50 to-surface-1 dark:from-brand-500/10 dark:to-surface-1',
        // Warning / urgent (e.g. expiring hold)
        warning: 'border-warning/30 bg-warning-soft/50 dark:bg-warning/10',
        // Danger (e.g. failed booking)
        danger: 'border-danger/30 bg-danger-soft/50 dark:bg-danger/10',
      },
    },
    defaultVariants: { elevation: 'flat', interactive: false, tone: 'default' },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation, interactive, tone, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ elevation, interactive, tone }), className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

// Padding rhythm: `p-4 sm:p-6` so cards on phones feel proportional. 24px of
// internal padding on a full-width card at 375px viewport leaves only 327px
// of content — too cramped for KPI grids and stat cards. The breakpoint
// nudges the spacing without affecting tablet+ where p-6 reads as elegant.
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5 p-4 sm:p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-lg font-bold leading-tight tracking-tight text-ink-1', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm leading-relaxed text-ink-3', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-3 border-t bg-surface-0/50 p-3 sm:p-4 sm:px-6',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
