'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatDuration, formatTime, type FlightResult } from './utils';

interface BestOfTileProps {
  tone: 'brand' | 'accent' | 'default';
  label: string;
  icon: LucideIcon;
  r: FlightResult | null | undefined;
  /** Which metric to feature in the headline number — the other still appears in the byline. */
  metric: 'price' | 'duration' | 'balanced';
  onClick: () => void;
}

/**
 * Top-of-list "Cheapest / Fastest / Best value" tile. One row above the result
 * list — visually distinct from a regular ResultCard so users can grab the
 * outlier picks without scanning.
 */
export function BestOfTile({ tone, label, icon: Icon, r, metric, onClick }: BestOfTileProps) {
  if (!r) {
    return (
      <Card className="opacity-50">
        <CardContent className="p-4 text-sm text-ink-3">No data</CardContent>
      </Card>
    );
  }
  const seg0 = r.segments[0]!;
  const segLast = r.segments[r.segments.length - 1]!;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-lg border p-4 text-left transition-all duration-fast hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone === 'brand' &&
          'bg-gradient-to-br from-brand-50 to-surface-1 border-brand-200/60 dark:from-brand-500/10 dark:border-brand-500/20',
        tone === 'accent' &&
          'bg-gradient-to-br from-accent-50 to-surface-1 border-accent-200/60 dark:from-accent-500/10 dark:border-accent-500/20',
        tone === 'default' && 'bg-surface-1 border-strong',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-md',
              tone === 'brand' && 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
              tone === 'accent' && 'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-400',
              tone === 'default' && 'bg-surface-2 text-ink-3',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-ink-2">{label}</span>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-ink-4 transition-all duration-fast group-hover:translate-x-0.5 group-hover:text-ink-1" />
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums text-ink-1">
        {metric === 'duration'
          ? formatDuration(r.totalDuration)
          : formatPaiseAsINR(r.totalGrossPaise, { compact: true })}
      </p>
      <p className="mt-1 truncate text-xs text-ink-3">
        <span className="font-mono font-semibold">
          {seg0.airline.code} {seg0.flightNumber}
        </span>
        {' · '}
        {formatTime(seg0.departure)} {seg0.origin.code} → {formatTime(segLast.arrival)} {segLast.destination.code}
        {' · '}
        {metric === 'duration'
          ? formatPaiseAsINR(r.totalGrossPaise, { compact: true })
          : formatDuration(r.totalDuration)}
      </p>
    </button>
  );
}
