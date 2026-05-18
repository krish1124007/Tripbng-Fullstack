import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Page-level header. Eyebrow + title + description, actions on the right.
 * Wraps gracefully on narrow viewports (actions fall below).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="eyebrow mb-2 text-brand-600 dark:text-brand-500">{eyebrow}</p>
        ) : null}
        <h1 className="text-h1 text-balance text-ink-1">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-3">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
