'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  FileText,
  Hospital,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@/components/ui';
import {
  InsuranceSearchForm,
  type InsuranceSearchFormValues,
} from '@/components/insurance/insurance-search-form';
import { regionLabel, type AgeBand, type Region, type TripType } from '@/components/insurance/utils';
import { useRecentSearches } from '@/lib/recent-searches';

interface RecentInsuranceSearch {
  key: string;
  tripType: string;
  region: string;
  from: string;
  to: string;
  travellers: string;
  oldestAge: string;
}

export default function InsuranceLandingPage() {
  const router = useRouter();
  const recents = useRecentSearches<RecentInsuranceSearch>('insurance');

  // Legacy mock-search form values are no longer used by the buy flow — we
  // route everyone into the live ASEGO wizard regardless. Recents still help
  // the user land on the new flow with one click.
  const goQuote = (v: InsuranceSearchFormValues) => {
    recents.add({
      key: `${v.tripType}|${v.region}|${v.from}|${v.to}|${v.travellers}|${v.oldestAge}`,
      ...v,
    });
    router.push('/insurance/buy');
  };

  const goRecent = (_r: RecentInsuranceSearch) => {
    router.push('/insurance/buy');
  };

  return (
    <div className="space-y-6">
      {/* New ASEGO-backed buy flow CTA — surfaces the live integration alongside
          the legacy mock search below until the latter is fully migrated. */}
      <Card className="border-brand-300/60 bg-gradient-to-br from-brand-50 to-surface-1 dark:from-brand-500/10 dark:to-surface-2/40">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-500 text-white">
            <Sparkles className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-1">Live ASEGO travel insurance</p>
            <p className="text-xs text-ink-3">
              Quote, validate, and issue real policies via our ASEGO partner integration —
              policy PDF lands in seconds.
            </p>
          </div>
          <Link href="/insurance/buy">
            <Button>
              Start buy flow <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      <InsuranceSearchForm variant="hero" onSubmit={goQuote} />

      {/* Recent searches */}
      {recents.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-3">Recent:</span>
          {recents.items.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => goRecent(r)}
              className="inline-flex items-center gap-1.5 rounded-full border bg-surface-1 py-1 pl-3 pr-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
              <span className="capitalize">{r.tripType}</span>
              <span className="text-ink-4">·</span>
              <span>{regionLabel(r.region).split(' ')[0]}</span>
              <span className="text-ink-4">·</span>
              <span className="font-mono">{r.travellers}p</span>
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

      {/* Common quote presets */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="eyebrow text-brand-600">Common quotes</p>
            <h2 className="mt-1 text-h3 text-ink-1">Start with a typical traveller profile</h2>
          </div>
          <Badge variant="brand" dot>
            <Zap className="h-3 w-3" /> Quick start
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                goQuote({
                  tripType: preset.tripType,
                  region: preset.region,
                  from: preset.from,
                  to: preset.to,
                  travellers: preset.travellers,
                  oldestAge: preset.oldestAge,
                })
              }
              className="group rounded-xl border bg-surface-1 p-4 text-left transition-all duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  <preset.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <ArrowRight className="h-4 w-4 text-ink-4 transition-all duration-fast group-hover:translate-x-0.5 group-hover:text-brand-600" />
              </div>
              <p className="mt-3 text-sm font-bold text-ink-1">{preset.label}</p>
              <p className="mt-0.5 text-xs text-ink-3">{preset.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Why TripBng strip */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: ShieldCheck,
            title: '5 underwriters, one quote',
            body: 'Compare premium and cover line-by-line in a side-by-side table — pick on the spot.',
          },
          {
            icon: Hospital,
            title: '18k+ cashless hospitals',
            body: 'Carriers in our panel ship large cashless networks so the customer rarely pays upfront.',
          },
          {
            icon: FileText,
            title: 'Instant policy PDF',
            body: 'Issue at the point of booking — the policy PDF lands in the agency wallet within seconds.',
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

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface QuickPreset {
  label: string;
  description: string;
  icon: typeof ShieldCheck;
  tripType: TripType;
  region: Region;
  from: string;
  to: string;
  travellers: string;
  oldestAge: AgeBand;
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    label: 'Family week in Asia',
    description: '2 adults · 7 days · oldest 36–45',
    icon: ShieldCheck,
    tripType: 'single',
    region: 'asia',
    from: todayPlus(7),
    to: todayPlus(14),
    travellers: '2',
    oldestAge: '36–45',
  },
  {
    label: 'Schengen 14-day trip',
    description: '2 adults · 14 days · oldest 46–55',
    icon: ShieldCheck,
    tripType: 'single',
    region: 'schengen',
    from: todayPlus(21),
    to: todayPlus(35),
    travellers: '2',
    oldestAge: '46–55',
  },
  {
    label: 'Senior citizen worldwide',
    description: '1 traveller · 10 days · oldest 66–70',
    icon: ShieldCheck,
    tripType: 'senior',
    region: 'world',
    from: todayPlus(7),
    to: todayPlus(17),
    travellers: '1',
    oldestAge: '66–70',
  },
  {
    label: 'Annual multi-trip',
    description: '12-month cover · 1 traveller · oldest 36–45',
    icon: ShieldCheck,
    tripType: 'multi',
    region: 'world',
    from: todayPlus(7),
    to: todayPlus(372),
    travellers: '1',
    oldestAge: '36–45',
  },
  {
    label: 'Group of 5 to Asia',
    description: '5 travellers · 7 days · oldest 46–55',
    icon: ShieldCheck,
    tripType: 'group',
    region: 'asia',
    from: todayPlus(14),
    to: todayPlus(21),
    travellers: '5',
    oldestAge: '46–55',
  },
  {
    label: 'Student, year-long US',
    description: '1 traveller · 365 days · oldest 18–35',
    icon: ShieldCheck,
    tripType: 'student',
    region: 'world',
    from: todayPlus(30),
    to: todayPlus(395),
    travellers: '1',
    oldestAge: '18–35',
  },
];
