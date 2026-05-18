'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronDown, TreePalm } from 'lucide-react';
import { toast } from 'sonner';
import type { HolidayPackage, HolidaySearchResponse } from '@tripbng/shared';
import {
  Badge,
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { FilterChip } from '@/components/holidays/filter-chip';
import { HolidaySearchAnimation } from '@/components/holidays/holiday-search-animation';
import {
  HolidaySearchForm,
  type HolidaySearchFormValues,
} from '@/components/holidays/holiday-search-form';
import { PackageCard } from '@/components/holidays/package-card';
import {
  BUDGET_LABELS,
  THEMES,
  type Budget,
  type SortKey,
} from '@/components/holidays/utils';
import { adaptResponseToCache, writeHolidaySearchCache } from '@/lib/holiday-cache';
import { useApiMutation } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { useCart } from '@/lib/cart';

/**
 * /holidays/search — URL-driven holiday-package results page. Reads the search
 * query from the URL, fires the API on mount, surfaces a "Modify" form, and
 * writes results to sessionStorage so the detail page can read by id.
 */
export default function HolidaysSearchPage() {
  return (
    <Suspense fallback={<HolidaySearchAnimation />}>
      <HolidaysSearchInner />
    </Suspense>
  );
}

function HolidaysSearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const addToCart = useCart((s) => s.addItem);
  const [results, setResults] = useState<HolidayPackage[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const destination = params.get('destination')?.trim() ?? '';
  const duration = params.get('duration') ?? '5';
  const travellers = params.get('travellers') ?? '2';
  const budget = (params.get('budget') ?? 'mid') as Budget;
  const theme = params.get('theme') ?? 'cultural';
  const departure = params.get('departure') ?? '';

  const [flightOnly, setFlightOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('recommended');

  const search = useApiMutation<
    {
      destination: string;
      duration: string;
      budget: string;
      theme: string;
      travellers: number;
      departure?: string;
    },
    HolidaySearchResponse
  >('/api/v1/holidays/search', 'POST', {
    onSuccess: (data) => {
      setResults(data.results);
      writeHolidaySearchCache(
        adaptResponseToCache(data, {
          destination,
          duration,
          travellers,
          budget,
          theme,
          departure,
        }),
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiCallError ? err.message : 'Holiday search failed'),
  });

  // Auto-fire search on URL change.
  const lastSig = useRef<string>('');
  useEffect(() => {
    if (!destination) return;
    const sig = `${destination}|${duration}|${travellers}|${budget}|${theme}|${departure}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    search.mutate({
      destination,
      duration,
      budget,
      theme,
      travellers: parseInt(travellers, 10) || 2,
      departure: departure || undefined,
    });
  }, [destination, duration, travellers, budget, theme, departure, search]);

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = [...results];
    if (flightOnly) list = list.filter((p) => p.flightIncluded);
    if (sortBy === 'price') list.sort((a, b) => a.perPaxRupees - b.perPaxRupees);
    else if (sortBy === 'nights') list.sort((a, b) => a.nights - b.nights);
    else if (sortBy === 'recommended')
      list.sort((a, b) => Number(b.bestSeller) - Number(a.bestSeller));
    return list;
  }, [results, flightOnly, sortBy]);

  const totalPax = parseInt(travellers, 10) || 1;

  const onView = (p: HolidayPackage) => router.push(`/holidays/${p.id}`);

  const onBook = (p: HolidayPackage) => {
    addToCart({
      id: `holiday:${p.id}`,
      kind: 'holiday',
      title: p.title,
      subtitle: `${p.nights} nights · ${p.cities.join(' · ')} · ${p.inclusions[0] ?? ''}${p.flightIncluded ? ' · Flights included' : ''}`,
      datePrimary: departure,
      priceRupees: p.perPaxRupees * totalPax,
      qty: totalPax,
      meta: {
        nights: p.nights,
        inclusions: p.inclusions,
        flightIncluded: p.flightIncluded,
        themeLabel: p.themeLabel,
      },
    });
    toast.success(`${p.title} added to your itinerary`, {
      description: 'Open the cart in the topbar to review or generate a quote.',
    });
  };

  const onModify = (v: HolidaySearchFormValues) => {
    router.replace(
      `/holidays/search?destination=${encodeURIComponent(v.destination)}` +
        `&duration=${v.duration}&travellers=${v.travellers}&budget=${v.budget}` +
        `&theme=${v.theme}&departure=${v.departure}`,
    );
    setShowForm(false);
  };

  if (!destination) {
    return (
      <EmptyState
        icon={TreePalm}
        title="No search to show"
        description="Start a holiday search from the holidays landing page."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/holidays')}>
            Go to holidays
          </Button>
        }
      />
    );
  }

  const themeLabel = THEMES.find((t) => t.value === theme)?.label ?? theme;

  return (
    <div className="space-y-4">
      {/* Sticky summary header */}
      <div className="sticky top-0 z-20 -mx-4 border-b bg-surface-1/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/holidays')}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> Search
          </Button>

          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="truncate text-lg font-bold text-ink-1">{destination}</p>
            <p className="text-xs text-ink-3">
              {duration} nights · {totalPax} {totalPax === 1 ? 'traveller' : 'travellers'} ·{' '}
              {BUDGET_LABELS[budget]} · {themeLabel}
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
            <HolidaySearchForm
              variant="compact"
              loading={search.isPending}
              ctaLabel="Re-search"
              initial={{
                destination,
                duration,
                travellers,
                budget,
                theme,
                departure,
              }}
              onSubmit={onModify}
            />
          </div>
        ) : null}
      </div>

      {search.isPending && !results ? (
        <HolidaySearchAnimation destination={destination} nights={duration} />
      ) : !results ? (
        <EmptyState
          icon={TreePalm}
          title="Loading…"
          description="Hang on while we contact our DMC partners."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
            <Badge variant="brand" dot>
              {filtered.length} of {results.length}
            </Badge>
            <div className="mx-1 h-5 w-px bg-border" />
            <FilterChip
              active={flightOnly}
              onClick={() => setFlightOnly(!flightOnly)}
              label="Flights included"
            />
            <div className="ml-auto">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="h-8 w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recommended">Sort: recommended</SelectItem>
                  <SelectItem value="price">Sort: price</SelectItem>
                  <SelectItem value="nights">Sort: nights</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={TreePalm}
              title="No packages match your filters"
              description="Try a different theme or budget tier."
              action={
                <Button variant="secondary" size="sm" onClick={() => setFlightOnly(false)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => (
                <PackageCard
                  key={p.id}
                  p={p}
                  travellers={totalPax}
                  onView={() => onView(p)}
                  onBook={() => onBook(p)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
