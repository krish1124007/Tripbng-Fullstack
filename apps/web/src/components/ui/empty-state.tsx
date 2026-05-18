import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EmptyState — never blank, always teaches. Icon in a soft brand-tinted disc,
 * h3 title, supporting copy, optional action. Subtle dashed border so it reads
 * as a placeholder, not a card.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-strong bg-surface-1 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-600 ring-8 ring-brand-50/40 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/5">
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </span>
      ) : null}
      <div className="max-w-sm">
        <h3 className="text-h3 text-ink-1">{title}</h3>
        {description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
