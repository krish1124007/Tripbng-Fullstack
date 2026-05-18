'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Sparkles, TrendingUp } from 'lucide-react';
import type { SearchRequest } from '@tripbng/shared';
import { Card, CardContent } from '@/components/ui';
import { FlightSearchForm } from '@/components/flights/flight-search-form';
import { buildSearchUrl } from '@/components/flights/utils';

/**
 * /flights — landing page. Hero search form + popular-routes strip. On submit,
 * pushes to /flights/search?...&… so results live on a dedicated route with
 * shareable URLs and proper browser back/forward semantics.
 */

const POPULAR_ROUTES = [
  { from: 'BOM', to: 'DEL', label: 'Mumbai → Delhi', from_name: 'Mumbai', to_name: 'Delhi' },
  { from: 'DEL', to: 'BLR', label: 'Delhi → Bengaluru', from_name: 'Delhi', to_name: 'Bengaluru' },
  { from: 'BLR', to: 'GOI', label: 'Bengaluru → Goa', from_name: 'Bengaluru', to_name: 'Goa' },
  { from: 'BOM', to: 'DXB', label: 'Mumbai → Dubai', from_name: 'Mumbai', to_name: 'Dubai' },
  { from: 'DEL', to: 'SIN', label: 'Delhi → Singapore', from_name: 'Delhi', to_name: 'Singapore' },
  { from: 'AMD', to: 'BOM', label: 'Ahmedabad → Mumbai', from_name: 'Ahmedabad', to_name: 'Mumbai' },
];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function FlightsLandingPage() {
  const router = useRouter();

  const goSearch = (req: SearchRequest) => {
    router.push(buildSearchUrl(req));
  };

  const goPopular = (from: string, to: string) =>
    router.push(
      buildSearchUrl({
        tripType: 'ONEWAY',
        segments: [{ origin: from, destination: to, date: new Date(todayPlus(7)) }],
        travelClass: 'ECONOMY',
        pax: { adults: 1, children: 0, infants: 0 },
      }),
    );

  return (
    <div className="space-y-6">
      <FlightSearchForm variant="hero" onSubmit={goSearch} />

      {/* ─────────── Popular routes ─────────── */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="eyebrow text-ink-3">Popular routes</p>
            <h2 className="text-base font-semibold text-ink-1">
              Quick-start a search for sectors your agencies book most
            </h2>
          </div>
          <span className="hidden items-center gap-1 text-xs text-ink-3 sm:inline-flex">
            <TrendingUp className="h-3.5 w-3.5" /> Updated weekly
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POPULAR_ROUTES.map((route) => (
            <button
              key={`${route.from}-${route.to}`}
              type="button"
              onClick={() => goPopular(route.from, route.to)}
              className="group flex items-center justify-between rounded-lg border bg-surface-1 px-4 py-3 text-left transition-all duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="font-mono text-sm font-bold text-ink-1">
                    {route.from} <span className="text-ink-4">→</span> {route.to}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {route.from_name} to {route.to_name}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-ink-4 transition-all duration-fast group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </button>
          ))}
        </div>
      </section>

      {/* ─────────── Why TripBng ─────────── */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            title: 'One screen, every fare type',
            body: 'Series, LCC, and FSC inventory merged and re-priced through your policy and markup chain.',
          },
          {
            title: 'Live supplier fan-out',
            body: 'Every search hits all configured suppliers in parallel — cheapest fare wins automatically.',
          },
          {
            title: 'Shareable result links',
            body: 'Send a search URL to a colleague and they land on the same fares, filters, and sort order.',
          },
        ].map((card) => (
          <Card key={card.title}>
            <CardContent className="space-y-1.5 p-5">
              <p className="text-sm font-semibold text-ink-1">{card.title}</p>
              <p className="text-xs leading-relaxed text-ink-3">{card.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
