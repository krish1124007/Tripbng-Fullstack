'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Compass,
  Hotel,
  Info,
  MapPin,
  PlaneTakeoff,
  Receipt,
  ShieldCheck,
  Sparkles,
  TreePalm,
  Users as UsersIcon,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { HolidayPackage } from '@tripbng/shared';
import { Badge, Button, Card, CardContent, EmptyState } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';
import { findHolidayInCache } from '@/lib/holiday-cache';
import { useCart } from '@/lib/cart';
import { BUDGET_LABELS, formatDateLong, type Budget } from '@/components/holidays/utils';

/**
 * /holidays/[id] — holiday-package detail page. Reads the package from the
 * session-cached search results (sessionStorage, populated by /holidays/search).
 * When the cache is missing or expired, shows a "Search expired" empty state.
 *
 * Once the backend ships GET /api/v1/holidays/:id (currently only /search
 * exists), swap the cache lookup for a real fetch and delete lib/holiday-cache.ts.
 */
export default function HolidayDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const addToCart = useCart((s) => s.addItem);

  const [data, setData] = useState<{
    pkg: HolidayPackage;
    departure: string;
    travellers: number;
    budget: Budget;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const found = findHolidayInCache(id);
    if (found) {
      setData({
        pkg: found.pkg,
        departure: found.cache.departure,
        travellers: parseInt(found.cache.travellers, 10) || 1,
        budget: (found.cache.budget as Budget) ?? 'mid',
      });
    }
    setHydrated(true);
  }, [id]);

  if (!hydrated) {
    return (
      <div className="space-y-3">
        <div className="shimmer h-8 w-40 rounded-md bg-surface-2/40" />
        <div className="shimmer h-72 w-full overflow-hidden rounded-lg bg-surface-2/40" />
        <div className="shimmer h-32 w-full overflow-hidden rounded-md bg-surface-2/40" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={TreePalm}
        title="Search session expired"
        description="Package details are loaded from your last search. Run the search again to view this package."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/holidays')}>
            <ArrowLeft className="h-4 w-4" /> Back to holidays
          </Button>
        }
      />
    );
  }

  const { pkg: p, departure, travellers, budget } = data;
  const totalRupees = p.perPaxRupees * Math.max(1, travellers);

  const onBook = () => {
    addToCart({
      id: `holiday:${p.id}`,
      kind: 'holiday',
      title: p.title,
      subtitle: `${p.nights} nights · ${p.cities.join(' · ')} · ${p.inclusions[0] ?? ''}${p.flightIncluded ? ' · Flights included' : ''}`,
      datePrimary: departure,
      priceRupees: totalRupees,
      qty: travellers,
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

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      {/* Back nav */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="-ml-2 text-ink-3 hover:text-ink-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back to results
      </Button>

      {/* ─────────── Hero ─────────── */}
      <section
        className={cn(
          'relative overflow-hidden rounded-xl border bg-gradient-to-br p-6 md:p-8',
          p.imageGradient ?? 'from-brand-100 to-accent-100 dark:from-brand-500/20 dark:to-accent-500/20',
        )}
      >
        <div className="relative z-10 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {p.bestSeller ? (
              <Badge variant="accent">
                <Sparkles className="h-2.5 w-2.5" /> Best seller
              </Badge>
            ) : null}
            {p.flightIncluded ? (
              <Badge variant="brand">
                <PlaneTakeoff className="h-2.5 w-2.5" /> Flights included
              </Badge>
            ) : null}
            <Badge variant="outline" className="bg-surface-1/80">
              {p.themeLabel}
            </Badge>
            <Badge variant="outline" className="bg-surface-1/80">
              {BUDGET_LABELS[budget]} tier
            </Badge>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              {p.destination}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-1 md:text-4xl">
              {p.title}
            </h1>
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-ink-2">
              <MapPin className="h-3.5 w-3.5" /> {p.cities.join(' · ')}
            </p>
          </div>
        </div>
      </section>

      {/* Quick facts strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact icon={CalendarIcon} label="Duration" value={`${p.nights} nights`} />
        <Fact icon={MapPin} label="Cities" value={`${p.cities.length}`} sub={p.cities.join(', ')} />
        <Fact icon={Hotel} label="Hotels" value={`${p.hotels}`} />
        <Fact
          icon={UsersIcon}
          label="Travellers"
          value={`${travellers}`}
          sub={departure ? `Departing ${formatDateLong(departure)}` : undefined}
        />
      </section>

      {/* Two-column layout */}
      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Day-by-day itinerary */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow text-ink-3">Day-by-day itinerary</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-1">
                    {p.itinerary.length} planned days
                  </h2>
                </div>
                <Compass className="h-5 w-5 text-brand-500" strokeWidth={1.5} />
              </div>

              {/* Timeline rail */}
              <ol className="relative space-y-4 border-l-2 border-dashed border-stroke-1 pl-6">
                {p.itinerary.map((d, idx) => (
                  <li key={d.day} className="relative">
                    <span
                      className={cn(
                        'absolute -left-[33px] top-0 grid h-7 w-7 place-items-center rounded-full font-mono text-[10px] font-bold ring-4 ring-surface-1',
                        idx === 0
                          ? 'bg-brand-500 text-white'
                          : idx === p.itinerary.length - 1
                            ? 'bg-accent-500 text-white'
                            : 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
                      )}
                    >
                      D{d.day}
                    </span>
                    <div className="rounded-md border bg-surface-2/40 p-4">
                      <p className="text-sm font-semibold text-ink-1">{d.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-2">{d.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* Inclusions */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow text-ink-3">What&apos;s included</p>
                <Receipt className="h-4 w-4 text-ink-3" />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {p.inclusions.map((i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-ink-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                    <span>{i}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t pt-3">
                <p className="eyebrow text-ink-3">Not included</p>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  <NotIncludedRow label="Personal expenses & tips" />
                  <NotIncludedRow label="Travel insurance" />
                  <NotIncludedRow label="Visa fees (unless stated)" />
                  <NotIncludedRow label={p.flightIncluded ? 'Optional excursions' : 'International flights'} />
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Cities visited */}
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Cities visited</p>
              <div className="flex flex-wrap items-center gap-2">
                {p.cities.map((c, i) => (
                  <span key={`${c}-${i}`} className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border bg-surface-2/50 px-3 py-1 text-xs font-semibold text-ink-1">
                      <MapPin className="h-3 w-3 text-brand-500" />
                      {c}
                    </span>
                    {i < p.cities.length - 1 ? (
                      <ArrowRight className="h-3 w-3 text-ink-4" />
                    ) : null}
                  </span>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-3">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> Inter-city transfers included; map view
                activates once a DMC integration ships geocoded city stops.
              </p>
            </CardContent>
          </Card>

          {/* Stay & policies */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="eyebrow text-ink-3">Stay &amp; policies</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-2 text-sm">
                  <Hotel className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Hotels</p>
                    <p className="text-xs text-ink-3">
                      {p.hotels} {p.hotels === 1 ? 'property' : 'properties'} across the {p.nights}-night stay,
                      curated for the {BUDGET_LABELS[budget].toLowerCase()} tier. Specific hotel allocations confirm
                      with the quote.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Cancellation</p>
                    <p className="text-xs text-ink-3">
                      Series departures follow DMC cancellation slabs — typically 100% retention inside 14 days
                      of departure. Tailor-made packages quoted with custom terms.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <PlaneTakeoff className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Flights</p>
                    <p className="text-xs text-ink-3">
                      {p.flightIncluded
                        ? 'International flights included as quoted — class/airline as per the series departure.'
                        : 'Flights are not part of this package. Add them via the flights desk and bundle for one quote.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Quote &amp; payment</p>
                    <p className="text-xs text-ink-3">
                      Add to your itinerary, then issue a branded quote from the cart. Customer payment is
                      collected outside this platform; agency wallet auto-debits on confirmation.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sticky right sidebar — desktop */}
        <aside className="hidden md:block">
          <div className="sticky top-4 space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5">
                <div>
                  <p className="eyebrow text-ink-3">Per pax · from</p>
                  <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">
                    {formatRupees(p.perPaxRupees)}
                  </p>
                  <p className="text-xs text-ink-3">indicative — confirms on quote</p>
                </div>
                <div className="rounded-md border bg-surface-2/40 p-3 text-xs">
                  <Row icon={<CalendarIcon className="h-3 w-3" />} label="Duration">
                    {p.nights} nights
                  </Row>
                  <Row icon={<MapPin className="h-3 w-3" />} label="Cities">
                    {p.cities.length}
                  </Row>
                  <Row icon={<UsersIcon className="h-3 w-3" />} label="Travellers">
                    {travellers}
                  </Row>
                  <Row icon={<Hotel className="h-3 w-3" />} label="Hotels">
                    {p.hotels}
                  </Row>
                  {departure ? (
                    <Row icon={<PlaneTakeoff className="h-3 w-3" />} label="Departure">
                      <span className="font-mono font-semibold text-ink-1">
                        {formatDateLong(departure)}
                      </span>
                    </Row>
                  ) : null}
                </div>
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink-2">
                      Total · {travellers} {travellers === 1 ? 'pax' : 'pax'}
                    </span>
                    <span className="font-mono text-xl font-bold tabular-nums text-ink-1">
                      {formatRupees(totalRupees)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    Indicative; confirms with the supplier quote.
                  </p>
                </div>
                <Button onClick={onBook} className="w-full">
                  Add to itinerary <ArrowRight className="h-4 w-4" />
                </Button>
                <p className="flex items-center justify-center gap-1 text-[10px] text-ink-3">
                  <CheckCircle2 className="h-3 w-3 text-success" /> Re-priced through your policy chain
                </p>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>

      {/* Mobile sticky bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-surface-1 px-4 py-3 shadow-lg md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-3">Per pax · from</p>
            <p className="font-mono text-lg font-bold tabular-nums text-ink-1">
              {formatRupees(p.perPaxRupees)}
            </p>
          </div>
          <Button onClick={onBook} size="lg" className="flex-1">
            Add to itinerary
          </Button>
        </div>
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof CalendarIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
          <p className="text-base font-bold text-ink-1">{value}</p>
          {sub ? <p className="truncate text-[11px] text-ink-3">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="inline-flex items-center gap-1.5 text-ink-3">
        {icon} {label}
      </span>
      <span className="text-right text-ink-1">{children}</span>
    </div>
  );
}

function NotIncludedRow({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-ink-2">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
      <span>{label}</span>
    </li>
  );
}
