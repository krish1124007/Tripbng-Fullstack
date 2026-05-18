'use client';

// /bus — landing page for the SeatSeller-backed bus booking module.
// Hero search form + recent searches.

import { useRouter } from 'next/navigation';
import { Bus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import {
  BusSearchForm,
  type BusSearchFormValues,
} from '@/components/bus/bus-search-form';
import { useRecentSearches } from '@/lib/recent-searches';

interface RecentBusV2Search {
  key: string;
  sourceId: number;
  sourceName: string;
  destinationId: number;
  destinationName: string;
  doj: string;
}

export default function BusLandingPage() {
  const router = useRouter();
  // Distinct namespace from the older `/buses` placeholder so the two
  // surfaces don't share recent-search keys.
  const recents = useRecentSearches<RecentBusV2Search>('bus-v2');

  const goSearch = (v: BusSearchFormValues) => {
    recents.add({
      key: `${v.source.id}|${v.destination.id}|${v.doj}`,
      sourceId: v.source.id,
      sourceName: v.source.name,
      destinationId: v.destination.id,
      destinationName: v.destination.name,
      doj: v.doj,
    });
    const qs = new URLSearchParams({
      source: String(v.source.id),
      sourceName: v.source.name,
      destination: String(v.destination.id),
      destinationName: v.destination.name,
      doj: v.doj,
    });
    router.push(`/bus/search?${qs.toString()}`);
  };

  return (
    <div className="space-y-6">
      <BusSearchForm onSubmit={goSearch} />

      {recents.items.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink-2">Recent searches</p>
              <button
                type="button"
                onClick={() => recents.clear()}
                className="text-xs text-ink-3 hover:text-ink-1"
              >
                Clear all
              </button>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recents.items.slice(0, 6).map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => {
                      const qs = new URLSearchParams({
                        source: String(r.sourceId),
                        sourceName: r.sourceName,
                        destination: String(r.destinationId),
                        destinationName: r.destinationName,
                        doj: r.doj,
                      });
                      router.push(`/bus/search?${qs.toString()}`);
                    }}
                    className="flex w-full items-center gap-3 rounded-md border bg-surface-1 px-3 py-2 text-left text-sm hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <Bus className="h-3.5 w-3.5 text-ink-3" />
                    <span className="flex-1">
                      <span className="block text-ink-1">
                        {r.sourceName} → {r.destinationName}
                      </span>
                      <span className="block text-xs text-ink-3">{formatDoj(r.doj)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
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
