'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  Filter as FilterIcon,
  Plane,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Airport, SearchRequest, SearchResponse } from '@tripbng/shared';
import { Badge, Button, EmptyState } from '@/components/ui';
import { FlightSearchAnimation } from '@/components/flight-search-animation';
import { BestOfTile } from '@/components/flights/best-of-tile';
import { DateStrip } from '@/components/flights/date-strip';
import { FlightFiltersSidebar } from '@/components/flights/filters-sidebar';
import { FlightSearchForm } from '@/components/flights/flight-search-form';
import { ResultCard } from '@/components/flights/result-card';
import { MultiCityView } from '@/components/flights/multi-city-view';
import { RoundTripView } from '@/components/flights/round-trip-view';
import { SortTabs } from '@/components/flights/sort-tabs';
import {
  TIME_BUCKETS,
  activeFilterCount,
  applyFlightFilters,
  buildSearchUrl,
  emptyFilters,
  formatDateLong,
  formatDuration,
  groupFlightsBySignature,
  parseSearchUrl,
  type FlightFilters,
  type FlightResult,
  type SortKey,
} from '@/components/flights/utils';
import { formatPaiseAsINR } from '@/lib/money';
import { useApiMutation } from '@/lib/api-client';
import { ApiCallError, apiFetch } from '@/lib/api';
import { startChain } from '@/lib/multi-leg-chain';

/**
 * /flights/search — dedicated results page. Reads search params from the URL,
 * fires the API call on mount and on every URL change, surfaces filters/sort
 * over the result set, and lets the user re-search via a sticky compact form
 * at the top.
 *
 * Wrapped in Suspense per Next 14's `useSearchParams()` requirement.
 */
export default function FlightsSearchPage() {
  return (
    <Suspense fallback={<FlightSearchAnimation />}>
      <FlightsSearchInner />
    </Suspense>
  );
}

function FlightsSearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [showForm, setShowForm] = useState(false);

  // ────────── URL → SearchRequest ──────────

  const parsed = useMemo(() => parseSearchUrl(params), [params]);

  // Convenience for the sticky header summary.
  const tripType = parsed?.tripType ?? 'ONEWAY';
  const travelClass = parsed?.travelClass ?? ('ECONOMY' as SearchRequest['travelClass']);
  const adults = parsed?.pax.adults ?? 1;
  const children = parsed?.pax.children ?? 0;
  const infants = parsed?.pax.infants ?? 0;
  const firstSeg = parsed?.segments[0];
  const lastSeg = parsed?.segments[parsed.segments.length - 1];

  const initialOrigin: Airport | null = firstSeg
    ? { iata: firstSeg.origin, city: firstSeg.origin, name: firstSeg.origin, country: '', countryCode: 'IN' }
    : null;
  const initialDestination: Airport | null = firstSeg
    ? {
        iata: firstSeg.destination,
        city: firstSeg.destination,
        name: firstSeg.destination,
        country: '',
        countryCode: 'IN',
      }
    : null;
  const initialDate = firstSeg ? new Date(firstSeg.date).toISOString().slice(0, 10) : '';
  const initialReturnDate =
    parsed?.tripType === 'ROUNDTRIP' && parsed.segments[1]
      ? new Date(parsed.segments[1].date).toISOString().slice(0, 10)
      : '';
  const initialMultiSegments =
    parsed?.tripType === 'MULTICITY'
      ? parsed.segments.map((s) => ({
          origin: { iata: s.origin, city: s.origin, name: s.origin, country: '', countryCode: 'IN' },
          destination: {
            iata: s.destination,
            city: s.destination,
            name: s.destination,
            country: '',
            countryCode: 'IN',
          },
          date: new Date(s.date).toISOString().slice(0, 10),
        }))
      : [];

  // ────────── Search mutation ──────────

  const search = useApiMutation<SearchRequest, SearchResponse>(
    '/api/v1/search/flights',
    'POST',
    {
      onSuccess: (data) => setResults(data),
      onError: (err) =>
        toast.error(err instanceof ApiCallError ? err.message : 'Search failed'),
    },
  );

  // Auto-fire the search whenever the URL signature changes. We use a ref-based
  // signature so an in-flight mutation isn't fired twice for the same URL on
  // re-renders.
  const lastSig = useRef<string>('');
  useEffect(() => {
    if (!parsed) return;
    const segSig = parsed.segments
      .map((s) => `${s.origin}-${s.destination}-${new Date(s.date).toISOString().slice(0, 10)}`)
      .join('|');
    const sig = `${parsed.tripType}|${segSig}|${travelClass}|${adults}|${children}|${infants}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    search.mutate(parsed);
  }, [parsed, travelClass, adults, children, infants, search]);

  // ────────── DateStrip prefetch ──────────
  //
  // We populate the carousel chips with real cheapest-fare numbers for
  // ±7 days around the current search date. Each adjacent date triggers
  // its own /search call — concurrency is capped at 3 so we don't
  // hammer the supplier fanout, and each date's response is cached for
  // the session so flipping back and forth is instant.

  const [faresByDate, setFaresByDate] = useState<Record<string, number>>({});
  const inflightDates = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!parsed || tripType !== 'ONEWAY') return;
    const baseDate = new Date(parsed.segments[0]!.date);
    // Window: ±7 days around the search date.
    const dates: string[] = [];
    for (let i = -7; i <= 7; i++) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + i);
      const ymd = d.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (ymd < today) continue; // skip past dates
      dates.push(ymd);
    }

    const origin = parsed.segments[0]!.origin;
    const destination = parsed.segments[0]!.destination;

    // Only fetch dates we don't already have AND aren't already in
    // flight. The cache key includes pax + class so changing those
    // wipes the cache implicitly via the effect re-running.
    const cacheKey = (ymd: string) =>
      `${origin}-${destination}-${ymd}-${travelClass}-${adults}-${children}-${infants}`;

    const toFetch = dates.filter((d) => {
      const key = cacheKey(d);
      return !(key in faresByDate) && !inflightDates.current.has(key);
    });

    if (toFetch.length === 0) return;

    let cancelled = false;
    const CONCURRENCY = 3;
    let cursor = 0;

    async function worker() {
      while (cursor < toFetch.length) {
        const idx = cursor++;
        const ymd = toFetch[idx]!;
        const key = cacheKey(ymd);
        inflightDates.current.add(key);
        try {
          const res = await apiFetch<SearchResponse>('/api/v1/search/flights', {
            method: 'POST',
            body: {
              ...parsed,
              segments: [{ origin, destination, date: ymd }],
            },
          });
          if (cancelled) return;
          if (res.results.length > 0) {
            const min = Math.min(...res.results.map((r) => r.totalGrossPaise));
            setFaresByDate((prev) => ({ ...prev, [key]: min }));
          } else {
            // Record an "empty" sentinel so we don't refetch.
            setFaresByDate((prev) => ({ ...prev, [key]: -1 }));
          }
        } catch {
          // Silent — chip falls back to "Get fare". User can still
          // click through and trigger a real search.
        } finally {
          inflightDates.current.delete(key);
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker);
    Promise.all(workers);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.segments[0]?.date, parsed?.segments[0]?.origin, parsed?.segments[0]?.destination, travelClass, adults, children, infants, tripType]);

  // Reshape faresByDate into the simple `{ymd: paise}` map DateStrip wants.
  const faresByDateForStrip = useMemo(() => {
    if (!parsed) return {};
    const origin = parsed.segments[0]?.origin;
    const destination = parsed.segments[0]?.destination;
    if (!origin || !destination) return {};
    const out: Record<string, number> = {};
    for (const [key, paise] of Object.entries(faresByDate)) {
      if (paise < 0) continue; // skip "empty" sentinels
      const parts = key.split('-');
      // key shape: "ORIG-DEST-YYYY-MM-DD-CLASS-A-C-I"
      // Origin and destination are always 3 letters each, so YMD = parts[2..4]
      if (parts[0] !== origin || parts[1] !== destination) continue;
      const ymd = `${parts[2]}-${parts[3]}-${parts[4]}`;
      out[ymd] = paise;
    }
    return out;
  }, [faresByDate, parsed]);

  // ────────── Filters + sort ──────────
  //
  // The filter state is the single object defined in utils.ts. Each
  // sidebar control mutates it; `applyFlightFilters` runs the union
  // against `allResults`; the sort step orders the survivors.

  const [filters, setFilters] = useState<FlightFilters>({ ...emptyFilters });
  const [sortBy, setSortBy] = useState<SortKey>('recommended');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const allResults = results?.results ?? [];

  const cheapest = useMemo(
    () =>
      allResults.length
        ? [...allResults].sort((a, b) => a.totalGrossPaise - b.totalGrossPaise)[0]
        : null,
    [allResults],
  );
  const fastest = useMemo(
    () =>
      allResults.length
        ? [...allResults].sort((a, b) => a.totalDuration - b.totalDuration)[0]
        : null,
    [allResults],
  );
  const best = useMemo(() => {
    if (!allResults.length) return null;
    const minP = Math.min(...allResults.map((r) => r.totalGrossPaise));
    const maxP = Math.max(...allResults.map((r) => r.totalGrossPaise));
    const minD = Math.min(...allResults.map((r) => r.totalDuration));
    const maxD = Math.max(...allResults.map((r) => r.totalDuration));
    const score = (r: FlightResult) => {
      const p = (r.totalGrossPaise - minP) / Math.max(1, maxP - minP);
      const d = (r.totalDuration - minD) / Math.max(1, maxD - minD);
      return p + d;
    };
    return [...allResults].sort((a, b) => score(a) - score(b))[0];
  }, [allResults]);

  const filtered = useMemo(() => {
    const list = applyFlightFilters(allResults, filters);
    // Sort happens on a separate switch — keeping it out of
    // applyFlightFilters keeps that helper pure + reusable.
    const sorted = [...list];
    switch (sortBy) {
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
      case 'recommended':
      default: {
        // Mirror the "best" score from above so the default order
        // surfaces a price/duration trade-off, not the cheapest only.
        if (allResults.length > 1) {
          const minP = Math.min(...allResults.map((r) => r.totalGrossPaise));
          const maxP = Math.max(...allResults.map((r) => r.totalGrossPaise));
          const minD = Math.min(...allResults.map((r) => r.totalDuration));
          const maxD = Math.max(...allResults.map((r) => r.totalDuration));
          const score = (r: FlightResult) => {
            const p = (r.totalGrossPaise - minP) / Math.max(1, maxP - minP);
            const d = (r.totalDuration - minD) / Math.max(1, maxD - minD);
            // Equal weight; tilt later if user feedback says one side
            // matters more.
            return p + d;
          };
          sorted.sort((a, b) => score(a) - score(b));
        }
      }
    }
    return sorted;
  }, [allResults, filters, sortBy]);

  // Collapse identical-flight results (same airline + flight nos + times)
  // into a single card with a fare picker. Driven off the **sorted**
  // list so the parent order is preserved.
  const groupedResults = useMemo(() => groupFlightsBySignature(filtered), [filtered]);

  const activeChips = useMemo(() => buildActiveChips(filters), [filters]);

  // ────────── Actions ──────────

  const goBook = (r: FlightResult) =>
    router.push(`/book?searchId=${results!.searchId}&fareToken=${encodeURIComponent(r.fareToken)}`);

  const onModify = (req: SearchRequest) => {
    router.replace(buildSearchUrl(req));
    setShowForm(false);
  };

  // ────────── Render ──────────

  // No URL params → bounce to landing.
  if (!parsed) {
    return (
      <EmptyState
        icon={Plane}
        title="No search to show"
        description="Start a search from the flights landing page."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/flights')}>
            Go to flights
          </Button>
        }
      />
    );
  }

  const totalPax = adults + children + infants;
  const headerRoute =
    tripType === 'MULTICITY'
      ? parsed.segments
          .map((s, i) => (i === 0 ? `${s.origin} → ${s.destination}` : `→ ${s.destination}`))
          .join(' ')
      : tripType === 'ROUNDTRIP'
        ? `${firstSeg!.origin} ⇄ ${firstSeg!.destination}`
        : `${firstSeg!.origin} → ${firstSeg!.destination}`;
  const headerDate =
    tripType === 'ROUNDTRIP' && lastSeg
      ? `${formatDateLong(firstSeg!.date)} – ${formatDateLong(lastSeg.date)}`
      : tripType === 'MULTICITY'
        ? `${parsed.segments.length} legs · ${formatDateLong(firstSeg!.date)}`
        : formatDateLong(firstSeg!.date);

  return (
    <div className="space-y-4">
      {/* ─────────── Sticky route summary header ─────────── */}
      <div className="sticky top-0 z-20 -mx-4 border-b bg-surface-1/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/flights')}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> Search
          </Button>

          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-mono text-lg font-bold text-ink-1">{headerRoute}</p>
            <p className="text-xs text-ink-3">
              {headerDate} · {travelClass.charAt(0) + travelClass.slice(1).toLowerCase().replace('_', ' ')} ·{' '}
              {totalPax} {totalPax === 1 ? 'passenger' : 'passengers'}
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm((v) => !v)}
            className="ml-auto"
          >
            {showForm ? 'Hide' : 'Modify'} search
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showForm ? 'rotate-180' : ''}`}
            />
          </Button>
        </div>

        {showForm ? (
          <div className="mt-3 animate-slide-down">
            <FlightSearchForm
              variant="compact"
              loading={search.isPending}
              ctaLabel="Re-search"
              initial={{
                tripType,
                origin: initialOrigin,
                destination: initialDestination,
                date: initialDate,
                returnDate: initialReturnDate,
                segments: initialMultiSegments,
                travelClass,
                pax: { adults, children, infants },
              }}
              onSubmit={onModify}
            />
          </div>
        ) : null}
      </div>

      {/* ─────────── Date strip ─────────── */}
      {tripType === 'ONEWAY' && firstSeg ? (
        <DateStrip
          currentDate={initialDate}
          currentDateMinPaise={cheapest?.totalGrossPaise ?? null}
          faresByDate={faresByDateForStrip}
          onDateChange={(newDate) => {
            // Rebuild the URL with the new outbound date and let the
            // existing search-on-URL-change pipeline re-run the search.
            const req: SearchRequest = {
              ...parsed,
              segments: [{ ...parsed.segments[0]!, date: new Date(newDate) }],
            };
            router.replace(buildSearchUrl(req));
          }}
        />
      ) : null}

      {/* ─────────── Results ─────────── */}
      {/* Multi-city + round-trip each render their own multi-leg view.
          Both fire one /search per leg and provide selection state.
          Booking handoff stashes the remaining legs in sessionStorage
          and navigates to /book for leg 1; subsequent legs resume
          after each ticket is issued. */}
      {tripType === 'MULTICITY' && parsed ? (
        <MultiCityView
          parsed={parsed}
          onBookMultiCity={(legs) => {
            // Start a multi-leg chain. The book page consumes it on
            // mount (pre-fills passenger / contact / GST) and on each
            // ticket success advances to the next leg automatically.
            startChain({
              kind: 'MULTICITY',
              legs: legs.map((l) => ({
                searchId: l.searchId,
                fareToken: l.result.fareToken,
                route: `${l.result.segments[0]?.origin.code} → ${l.result.segments[l.result.segments.length - 1]?.destination.code}`,
              })),
            });
            const first = legs[0]!;
            router.push(
              `/book?searchId=${first.searchId}&fareToken=${encodeURIComponent(first.result.fareToken)}`,
            );
          }}
        />
      ) : tripType === 'ROUNDTRIP' && parsed ? (
        <RoundTripView
          parsed={parsed}
          onBookRoundTrip={(outbound, ret, outSearchId, retSearchId) => {
            // Round-trip is a 2-leg chain — outbound first, return
            // resumes after the outbound tickets.
            const outRoute = `${outbound.segments[0]?.origin.code} → ${outbound.segments[outbound.segments.length - 1]?.destination.code}`;
            const retRoute = `${ret.segments[0]?.origin.code} → ${ret.segments[ret.segments.length - 1]?.destination.code}`;
            startChain({
              kind: 'ROUNDTRIP',
              legs: [
                { searchId: outSearchId, fareToken: outbound.fareToken, route: outRoute },
                { searchId: retSearchId, fareToken: ret.fareToken, route: retRoute },
              ],
            });
            router.push(
              `/book?searchId=${outSearchId}&fareToken=${encodeURIComponent(outbound.fareToken)}`,
            );
          }}
        />
      ) : search.isPending && allResults.length === 0 ? (
        <FlightSearchAnimation
          originCode={firstSeg!.origin}
          destinationCode={firstSeg!.destination}
          suppliers={['Series', 'eTrav', 'AirIQ']}
        />
      ) : !results ? (
        <EmptyState
          icon={Plane}
          title="Loading…"
          description="Hang on while we contact the suppliers."
        />
      ) : (
        <>
          {results.errors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} />
              <span className="text-ink-2">
                <span className="font-semibold">
                  {results.errors.length} supplier{results.errors.length === 1 ? '' : 's'} unavailable
                </span>{' '}
                — results below are partial.
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-1">
                {results.errors.map((e) => (
                  <Badge key={e.supplierCode} variant="warning" className="text-[9px]">
                    {e.supplierCode}: {e.code}
                  </Badge>
                ))}
              </span>
            </div>
          ) : null}

          {results.results.length > 0 ? (
            <section className="grid gap-3 sm:grid-cols-3">
              <BestOfTile
                tone="brand"
                label="Cheapest"
                icon={Sparkles}
                r={cheapest}
                metric="price"
                onClick={() => cheapest && goBook(cheapest)}
              />
              <BestOfTile
                tone="accent"
                label="Fastest"
                icon={Zap}
                r={fastest}
                metric="duration"
                onClick={() => fastest && goBook(fastest)}
              />
              <BestOfTile
                tone="default"
                label="Best value"
                icon={ShieldCheck}
                r={best}
                metric="balanced"
                onClick={() => best && goBook(best)}
              />
            </section>
          ) : null}

          {/* ────────── Two-column layout: sidebar (lg+) + main ────────── */}
          <div className="grid gap-4 lg:grid-cols-[280px_1fr] xl:grid-cols-[300px_1fr]">
            {/* Sidebar — desktop only; mobile gets a sheet drawer (below). */}
            <div className="hidden lg:block">
              <FlightFiltersSidebar
                results={allResults}
                filters={filters}
                onChange={setFilters}
                formatCurrency={(p) => formatPaiseAsINR(p, { compact: false })}
              />
            </div>

            <div className="min-w-0 space-y-3">
              {/* Top bar — result count, active chips, sort, mobile filter button */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2.5">
                <Badge variant="brand" dot>
                  <FilterIcon className="h-3 w-3" /> {filtered.length} of {results.results.length}
                </Badge>

                {/* Mobile "Filters (n)" button — opens the bottom sheet */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilterSheetOpen(true)}
                  className="lg:hidden"
                >
                  <FilterIcon className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount(filters) > 0 ? (
                    <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 font-mono text-[9px] font-bold text-white">
                      {activeFilterCount(filters)}
                    </span>
                  ) : null}
                </Button>

                <div className="ml-auto flex flex-1 items-center justify-end gap-2 md:max-w-[560px]">
                  <SortTabs sort={sortBy} onChange={setSortBy} />
                </div>
              </div>

              {/* Active filter chips — one-click clear per dimension */}
              {activeChips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setFilters(chip.clear(filters))}
                      className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
                    >
                      {chip.label}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFilters({ ...emptyFilters })}
                    className="rounded-full px-2 py-1 text-[11px] font-semibold text-ink-3 hover:text-ink-1"
                  >
                    Clear all
                  </button>
                </div>
              ) : null}

              {/* Result list */}
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Plane}
                  title="No flights match your filters"
                  description="Loosen the filters or try a different date — series fares come and go fast."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setFilters({ ...emptyFilters })}
                    >
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {groupedResults.map((g) => {
                    // Group earns a best-of ribbon if ANY fare inside
                    // is the cheapest / fastest / best overall.
                    const isCheapest = g.fares.some((f) => f.id === cheapest?.id);
                    const isFastest = g.fares.some((f) => f.id === fastest?.id);
                    const isBest = g.fares.some((f) => f.id === best?.id);
                    return (
                      <ResultCard
                        key={g.signature}
                        fares={g.fares}
                        isCheapest={isCheapest}
                        isFastest={isFastest}
                        isBest={isBest}
                        onBook={(r) => goBook(r)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Mobile filter sheet — slides up from the bottom on < lg */}
          {filterSheetOpen ? (
            <div
              className="fixed inset-0 z-50 bg-ink-1/40 backdrop-blur-sm lg:hidden"
              onClick={() => setFilterSheetOpen(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-surface-1 p-3 shadow-2xl animate-slide-down"
                // iOS notched devices: the home indicator + bottom safe area
                // eats ~34px; respect it so the close button + last filter
                // aren't hidden behind the bar.
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-2">
                  <h2 className="text-base font-bold text-ink-1">Filters</h2>
                  <button
                    type="button"
                    onClick={() => setFilterSheetOpen(false)}
                    className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
                    aria-label="Close filters"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <FlightFiltersSidebar
                  results={allResults}
                  filters={filters}
                  onChange={setFilters}
                  formatCurrency={(p) => formatPaiseAsINR(p, { compact: false })}
                />
                <div className="sticky bottom-0 mt-3 flex gap-2 border-t bg-surface-1/95 p-3 backdrop-blur">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => setFilters({ ...emptyFilters })}
                  >
                    Clear all
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => setFilterSheetOpen(false)}>
                    Show {filtered.length} flight{filtered.length === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─────────── Active-filter chip helper ───────────
//
// Turns the FlightFilters object into a list of human-readable chips
// the top bar can render. Each chip carries its own `clear()` that
// returns a filters object with just that dimension reset.

interface ActiveChip {
  id: string;
  label: string;
  clear: (f: FlightFilters) => FlightFilters;
}

function buildActiveChips(f: FlightFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];

  if (f.stops.size > 0) {
    const labels: string[] = [];
    if (f.stops.has(0)) labels.push('Non-stop');
    if (f.stops.has(1)) labels.push('1 stop');
    if (f.stops.has(2)) labels.push('2+ stops');
    chips.push({
      id: 'stops',
      label: labels.join(' · '),
      clear: (cur) => ({ ...cur, stops: new Set() }),
    });
  }

  if (f.priceRange[0] > 0 || f.priceRange[1] !== Number.POSITIVE_INFINITY) {
    const max =
      f.priceRange[1] === Number.POSITIVE_INFINITY
        ? '∞'
        : formatPaiseAsINR(f.priceRange[1], { compact: true });
    chips.push({
      id: 'price',
      label: `Up to ${max}`,
      clear: (cur) => ({ ...cur, priceRange: [0, Number.POSITIVE_INFINITY] }),
    });
  }

  if (f.maxDurationMin !== Number.POSITIVE_INFINITY) {
    chips.push({
      id: 'duration',
      label: `Under ${formatDuration(f.maxDurationMin)}`,
      clear: (cur) => ({ ...cur, maxDurationMin: Number.POSITIVE_INFINITY }),
    });
  }

  if (f.departureBuckets.size > 0) {
    const labels = Array.from(f.departureBuckets)
      .map((b) => TIME_BUCKETS[b]?.label ?? '')
      .join(' · ');
    chips.push({
      id: 'departure',
      label: `Depart: ${labels}`,
      clear: (cur) => ({ ...cur, departureBuckets: new Set() }),
    });
  }

  if (f.arrivalBuckets.size > 0) {
    const labels = Array.from(f.arrivalBuckets)
      .map((b) => TIME_BUCKETS[b]?.label ?? '')
      .join(' · ');
    chips.push({
      id: 'arrival',
      label: `Arrive: ${labels}`,
      clear: (cur) => ({ ...cur, arrivalBuckets: new Set() }),
    });
  }

  if (f.airlines.size > 0) {
    chips.push({
      id: 'airlines',
      label: `Airlines: ${Array.from(f.airlines).join(', ')}`,
      clear: (cur) => ({ ...cur, airlines: new Set() }),
    });
  }

  if (f.refundableOnly) {
    chips.push({
      id: 'refundable',
      label: 'Refundable only',
      clear: (cur) => ({ ...cur, refundableOnly: false }),
    });
  }

  if (f.sources.size > 0) {
    chips.push({
      id: 'sources',
      label: `Source: ${Array.from(f.sources).join(', ')}`,
      clear: (cur) => ({ ...cur, sources: new Set() }),
    });
  }

  if (f.suppliers.size > 0) {
    chips.push({
      id: 'suppliers',
      label: `Supplier: ${Array.from(f.suppliers).join(', ')}`,
      clear: (cur) => ({ ...cur, suppliers: new Set() }),
    });
  }

  if (f.layovers.size > 0) {
    chips.push({
      id: 'layovers',
      label: `Via ${Array.from(f.layovers).join(', ')}`,
      clear: (cur) => ({ ...cur, layovers: new Set() }),
    });
  }

  if (f.minSeats > 0) {
    chips.push({
      id: 'seats',
      label: `≥ ${f.minSeats} seats`,
      clear: (cur) => ({ ...cur, minSeats: 0 }),
    });
  }

  if (f.query.trim()) {
    chips.push({
      id: 'query',
      label: `“${f.query.trim()}”`,
      clear: (cur) => ({ ...cur, query: '' }),
    });
  }

  return chips;
}
