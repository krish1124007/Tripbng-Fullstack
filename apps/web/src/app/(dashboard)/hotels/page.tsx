'use client';

import { useRouter } from 'next/navigation';
import { Hotel, MapPin, Sparkles, Trash2, X } from 'lucide-react';
import { Badge, Card, CardContent } from '@/components/ui';
import {
  HotelSearchForm,
  type HotelSearchFormValues,
} from '@/components/hotels/hotel-search-form';
import { todayPlus } from '@/components/hotels/utils';
import { useRecentSearches } from '@/lib/recent-searches';

interface RecentHotelSearch {
  key: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
}

const FEATURED_DESTINATIONS = [
  {
    city: 'Bangkok',
    country: 'Thailand',
    from: '₹2,400',
    img: 'from-amber-200 to-rose-300 dark:from-amber-300/40 dark:to-rose-400/40',
  },
  {
    city: 'Bali',
    country: 'Indonesia',
    from: '₹3,800',
    img: 'from-emerald-200 to-cyan-300 dark:from-emerald-300/40 dark:to-cyan-400/40',
  },
  {
    city: 'Dubai',
    country: 'UAE',
    from: '₹5,200',
    img: 'from-orange-200 to-amber-400 dark:from-orange-300/40 dark:to-amber-400/40',
  },
  {
    city: 'Maldives',
    country: 'Maldives',
    from: '₹9,400',
    img: 'from-sky-200 to-blue-400 dark:from-sky-300/40 dark:to-blue-400/40',
  },
];

export default function HotelsLandingPage() {
  const router = useRouter();
  const recents = useRecentSearches<RecentHotelSearch>('hotels');

  const goSearch = (v: HotelSearchFormValues) => {
    recents.add({
      key: `${v.destination}|${v.checkIn}|${v.checkOut}|${v.rooms}|${v.guests}`,
      destination: v.destination,
      checkIn: v.checkIn,
      checkOut: v.checkOut,
      rooms: v.rooms,
      guests: v.guests,
    });
    router.push(
      `/hotels/search?destination=${encodeURIComponent(v.destination)}` +
        `&checkIn=${v.checkIn}&checkOut=${v.checkOut}` +
        `&rooms=${v.rooms}&guests=${v.guests}&nationality=${v.nationality}`,
    );
  };

  const goRecent = (r: RecentHotelSearch) => {
    router.push(
      `/hotels/search?destination=${encodeURIComponent(r.destination)}` +
        `&checkIn=${r.checkIn}&checkOut=${r.checkOut}` +
        `&rooms=${r.rooms}&guests=${r.guests}&nationality=IN`,
    );
  };

  const goFeatured = (city: string) => {
    router.push(
      `/hotels/search?destination=${encodeURIComponent(city)}` +
        `&checkIn=${todayPlus(7)}&checkOut=${todayPlus(9)}` +
        `&rooms=1&guests=2&nationality=IN`,
    );
  };

  return (
    <div className="space-y-6">
      <HotelSearchForm variant="hero" onSubmit={goSearch} />

      {/* Recent searches */}
      {recents.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-3">Recent:</span>
          {recents.items.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => goRecent(r)}
              className="group inline-flex items-center gap-1.5 rounded-full border bg-surface-1 py-1 pl-3 pr-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <MapPin className="h-3 w-3" strokeWidth={1.75} />
              <span>{r.destination}</span>
              <span className="text-ink-4">·</span>
              <span className="font-mono tabular-nums">
                {r.checkIn.slice(5)} → {r.checkOut.slice(5)}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  recents.remove(r.key);
                }}
                aria-label="Remove"
                className="ml-1 grid h-5 w-5 place-items-center rounded-full text-ink-4 hover:bg-surface-2 hover:text-ink-1"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={recents.clear}
            className="ml-auto inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink-1"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </button>
        </div>
      ) : null}

      {/* Featured destinations */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="eyebrow text-brand-600">Featured destinations</p>
            <h2 className="mt-1 text-h3 text-ink-1">Where partners are booking this week</h2>
          </div>
          <Badge variant="brand" dot>
            <Hotel className="h-3 w-3" /> Live rates
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED_DESTINATIONS.map((d) => (
            <button
              key={d.city}
              type="button"
              onClick={() => goFeatured(d.city)}
              className="group relative overflow-hidden rounded-xl border text-left transition-all duration-fast hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className={`h-28 w-full bg-gradient-to-br ${d.img}`} />
              <div className="bg-surface-1 p-3">
                <p className="text-sm font-bold text-ink-1">{d.city}</p>
                <p className="text-xs text-ink-3">{d.country}</p>
                <p className="mt-1.5 font-mono text-xs font-semibold tabular-nums text-brand-700">
                  from {d.from}/night
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Why TripBng strip */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: Sparkles,
            title: 'Contracted + live in one list',
            body: 'Direct-hotel rates and live supplier inventory merge under your policy and markup chain.',
          },
          {
            icon: Hotel,
            title: 'Currency & nationality aware',
            body: "Prices respect the agency's booking currency and the guest's nationality from the search.",
          },
          {
            icon: MapPin,
            title: 'Shareable search URLs',
            body: 'Send a search link to a colleague — they land on the same hotels, filters, and sort order.',
          },
        ].map((card) => (
          <Card key={card.title}>
            <CardContent className="space-y-1.5 p-5">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  <card.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <p className="text-sm font-semibold text-ink-1">{card.title}</p>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">{card.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
