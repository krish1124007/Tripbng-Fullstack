'use client';

// /bus/search — results page. Reads source/destination/doj from the
// URL, fires GET /api/v1/bus/search, renders the trip list with a
// compact filter row.

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Bus } from 'lucide-react';
import { toast } from 'sonner';
import type { BusTrip, BusTripsSearchResponse } from '@tripbng/shared';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui';
import { BusSearchForm } from '@/components/bus/bus-search-form';
import { BusTripCard } from '@/components/bus/bus-trip-card';
import { useApiQuery } from '@/lib/api-client';

export default function BusSearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <BusSearchView />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-1/3" />
      <Skeleton className="h-24" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

function BusSearchView() {
  const router = useRouter();
  const params = useSearchParams();

  const source = Number.parseInt(params.get('source') ?? '0', 10);
  const sourceName = params.get('sourceName') ?? '';
  const destination = Number.parseInt(params.get('destination') ?? '0', 10);
  const destinationName = params.get('destinationName') ?? '';
  const doj = params.get('doj') ?? '';

  // Auto-resolve from query string if any field missing — bounce back
  // to the landing page so the user picks again.
  const incomplete =
    !Number.isFinite(source) || source <= 0 ||
    !Number.isFinite(destination) || destination <= 0 ||
    !doj;

  const search = useApiQuery<BusTripsSearchResponse>(
    ['bus-search', source, destination, doj],
    '/api/v1/bus/search',
    {
      query: { source, destination, doj },
      enabled: !incomplete,
    },
  );
  // Surface fetch failures via toast — useApiQuery's wrapper options
  // omit onError, so we observe the query state directly.
  useEffect(() => {
    if (search.isError) toast.error(search.error?.message ?? 'Search failed');
  }, [search.isError, search.error]);

  // ── Filters / sort ──
  const [sortBy, setSortBy] = useState<'departure' | 'price-asc' | 'price-desc' | 'duration'>(
    'departure',
  );
  const [acOnly, setAcOnly] = useState(false);
  const [sleeperOnly, setSleeperOnly] = useState(false);

  const filteredSorted = useMemo(() => {
    const trips = search.data?.trips ?? [];
    const filtered = trips.filter((t) => {
      if (acOnly && t.isAc !== true) return false;
      if (sleeperOnly && t.isSleeper !== true) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'price-asc':
          return a.fareMinINR - b.fareMinINR;
        case 'price-desc':
          return b.fareMinINR - a.fareMinINR;
        case 'duration': {
          const da = new Date(a.arrivalAt).getTime() - new Date(a.departureAt).getTime();
          const db = new Date(b.arrivalAt).getTime() - new Date(b.departureAt).getTime();
          return da - db;
        }
        case 'departure':
        default:
          return a.departureAt.localeCompare(b.departureAt);
      }
    });
    return sorted;
  }, [search.data, sortBy, acOnly, sleeperOnly]);

  const onPick = (trip: BusTrip) => {
    const qs = new URLSearchParams({
      doj,
      operatorName: trip.operatorName,
      busType: trip.busType,
      isAc: String(trip.isAc ?? false),
      isSleeper: String(trip.isSleeper ?? false),
      operatorId: String(trip.operatorId),
      source: String(source),
      sourceName: trip.source.name ?? sourceName,
      destination: String(destination),
      destinationName: trip.destination.name ?? destinationName,
      inventoryId: trip.inventoryId,
      departureAt: trip.departureAt,
      arrivalAt: trip.arrivalAt,
    });
    router.push(`/bus/trips/${encodeURIComponent(trip.tripId)}?${qs.toString()}`);
  };

  if (incomplete) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Bus className="mx-auto h-8 w-8 text-warning" />
          <p className="mt-3 text-sm text-ink-2">
            Missing search context — go back and pick cities + a journey date.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => router.push('/bus')}
          >
            <ArrowLeft className="h-4 w-4" /> Back to search
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Booking · Buses"
        title={`${sourceName || 'From'} → ${destinationName || 'To'}`}
        description={`${formatDoj(doj)} · ${search.data?.trips.length ?? 0} options`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.push('/bus')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      {/* Compact re-search bar — keeps the agent in the flow when
          they want to tweak cities/date without going back. */}
      <BusSearchForm
        variant="compact"
        initial={{
          source: { id: source, name: sourceName },
          destination: { id: destination, name: destinationName },
          doj,
        }}
        loading={search.isPending}
        onSubmit={(v) => {
          const qs = new URLSearchParams({
            source: String(v.source.id),
            sourceName: v.source.name,
            destination: String(v.destination.id),
            destinationName: v.destination.name,
            doj: v.doj,
          });
          router.push(`/bus/search?${qs.toString()}`);
        }}
      />

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-surface-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Sort</span>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="departure">Departure (early first)</SelectItem>
              <SelectItem value="price-asc">Price (low → high)</SelectItem>
              <SelectItem value="price-desc">Price (high → low)</SelectItem>
              <SelectItem value="duration">Duration (short first)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={acOnly}
            onChange={(e) => setAcOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          AC only
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={sleeperOnly}
            onChange={(e) => setSleeperOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Sleeper only
        </label>
        {search.data?.fromCache ? (
          <span className="ml-auto text-[10px] text-ink-4">cache · 30 min</span>
        ) : null}
      </div>

      {/* Results */}
      {search.isPending ? (
        <SearchSkeleton />
      ) : filteredSorted.length === 0 ? (
        <EmptyState
          icon={Bus}
          title="No buses found"
          description={
            search.data?.trips.length === 0
              ? 'No operators run on this route + date. Try a different day.'
              : 'No trips match your filters. Try clearing AC / Sleeper.'
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {filteredSorted.map((t) => (
            <li key={t.tripId}>
              <BusTripCard trip={t} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDoj(doj: string): string {
  const d = new Date(`${doj}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return doj;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    weekday: 'short',
  });
}
