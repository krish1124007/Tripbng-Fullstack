'use client';

import { Hotel, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HotelSearchAnimationProps {
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  message?: string;
  className?: string;
}

/**
 * Loading state for the hotel search results — pulses the destination pin,
 * mirrors the FlightSearchAnimation visual language so the loaders feel
 * consistent across product surfaces.
 */
export function HotelSearchAnimation({
  destination,
  checkIn,
  checkOut,
  message = 'Searching live rates from our suppliers…',
  className,
}: HotelSearchAnimationProps) {
  const dest = destination?.trim() || 'your destination';
  const dates = checkIn && checkOut
    ? `${new Date(checkIn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} → ${new Date(checkOut).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Searching hotels in ${dest}`}
      className={cn(
        'flex flex-col items-center gap-4 rounded-lg border bg-surface-1 px-6 py-10',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <MapPin
            className="relative h-7 w-7 text-brand-600 dark:text-brand-300"
            strokeWidth={2}
          />
          <span className="absolute inset-0 -m-1 inline-flex animate-pulse-soft rounded-full bg-brand-500/30" aria-hidden />
        </span>
        <div className="text-left">
          <p className="text-base font-bold text-ink-1">{dest}</p>
          {dates ? <p className="font-mono text-xs text-ink-3">{dates}</p> : null}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-1">
          <Hotel className="h-4 w-4 text-brand-500" /> {message}
        </p>
        <p className="text-xs text-ink-3">This usually takes 5–10 seconds</p>
      </div>

      {/* Skeleton hotel rows while we wait */}
      <div className="mt-2 w-full max-w-3xl space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="shimmer h-20 w-full overflow-hidden rounded-md border bg-surface-2/40"
          />
        ))}
      </div>
    </div>
  );
}
