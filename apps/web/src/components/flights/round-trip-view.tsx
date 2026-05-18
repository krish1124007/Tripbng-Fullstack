'use client';

// RoundTripView — side-by-side outbound + return search results.
//
// India domestic round-trip bookings are typically two independent
// PNRs stitched together — each leg lives as its own ticket in the
// airline's GDS / NDC system. We mirror that operationally:
//
//   1. Fire TWO parallel /api/v1/search/flights calls, each shaped as
//      a single-segment ONEWAY request:
//        • Outbound:  origin → destination  on `outboundDate`
//        • Return:    destination → origin  on `returnDate`
//   2. Render the two result sets in side-by-side columns
//   3. Track `selectedOutbound` and `selectedReturn` independently
//   4. Sticky bottom bar shows both selections + combined fare +
//      a single Book button that hands off to the booking flow
//
// We deliberately re-use the existing single-leg search service. The
// only round-trip-aware code is in this component + a small URL-shape
// adjustment in the booking-handoff handler.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SearchRequest, SearchResponse } from '@tripbng/shared';
import { Badge, Button, Card, CardContent, EmptyState, Skeleton } from '@/components/ui';
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

interface RoundTripViewProps {
  parsed: SearchRequest;
  onBookRoundTrip: (outbound: FlightResult, ret: FlightResult, outSearchId: string, retSearchId: string) => void;
}

export function RoundTripView({ parsed, onBookRoundTrip }: RoundTripViewProps) {
  // ────────── Derive the two leg requests ──────────
  //
  // ROUNDTRIP requests come in with `segments: [outbound, return]`. We
  // reshape each leg into a ONEWAY-shape single-segment request so the
  // existing /search endpoint can handle them unchanged.

  const outboundSeg = parsed.segments[0];
  const returnSeg = parsed.segments[1];

  const outboundReq = useMemo<SearchRequest | null>(() => {
    if (!outboundSeg) return null;
    return {
      ...parsed,
      tripType: 'ONEWAY',
      segments: [outboundSeg],
    };
  }, [parsed, outboundSeg]);

  const returnReq = useMemo<SearchRequest | null>(() => {
    if (!returnSeg) return null;
    return {
      ...parsed,
      tripType: 'ONEWAY',
      segments: [returnSeg],
    };
  }, [parsed, returnSeg]);

  // ────────── Two parallel searches ──────────

  const [outboundData, setOutboundData] = useState<SearchResponse | null>(null);
  const [returnData, setReturnData] = useState<SearchResponse | null>(null);

  const outboundMut = useApiMutation<SearchRequest, SearchResponse>(
    '/api/v1/search/flights',
    'POST',
    {
      onSuccess: setOutboundData,
      onError: (err) => toast.error(`Outbound search: ${err.message}`),
    },
  );
  const returnMut = useApiMutation<SearchRequest, SearchResponse>(
    '/api/v1/search/flights',
    'POST',
    {
      onSuccess: setReturnData,
      onError: (err) => toast.error(`Return search: ${err.message}`),
    },
  );

  // Fire-once per (outbound + return) signature.
  const lastSig = useRef<string>('');
  useEffect(() => {
    if (!outboundReq || !returnReq) return;
    const sig =
      `${outboundReq.segments[0]!.origin}-${outboundReq.segments[0]!.destination}@${
        new Date(outboundReq.segments[0]!.date).toISOString().slice(0, 10)
      }|${returnReq.segments[0]!.origin}-${returnReq.segments[0]!.destination}@${
        new Date(returnReq.segments[0]!.date).toISOString().slice(0, 10)
      }|${parsed.travelClass}|${parsed.pax.adults}|${parsed.pax.children}|${parsed.pax.infants}`;
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    outboundMut.mutate(outboundReq);
    returnMut.mutate(returnReq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outboundReq, returnReq]);

  // ────────── Selection + filter/sort per leg ──────────

  const [selectedOutbound, setSelectedOutbound] = useState<FlightResult | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<FlightResult | null>(null);

  const [outboundSort, setOutboundSort] = useState<SortKey>('price');
  const [returnSort, setReturnSort] = useState<SortKey>('price');

  // Reuse the global FlightFilters but keep them per-leg in case the
  // agent wants tighter limits for one leg.
  const [outboundFilters] = useState<FlightFilters>({ ...emptyFilters });
  const [returnFilters] = useState<FlightFilters>({ ...emptyFilters });

  const outboundGroups = useFilteredGroups(outboundData, outboundFilters, outboundSort);
  const returnGroups = useFilteredGroups(returnData, returnFilters, returnSort);

  // ────────── Render ──────────

  if (!outboundSeg || !returnSeg) {
    return (
      <EmptyState
        icon={Plane}
        title="Missing return leg"
        description="Add a return date to see round-trip results."
      />
    );
  }

  const outboundLoading = outboundMut.isPending && !outboundData;
  const returnLoading = returnMut.isPending && !returnData;

  const totalPaise =
    (selectedOutbound?.totalGrossPaise ?? 0) + (selectedReturn?.totalGrossPaise ?? 0);

  return (
    <>
      {/* Two-column results — single grid on lg+, stacked on mobile. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LegColumn
          icon={PlaneTakeoff}
          label="Outbound"
          route={`${outboundSeg.origin} → ${outboundSeg.destination}`}
          dateLabel={formatLegDate(outboundSeg.date)}
          loading={outboundLoading}
          totalCount={outboundData?.results.length ?? 0}
          groups={outboundGroups}
          selected={selectedOutbound}
          onSelect={setSelectedOutbound}
          sort={outboundSort}
          onSortChange={setOutboundSort}
        />
        <LegColumn
          icon={PlaneLanding}
          label="Return"
          route={`${returnSeg.origin} → ${returnSeg.destination}`}
          dateLabel={formatLegDate(returnSeg.date)}
          loading={returnLoading}
          totalCount={returnData?.results.length ?? 0}
          groups={returnGroups}
          selected={selectedReturn}
          onSelect={setSelectedReturn}
          sort={returnSort}
          onSortChange={setReturnSort}
        />
      </div>

      {/* Sticky bottom bar — shows selections + combined total + Book.
          Hidden until at least one leg is selected so the agent's view
          isn't cluttered while scanning options. */}
      {selectedOutbound || selectedReturn ? (
        <div className="sticky bottom-0 z-30 -mx-4 mt-4 border-t border-stroke-1 bg-surface-1/95 px-4 py-3 shadow-lg backdrop-blur-md md:-mx-6 md:px-6">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3">
            <SelectedLegChip
              icon={PlaneTakeoff}
              label="Outbound"
              selected={selectedOutbound}
              onClear={() => setSelectedOutbound(null)}
            />
            <SelectedLegChip
              icon={PlaneLanding}
              label="Return"
              selected={selectedReturn}
              onClear={() => setSelectedReturn(null)}
            />
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  Total round-trip
                </p>
                <p className="font-mono text-[18px] font-extrabold tabular-nums text-ink-1">
                  {formatPaiseAsINR(totalPaise)}
                </p>
              </div>
              <Button
                size="lg"
                disabled={!selectedOutbound || !selectedReturn}
                onClick={() => {
                  if (!selectedOutbound || !selectedReturn) return;
                  if (!outboundData || !returnData) return;
                  onBookRoundTrip(
                    selectedOutbound,
                    selectedReturn,
                    outboundData.searchId,
                    returnData.searchId,
                  );
                }}
              >
                Book round-trip <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {!selectedOutbound || !selectedReturn ? (
            <p className="mx-auto mt-2 max-w-[1440px] text-[11px] text-ink-3">
              {!selectedOutbound && !selectedReturn
                ? 'Pick one outbound and one return fare to enable booking.'
                : !selectedOutbound
                  ? 'Pick an outbound fare to enable booking.'
                  : 'Pick a return fare to enable booking.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ────────── One leg column ──────────

interface LegColumnProps {
  icon: typeof PlaneTakeoff;
  label: string;
  route: string;
  dateLabel: string;
  loading: boolean;
  totalCount: number;
  groups: ReturnType<typeof groupFlightsBySignature>;
  selected: FlightResult | null;
  onSelect: (r: FlightResult) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}

function LegColumn({
  icon: Icon,
  label,
  route,
  dateLabel,
  loading,
  totalCount,
  groups,
  selected,
  onSelect,
  sort,
  onSortChange,
}: LegColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke-1 bg-gradient-to-r from-brand-50/60 to-surface-1 px-4 py-3 dark:from-brand-500/10">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
              {label}
            </p>
            <p className="font-mono text-[14px] font-bold text-ink-1">
              {route}
              <span className="ml-2 text-[12px] font-normal text-ink-3">{dateLabel}</span>
            </p>
          </div>
        </div>
        {loading ? (
          <Badge variant="brand" className="text-[10px]">
            Searching…
          </Badge>
        ) : (
          <Badge variant="neutral" className="text-[10px]">
            {totalCount} fares
          </Badge>
        )}
      </div>

      {/* Sort tabs */}
      {!loading && totalCount > 0 ? <SortTabs sort={sort} onChange={onSortChange} /> : null}

      {/* Results list */}
      {loading ? (
        <FlightSearchAnimation
          originCode={route.split(' → ')[0]?.trim() ?? ''}
          destinationCode={route.split(' → ')[1]?.trim() ?? ''}
          suppliers={['ETrav', 'TBO', 'Kafila']}
        />
      ) : totalCount === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-ink-3">
            No flights found on this date. Try a different date or loosen filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isSelected = g.fares.some((f) => f.id === selected?.id);
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
                  onBook={onSelect}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────── Sticky-bar selection chip ──────────

function SelectedLegChip({
  icon: Icon,
  label,
  selected,
  onClear,
}: {
  icon: typeof PlaneTakeoff;
  label: string;
  selected: FlightResult | null;
  onClear: () => void;
}) {
  if (!selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-stroke-1 bg-surface-2/40 px-3 py-2">
        <span className="grid h-6 w-6 place-items-center rounded-md text-ink-4">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-ink-4">{label}</p>
          <p className="text-[11px] text-ink-3">Not selected</p>
        </div>
      </div>
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
          {label} · {seg0.airline.code} {seg0.flightNumber}
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
        aria-label={`Clear ${label} selection`}
        className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-emerald-100 hover:text-rose-600 dark:hover:bg-emerald-500/20"
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  );
}

// ────────── Helpers ──────────

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

// Re-export Skeleton so the parent page can use it (avoids extra import).
export { Skeleton };
