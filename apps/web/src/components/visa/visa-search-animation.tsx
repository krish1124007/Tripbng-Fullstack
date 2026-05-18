'use client';

import { Stamp, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VisaSearchAnimationProps {
  countryFlag?: string | null;
  countryName?: string | null;
  message?: string;
  className?: string;
}

/**
 * Loading state for the visa quote — shows the destination country flag while
 * we compute the fee breakdown + document list. Mirrors the loader vocabulary
 * used on flights/hotels/buses/holidays so the experience feels consistent.
 */
export function VisaSearchAnimation({
  countryFlag,
  countryName,
  message = 'Computing govt fee, service fee, and TAT…',
  className,
}: VisaSearchAnimationProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Calculating visa quote for ${countryName ?? 'your destination'}`}
      className={cn(
        'flex flex-col items-center gap-4 rounded-lg border bg-surface-1 px-6 py-10',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <span className="grid h-12 w-12 place-items-center rounded-md border-2 border-dashed border-stroke-2 bg-surface-2/40 text-3xl">
            {countryFlag ?? '🛂'}
          </span>
          <Stamp
            className="absolute -bottom-1 -right-1 h-5 w-5 animate-pulse-soft text-brand-600 dark:text-brand-300"
            strokeWidth={2}
            aria-hidden
          />
        </span>
        <div className="text-left">
          <p className="text-base font-bold text-ink-1">{countryName ?? 'Destination country'}</p>
          <p className="font-mono text-xs text-ink-3">Stamping in progress…</p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
          <StickyNote className="h-4 w-4 text-brand-500" /> {message}
        </p>
        <p className="text-xs text-ink-3">This usually takes 2–5 seconds</p>
      </div>

      {/* Skeleton blocks resembling the fee + doc cards */}
      <div className="mt-2 grid w-full max-w-3xl gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-3">
          <div className="shimmer h-32 w-full overflow-hidden rounded-lg border bg-surface-2/40" />
          <div className="shimmer h-40 w-full overflow-hidden rounded-lg border bg-surface-2/40" />
        </div>
        <div className="space-y-3">
          <div className="shimmer h-32 w-full overflow-hidden rounded-lg border bg-surface-2/40" />
          <div className="shimmer h-44 w-full overflow-hidden rounded-lg border bg-surface-2/40" />
        </div>
      </div>
    </div>
  );
}
