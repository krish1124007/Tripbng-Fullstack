import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base — single source of truth for transition, sizing rhythm, focus, disabled.
  //
  // Behaviour tuning:
  //   - `cursor-pointer` is explicit (Tailwind defaults to `default` on
  //      <button>) — small thing, but it makes hover feel right
  //   - `tap-transparent` kills Mobile Safari's blue tap flash so our own
  //      `active:scale-[0.98]` is the only feedback signal
  //   - `transition-[…transform…] duration-fast ease-snappy` lets the press
  //      animation feel modern (Material 3 / iOS spring curve)
  //   - `focus-visible:ring-2` (no offset) keeps the ring inline so it
  //      doesn't bleed past tight container edges
  'group relative inline-flex cursor-pointer tap-transparent select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-tight transition-[background,color,box-shadow,transform] duration-fast ease-snappy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primary CTA — brand blue. Subtle elevation, lifts on hover.
        primary:
          'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-md',
        // Accent CTA — orange. Reserved for high-energy moments (book now, complete top-up).
        accent: 'bg-accent-500 text-white shadow-sm hover:bg-accent-600 hover:shadow-md',
        // Secondary — outlined, neutral. The workhorse for less-loud actions.
        secondary:
          'border border-strong bg-surface-1 text-ink-1 hover:bg-surface-2 hover:border-ink-5',
        // Soft — brand-tinted fill, low ink. Good for "Manage…", "View…" follow-ups.
        soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
        // Ghost — no chrome, just hover well.
        ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink-1',
        // Destructive — rare, save for confirms.
        danger: 'bg-danger text-white shadow-sm hover:bg-danger/90',
        // Inline link.
        link: 'h-auto px-0 text-brand-600 underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs',
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
        lg: 'h-11 px-5 text-base',
        xl: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Show a spinner and disable the button. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        <span className={cn('inline-flex items-center gap-2', loading && 'opacity-90')}>
          {children}
        </span>
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
