'use client';

// BaggageDetailsPicker — dedicated "Baggage Details" section for the
// booking form. Mirrors the dropdown-per-passenger UX from competitor
// portals: each segment lists pax rows with a single Select per pax,
// options sourced from the supplier's SSR catalog
// (POST /api/v1/search/flights/ssr).
//
// We keep it focused on baggage (not meals / seats — the SsrPicker
// continues to handle those). The booking page composes both pickers
// and merges their outputs before posting /bookings/hold.
//
// Supplier support: TBO ships baggage in its SSR response today; other
// suppliers return empty arrays and the section gracefully self-hides.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Luggage } from 'lucide-react';
import type { SsrBaggagePick } from '@tripbng/shared';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useSsrCatalog, type SsrBaggageOption } from './ssr-catalog-context';

// Local alias so the existing render code keeps reading naturally.
type BaggageOption = SsrBaggageOption;

export interface BaggageDetailsPickerProps {
  /** Pax labels — order corresponds to paxIndex in the output. */
  passengers: { label: string; type: 'ADULT' | 'CHILD' | 'INFANT' }[];
  /** Per-segment routing metadata so each pick carries airline / flight
   *  / wayType for the supplier API. Keyed by segmentId. */
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
  /** Pretty per-segment dates / times for the header (e.g. "Fri 15 May 26 | 08:55"). */
  segmentSchedule?: Record<string, string>;
  /** Pretty origin / destination city names (e.g. "Chennai", "Bengaluru"). */
  segmentCities?: Record<string, { origin?: string; destination?: string }>;
  /** Called whenever the selection set changes. Returns the canonical
   *  list ready to inline into SsrSelections.baggage. */
  onChange: (baggage: SsrBaggagePick[] | undefined) => void;
}

export function BaggageDetailsPicker(props: BaggageDetailsPickerProps) {
  const { passengers, segmentRouting, segmentSchedule, segmentCities, onChange } = props;

  // Pull the shared catalog from context — populated once by the
  // SsrCatalogProvider that wraps the booking step.
  const { catalog, isLoading, error, enabled: supportsSsr } = useSsrCatalog();
  const [collapsed, setCollapsed] = useState(false);

  // Selection state — keyed by `${segmentId}|${paxIndex}` so each pax
  // can pick a different bag per segment.
  type Key = string;
  const [picks, setPicks] = useState<Map<Key, BaggageOption>>(new Map());

  // Bubble up whenever a pick changes — convert the Map into the
  // canonical SsrBaggagePick[] shape the API expects.
  useEffect(() => {
    if (picks.size === 0) {
      onChange(undefined);
      return;
    }
    const out: SsrBaggagePick[] = [];
    for (const [key, bag] of picks) {
      const [segmentId, paxIdxStr] = key.split('|');
      if (!segmentId) continue;
      const routing = segmentRouting?.[segmentId];
      out.push({
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
      void paxIdxStr;
    }
    onChange(out.length > 0 ? out : undefined);
  }, [picks, segmentRouting, onChange]);

  // Total add-on price across all picks — shown next to section header.
  const addOnTotal = useMemo(() => {
    let sum = 0;
    for (const b of picks.values()) sum += b.pricePaise;
    return sum;
  }, [picks]);

  // Eligible pax — infants share with the lap adult, so exclude them.
  const eligiblePax = passengers
    .map((p, i) => ({ ...p, paxIndex: i }))
    .filter((p) => p.type !== 'INFANT');

  // Don't render at all if there's no signal that the section will be
  // useful: non-TBO suppliers, no eligible pax, or the catalog came
  // back with zero baggage options across all segments.
  if (!supportsSsr || eligiblePax.length === 0) return null;
  if (error) {
    return (
      <div className="rounded-lg border border-stroke-1 bg-surface-2/30 p-4 text-xs text-ink-3">
        Couldn&apos;t load baggage options: {error}. You can continue without selecting any.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-stroke-1 bg-surface-1 p-4 text-sm text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        Loading baggage options…
      </div>
    );
  }
  if (!catalog) return null;
  const segmentsWithBaggage = catalog.segments.filter((s) => s.baggage.length > 0);
  if (segmentsWithBaggage.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-stroke-1 bg-surface-1 shadow-sm">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 border-b border-stroke-1 bg-gradient-to-r from-brand-50/40 to-surface-1 px-4 py-3 text-left transition-colors hover:bg-brand-50/60 dark:from-brand-500/10"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Luggage className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div>
            <h3 className="text-sm font-bold text-ink-1">
              Baggage Details{' '}
              <span className="text-[11px] font-medium text-ink-3">(Optional)</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Pre-pay extra baggage — cheaper than buying at the airport
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {addOnTotal > 0 ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              + {formatPaiseAsINR(addOnTotal)}
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
        <div className="space-y-5 p-4">
          {segmentsWithBaggage.map((seg) => {
            const schedule = segmentSchedule?.[seg.segmentId];
            const cities = segmentCities?.[seg.segmentId];
            const originName = cities?.origin ?? seg.origin ?? '—';
            const destName = cities?.destination ?? seg.destination ?? '—';
            return (
              <div key={seg.segmentId} className="space-y-2">
                {/* Sector header — "Chennai (MAA) - Bengaluru (BLR) Fri 15 May 26 | 08:55" */}
                <div className="text-[13px] font-semibold text-brand-700 dark:text-brand-300">
                  {originName}
                  <span className="font-mono text-ink-3"> ({seg.origin ?? '—'})</span>
                  <span className="mx-1.5 text-ink-3">–</span>
                  {destName}
                  <span className="font-mono text-ink-3"> ({seg.destination ?? '—'})</span>
                  {schedule ? (
                    <>
                      <span className="mx-2 text-ink-3">·</span>
                      <span className="font-normal text-ink-2">{schedule}</span>
                    </>
                  ) : null}
                </div>

                {/* "Add Baggage" sub-label */}
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Add Baggage
                </p>

                {/* Per-pax rows */}
                <div className="space-y-2">
                  {eligiblePax.map((p) => {
                    const key = `${seg.segmentId}|${p.paxIndex}`;
                    const currentPick = picks.get(key) ?? null;
                    return (
                      <BaggageRow
                        key={key}
                        paxLabel={`${p.type === 'CHILD' ? 'CHILD' : 'ADULT'} ${
                          eligiblePax.filter((q) => q.type === p.type).indexOf(p) + 1
                        }`}
                        currentPick={currentPick}
                        options={seg.baggage}
                        onChange={(bag) =>
                          setPicks((prev) => {
                            const next = new Map(prev);
                            if (bag) next.set(key, bag);
                            else next.delete(key);
                            return next;
                          })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ────────── Sub-component · per-pax baggage row ──────────

function BaggageRow({
  paxLabel,
  currentPick,
  options,
  onChange,
}: {
  paxLabel: string;
  currentPick: BaggageOption | null;
  options: BaggageOption[];
  onChange: (bag: BaggageOption | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[120px_1fr]">
      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink-2">
        {paxLabel}
      </span>
      <select
        value={currentPick?.code ?? ''}
        onChange={(e) => {
          const code = e.target.value;
          if (!code) {
            onChange(null);
            return;
          }
          const pick = options.find((o) => o.code === code);
          onChange(pick ?? null);
        }}
        className={cn(
          'w-full rounded-md border bg-surface-1 px-3 py-2 text-[13px] text-ink-1 transition-colors',
          'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
          currentPick
            ? 'border-brand-300 bg-brand-50/40 font-semibold dark:bg-brand-500/10'
            : 'border-stroke-1',
        )}
      >
        <option value="">Add Baggage</option>
        {options.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {opt.label.length > 0
              ? `${opt.label}${
                  opt.weightKg ? ` ${opt.weightKg} Kg` : ''
                } @ ${formatPaiseAsINR(opt.pricePaise)}`
              : `Excess Baggage ${opt.weightKg} Kg @ ${formatPaiseAsINR(opt.pricePaise)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
