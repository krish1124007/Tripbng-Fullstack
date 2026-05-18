'use client';

// SsrPicker — meal / baggage / seat add-on picker for the booking form.
//
// Wires `/api/v1/search/flights/ssr` to a per-pax × per-segment selection
// model that the parent form converts back into the canonical
// SsrSelectionsSchema before submitting /bookings/hold.
//
// Currently TBO-only on the API side; gracefully no-ops when supplierCode
// isn't TBO (renders nothing — the booking form continues to work without
// add-ons). Future suppliers (eTrav SSR) plug into the same endpoint.
//
// Three sub-pickers, all optional:
//   - Meals    — per segment × per pax, single choice from a list
//   - Baggage  — per segment × per pax, single choice from a list
//   - Seats    — per segment × per pax, click a seat in a simple grid
//
// Selections are propagated to the parent via onChange; the parent owns the
// state (so it can send `ssrSelections` in the hold body, and so this stays
// trivially testable).

import { useEffect, useMemo, useState } from 'react';
import { Apple, Briefcase, Loader2, ArmchairIcon } from 'lucide-react';
import type { SsrSelections } from '@tripbng/shared';
import { Badge, Button, Card, CardContent } from '@/components/ui';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useSsrCatalog } from './ssr-catalog-context';

// Mirror of the canonical shape in apps/api/src/adapters/tbo-flight/transforms.ts
// — kept as a structural type here so we don't have to round-trip it through
// the shared package just for UI rendering.
interface MealOption {
  code: string;
  label: string;
  description: string | null;
  pricePaise: number;
  currency: string;
}
interface BaggageOption {
  code: string;
  label: string;
  weightKg: number;
  pricePaise: number;
  currency: string;
}
interface SeatOption {
  code: string;
  rowNo: number;
  seatNo: string;
  seatType: string;
  available: boolean;
  pricePaise: number;
  currency: string;
}
interface SeatRow {
  rowNo: number;
  seats: SeatOption[];
}
interface SsrSegment {
  segmentId: string;
  origin: string | null;
  destination: string | null;
  meals: MealOption[];
  baggage: BaggageOption[];
  seatRows: SeatRow[];
  currency: string;
}

export interface SsrPickerProps {
  supplierCode: string;
  fareToken: string;
  /** Pax labels shown in the picker. The parent passes "Pax 1 (Adult)" etc.
   *  Order matters — paxIndex in the output corresponds to this array. */
  passengers: { label: string; type: 'ADULT' | 'CHILD' | 'INFANT' }[];
  /** Segment routing context — used to enrich each pick with airlineCode,
   *  flightNumber, wayType so the API has everything it needs to build the
   *  TBO SSR fields without re-fetching. Indexed by segmentId. */
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
  /** Bubble selections up to the form. */
  onChange: (selections: SsrSelections | undefined) => void;
  /** When true, hide the baggage section + omit baggage from onChange.
   *  Use this when a dedicated BaggageDetailsPicker is rendered above
   *  this component — prevents double-rendering + double-counting. */
  hideBaggage?: boolean;
  /** When true, hide the seats section + omit seats from onChange.
   *  Same pattern as hideBaggage — used when a dedicated
   *  SeatSelectionPicker takes over the seat-map UX. */
  hideSeats?: boolean;
  /** Raw segment IATA codes — passed to the SSR endpoint so it can
   *  synthesise a catalog for suppliers whose adapters don't ship
   *  SSR yet. */
  segments?: Array<{ origin: string; destination: string }>;
}

// Internal selection model — keyed on (segmentId, paxIndex) for meals + baggage,
// and (segmentId, paxIndex, seatCode) for seats. Stored as plain Maps to keep
// the equality logic obvious.
type MealKey = string; // `${segmentId}|${paxIndex}`
type BagKey = string; // `${segmentId}|${paxIndex}`
type SeatKey = string; // `${segmentId}|${paxIndex}`

export function SsrPicker(props: SsrPickerProps) {
  const {
    passengers,
    segmentRouting,
    onChange,
    hideBaggage,
    hideSeats,
  } = props;

  // Pull the shared catalog from the booking-step provider so we
  // don't fire a parallel fetch alongside BaggageDetailsPicker and
  // SeatSelectionPicker.
  const { catalog, isLoading, error, enabled: supportsSsr } = useSsrCatalog();
  // Compat alias for the existing render code below — preserves the
  // `fetchSsr.isPending` references without rewriting them.
  const fetchSsr = { isPending: isLoading };

  const [mealPicks, setMealPicks] = useState<Map<MealKey, MealOption>>(new Map());
  const [bagPicks, setBagPicks] = useState<Map<BagKey, BaggageOption>>(new Map());
  const [seatPicks, setSeatPicks] = useState<Map<SeatKey, SeatOption>>(new Map());

  // Bubble up whenever a pick changes. Convert the internal Maps into the
  // canonical SsrSelections shape the API expects.
  useEffect(() => {
    if (!supportsSsr || !catalog) {
      onChange(undefined);
      return;
    }
    const out: SsrSelections = {
      meals: [],
      baggage: [],
      seats: [],
    };
    for (const [key, meal] of mealPicks) {
      const [segmentId, paxIdxStr] = key.split('|');
      if (!segmentId) continue;
      const routing = segmentRouting?.[segmentId];
      out.meals!.push({
        segmentId,
        airlineCode: routing?.airlineCode,
        flightNumber: routing?.flightNumber,
        wayType: routing?.wayType,
        origin: routing?.origin,
        destination: routing?.destination,
        code: meal.code,
        description: meal.description ?? meal.label,
        pricePaise: meal.pricePaise,
        currency: meal.currency,
      });
      // paxIdx isn't required for meals in the schema, but track it for clarity.
      void paxIdxStr;
    }
    // Skip baggage entirely when a dedicated picker is rendered above —
    // the booking page will merge that picker's output separately.
    if (!hideBaggage) {
      for (const [key, bag] of bagPicks) {
        const [segmentId] = key.split('|');
        if (!segmentId) continue;
        const routing = segmentRouting?.[segmentId];
        out.baggage!.push({
          segmentId,
          airlineCode: routing?.airlineCode,
          flightNumber: routing?.flightNumber,
          wayType: routing?.wayType,
          origin: routing?.origin,
          destination: routing?.destination,
          code: bag.code,
          description: bag.label,
          weightKg: bag.weightKg,
          pricePaise: bag.pricePaise,
          currency: bag.currency,
        });
      }
    }
    if (!hideSeats) {
      for (const [key, seat] of seatPicks) {
        const [segmentId, paxIdxStr] = key.split('|');
        if (!segmentId || !paxIdxStr) continue;
        const paxIndex = Number.parseInt(paxIdxStr, 10);
        if (!Number.isFinite(paxIndex)) continue;
        const routing = segmentRouting?.[segmentId];
        out.seats!.push({
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
    }
    // Drop empty arrays — the API treats undefined and [] differently for
    // some suppliers. Cleaner to omit when there's nothing chosen.
    const cleaned: SsrSelections = {};
    if (out.meals && out.meals.length > 0) cleaned.meals = out.meals;
    if (out.baggage && out.baggage.length > 0) cleaned.baggage = out.baggage;
    if (out.seats && out.seats.length > 0) cleaned.seats = out.seats;
    onChange(Object.keys(cleaned).length === 0 ? undefined : cleaned);
  }, [supportsSsr, catalog, mealPicks, bagPicks, seatPicks, segmentRouting, onChange, hideBaggage, hideSeats]);

  // Total add-on price across all picks — surfaced in the section header.
  const addOnTotal = useMemo(() => {
    let sum = 0;
    for (const m of mealPicks.values()) sum += m.pricePaise;
    for (const b of bagPicks.values()) sum += b.pricePaise;
    for (const s of seatPicks.values()) sum += s.pricePaise;
    return sum;
  }, [mealPicks, bagPicks, seatPicks]);

  if (!supportsSsr) return null;

  if (fetchSsr.isPending) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading meals, baggage and seats…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-ink-3">
          Couldn't load add-ons: {error}. You can continue without selecting any.
        </CardContent>
      </Card>
    );
  }
  if (!catalog || catalog.segments.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-1">Add-ons</h3>
            <p className="mt-0.5 text-xs text-ink-3">
              Meals, baggage and seats — all optional.
            </p>
          </div>
          {addOnTotal > 0 ? (
            <Badge variant="brand" className="font-mono">
              + {formatPaiseAsINR(addOnTotal)}
            </Badge>
          ) : null}
        </div>

        {catalog.segments.map((seg) => (
          <SegmentPicker
            key={seg.segmentId}
            segment={seg}
            passengers={passengers}
            hideBaggage={!!hideBaggage}
            hideSeats={!!hideSeats}
            mealPicks={mealPicks}
            bagPicks={bagPicks}
            seatPicks={seatPicks}
            onMealChange={(key, meal) =>
              setMealPicks((prev) => {
                const next = new Map(prev);
                if (meal) next.set(key, meal);
                else next.delete(key);
                return next;
              })
            }
            onBagChange={(key, bag) =>
              setBagPicks((prev) => {
                const next = new Map(prev);
                if (bag) next.set(key, bag);
                else next.delete(key);
                return next;
              })
            }
            onSeatChange={(key, seat) =>
              setSeatPicks((prev) => {
                const next = new Map(prev);
                if (seat) next.set(key, seat);
                else next.delete(key);
                return next;
              })
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

// ────────── Sub-component: one segment's pickers ──────────

interface SegmentPickerProps {
  segment: SsrSegment;
  passengers: SsrPickerProps['passengers'];
  /** When true the baggage row is omitted — a dedicated picker
   *  handles it above. */
  hideBaggage: boolean;
  /** When true the seat-grid is omitted — a dedicated seat picker
   *  handles seat selection above. */
  hideSeats: boolean;
  mealPicks: Map<MealKey, MealOption>;
  bagPicks: Map<BagKey, BaggageOption>;
  seatPicks: Map<SeatKey, SeatOption>;
  onMealChange: (key: MealKey, meal: MealOption | null) => void;
  onBagChange: (key: BagKey, bag: BaggageOption | null) => void;
  onSeatChange: (key: SeatKey, seat: SeatOption | null) => void;
}

function SegmentPicker(props: SegmentPickerProps) {
  const { segment, passengers } = props;
  // Infants don't get separate meals/baggage/seats — they share with the lap-
  // adult. Filter them out of the picker pax list for ergonomic clarity.
  const eligiblePax = passengers
    .map((p, i) => ({ ...p, paxIndex: i }))
    .filter((p) => p.type !== 'INFANT');

  const [activePax, setActivePax] = useState<number>(eligiblePax[0]?.paxIndex ?? 0);
  const activeLabel =
    eligiblePax.find((p) => p.paxIndex === activePax)?.label ?? 'Pax 1';

  return (
    <div className="rounded-lg border bg-surface-2/30 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-2">
          <span className="font-mono">
            {segment.origin ?? '—'} → {segment.destination ?? '—'}
          </span>
        </div>
        {eligiblePax.length > 1 ? (
          <div className="flex gap-1 text-xs">
            {eligiblePax.map((p) => (
              <button
                key={p.paxIndex}
                type="button"
                onClick={() => setActivePax(p.paxIndex)}
                className={cn(
                  'rounded-md border px-2 py-1 transition-colors',
                  activePax === p.paxIndex
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-transparent text-ink-3 hover:bg-surface-3',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {eligiblePax.length === 0 ? (
        <p className="text-xs text-ink-3">
          No passengers eligible for add-ons on this segment.
        </p>
      ) : (
        <div className="space-y-4">
          <MealList
            options={segment.meals}
            selectedKey={`${segment.segmentId}|${activePax}`}
            currentPick={props.mealPicks.get(`${segment.segmentId}|${activePax}`) ?? null}
            paxLabel={activeLabel}
            onChange={(meal) =>
              props.onMealChange(`${segment.segmentId}|${activePax}`, meal)
            }
          />
          {!props.hideBaggage ? (
            <BaggageList
              options={segment.baggage}
              selectedKey={`${segment.segmentId}|${activePax}`}
              currentPick={props.bagPicks.get(`${segment.segmentId}|${activePax}`) ?? null}
              paxLabel={activeLabel}
              onChange={(bag) =>
                props.onBagChange(`${segment.segmentId}|${activePax}`, bag)
              }
            />
          ) : null}
          {!props.hideSeats ? (
            <SeatGrid
              rows={segment.seatRows}
              paxLabel={activeLabel}
              currentPick={props.seatPicks.get(`${segment.segmentId}|${activePax}`) ?? null}
              onChange={(seat) =>
                props.onSeatChange(`${segment.segmentId}|${activePax}`, seat)
              }
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ────────── Sub-component: meal list ──────────

function MealList(props: {
  options: MealOption[];
  selectedKey: string;
  currentPick: MealOption | null;
  paxLabel: string;
  onChange: (meal: MealOption | null) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <details className="group" open={props.currentPick !== null}>
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
        <Apple className="h-3.5 w-3.5" strokeWidth={1.75} />
        Meals · {props.paxLabel}
        {props.currentPick ? (
          <Badge variant="success" className="ml-auto text-[10px]">
            {props.currentPick.label} +{formatPaiseAsINR(props.currentPick.pricePaise)}
          </Badge>
        ) : null}
      </summary>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => props.onChange(null)}
          className={cn(
            'rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
            props.currentPick === null
              ? 'border-ink-2 bg-surface-3'
              : 'border-transparent hover:bg-surface-3',
          )}
        >
          <span className="font-medium text-ink-1">No meal</span>
        </button>
        {props.options.map((m) => (
          <button
            key={m.code}
            type="button"
            onClick={() => props.onChange(m)}
            className={cn(
              'flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
              props.currentPick?.code === m.code
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                : 'border-transparent hover:bg-surface-3',
            )}
          >
            <span>
              <span className="font-medium text-ink-1">{m.label}</span>
              {m.description && m.description !== m.label ? (
                <span className="block text-ink-3">{m.description}</span>
              ) : null}
            </span>
            <span className="font-mono text-ink-2">
              +{formatPaiseAsINR(m.pricePaise)}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

// ────────── Sub-component: baggage list ──────────

function BaggageList(props: {
  options: BaggageOption[];
  selectedKey: string;
  currentPick: BaggageOption | null;
  paxLabel: string;
  onChange: (bag: BaggageOption | null) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <details className="group" open={props.currentPick !== null}>
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
        <Briefcase className="h-3.5 w-3.5" strokeWidth={1.75} />
        Extra baggage · {props.paxLabel}
        {props.currentPick ? (
          <Badge variant="success" className="ml-auto text-[10px]">
            {props.currentPick.weightKg}kg +
            {formatPaiseAsINR(props.currentPick.pricePaise)}
          </Badge>
        ) : null}
      </summary>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => props.onChange(null)}
          className={cn(
            'rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
            props.currentPick === null
              ? 'border-ink-2 bg-surface-3'
              : 'border-transparent hover:bg-surface-3',
          )}
        >
          <span className="font-medium text-ink-1">No extra baggage</span>
        </button>
        {props.options.map((b) => (
          <button
            key={b.code}
            type="button"
            onClick={() => props.onChange(b)}
            className={cn(
              'flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
              props.currentPick?.code === b.code
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                : 'border-transparent hover:bg-surface-3',
            )}
          >
            <span className="font-medium text-ink-1">{b.label}</span>
            <span className="font-mono text-ink-2">
              +{formatPaiseAsINR(b.pricePaise)}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

// ────────── Sub-component: seat grid ──────────

function SeatGrid(props: {
  rows: SeatRow[];
  paxLabel: string;
  currentPick: SeatOption | null;
  onChange: (seat: SeatOption | null) => void;
}) {
  if (props.rows.length === 0) return null;
  return (
    <details className="group" open={props.currentPick !== null}>
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
        <ArmchairIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
        Seat · {props.paxLabel}
        {props.currentPick ? (
          <Badge variant="success" className="ml-auto text-[10px]">
            {props.currentPick.code} +{formatPaiseAsINR(props.currentPick.pricePaise)}
          </Badge>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[10px] text-ink-3"
            onClick={(e) => {
              e.preventDefault();
              props.onChange(null);
            }}
          >
            Clear
          </Button>
        )}
      </summary>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-md border bg-surface-2/40 p-2 text-[11px]">
        {props.rows.map((r) => (
          <div key={r.rowNo} className="mb-1 flex items-center gap-1">
            <span className="w-6 shrink-0 text-right font-mono text-ink-3">
              {r.rowNo}
            </span>
            <div className="flex flex-1 flex-wrap gap-1">
              {r.seats.map((s) => {
                const selected = props.currentPick?.code === s.code;
                const disabled = !s.available;
                return (
                  <button
                    key={s.code}
                    type="button"
                    disabled={disabled}
                    onClick={() => props.onChange(s)}
                    className={cn(
                      'h-7 min-w-[2.25rem] rounded border font-mono transition-colors',
                      disabled
                        ? 'border-transparent bg-surface-3 text-ink-3 line-through opacity-50'
                        : selected
                          ? 'border-brand-500 bg-brand-500 text-white'
                          : 'border-ink-3/30 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10',
                    )}
                    title={
                      disabled
                        ? `${s.code} (taken)`
                        : `${s.code} · ${s.seatType} · +${formatPaiseAsINR(s.pricePaise)}`
                    }
                  >
                    {s.seatNo}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
