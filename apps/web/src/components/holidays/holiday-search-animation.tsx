'use client';

import { Compass, MapPin, TreePalm } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HolidaySearchAnimationProps {
  destination?: string | null;
  nights?: string | null;
  message?: string;
  className?: string;
}

/**
 * Loading state for the holiday search results — a compass spins above a
 * destination chip while DMC packages are pulled. Mirrors the hotels +
 * buses loaders so the loading vocabulary is consistent across surfaces.
 */
export function HolidaySearchAnimation({
  destination,
  nights,
  message = 'Curating packages from our DMC partners…',
  className,
}: HolidaySearchAnimationProps) {
  const dest = destination?.trim() || 'your destination';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Searching holiday packages for ${dest}`}
      className={cn(
        'flex flex-col items-center gap-4 rounded-lg border bg-surface-1 px-6 py-10',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <Compass
            className="relative h-7 w-7 text-brand-600 dark:text-brand-300"
            strokeWidth={2}
            style={{ animation: 'spin 4s linear infinite' }}
          />
          <span className="absolute inset-0 -m-1 inline-flex animate-pulse-soft rounded-full bg-brand-500/30" aria-hidden />
        </span>
        <div className="text-left">
          <p className="inline-flex items-center gap-1 text-base font-bold text-ink-1">
            <MapPin className="h-3.5 w-3.5 text-ink-3" /> {dest}
          </p>
          {nights ? (
            <p className="font-mono text-xs text-ink-3">
              {nights} {nights === '1' ? 'night' : 'nights'}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
          <TreePalm className="h-4 w-4 text-brand-500" /> {message}
        </p>
        <p className="text-xs text-ink-3">This usually takes 5–10 seconds</p>
      </div>

      {/* Skeleton package tiles */}
      <div className="mt-2 grid w-full max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="shimmer h-48 w-full overflow-hidden rounded-md border bg-surface-2/40"
          />
        ))}
      </div>
    </div>
  );
}
