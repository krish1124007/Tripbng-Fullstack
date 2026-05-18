'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  Hotel,
} from 'lucide-react';
import { toast } from 'sonner';
import type { HotelOption, HotelSearchResponse } from '@tripbng/shared';
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
import { FilterChip } from '@/components/hotels/filter-chip';
import { HotelCard } from '@/components/hotels/hotel-card';
import { HotelSearchAnimation } from '@/components/hotels/hotel-search-animation';
import {
  HotelSearchForm,
  type HotelSearchFormValues,
} from '@/components/hotels/hotel-search-form';
import {
  formatDateShort,
  nightsBetween,
  type SortKey,
  type StarFilter,
} from '@/components/hotels/utils';
import { adaptResponseToCache, writeHotelSearchCache } from '@/lib/hotel-cache';
import { useApiMutation } from '@/lib/api-client';
import { apiFetch, ApiCallError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useCart } from '@/lib/cart';

type HotelSearchBody = {
  destination: { type: 'city'; cityId: string };
  checkIn: string;
  checkOut: string;
  rooms: { adults: number; children: number; childrenAges: number[] }[];
  guestNationality: string;
};

type CityAutocompleteItem = { cityId: string; name: string };

function buildRoomsArray(
  rooms: number,
  guests: number,
): HotelSearchBody['rooms'] {
  const list: HotelSearchBody['rooms'] = [];
  const base = Math.floor(guests / rooms);
  const extra = guests % rooms;
  for (let i = 0; i < rooms; i++) {
    list.push({
      adults: Math.max(1, base + (i < extra ? 1 : 0)),
      children: 0,
      childrenAges: [],
    });
  }
  return list;
}

/**
 * /hotels/search — dedicated results page. URL-driven (destination / dates /
 * rooms / guests / nationality), shareable via URL, results live in sessionStorage
 * so the detail page can read a hotel by id without re-searching.
 */
export default function HotelsSearchPage() {
  return (
    <Suspense fallback={<HotelSearchAnimation />}>
      <HotelsSearchInner />
    </Suspense>
  );
}

function HotelsSearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const addToCart = useCart((s) => s.addItem);
  const [results, setResults] = useState<HotelOption[] | null>(null);
  const [showForm, setShowForm] = useState(false);

  const destination = params.get('destination')?.trim() ?? '';
  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';
  const rooms = Math.max(1, parseInt(params.get('rooms') ?? '1', 10));
  const guests = Math.max(1, parseInt(params.get('guests') ?? '2', 10));
  const nationality = params.get('nationality') ?? 'IN';

  const [refundableOnly, setRefundableOnly] = useState(false);
  const [starFilter, setStarFilter] = useState<StarFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('price');

  const accessToken = useAuthStore((s) => s.accessToken);

  const search = useApiMutation<HotelSearchBody, HotelSearchResponse>(
    '/api/v1/hotels/search',
    'POST',
    {
      onSuccess: (data) => {
        setResults(data.results);
        writeHotelSearchCache(
          adaptResponseToCache(data, {
            destination,
            checkIn,
            checkOut,
            rooms,
            guests,
            nationality,
          }),
        );
      },
      onError: (err) =>
        toast.error(err instanceof ApiCallError ? err.message : 'Hotel search failed'),
    },
  );

  // Auto-fire search when URL signature changes. Resolves the free-text
  // destination to a TBO cityId via the autocomplete endpoint, then submits
  // the canonical HotelAvailRequest shape.
  const lastSig = useRef<string>('');
  useEffect(() => {
    if (!destination || !checkIn || !checkOut) return;
    const sig = `${destination}|${checkIn}|${checkOut}|${rooms}|${guests}|${nationality}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;

    void (async () => {
      try {
        const items = await apiFetch<CityAutocompleteItem[]>(
          `/api/v1/hotels/cities/autocomplete?q=${encodeURIComponent(destination)}&limit=1`,
          { accessToken },
        );
        const first = items[0];
        if (!first) {
          toast.error(`No city matched "${destination}"`);
          return;
        }
        search.mutate({
          destination: { type: 'city', cityId: first.cityId },
          checkIn,
          checkOut,
          rooms: buildRoomsArray(rooms, guests),
          guestNationality: nationality,
        });
      } catch (err) {
        toast.error(err instanceof ApiCallError ? err.message : 'City lookup failed');
      }
    })();
  }, [destination, checkIn, checkOut, rooms, guests, nationality, accessToken, search]);

  const filtered = useMemo(() => {
    if (!results) return [];
    let list = [...results];
    if (refundableOnly) list = list.filter((h) => h.refundable);
    if (starFilter !== 'all') list = list.filter((h) => h.stars === parseInt(starFilter, 10));
    if (sortBy === 'price') list.sort((a, b) => a.perNightPaise - b.perNightPaise);
    if (sortBy === 'rating') list.sort((a, b) => b.reviewScore - a.reviewScore);
    if (sortBy === 'review') list.sort((a, b) => b.reviewCount - a.reviewCount);
    return list;
  }, [results, refundableOnly, starFilter, sortBy]);

  const onView = (h: HotelOption) => router.push(`/hotels/${h.id}`);

  const onBook = (h: HotelOption) => {
    addToCart({
      id: `hotel:${h.id}`,
      kind: 'hotel',
      title: h.name,
      subtitle: `${h.area}, ${h.city} · ${h.roomType} · ${h.inclusion}`,
      datePrimary: checkIn,
      dateSecondary: checkOut,
      priceRupees: Math.round(h.totalPaise / 100),
      qty: rooms,
      meta: {
        stars: h.stars,
        refundable: h.refundable,
        reviewScore: h.reviewScore,
        nights: h.nights,
        guests,
        nationality,
      },
    });
    toast.success(`${h.name} added to your itinerary`, {
      description: 'Open the cart in the topbar to review or generate a quote.',
    });
  };

  const onModify = (values: HotelSearchFormValues) => {
    router.replace(
      `/hotels/search?destination=${encodeURIComponent(values.destination)}` +
        `&checkIn=${values.checkIn}&checkOut=${values.checkOut}` +
        `&rooms=${values.rooms}&guests=${values.guests}&nationality=${values.nationality}`,
    );
    setShowForm(false);
  };

  // Bounce to landing if URL is missing required params.
  if (!destination || !checkIn || !checkOut) {
    return (
      <EmptyState
        icon={Hotel}
        title="No search to show"
        description="Start a hotel search from the hotels landing page."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/hotels')}>
            Go to hotels
          </Button>
        }
      />
    );
  }

  const nights = nightsBetween(checkIn, checkOut);

  return (
    <div className="space-y-4">
      {/* Sticky summary header */}
      <div className="sticky top-0 z-20 -mx-4 border-b bg-surface-1/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/hotels')}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> Search
          </Button>

          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="truncate text-lg font-bold text-ink-1">{destination}</p>
            <p className="text-xs text-ink-3">
              {formatDateShort(checkIn)} → {formatDateShort(checkOut)} · {nights}{' '}
              {nights === 1 ? 'night' : 'nights'} · {rooms} {rooms === 1 ? 'room' : 'rooms'} · {guests}{' '}
              {guests === 1 ? 'guest' : 'guests'}
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
            <HotelSearchForm
              variant="compact"
              loading={search.isPending}
              ctaLabel="Re-search"
              initial={{ destination, checkIn, checkOut, rooms, guests, nationality }}
              onSubmit={onModify}
            />
          </div>
        ) : null}
      </div>

      {search.isPending && !results ? (
        <HotelSearchAnimation
          destination={destination}
          checkIn={checkIn}
          checkOut={checkOut}
        />
      ) : !results ? (
        <EmptyState
          icon={Hotel}
          title="Loading…"
          description="Hang on while we contact the suppliers."
        />
      ) : (
        <>
          {/* Filter chip row */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
            <Badge variant="brand" dot>
              {filtered.length} of {results.length}
            </Badge>
            <div className="mx-1 h-5 w-px bg-border" />
            <FilterChip
              active={starFilter === 'all'}
              onClick={() => setStarFilter('all')}
              label="All"
            />
            <FilterChip
              active={starFilter === '3'}
              onClick={() => setStarFilter('3')}
              label="3★"
            />
            <FilterChip
              active={starFilter === '4'}
              onClick={() => setStarFilter('4')}
              label="4★"
            />
            <FilterChip
              active={starFilter === '5'}
              onClick={() => setStarFilter('5')}
              label="5★"
            />
            <div className="mx-1 h-5 w-px bg-border" />
            <FilterChip
              active={refundableOnly}
              onClick={() => setRefundableOnly(!refundableOnly)}
              label="Refundable"
            />
            <div className="ml-auto">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="h-8 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="price">Sort: price</SelectItem>
                  <SelectItem value="rating">Sort: review score</SelectItem>
                  <SelectItem value="review">Sort: review count</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Hotel}
              title="No hotels match your filters"
              description="Loosen the filters or try a wider star range."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRefundableOnly(false);
                    setStarFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((h, i) => (
                <HotelCard
                  key={h.id}
                  h={h}
                  bestPrice={i === 0}
                  onView={() => onView(h)}
                  onBook={() => onBook(h)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
