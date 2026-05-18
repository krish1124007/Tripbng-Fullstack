'use client';

// MultiCityView — N-leg booking results with tab-based navigation.
//
// Mirrors the reference UX from competitor portals (etrav, MMT, etc.):
//   • Top tab strip — one tab per leg (e.g. BLR → MAA · MAA → HYD · HYD → BOM)
//   • Active tab shows that leg's flight results
//   • Each leg fires its own /search call (in parallel)
//   • Per-leg selection state, per-leg sort, per-leg filter (sidebar
//     filters from the parent still apply globally — we re-use the
//     same FlightFilters object)
//   • Sticky bottom bar shows ALL selected legs + combined total +
//     Book button (enabled only when every leg is selected)
//
// Booking handoff: stashes legs 2..N in sessionStorage and navigates
// to /book with leg 1's fareToken. The book page picks up the chain
// after the first leg is ticketed.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  PlaneTakeoff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SearchRequest, SearchResponse, SearchSegment } from '@tripbng/shared';
import { Button, Card, CardContent, EmptyState } from '@/components/ui';
import { ResultCard } from '@/components/flights/result-card';
import { SortTabs } from '@/components/flights/sort-tabs';
import {
  applyFlightFilters,
  emptyFilters,
  groupFlightsBySignature,
  type FlightFilters,
  type FlightResult,
  type SortKey,
} from '@/components/flights/utils';
import { FlightSearchAnimation } from '@/components/flight-search-animation';
import { useApiMutation } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface MultiCityViewProps {
  parsed: SearchRequest;
  /** Called when the agent clicks "Book all" with every leg selected. */
  onBookMultiCity: (
    legs: Array<{ searchId: string; result: FlightResult }>,
  ) => void;
}

interface LegState {
  segment: SearchSegment;
  request: SearchRequest;
  data: SearchResponse | null;
  selected: FlightResult | null;
  sort: SortKey;
  filters: FlightFilters;
  loading: boolean;
  errored: boolean;
}

export function MultiCityView({ parsed, onBookMultiCity }: MultiCityViewProps) {
  // ────────── Build a per-leg request list ──────────
  //
  // Each multi-city leg is reshaped into a ONEWAY-shape single-segment
  // request so the existing /search endpoint can serve it. The order
  // is preserved: parsed.segments[i] → leg[i].

  const legRequests = useMemo<SearchRequest[]>(() => {
    return parsed.segments.map((s) => ({
      ...parsed,
      tripType: 'ONEWAY',
      segments: [s],
    }));
  }, [parsed]);

  // Per-leg result + selection + sort. Initialised on every mount;
  // re-creating array keeps `useState<T[]>` updates predictable.
  const [legs, setLegs] = useState<LegState[]>(() =>
    parsed.segments.map((s, i) => ({
      segment: s,
      request: legRequests[i]!,
      data: null,
      selected: null,
      sort: 'price' as SortKey,
      filters: { ...emptyFilters },
      loading: true,
      errored: false,
    })),
  );

  const [activeLeg, setActiveLeg] = useState(0);

  // Per-leg mutations. We instantiate N mutations up-front (one per
  // leg) so each has its own isPending / response handlers. The
  // mutations all hit the same endpoint — TanStack Query keeps them
  // independent.
  //
  // Hooks-rules: we can't loop `useApiMutation` because hook count
  // mustn't vary across renders. Multi-city allows 1..6 segments, so
  // we instantiate the max (6) and only fire the ones we need.

  const MAX_LEGS = 6;
  const mutations = [
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLegMutation(0, setLegs),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLegMutation(1, setLegs),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLegMutation(2, setLegs),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLegMutation(3, setLegs),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLegMutation(4, setLegs),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLegMutation(5, setLegs),
  ];

  // Fire all leg searches once per (segments × class × pax) signature.
  const lastSig = useRef<string>('');
  useEffect(() => {
    const sig =
      parsed.segments
        .map(
          (s) =>
            `${s.origin}-${s.destination}@${new Date(s.date).toISOString().slice(0, 10)}`,
        )
        .join('|') +
      `|${parsed.travelClass}|${parsed.pax.adults}|${parsed.pax.children}|${parsed.pax.infants}`;
    if (lastSig.current === sig) return;
    lastSig.current = sig;

    // Reset state on signature change.
    setLegs(
      parsed.segments.map((s, i) => ({
        segment: s,
        request: legRequests[i]!,
        data: null,
        selected: null,
        sort: 'price' as SortKey,
        filters: { ...emptyFilters },
        loading: true,
        errored: false,
      })),
    );
    setActiveLeg(0);

    legRequests.slice(0, MAX_LEGS).forEach((req, i) => {
      mutations[i]!.mutate(req);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  // ────────── Derived ──────────

  const activeLegState = legs[activeLeg];
  const filteredGroups = useFilteredGroups(
    activeLegState?.data ?? null,
    activeLegState?.filters ?? emptyFilters,
    activeLegState?.sort ?? 'price',
  );
  const allLegsSelected = legs.every((l) => l.selected != null);
  const totalPaise = legs.reduce((sum, l) => sum + (l.selected?.totalGrossPaise ?? 0), 0);

  // ────────── Render ──────────

  if (parsed.segments.length < 2) {
    return (
      <EmptyState
        icon={PlaneTakeoff}
        title="Multi-city needs ≥ 2 segments"
        description="Modify your search to add at least two legs."
      />
    );
  }

  return (
    <>
      {/* Leg tabs */}
      <div className="overflow-hidden rounded-xl border border-stroke-1 bg-surface-1 shadow-sm">
        <div className="no-scrollbar flex overflow-x-auto">
          {legs.map((leg, i) => {
            const isActive = i === activeLeg;
            return (
              <button
                key={`${leg.segment.origin}-${leg.segment.destination}-${i}`}
                type="button"
                onClick={() => setActiveLeg(i)}
                aria-pressed={isActive}
                className={cn(
                  'relative flex-1 min-w-[180px] border-r border-stroke-1 px-4 py-3 text-left transition-colors last:border-r-0',
                  isActive
                    ? 'bg-gradient-to-r from-emerald-50 to-brand-50 dark:from-emerald-500/15 dark:to-brand-500/15'
                    : 'hover:bg-surface-2/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wider',
                      isActive ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3',
                    )}
                  >
                    Leg {i + 1}
                  </span>
                  {leg.selected ? (
                    <CheckCircle2
                      className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                      strokeWidth={2.25}
                    />
                  ) : null}
                </div>
                <p
                  className={cn(
                    'mt-0.5 font-mono text-[14px] font-bold',
                    isActive ? 'text-ink-1' : 'text-ink-2',
                  )}
                >
                  {leg.segment.origin} <ArrowRight className="inline h-3 w-3" strokeWidth={2.5} />{' '}
                  {leg.segment.destination}
                </p>
                <p className="text-[11px] text-ink-3">
                  {formatLegDate(leg.segment.date)} · {legResultCount(leg)} fares
                </p>
                {/* Active indicator */}
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-px h-[3px] rounded-t-full bg-brand-600 dark:bg-brand-400"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active-leg toolbar — sort */}
      {activeLegState && !activeLegState.loading && (activeLegState.data?.results.length ?? 0) > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-ink-3">
            Showing{' '}
            <span className="font-bold text-ink-1">
              {activeLegState.data?.results.length ?? 0}
            </span>{' '}
            fares for{' '}
            <span className="font-mono font-bold text-ink-1">
              {activeLegState.segment.origin} → {activeLegState.segment.destination}
            </span>
          </p>
          <SortTabs
            sort={activeLegState.sort}
            onChange={(s) =>
              setLegs((prev) => {
                const next = [...prev];
                if (next[activeLeg]) next[activeLeg] = { ...next[activeLeg]!, sort: s };
                return next;
              })
            }
          />
        </div>
      ) : null}

      {/* Active-leg results */}
      <div className="mt-3">
        {activeLegState?.loading ? (
          <FlightSearchAnimation
            originCode={activeLegState.segment.origin}
            destinationCode={activeLegState.segment.destination}
            suppliers={['ETrav', 'Kafila', 'TBO']}
          />
        ) : activeLegState?.errored ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-ink-3">
              Couldn&apos;t fetch fares for this leg. Switch tabs or refresh to retry.
            </CardContent>
          </Card>
        ) : !activeLegState?.data || activeLegState.data.results.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-ink-3">
              No flights found for this leg on the selected date.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map((g) => {
              const isSelected = g.fares.some((f) => f.id === activeLegState.selected?.id);
              return (
                <div
                  key={g.signature}
                  className={cn(
                    'rounded-xl transition-all',
                    isSelected && 'ring-2 ring-brand-500 ring-offset-2',
                  )}
                >
                  <ResultCard
                    fares={g.fares}
                    isCheapest={false}
                    isFastest={false}
                    isBest={false}
                    onBook={(r) => {
                      setLegs((prev) => {
                        const next = [...prev];
                        if (next[activeLeg]) {
                          next[activeLeg] = { ...next[activeLeg]!, selected: r };
                        }
                        return next;
                      });
                      // Auto-advance to the next un-picked leg so the
                      // agent flows naturally through all legs.
                      const nextUnpicked = legs.findIndex(
                        (l, i) => i !== activeLeg && !l.selected,
                      );
                      if (nextUnpicked >= 0) setActiveLeg(nextUnpicked);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky selection bar */}
      {legs.some((l) => l.selected) ? (
        <div className="sticky bottom-0 z-30 -mx-4 mt-4 border-t border-stroke-1 bg-surface-1/95 px-4 py-3 shadow-lg backdrop-blur-md md:-mx-6 md:px-6">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3">
            {legs.map((leg, i) => (
              <SelectedLegChip
                key={i}
                index={i}
                segment={leg.segment}
                selected={leg.selected}
                onClear={() =>
                  setLegs((prev) => {
                    const next = [...prev];
                    if (next[i]) next[i] = { ...next[i]!, selected: null };
                    return next;
                  })
                }
                onFocus={() => setActiveLeg(i)}
              />
            ))}
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  Total multi-city
                </p>
                <p className="font-mono text-[18px] font-extrabold tabular-nums text-ink-1">
                  {formatPaiseAsINR(totalPaise)}
                </p>
              </div>
              <Button
                size="lg"
                disabled={!allLegsSelected}
                onClick={() => {
                  if (!allLegsSelected) {
                    toast.error('Pick a fare on every leg before booking');
                    return;
                  }
                  const built = legs.map((l) => ({
                    searchId: l.data!.searchId,
                    result: l.selected!,
                  }));
                  onBookMultiCity(built);
                }}
              >
                Book all legs <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {!allLegsSelected ? (
            <p className="mx-auto mt-2 max-w-[1440px] text-[11px] text-ink-3">
              {legs.filter((l) => !l.selected).length} leg
              {legs.filter((l) => !l.selected).length === 1 ? '' : 's'} still need a fare picked.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ────────── Per-leg mutation hook (one per leg slot) ──────────
//
// Each useApiMutation needs to be called the same number of times on
// every render. This factory returns a mutation bound to the correct
// leg index — the setter updates the leg's data / loading / errored
// flags in place.

function useLegMutation(
  legIndex: number,
  setLegs: React.Dispatch<React.SetStateAction<LegState[]>>,
) {
  return useApiMutation<SearchRequest, SearchResponse>('/api/v1/search/flights', 'POST', {
    onSuccess: (data) => {
      setLegs((prev) => {
        const next = [...prev];
        if (next[legIndex]) {
          next[legIndex] = { ...next[legIndex]!, data, loading: false, errored: false };
        }
        return next;
      });
    },
    onError: (err) => {
      toast.error(`Leg ${legIndex + 1}: ${err.message}`);
      setLegs((prev) => {
        const next = [...prev];
        if (next[legIndex]) {
          next[legIndex] = { ...next[legIndex]!, loading: false, errored: true };
        }
        return next;
      });
    },
  });
}

// ────────── Sticky-bar selection chip ──────────

function SelectedLegChip({
  index,
  segment,
  selected,
  onClear,
  onFocus,
}: {
  index: number;
  segment: SearchSegment;
  selected: FlightResult | null;
  onClear: () => void;
  onFocus: () => void;
}) {
  if (!selected) {
    return (
      <button
        type="button"
        onClick={onFocus}
        className="flex items-center gap-2 rounded-lg border border-dashed border-stroke-1 bg-surface-2/40 px-3 py-2 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2 text-[10px] font-bold text-ink-4">
          {index + 1}
        </span>
        <div className="text-left">
          <p className="font-mono text-[11px] font-bold text-ink-2">
            {segment.origin} → {segment.destination}
          </p>
          <p className="text-[10px] text-ink-3">Tap to pick</p>
        </div>
      </button>
    );
  }
  const seg0 = selected.segments[0]!;
  const segLast = selected.segments[selected.segments.length - 1]!;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <span className="grid h-6 w-6 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
          Leg {index + 1} · {seg0.airline.code} {seg0.flightNumber}
        </p>
        <p className="truncate font-mono text-[12px] font-semibold text-ink-1">
          {seg0.origin.code} {formatTimeHM(seg0.departure)} → {segLast.destination.code}{' '}
          {formatTimeHM(segLast.arrival)}
          <span className="ml-1.5 text-ink-3">· {formatPaiseAsINR(selected.totalGrossPaise)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear leg ${index + 1}`}
        className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-emerald-100 hover:text-rose-600 dark:hover:bg-emerald-500/20"
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}

// ────────── Helpers ──────────

function legResultCount(leg: LegState): number | string {
  if (leg.loading) return '…';
  if (leg.errored) return '!';
  return leg.data?.results.length ?? 0;
}

function useFilteredGroups(
  data: SearchResponse | null,
  filters: FlightFilters,
  sort: SortKey,
): ReturnType<typeof groupFlightsBySignature> {
  return useMemo(() => {
    const results = data?.results ?? [];
    if (results.length === 0) return [];
    const filtered = applyFlightFilters(results, filters);
    const sorted = [...filtered];
    switch (sort) {
      case 'price':
        sorted.sort((a, b) => a.totalGrossPaise - b.totalGrossPaise);
        break;
      case 'price_desc':
        sorted.sort((a, b) => b.totalGrossPaise - a.totalGrossPaise);
        break;
      case 'duration':
        sorted.sort((a, b) => a.totalDuration - b.totalDuration);
        break;
      case 'departure_asc':
        sorted.sort(
          (a, b) =>
            new Date(a.segments[0]?.departure ?? 0).getTime() -
            new Date(b.segments[0]?.departure ?? 0).getTime(),
        );
        break;
      case 'departure_desc':
        sorted.sort(
          (a, b) =>
            new Date(b.segments[0]?.departure ?? 0).getTime() -
            new Date(a.segments[0]?.departure ?? 0).getTime(),
        );
        break;
      case 'arrival_asc':
        sorted.sort(
          (a, b) =>
            new Date(a.segments[a.segments.length - 1]?.arrival ?? 0).getTime() -
            new Date(b.segments[b.segments.length - 1]?.arrival ?? 0).getTime(),
        );
        break;
      case 'arrival_desc':
        sorted.sort(
          (a, b) =>
            new Date(b.segments[b.segments.length - 1]?.arrival ?? 0).getTime() -
            new Date(a.segments[a.segments.length - 1]?.arrival ?? 0).getTime(),
        );
        break;
      default:
        break;
    }
    return groupFlightsBySignature(sorted);
  }, [data, filters, sort]);
}

function formatLegDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTimeHM(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

