'use client';

// SeatSelectionPicker — "Select Seats (Optional)" row + modal seat map.
//
// Collapsed view (shown inline in the booking form):
//   ┌──────────────────────────────────────────────────────────┐
//   │ Select Seats (Optional)                              ⌃   │
//   │ Chennai (MAA) – Bengaluru (BLR) · 15 May 26 08:55       │
//   │ No seats selected                       [ Select seats ] │
//   └──────────────────────────────────────────────────────────┘
//
// Expanded modal: per-segment tabs, passenger × seat allocation table,
// visual seat map with price-tier colour coding, and "Proceed / Proceed
// without seats" actions.
//
// Data source: same TBO-backed /api/v1/search/flights/ssr endpoint
// that BaggageDetailsPicker and SsrPicker use. We fetch once per
// (supplierCode, fareToken) and reuse the catalog locally.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, ArmchairIcon, X } from 'lucide-react';
import type { SsrSeatPick } from '@tripbng/shared';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import {
  useSsrCatalog,
  type SsrCatalogSegment as SsrSegment,
  type SsrSeatOption as SeatOption,
  type SsrSeatRow as SeatRow,
} from './ssr-catalog-context';

interface PassengerLabel {
  label: string;
  type: 'ADULT' | 'CHILD' | 'INFANT';
}

export interface SeatSelectionPickerProps {
  passengers: PassengerLabel[];
  /** Per-segment routing — used to enrich each pick with airline / flight / wayType. */
  segmentRouting?: Record<
    string,
    {
      airlineCode?: string;
      flightNumber?: string;
      wayType?: 1 | 2;
      origin?: string;
      destination?: string;
    }
  >;
  /** Pretty city names per segment (e.g. {"BOM-DEL": {origin:"Mumbai", destination:"Delhi"}}). */
  segmentCities?: Record<string, { origin?: string; destination?: string }>;
  /** Pretty schedule per segment (e.g. "Fri 15 May 26 08:55"). */
  segmentSchedule?: Record<string, string>;
  /** Receives the canonical SsrSeatPick[] whenever the selection changes. */
  onChange: (seats: SsrSeatPick[] | undefined) => void;
}

// Internal selection: keyed by `${segmentId}|${paxIndex}` → one seat per pax per segment.
type SeatKey = string;

export function SeatSelectionPicker(props: SeatSelectionPickerProps) {
  const { passengers, segmentRouting, segmentCities, segmentSchedule, onChange } = props;

  // Pull the shared catalog from context — one fetch shared across
  // BaggageDetailsPicker, SeatSelectionPicker, and SsrPicker.
  const { catalog, isLoading, error, enabled: supportsSsr } = useSsrCatalog();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Picks keyed by (segmentId, paxIndex). One seat per pax per segment.
  const [picks, setPicks] = useState<Map<SeatKey, SeatOption>>(new Map());

  // Bubble up selections in the canonical SsrSeatPick[] shape.
  useEffect(() => {
    if (picks.size === 0) {
      onChange(undefined);
      return;
    }
    const out: SsrSeatPick[] = [];
    for (const [key, seat] of picks) {
      const [segmentId, paxIdxStr] = key.split('|');
      if (!segmentId || !paxIdxStr) continue;
      const paxIndex = Number.parseInt(paxIdxStr, 10);
      if (!Number.isFinite(paxIndex)) continue;
      const routing = segmentRouting?.[segmentId];
      out.push({
        segmentId,
        airlineCode: routing?.airlineCode,
        flightNumber: routing?.flightNumber,
        wayType: routing?.wayType,
        origin: routing?.origin,
        destination: routing?.destination,
        code: seat.code,
        rowNo: seat.rowNo,
        seatNo: seat.seatNo,
        seatType: seat.seatType,
        pricePaise: seat.pricePaise,
        currency: seat.currency,
        paxIndex,
      });
    }
    onChange(out.length > 0 ? out : undefined);
  }, [picks, segmentRouting, onChange]);

  const eligiblePax = useMemo(
    () =>
      passengers
        .map((p, i) => ({ ...p, paxIndex: i }))
        .filter((p) => p.type !== 'INFANT'),
    [passengers],
  );

  // Total seat fare across all picks.
  const totalSeatFare = useMemo(() => {
    let sum = 0;
    for (const s of picks.values()) sum += s.pricePaise;
    return sum;
  }, [picks]);

  // Self-hide gates.
  if (!supportsSsr || eligiblePax.length === 0) return null;
  if (error) {
    return (
      <div className="rounded-lg border border-stroke-1 bg-surface-2/30 p-4 text-xs text-ink-3">
        Couldn&apos;t load seat map: {error}. You can continue without selecting seats.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-stroke-1 bg-surface-1 p-4 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        Loading seat map…
      </div>
    );
  }
  if (!catalog) return null;
  const segmentsWithSeats = catalog.segments.filter((s) => s.seatRows.length > 0);
  if (segmentsWithSeats.length === 0) return null;

  // Selection helpers per segment for the collapsed row.
  function selectedCountForSegment(segmentId: string): number {
    let n = 0;
    for (const key of picks.keys()) {
      if (key.startsWith(`${segmentId}|`)) n += 1;
    }
    return n;
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-stroke-1 bg-surface-1 shadow-sm">
        {/* Section header — matches the user's screenshot UX */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex w-full items-center justify-between gap-3 border-b border-stroke-1 bg-gradient-to-r from-brand-50/40 to-surface-1 px-4 py-3 text-left transition-colors hover:bg-brand-50/60 dark:from-brand-500/10"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <ArmchairIcon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-ink-1">
                Select Seats{' '}
                <span className="text-[11px] font-medium text-ink-3">(Optional)</span>
              </h3>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Pick your seats now or let the airline auto-assign at check-in
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalSeatFare > 0 ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                + {formatPaiseAsINR(totalSeatFare)}
              </span>
            ) : null}
            {collapsed ? (
              <ChevronDown className="h-4 w-4 text-brand-600" strokeWidth={2} />
            ) : (
              <ChevronUp className="h-4 w-4 text-brand-600" strokeWidth={2} />
            )}
          </div>
        </button>

        {!collapsed ? (
          <div className="space-y-3 p-4">
            {segmentsWithSeats.map((seg) => {
              const cities = segmentCities?.[seg.segmentId];
              const schedule = segmentSchedule?.[seg.segmentId];
              const count = selectedCountForSegment(seg.segmentId);
              return (
                <div
                  key={seg.segmentId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stroke-1 bg-surface-2/30 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-brand-700 dark:text-brand-300">
                      {cities?.origin ?? seg.origin}
                      <span className="font-mono text-ink-3"> ({seg.origin ?? '—'})</span>
                      <span className="mx-1.5 text-ink-3">–</span>
                      {cities?.destination ?? seg.destination}
                      <span className="font-mono text-ink-3"> ({seg.destination ?? '—'})</span>
                      {schedule ? (
                        <>
                          <span className="mx-2 text-ink-3">·</span>
                          <span className="font-normal text-ink-2">{schedule}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-ink-3">
                      {count === 0
                        ? 'No Seats Selected'
                        : `${count} seat${count > 1 ? 's' : ''} selected`}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setOpen(true);
                      }}
                      className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300"
                    >
                      Select Seats
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {open ? (
        <SeatMapDialog
          open={open}
          onClose={() => setOpen(false)}
          segments={segmentsWithSeats}
          passengers={eligiblePax}
          picks={picks}
          setPicks={setPicks}
        />
      ) : null}
    </>
  );
}

// ────────── Seat map dialog ──────────

interface SeatMapDialogProps {
  open: boolean;
  onClose: () => void;
  segments: SsrSegment[];
  passengers: Array<PassengerLabel & { paxIndex: number }>;
  picks: Map<SeatKey, SeatOption>;
  setPicks: React.Dispatch<React.SetStateAction<Map<SeatKey, SeatOption>>>;
}

function SeatMapDialog({
  open,
  onClose,
  segments,
  passengers,
  picks,
  setPicks,
}: SeatMapDialogProps) {
  const [activeSegmentId, setActiveSegmentId] = useState<string>(
    segments[0]?.segmentId ?? '',
  );
  const [activePaxIndex, setActivePaxIndex] = useState<number>(
    passengers[0]?.paxIndex ?? 0,
  );

  const activeSegment =
    segments.find((s) => s.segmentId === activeSegmentId) ?? segments[0]!;

  // Per-pax totals for the active segment.
  function seatForPax(segmentId: string, paxIndex: number): SeatOption | null {
    return picks.get(`${segmentId}|${paxIndex}`) ?? null;
  }

  const segmentTotal = useMemo(() => {
    let sum = 0;
    for (const p of passengers) {
      const seat = seatForPax(activeSegment.segmentId, p.paxIndex);
      if (seat) sum += seat.pricePaise;
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, activeSegment.segmentId, passengers]);

  function selectSeat(seat: SeatOption) {
    if (!seat.available) return;
    setPicks((prev) => {
      const next = new Map(prev);
      // Remove this seat from any other pax it might already be on
      // (the agent re-clicked a previously-assigned seat — toggle off).
      const existingKey = Array.from(next.entries()).find(
        ([, s]) =>
          s.code === seat.code &&
          s.rowNo === seat.rowNo &&
          // Only match within the active segment
          true,
      );
      if (existingKey) {
        const [k] = existingKey;
        if (k.startsWith(`${activeSegment.segmentId}|`)) {
          // Same segment → toggle this seat off
          next.delete(k);
          return next;
        }
      }
      // Assign to the active pax (replace any existing seat for that pax).
      next.set(`${activeSegment.segmentId}|${activePaxIndex}`, seat);
      // Advance active pax to the next un-seated one for fluent multi-pax flow.
      const remaining = passengers.find(
        (p) =>
          p.paxIndex !== activePaxIndex &&
          !next.has(`${activeSegment.segmentId}|${p.paxIndex}`),
      );
      if (remaining) setActivePaxIndex(remaining.paxIndex);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <ArmchairIcon className="h-4 w-4" strokeWidth={2} />
            </span>
            <DialogTitle>Select Seats</DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </DialogHeader>

        <DialogBody className="max-h-[80vh] overflow-y-auto">
          {/* Segment tabs — only render when more than one segment */}
          {segments.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-1.5 border-b border-stroke-1 pb-3">
              {segments.map((seg) => {
                const isActive = seg.segmentId === activeSegment.segmentId;
                return (
                  <button
                    key={seg.segmentId}
                    type="button"
                    onClick={() => setActiveSegmentId(seg.segmentId)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors',
                      isActive
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'bg-surface-2 text-ink-2 hover:bg-surface-3',
                    )}
                  >
                    {seg.origin} – {seg.destination}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-8">
            {/* ── Left · Passenger table + Legend ── */}
            <div className="space-y-4">
              {/* Passenger × Seat table */}
              <div className="overflow-hidden rounded-lg border border-stroke-1">
                <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 border-b border-stroke-1 bg-brand-50/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  <span>Passenger</span>
                  <span>Seat</span>
                  <span>Fare</span>
                </div>
                {passengers.map((p) => {
                  const seat = seatForPax(activeSegment.segmentId, p.paxIndex);
                  const isActive = p.paxIndex === activePaxIndex;
                  return (
                    <button
                      key={p.paxIndex}
                      type="button"
                      onClick={() => setActivePaxIndex(p.paxIndex)}
                      className={cn(
                        'grid w-full grid-cols-[1.5fr_1fr_1fr] gap-2 border-b border-stroke-1 px-3 py-2 text-left text-[12px] last:border-b-0 transition-colors',
                        isActive
                          ? 'bg-brand-50/60 dark:bg-brand-500/10'
                          : 'hover:bg-surface-2/60',
                      )}
                    >
                      <span className="truncate font-semibold text-ink-1">{p.label}</span>
                      <span className="font-mono font-bold text-ink-1">
                        {seat ? seat.code : '—'}
                      </span>
                      <span className="font-mono tabular-nums text-ink-2">
                        {seat ? formatPaiseAsINR(seat.pricePaise) : formatPaiseAsINR(0)}
                      </span>
                    </button>
                  );
                })}
                <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 bg-surface-2/40 px-3 py-2 text-[12px] font-bold text-ink-1">
                  <span>Total fare</span>
                  <span />
                  <span className="font-mono tabular-nums">
                    {formatPaiseAsINR(segmentTotal)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col items-center gap-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={onClose}
                  className="w-full bg-amber-500 hover:bg-amber-600"
                >
                  Proceed
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    // Clear picks for this segment only
                    setPicks((prev) => {
                      const next = new Map(prev);
                      for (const k of Array.from(next.keys())) {
                        if (k.startsWith(`${activeSegment.segmentId}|`)) next.delete(k);
                      }
                      return next;
                    });
                    onClose();
                  }}
                  className="text-[12px] font-semibold text-rose-600 hover:underline dark:text-rose-400"
                >
                  Proceed without seats
                </button>
              </div>

              {/* Legend */}
              <div className="rounded-lg border border-stroke-1 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-brand-700 dark:text-brand-300">
                  <ArmchairIcon className="h-3.5 w-3.5" strokeWidth={2} />
                  Seat Type
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-ink-2">
                  <LegendItem color="#475569" label="Free" />
                  <LegendItem color="#d946ef" label="₹300 – 500" />
                  <LegendItem color="#ec4899" label="₹501 – 1000" />
                  <LegendItem color="#06b6d4" label="₹1001 – 1500" />
                  <LegendItem color="#10b981" label="Selected" />
                  <LegendItem color="#cbd5e1" label="Sold" />
                </div>
              </div>

              <p className="text-[10px] leading-snug text-ink-4">
                * Conditions apply. We will try our best to accommodate your seat
                preferences. Due to operational considerations the airline can&apos;t
                guarantee this selection. The seat map shown may not be the exact
                replica of the flight layout.
              </p>
            </div>

            {/* ── Right · Visual seat map ── */}
            <div className="rounded-lg bg-gradient-to-b from-surface-1 to-surface-2/30 p-3">
              <SeatMap
                rows={activeSegment.seatRows}
                onSelect={selectSeat}
                picks={picks}
                activeSegmentId={activeSegment.segmentId}
              />
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-3 w-3 rounded-sm"
        style={{ background: color }}
      />
      <span>{label}</span>
    </div>
  );
}

// ────────── Seat map (visual grid) ──────────

interface SeatMapProps {
  rows: SeatRow[];
  picks: Map<SeatKey, SeatOption>;
  activeSegmentId: string;
  onSelect: (seat: SeatOption) => void;
}

function SeatMap({ rows, picks, activeSegmentId, onSelect }: SeatMapProps) {
  // Build per-row layout. Assume the longest row defines the seat letters.
  const allLetters = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      for (const s of row.seats) set.add(s.seatNo);
    }
    return Array.from(set).sort();
  }, [rows]);

  // Insert an aisle gap roughly in the middle (works for 3-3 LCC layouts).
  // Heuristic: gap goes after position floor(N/2).
  const aisleAfter = Math.floor(allLetters.length / 2);

  // Which seats are currently in the picks map for this segment? Build a set.
  const selectedCodes = useMemo(() => {
    const out = new Set<string>();
    for (const [key, seat] of picks) {
      if (!key.startsWith(`${activeSegmentId}|`)) continue;
      out.add(`${seat.rowNo}${seat.seatNo}`);
    }
    return out;
  }, [picks, activeSegmentId]);

  return (
    <div className="mx-auto w-full max-w-[min(400px,95vw)] rounded-[40%_40%_18px_18px] border border-stroke-2 bg-surface-1 px-4 py-6 shadow-inner">
      {/* Cockpit silhouette */}
      <div className="mb-4 h-12 rounded-b-[40%_60%] border-b border-stroke-2 bg-gradient-to-b from-surface-2 to-surface-1" />

      {/* Column headers */}
      <div className="mb-2 flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase text-ink-3">
        {allLetters.map((letter, i) => (
          <>
            <span key={letter} className="w-7 text-center">
              {letter}
            </span>
            {i === aisleAfter - 1 ? <span key="aisle" className="w-3" /> : null}
          </>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        {rows.map((row) => (
          <div key={row.rowNo} className="flex items-center gap-1.5">
            <span className="w-5 text-right font-mono text-[9px] text-ink-4">
              {row.rowNo}
            </span>
            {allLetters.map((letter, i) => {
              const seat = row.seats.find((s: SeatOption) => s.seatNo === letter);
              return (
                <>
                  {seat ? (
                    <Seat
                      key={`${row.rowNo}${letter}`}
                      seat={seat}
                      isSelected={selectedCodes.has(`${seat.rowNo}${seat.seatNo}`)}
                      onSelect={onSelect}
                    />
                  ) : (
                    <span key={`${row.rowNo}${letter}-empty`} className="h-7 w-7" />
                  )}
                  {i === aisleAfter - 1 ? (
                    <span key={`${row.rowNo}-aisle`} className="w-3" />
                  ) : null}
                </>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Seat({
  seat,
  isSelected,
  onSelect,
}: {
  seat: SeatOption;
  isSelected: boolean;
  onSelect: (s: SeatOption) => void;
}) {
  const sold = !seat.available;
  const tier = priceTier(seat.pricePaise);
  const bgColor = sold
    ? '#cbd5e1'
    : isSelected
      ? '#10b981'
      : tierColor(tier);

  return (
    <button
      type="button"
      onClick={() => onSelect(seat)}
      disabled={sold}
      title={
        sold
          ? `${seat.rowNo}${seat.seatNo} · Sold`
          : `${seat.rowNo}${seat.seatNo} · ${
              seat.seatType || 'Seat'
            } · ${seat.pricePaise === 0 ? 'Free' : formatPaiseAsINR(seat.pricePaise)}`
      }
      aria-label={`Seat ${seat.rowNo}${seat.seatNo}`}
      className={cn(
        'h-7 w-7 rounded-md transition-transform',
        sold ? 'cursor-not-allowed' : 'cursor-pointer hover:scale-110',
        isSelected && 'ring-2 ring-emerald-500 ring-offset-1',
      )}
      style={{ background: bgColor }}
    />
  );
}

function priceTier(paise: number): 0 | 1 | 2 | 3 {
  const rupees = paise / 100;
  if (rupees <= 0) return 0;
  if (rupees <= 500) return 1;
  if (rupees <= 1000) return 2;
  return 3;
}

function tierColor(tier: 0 | 1 | 2 | 3): string {
  switch (tier) {
    case 0:
      return '#475569';
    case 1:
      return '#d946ef';
    case 2:
      return '#ec4899';
    case 3:
      return '#06b6d4';
  }
}
