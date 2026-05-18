'use client';

// DateStrip — horizontal date carousel above the result list.
//
// Lets the agent jump to surrounding dates without re-typing the route
// or opening the search form. Mirrors the UX of every major OTA (and the
// competitor screenshot the user shared).
//
// Default window: 11 dates, centred on `currentDate` (5 days before + 5
// days after). Arrows shift the window by ±7 days. We do NOT prefetch
// fares for non-current dates — that would require N parallel supplier
// calls. For non-current dates we render "Get fare" as a soft hint, and
// the actual fare appears only after the user clicks through.

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

interface DateStripProps {
  /** YYYY-MM-DD — the date the result list is currently showing. */
  currentDate: string;
  /** Cheapest fare on the currently-selected date, in paise. Shown on the active chip. */
  currentDateMinPaise?: number | null;
  /** Optional preloaded fares for other dates: { 'YYYY-MM-DD': paise }. */
  faresByDate?: Record<string, number>;
  /** Called with a YYYY-MM-DD string when the user picks a new date. */
  onDateChange: (date: string) => void;
}

const DAYS_TO_SHOW = 11;
const SHIFT_BY = 7;

export function DateStrip({
  currentDate,
  currentDateMinPaise,
  faresByDate,
  onDateChange,
}: DateStripProps) {
  // The "anchor" date — the date displayed in the centre of the window.
  // Defaults to currentDate but the user can scroll independently.
  const [anchor, setAnchor] = useState<string>(currentDate);

  // Whenever the currentDate prop changes (e.g. user clicked a date
  // here, parent updated URL → new currentDate), recentre anchor.
  // We use a render-time check rather than useEffect so the strip never
  // shows a stale anchor.
  const effectiveAnchor = useMemo(() => {
    if (anchor === currentDate) return anchor;
    // If currentDate is inside the current window, keep anchor as-is —
    // user might be flipping through nearby dates and we shouldn't snap.
    const windowStart = addDays(anchor, -Math.floor(DAYS_TO_SHOW / 2));
    const windowEnd = addDays(anchor, Math.floor(DAYS_TO_SHOW / 2));
    if (currentDate >= windowStart && currentDate <= windowEnd) return anchor;
    return currentDate;
  }, [anchor, currentDate]);

  const dates = useMemo(() => {
    const list: string[] = [];
    const half = Math.floor(DAYS_TO_SHOW / 2);
    for (let i = -half; i <= half; i++) {
      list.push(addDays(effectiveAnchor, i));
    }
    return list;
  }, [effectiveAnchor]);

  // Today as YYYY-MM-DD for "can we go back further?" check + visual.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const canGoPrev = dates[0]! > today;

  return (
    <div className="rounded-xl border border-stroke-1 bg-surface-1 shadow-sm">
      <div className="flex items-stretch">
        {/* Prev arrow */}
        <button
          type="button"
          onClick={() => setAnchor(addDays(effectiveAnchor, -SHIFT_BY))}
          disabled={!canGoPrev}
          aria-label="Show earlier dates"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-l-xl border-r border-stroke-1 px-3 transition-colors',
            canGoPrev
              ? 'text-ink-2 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-500/10'
              : 'cursor-not-allowed text-ink-4 opacity-50',
          )}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        </button>

        {/* Date row — horizontally scrollable on mobile, grid-fit on desktop */}
        <div className="no-scrollbar flex flex-1 overflow-x-auto">
          {dates.map((d) => {
            const isCurrent = d === currentDate;
            const isPast = d < today;
            const fareForDate = faresByDate?.[d];
            const minPaise = isCurrent ? currentDateMinPaise : fareForDate;
            return (
              <DateChip
                key={d}
                date={d}
                isCurrent={isCurrent}
                isPast={isPast}
                minPaise={minPaise ?? null}
                onClick={() => {
                  if (isPast) return;
                  if (d !== currentDate) onDateChange(d);
                }}
              />
            );
          })}
        </div>

        {/* Next arrow */}
        <button
          type="button"
          onClick={() => setAnchor(addDays(effectiveAnchor, SHIFT_BY))}
          aria-label="Show later dates"
          className="flex shrink-0 items-center justify-center rounded-r-xl border-l border-stroke-1 px-3 text-ink-2 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-500/10"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ────────── Single date chip ──────────

function DateChip({
  date,
  isCurrent,
  isPast,
  minPaise,
  onClick,
}: {
  date: string;
  isCurrent: boolean;
  isPast: boolean;
  minPaise: number | null;
  onClick: () => void;
}) {
  const d = new Date(date + 'T00:00:00');
  const dayLabel = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' });

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPast}
      aria-current={isCurrent ? 'date' : undefined}
      className={cn(
        'group/date relative flex min-w-[100px] flex-1 flex-col items-center gap-0.5 border-r border-stroke-1 px-3 py-2.5 transition-colors duration-fast last:border-r-0',
        isCurrent
          ? 'bg-brand-50/60 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
          : isPast
            ? 'cursor-not-allowed text-ink-4 opacity-60'
            : 'text-ink-3 hover:bg-surface-2/60 hover:text-ink-1',
      )}
    >
      <span
        className={cn(
          'text-[10px] font-semibold uppercase tracking-wider',
          isCurrent ? 'text-brand-600 dark:text-brand-400' : 'text-ink-4',
        )}
      >
        {weekday}
      </span>
      <span
        className={cn(
          'font-mono text-[14px] leading-tight tabular-nums',
          isCurrent ? 'font-bold' : 'font-semibold',
        )}
      >
        {dayLabel}
      </span>
      {minPaise != null ? (
        <span
          className={cn(
            'mt-0.5 font-mono text-[11px] font-semibold tabular-nums',
            isCurrent
              ? 'font-bold text-brand-700 dark:text-brand-300'
              : 'text-emerald-700 dark:text-emerald-400',
          )}
        >
          {formatPaiseAsINR(minPaise, { compact: true })}
        </span>
      ) : isPast ? (
        <span className="mt-0.5 text-[11px] text-ink-4">—</span>
      ) : (
        // No fare yet — render a subtle shimmer placeholder so the chip
        // doesn't keep saying "Get fare" while the prefetch is in
        // flight. After ~1.5s the prefetch usually returns; if a date
        // truly has no flights, we render "—" instead.
        <span
          aria-hidden
          className="mt-1 h-2 w-12 animate-pulse rounded bg-stroke-1 dark:bg-stroke-2"
        />
      )}

      {/* Active underline */}
      {isCurrent ? (
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-px h-[3px] rounded-t-full bg-brand-600 dark:bg-brand-400"
        />
      ) : null}
    </button>
  );
}

// ────────── Date math ──────────

function addDays(yyyyMmDd: string, days: number): string {
  const d = new Date(yyyyMmDd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
