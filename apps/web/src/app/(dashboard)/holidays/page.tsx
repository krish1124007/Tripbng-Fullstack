'use client';

import { useRouter } from 'next/navigation';
import { Compass, Sparkles, Trash2, TreePalm, X } from 'lucide-react';
import { Badge, Card, CardContent } from '@/components/ui';
import {
  HolidaySearchForm,
  type HolidaySearchFormValues,
} from '@/components/holidays/holiday-search-form';
import { FEATURED_PACKAGES, todayPlus } from '@/components/holidays/utils';
import { useRecentSearches } from '@/lib/recent-searches';

interface RecentHolidaySearch {
  key: string;
  destination: string;
  duration: string;
  travellers: string;
  budget: string;
  theme: string;
}

export default function HolidaysLandingPage() {
  const router = useRouter();
  const recents = useRecentSearches<RecentHolidaySearch>('holidays');

  const buildSearchUrl = (v: {
    destination: string;
    duration: string;
    travellers: string;
    budget: string;
    theme: string;
    departure?: string;
  }) =>
    `/holidays/search?destination=${encodeURIComponent(v.destination)}` +
    `&duration=${v.duration}&travellers=${v.travellers}` +
    `&budget=${v.budget}&theme=${v.theme}` +
    `&departure=${v.departure ?? todayPlus(14)}`;

  const goSearch = (v: HolidaySearchFormValues) => {
    recents.add({
      key: `${v.destination}|${v.duration}|${v.travellers}|${v.budget}|${v.theme}`,
      destination: v.destination,
      duration: v.duration,
      travellers: v.travellers,
      budget: v.budget,
      theme: v.theme,
    });
    router.push(buildSearchUrl({ ...v, departure: v.departure }));
  };

  const goRecent = (r: RecentHolidaySearch) => {
    router.push(buildSearchUrl({ ...r }));
  };

  const goFeatured = (
    title: string,
    destination: string,
    duration: string,
    theme: string,
    budget: string,
  ) => {
    void title;
    router.push(
      buildSearchUrl({
        destination,
        duration,
        travellers: '2',
        budget,
        theme,
      }),
    );
  };

  return (
    <div className="space-y-6">
      <HolidaySearchForm variant="hero" onSubmit={goSearch} />

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
              <TreePalm className="h-3 w-3" strokeWidth={1.75} />
              <span>{r.destination}</span>
              <span className="text-ink-4">·</span>
              <span className="font-mono">{r.duration}n</span>
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

      {/* Top-selling packages */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="eyebrow text-brand-600">Top-selling packages</p>
            <h2 className="mt-1 text-h3 text-ink-1">What partners are quoting this season</h2>
          </div>
          <Badge variant="brand" dot>
            <TreePalm className="h-3 w-3" /> Series fares
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURED_PACKAGES.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => goFeatured(p.title, p.destination, p.duration, p.theme, p.budget)}
              className="group overflow-hidden rounded-xl border bg-surface-1 p-0 text-left transition-all duration-fast hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className={`h-32 w-full bg-gradient-to-br ${p.accent}`} />
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-ink-1">{p.title}</p>
                  <Badge variant="accent" className="shrink-0 text-[10px]">
                    {p.nights}
                  </Badge>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-3">{p.inclusions}</p>
                <p className="font-mono text-sm font-bold tabular-nums text-brand-700">
                  from <span className="text-ink-1">{p.fromFare}</span>
                  <span className="text-[10px] font-normal text-ink-3"> /pax</span>
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
            title: 'Series + tailor-made',
            body: 'Locked-in series fares for fast turnaround, plus tailor-made for high-touch customers.',
          },
          {
            icon: TreePalm,
            title: 'DMC-direct rates',
            body: 'Inclusions, hotels, sightseeing, and transfers priced through your distribution chain.',
          },
          {
            icon: Compass,
            title: 'Day-by-day itinerary',
            body: 'Every package opens to a structured timeline with inclusions and policy notes.',
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
