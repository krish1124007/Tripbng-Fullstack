'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Clock, FileText, Globe, ShieldCheck, StickyNote } from 'lucide-react';
import { Badge, Card, CardContent } from '@/components/ui';
import {
  VisaSearchForm,
  type VisaSearchFormValues,
} from '@/components/visa/visa-search-form';
import { COUNTRIES, visaKindBadgeTone } from '@/components/visa/utils';
import { useRecentSearches } from '@/lib/recent-searches';

interface RecentVisaSearch {
  key: string;
  country: string;
  visaType: string;
  applicants: string;
}

export default function VisaLandingPage() {
  const router = useRouter();
  const recents = useRecentSearches<RecentVisaSearch>('visa');

  const goQuote = (v: VisaSearchFormValues) => {
    recents.add({
      key: `${v.country}|${v.visaType}|${v.applicants}`,
      country: v.country,
      visaType: v.visaType,
      applicants: v.applicants,
    });
    router.push(
      `/visa/quote?country=${v.country}&visaType=${v.visaType}` +
        `&nationality=${v.nationality}&travelDate=${v.travelDate}&applicants=${v.applicants}`,
    );
  };

  const goCountry = (code: string) => router.push(`/visa/${code}`);

  return (
    <div className="space-y-6">
      <VisaSearchForm variant="hero" onSubmit={goQuote} />

      {/* Recent searches */}
      {recents.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-3">Recent:</span>
          {recents.items.map((r) => {
            const c = COUNTRIES.find((co) => co.value === r.country);
            return (
              <button
                key={r.key}
                type="button"
                onClick={() =>
                  router.push(
                    `/visa/quote?country=${r.country}&visaType=${r.visaType}` +
                      `&nationality=IN&travelDate=&applicants=${r.applicants}`,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-full border bg-surface-1 px-3 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                <span>{c?.flag}</span>
                <span>{c?.label}</span>
                <span className="text-ink-4">·</span>
                <span className="capitalize">{r.visaType}</span>
                <span className="text-ink-4">·</span>
                <span className="font-mono">{r.applicants}p</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Browse by country */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="eyebrow text-brand-600">Browse by destination</p>
            <h2 className="mt-1 text-h3 text-ink-1">
              Visa policies for top destinations from India
            </h2>
          </div>
          <Badge variant="brand" dot>
            <StickyNote className="h-3 w-3" /> Curated
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COUNTRIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => goCountry(c.value)}
              className="group flex flex-col gap-2 rounded-xl border bg-surface-1 p-4 text-left transition-all duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl">{c.flag}</span>
                <ArrowRight className="h-4 w-4 text-ink-4 transition-all duration-fast group-hover:translate-x-0.5 group-hover:text-brand-600" />
              </div>
              <p className="text-sm font-bold text-ink-1">{c.label}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={visaKindBadgeTone(c.kind)} className="text-[9px]">
                  {c.kind}
                </Badge>
                <span className="font-mono text-[10px] text-ink-3">TAT {c.tat}</span>
              </div>
              {c.fromFare ? (
                <p className="font-mono text-xs font-semibold tabular-nums text-brand-700">
                  from <span className="text-ink-1">{c.fromFare}</span>
                  <span className="text-[10px] font-normal text-ink-3"> /pax</span>
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {/* Why TripBng strip */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: FileText,
            title: 'Fee + docs in one view',
            body: 'Government fee, service fee, courier, and the full document checklist — all on the quote page.',
          },
          {
            icon: Clock,
            title: 'Real-time TAT',
            body: 'Per-country processing time stays in sync with the supplier (VFS / BLS / consulate).',
          },
          {
            icon: ShieldCheck,
            title: 'Auto-refund on rejection',
            body: 'Rejected applications get the government fee minus DR auto-credited to the agency wallet.',
          },
          {
            icon: Globe,
            title: 'Browse policies by country',
            body: 'Each destination has a dedicated info page with visa kind, TAT, common documents, and FAQs.',
          },
        ]
          .slice(0, 3)
          .map((card) => (
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
