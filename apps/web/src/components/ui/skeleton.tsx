import { cn } from '@/lib/utils';

/**
 * Skeleton — uses the global `.skeleton-shimmer` class which has a subtle
 * gradient sweep. Falls back to `animate-pulse` if shimmer is suppressed by
 * `prefers-reduced-motion` (handled in tokens.css).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('skeleton-shimmer rounded-md', className)}
      {...props}
    />
  );
}
