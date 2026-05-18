'use client';

import { Plane } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FlightSearchAnimationProps {
  /** Origin IATA — shown on the left of the route line. Defaults to "FROM". */
  originCode?: string | null;
  /** Destination IATA — shown on the right. Defaults to "TO". */
  destinationCode?: string | null;
  /** Status line under the animation — defaults to "Searching live fares…". */
  message?: string;
  /** Names of suppliers being polled in this fan-out — rendered as small chips. */
  suppliers?: string[];
  className?: string;
}

/**
 * Loading state for the flight search results — a plane glides from origin to
 * destination on a dashed contrail while we wait on supplier fan-out (typically
 * 5–15s for live aggregators like eTrav). Replaces the previous skeleton block;
 * gives the user a sense of progress + a reminder of what they searched for.
 *
 * Respects `prefers-reduced-motion` (defined in globals.css) — the cross-screen
 * flight degrades to a soft pulse for users who opt out of motion.
 */
export function FlightSearchAnimation({
  originCode,
  destinationCode,
  message = 'Searching live fares across our suppliers…',
  suppliers,
  className,
}: FlightSearchAnimationProps) {
  const from = (originCode ?? 'FROM').toUpperCase();
  const to = (destinationCode ?? 'TO').toUpperCase();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Searching flights from ${from} to ${to}`}
      className={cn(
        'flex flex-col items-center gap-4 rounded-lg border bg-surface-1 px-6 py-10',
        className,
      )}
    >
      {/* Route line */}
      <div className="flex w-full max-w-md items-center gap-3">
        {/* Origin chip */}
        <span className="shrink-0 rounded-md bg-brand-50 px-2 py-1 font-mono text-xs font-bold text-brand-700 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/20">
          {from}
        </span>

        {/* Track + plane */}
        <div className="relative h-6 flex-1">
          {/* Static dashed line under the trail. */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-stroke-1" aria-hidden />
          {/* Solid contrail growing left-to-right under the plane. */}
          <div
            className="animate-contrail-grow absolute left-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-brand-500"
            aria-hidden
          />
          {/* The plane. translateY(-50%) keeps it vertically centred while the
              keyframe drives translateX. */}
          <div
            className="animate-flight-cross absolute left-0 top-1/2 text-brand-600 dark:text-brand-300"
            aria-hidden
          >
            <Plane className="h-5 w-5 -rotate-12" strokeWidth={2} />
          </div>
        </div>

        {/* Destination chip */}
        <span className="shrink-0 rounded-md bg-accent-50 px-2 py-1 font-mono text-xs font-bold text-accent-700 ring-1 ring-accent-100 dark:bg-accent-500/15 dark:text-accent-300 dark:ring-accent-500/20">
          {to}
        </span>
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium text-ink-1">{message}</p>
        {suppliers && suppliers.length > 0 ? (
          <p className="text-xs text-ink-3">
            Polling {suppliers.join(', ')} — best price wins
          </p>
        ) : (
          <p className="text-xs text-ink-3">This usually takes 5–10 seconds</p>
        )}
      </div>
    </div>
  );
}
