'use client';

import { Shield, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InsuranceSearchAnimationProps {
  region?: string | null;
  days?: number | null;
  message?: string;
  className?: string;
}

/**
 * Loading state for the insurance quote — pulsing shield while we fan out
 * across underwriters. Mirrors the loader vocabulary used on flights / hotels
 * / buses / holidays / visa for a consistent feel across surfaces.
 */
export function InsuranceSearchAnimation({
  region,
  days,
  message = 'Comparing plans across our underwriters…',
  className,
}: InsuranceSearchAnimationProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Calculating insurance quote"
      className={cn(
        'flex flex-col items-center gap-4 rounded-lg border bg-surface-1 px-6 py-10',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <Shield
            className="relative h-8 w-8 text-brand-600 dark:text-brand-300"
            strokeWidth={2}
          />
          <ShieldCheck
            className="absolute inset-0 m-auto h-4 w-4 animate-pulse-soft text-brand-500"
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
        <div className="text-left">
          {region ? (
            <p className="text-base font-bold text-ink-1">{region}</p>
          ) : (
            <p className="text-base font-bold text-ink-1">Travel insurance</p>
          )}
          {days ? (
            <p className="font-mono text-xs text-ink-3">{days}-day cover</p>
          ) : (
            <p className="font-mono text-xs text-ink-3">Computing premiums</p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
          <ShieldCheck className="h-4 w-4 text-brand-500" /> {message}
        </p>
        <p className="text-xs text-ink-3">This usually takes 2–5 seconds</p>
      </div>

      {/* Skeleton plan tiles */}
      <div className="mt-2 grid w-full max-w-5xl gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="shimmer h-72 w-full overflow-hidden rounded-lg border bg-surface-2/40"
          />
        ))}
      </div>
    </div>
  );
}
