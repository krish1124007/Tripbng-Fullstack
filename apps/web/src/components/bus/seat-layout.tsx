'use client';

// Seat-layout grid for bus selection.
//
// SeatSeller seats carry row/col + zIndex (0=lower berth, 1=upper).
// We render two stacked grids — Lower deck (zIndex=0) on top, Upper deck
// (zIndex=1) below it — labelled and separated. Seats colour-code by:
//   - available=false → struck through, disabled
//   - ladiesSeat=true → pink badge
//   - selected      → brand fill
//   - default       → neutral border
//
// Forced-seat rules (parsed by the backend's parseForcedSeats) drive
// whether a passenger of a given gender CAN pick a non-forced seat.
// We don't enforce that here — the backend re-validates at booking
// time — but we surface the rule in a banner so the agent knows why
// some picks may bounce.

import { Armchair, Info } from 'lucide-react';
import type { BusForcedSeatsView, BusSeat } from '@tripbng/shared';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

interface SeatLayoutProps {
  seats: BusSeat[];
  forcedSeats: BusForcedSeatsView;
  selectedSeats: string[];
  /** Max selectable — agent picks once per pax. */
  maxSelections?: number;
  onToggle: (seatName: string) => void;
}

export function SeatLayout({
  seats,
  forcedSeats,
  selectedSeats,
  maxSelections = 8,
  onToggle,
}: SeatLayoutProps) {
  const lower = seats.filter((s) => (s.zIndex ?? 0) === 0);
  const upper = seats.filter((s) => s.zIndex === 1);

  const selectedSet = new Set(selectedSeats);
  const limitReached = selectedSeats.length >= maxSelections;

  return (
    <div className="space-y-4">
      {(forcedSeats.female.length > 0 || forcedSeats.male.length > 0) ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} />
          <div className="space-y-0.5 text-ink-2">
            {forcedSeats.female.length > 0 ? (
              <p>
                <span className="font-semibold text-pink-600">Ladies-reserved:</span>{' '}
                {forcedSeats.female.join(', ')} — at least one female passenger must pick from
                this list.
              </p>
            ) : null}
            {forcedSeats.male.length > 0 ? (
              <p>
                <span className="font-semibold text-blue-600">Gents-reserved:</span>{' '}
                {forcedSeats.male.join(', ')} — at least one male passenger must pick from this
                list.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <DeckGrid
        title="Lower deck"
        seats={lower}
        selectedSet={selectedSet}
        forcedFemale={forcedSeats.female}
        forcedMale={forcedSeats.male}
        limitReached={limitReached}
        onToggle={onToggle}
      />
      {upper.length > 0 ? (
        <DeckGrid
          title="Upper deck"
          seats={upper}
          selectedSet={selectedSet}
          forcedFemale={forcedSeats.female}
          forcedMale={forcedSeats.male}
          limitReached={limitReached}
          onToggle={onToggle}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
        <LegendDot className="border-ink-3/30 bg-surface-1" label="Available" />
        <LegendDot className="border-brand-500 bg-brand-500 text-white" label="Selected" />
        <LegendDot className="border-pink-300 bg-pink-50 text-pink-700" label="Ladies seat" />
        <LegendDot className="border-blue-300 bg-blue-50 text-blue-700" label="Gents seat" />
        <LegendDot
          className="border-transparent bg-surface-3 text-ink-3 line-through opacity-50"
          label="Booked"
        />
      </div>
    </div>
  );
}

function DeckGrid({
  title,
  seats,
  selectedSet,
  forcedFemale,
  forcedMale,
  limitReached,
  onToggle,
}: {
  title: string;
  seats: BusSeat[];
  selectedSet: Set<string>;
  forcedFemale: string[];
  forcedMale: string[];
  limitReached: boolean;
  onToggle: (seatName: string) => void;
}): JSX.Element {
  // Group by row.
  const byRow = new Map<number, BusSeat[]>();
  for (const s of seats) {
    const row = s.row ?? 0;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row)!.push(s);
  }
  const sortedRows = [...byRow.entries()].sort(([a], [b]) => a - b);

  if (sortedRows.length === 0) return <></>;

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{title}</p>
      <div className="rounded-md border bg-surface-1 p-3">
        <div className="space-y-1.5">
          {sortedRows.map(([row, rowSeats]) => (
            <div key={row} className="flex items-center gap-1.5">
              <span className="w-6 shrink-0 text-right font-mono text-[10px] text-ink-3">
                {row}
              </span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {rowSeats.map((s) => (
                  <SeatButton
                    key={s.seatName}
                    seat={s}
                    selected={selectedSet.has(s.seatName)}
                    forcedFemale={forcedFemale.includes(s.seatName)}
                    forcedMale={forcedMale.includes(s.seatName)}
                    limitReached={limitReached}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SeatButton({
  seat,
  selected,
  forcedFemale,
  forcedMale,
  limitReached,
  onToggle,
}: {
  seat: BusSeat;
  selected: boolean;
  forcedFemale: boolean;
  forcedMale: boolean;
  limitReached: boolean;
  onToggle: (seatName: string) => void;
}): JSX.Element {
  const disabled = !seat.available || (limitReached && !selected);
  const tone = selected
    ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
    : !seat.available
      ? 'border-transparent bg-surface-3 text-ink-3 line-through opacity-50'
      : forcedFemale
        ? 'border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-100 dark:bg-pink-500/10'
        : forcedMale
          ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10'
          : 'border-ink-3/30 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(seat.seatName)}
      title={`${seat.seatName} · ${seat.seatType ?? ''} · ₹${seat.fareINR}${
        forcedFemale ? ' · ladies' : forcedMale ? ' · gents' : ''
      }`}
      className={cn(
        'flex h-8 min-w-[2.5rem] items-center justify-center gap-1 rounded border px-1.5 font-mono text-[11px] transition-colors',
        tone,
        disabled && 'cursor-not-allowed',
      )}
    >
      <Armchair className="h-3 w-3" />
      {seat.seatName}
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-3.5 w-3.5 rounded border', className)} />
      {label}
    </span>
  );
}

// Re-export the badge so consumers can decorate seat metadata above
// the layout. Keeps the one-stop-shop import shape simple.
export { Badge as SeatBadge };
