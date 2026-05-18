'use client';

// Inline section components for the rich holiday-detail page.
// Each is a small read-only renderer that takes a slice of AdminHolidayPackage.
// Kept in one file because they share imports and only ever render together
// inside /holidays/packages/[id]/page.tsx.

import { useMemo, useState } from 'react';
import {
  BedDouble,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  HelpCircle,
  Hotel,
  Info,
  MapPin,
  PlaneTakeoff,
  ShieldCheck,
  Sparkles,
  Star,
  Utensils,
  XCircle,
} from 'lucide-react';
import type {
  AdminHolidayPackage,
  HolidayCancellationSlab,
  HolidayCityStop,
  HolidayDayPlan,
  HolidayFlightEntry,
  HolidayHotel,
  HolidayMealPlan,
  HolidaySightseeing,
} from '@tripbng/shared';
import { Badge, Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/utils';
import { bestPriceMonths } from '@/lib/holiday-quote';

// ────────── Hero with image carousel ──────────

export function Hero({ pkg }: { pkg: AdminHolidayPackage }) {
  const [active, setActive] = useState(0);
  const images = pkg.heroImages.length > 0 ? pkg.heroImages : [];
  const cover = images[active];
  const ratingScore = pkg.rating?.score;

  const next = () => setActive((i) => (images.length === 0 ? 0 : (i + 1) % images.length));
  const prev = () => setActive((i) => (images.length === 0 ? 0 : (i - 1 + images.length) % images.length));

  return (
    <section className="relative -mx-4 overflow-hidden md:-mx-6">
      <div className="relative h-[280px] w-full bg-gradient-to-br from-brand-200 to-accent-200 md:h-[420px] dark:from-brand-500/30 dark:to-accent-500/30">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={pkg.title}
            className="h-full w-full object-cover"
            onError={(e) => {
              // Fall back to gradient if the URL 404s.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
        {/* Bottom gradient for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Carousel chevrons */}
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Previous image"
              className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next image"
              className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        ) : null}

        {/* Rating badge top-right */}
        {ratingScore != null ? (
          <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-ink-1 shadow">
            <Star className="h-3 w-3 fill-accent-500 text-accent-500" strokeWidth={1.5} />
            <span className="font-mono tabular-nums">{ratingScore.toFixed(1)}</span>
            {pkg.rating?.count ? (
              <span className="text-[10px] text-ink-3">
                ({pkg.rating.count.toLocaleString('en-IN')})
              </span>
            ) : null}
          </span>
        ) : null}

        {/* Title overlay */}
        <div className="absolute inset-x-0 bottom-0 px-6 pb-5 md:px-10">
          <div className="flex flex-wrap items-center gap-2">
            {pkg.bestSeller ? (
              <Badge variant="accent">
                <Sparkles className="h-2.5 w-2.5" /> Best seller
              </Badge>
            ) : null}
            {pkg.flightIncluded ? (
              <Badge variant="brand">
                <PlaneTakeoff className="h-2.5 w-2.5" /> Flights included
              </Badge>
            ) : null}
            {pkg.themeLabel ? (
              <Badge variant="outline" className="bg-white/80 text-ink-1">
                {pkg.themeLabel}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/80">
            <MapPin className="h-3 w-3" /> {pkg.destination}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white md:text-4xl">
            {pkg.title}
          </h1>
          {pkg.cities.length > 0 ? (
            <p className="mt-1.5 text-sm text-white/90">
              {pkg.cities.map((c) => c.city).join(' · ')}
            </p>
          ) : null}
        </div>
      </div>

      {/* Thumbnails strip */}
      {images.length > 1 ? (
        <div className="border-b bg-surface-1 px-4 py-2 md:px-6">
          <div className="flex flex-nowrap gap-2 overflow-x-auto">
            {images.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show image ${i + 1}`}
                className={cn(
                  'relative h-12 w-20 shrink-0 overflow-hidden rounded ring-2 transition-all',
                  i === active ? 'ring-brand-500' : 'ring-transparent hover:ring-stroke-2',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Thumb ${i + 1}`}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ────────── Quick-facts strip ──────────

export function QuickFacts({ pkg }: { pkg: AdminHolidayPackage }) {
  const hotelStarsHint = useMemo(() => {
    const stars = Object.values(pkg.hotelsPerCity).flat().map((h) => h.starRating);
    if (stars.length === 0) return '—';
    const min = Math.min(...stars);
    const max = Math.max(...stars);
    return min === max ? `${min}★` : `${min}–${max}★`;
  }, [pkg.hotelsPerCity]);

  const mealHint = useMemo(() => {
    const plans = new Set<HolidayMealPlan>(
      Object.values(pkg.hotelsPerCity).flatMap((list) => list.map((h) => h.mealPlan)),
    );
    if (plans.size === 0) return '—';
    return Array.from(plans).join(' · ');
  }, [pkg.hotelsPerCity]);

  const transferHint = useMemo(() => {
    const hasTransfer = pkg.dayWise.some((d) => d.inclusions.includes('transfer'));
    return hasTransfer ? 'Included' : 'On request';
  }, [pkg.dayWise]);

  const items = [
    { icon: CalendarIcon, label: 'Duration', value: `${pkg.nights} nights · ${pkg.cities.length || pkg.nights + 1} days` },
    { icon: Hotel, label: 'Stay tier', value: hotelStarsHint },
    { icon: Utensils, label: 'Meals', value: mealHint },
    { icon: Compass, label: 'Transfers', value: transferHint },
    { icon: ShieldCheck, label: 'Insurance', value: pkg.insuranceBundled ? 'Bundled' : 'Optional add-on' },
    { icon: PlaneTakeoff, label: 'Departure cities', value: pkg.departureCities.join(' · ') || 'Any' },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="flex items-start gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <it.icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {it.label}
              </p>
              <p className="truncate text-sm font-bold text-ink-1">{it.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

// ────────── Highlights ──────────

export function Highlights({ pkg }: { pkg: AdminHolidayPackage }) {
  // Auto-derive 6 cards from what the admin authored.
  const cards = useMemo(() => {
    const out: { icon: typeof Sparkles; title: string; body: string }[] = [];
    if (pkg.cities.length > 0) {
      out.push({
        icon: MapPin,
        title: `${pkg.cities.length}-city itinerary`,
        body: pkg.cities.map((c) => c.city).join(' → '),
      });
    }
    if (pkg.dayWise.length > 0) {
      out.push({
        icon: CalendarIcon,
        title: `${pkg.dayWise.length}-day plan`,
        body: 'Day-by-day itinerary curated by our DMC partners.',
      });
    }
    const hotelCount = Object.values(pkg.hotelsPerCity).reduce((sum, list) => sum + list.length, 0);
    if (hotelCount > 0) {
      out.push({
        icon: Hotel,
        title: `${hotelCount} hotel${hotelCount === 1 ? '' : 's'}`,
        body: 'Curated stays across the route.',
      });
    }
    const sightCount = Object.values(pkg.sightseeingPerCity).reduce((sum, list) => sum + list.length, 0);
    if (sightCount > 0) {
      out.push({
        icon: Compass,
        title: `${sightCount} experiences`,
        body: 'Guided sightseeing & local activities.',
      });
    }
    if (pkg.insuranceBundled) {
      out.push({
        icon: ShieldCheck,
        title: 'Insurance bundled',
        body: 'Travel insurance included in the package fare.',
      });
    }
    if (pkg.flightIncluded) {
      out.push({
        icon: PlaneTakeoff,
        title: 'Flights included',
        body: 'International flights are part of the price.',
      });
    }
    out.push({
      icon: Sparkles,
      title: '24×7 trade desk',
      body: 'Our concierge handles re-bookings and on-trip support.',
    });
    return out.slice(0, 6);
  }, [pkg]);

  return (
    <Section id="highlights" title="Highlights">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardContent className="space-y-1.5 p-4">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <c.icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <p className="text-sm font-semibold text-ink-1">{c.title}</p>
              <p className="text-xs text-ink-3">{c.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}

// ────────── Day-by-day ──────────

export function DayByDay({
  days,
  hotels,
}: {
  days: HolidayDayPlan[];
  hotels: Record<string, HolidayHotel[]>;
}) {
  if (days.length === 0) return null;
  // Pull a representative image per day from the first hotel/sightseeing
  // image we have. Best-effort — images are optional.
  const allHotels = Object.values(hotels).flat();
  const fallbackImage = allHotels.find((h) => h.imageUrl)?.imageUrl ?? null;

  return (
    <Section id="day-by-day" title="Day by day">
      <ol className="relative space-y-4 border-l-2 border-dashed border-stroke-1 pl-6 md:pl-8">
        {days.map((d, i) => {
          const isLeft = i % 2 === 0;
          return (
            <li key={i} className="relative">
              <span
                className={cn(
                  'absolute -left-[33px] top-0 grid h-7 w-7 place-items-center rounded-full font-mono text-[10px] font-bold ring-4 ring-surface-0 md:-left-[37px]',
                  i === 0
                    ? 'bg-brand-500 text-white'
                    : i === days.length - 1
                      ? 'bg-accent-500 text-white'
                      : 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
                )}
              >
                D{d.day}
              </span>
              <Card className={cn('overflow-hidden p-0', isLeft ? '' : 'md:ml-8')}>
                <div className="grid md:grid-cols-[1fr_180px]">
                  <div className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {d.inclusions.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium capitalize text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                        >
                          <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.5} />
                          {tag}
                        </span>
                      ))}
                    </div>
                    <h3 className="text-base font-bold text-ink-1">{d.title}</h3>
                    {d.description ? (
                      <div
                        className="prose prose-sm max-w-none text-sm leading-relaxed text-ink-2 dark:prose-invert"
                        dangerouslySetInnerHTML={{ __html: d.description }}
                      />
                    ) : null}
                  </div>
                  {fallbackImage ? (
                    <div className="hidden md:block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fallbackImage}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="hidden bg-gradient-to-br from-brand-100 to-accent-100 md:block dark:from-brand-500/20 dark:to-accent-500/20" />
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

// ────────── Where you stay ──────────

export function WhereYouStay({
  cities,
  hotelsPerCity,
}: {
  cities: HolidayCityStop[];
  hotelsPerCity: Record<string, HolidayHotel[]>;
}) {
  const totalHotels = Object.values(hotelsPerCity).reduce((sum, l) => sum + l.length, 0);
  if (totalHotels === 0) return null;
  return (
    <Section id="where-you-stay" title="Where you stay">
      <div className="space-y-5">
        {cities.map((city) => {
          const list = hotelsPerCity[city.key] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={city.key}>
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 font-mono text-[10px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {city.order}
                </span>
                <p className="text-sm font-semibold text-ink-1">{city.city}</p>
                <p className="text-xs text-ink-3">
                  {city.nights} {city.nights === 1 ? 'night' : 'nights'}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((h) => (
                  <HotelCard key={h.id} h={h} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function HotelCard({ h }: { h: HolidayHotel }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid md:grid-cols-[120px_1fr]">
        {h.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={h.imageUrl}
            alt={h.name}
            className="h-32 w-full object-cover md:h-full"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="h-32 w-full bg-gradient-to-br from-brand-100 to-accent-100 md:h-full dark:from-brand-500/20 dark:to-accent-500/20" />
        )}
        <div className="space-y-1.5 p-4">
          <div className="flex items-center gap-1">
            {Array.from({ length: h.starRating }).map((_, i) => (
              <Star key={i} className="h-3 w-3 fill-accent-500 text-accent-500" strokeWidth={1.5} />
            ))}
          </div>
          <p className="text-sm font-semibold text-ink-1">{h.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {h.mealPlan}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              <BedDouble className="h-2.5 w-2.5" /> {h.roomCategory}
            </Badge>
            <span className="text-[10px] text-ink-3">
              {h.nights} {h.nights === 1 ? 'night' : 'nights'}
            </span>
          </div>
          {h.descriptionHtml ? (
            <div
              className="prose prose-xs max-w-none text-xs text-ink-3 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: h.descriptionHtml }}
            />
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ────────── Sightseeing per city ──────────

export function SightseeingSection({
  cities,
  sightseeingPerCity,
}: {
  cities: HolidayCityStop[];
  sightseeingPerCity: Record<string, HolidaySightseeing[]>;
}) {
  const total = Object.values(sightseeingPerCity).reduce((sum, l) => sum + l.length, 0);
  if (total === 0) return null;
  return (
    <Section id="experiences" title="Experiences & sightseeing">
      <div className="space-y-5">
        {cities.map((city) => {
          const list = sightseeingPerCity[city.key] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={city.key}>
              <p className="mb-2 text-sm font-semibold text-ink-1">{city.city}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((s) => (
                  <Card key={s.id} className="overflow-hidden p-0">
                    <div className="grid md:grid-cols-[120px_1fr]">
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.imageUrl}
                          alt={s.name}
                          className="h-32 w-full object-cover md:h-full"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="h-32 w-full bg-gradient-to-br from-emerald-200 to-cyan-200 md:h-full dark:from-emerald-500/30 dark:to-cyan-500/30" />
                      )}
                      <div className="space-y-1.5 p-4">
                        <p className="text-sm font-semibold text-ink-1">{s.name}</p>
                        {s.descriptionHtml ? (
                          <div
                            className="prose prose-xs max-w-none text-xs text-ink-3 dark:prose-invert"
                            dangerouslySetInnerHTML={{ __html: s.descriptionHtml }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ────────── Flights ──────────

export function FlightsSection({ flights }: { flights: HolidayFlightEntry[] }) {
  if (flights.length === 0) return null;
  return (
    <Section id="flights" title="Flights">
      <div className="space-y-2">
        {flights.map((f) => (
          <Card key={f.id}>
            <CardContent className="flex flex-wrap items-start gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <PlaneTakeoff className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold text-ink-1">{f.sector}</p>
                {f.descriptionHtml ? (
                  <div
                    className="prose prose-sm mt-1 max-w-none text-xs text-ink-3 dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: f.descriptionHtml }}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}

// ────────── Inclusions / Exclusions ──────────

export function InclusionsExclusions({
  inclusions,
  exclusions,
}: {
  inclusions: string[];
  exclusions: string[];
}) {
  if (inclusions.length === 0 && exclusions.length === 0) return null;
  return (
    <Section id="whats-included" title="What's included">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="eyebrow text-success">Included</p>
            {inclusions.length === 0 ? (
              <p className="text-xs text-ink-3">No inclusions specified.</p>
            ) : (
              <ul className="space-y-2">
                {inclusions.map((i, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-ink-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                    <span
                      className="prose prose-sm max-w-none text-sm text-ink-2 dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: i }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="eyebrow text-ink-3">Not included</p>
            {exclusions.length === 0 ? (
              <p className="text-xs text-ink-3">No exclusions specified.</p>
            ) : (
              <ul className="space-y-2">
                {exclusions.map((e, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-ink-2">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
                    <span
                      className="prose prose-sm max-w-none text-sm text-ink-2 dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: e }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}

// ────────── Compare tiers ──────────

export function CompareTiers({ pkg }: { pkg: AdminHolidayPackage }) {
  const cheapest = pkg.priceMatrix[0];
  if (!cheapest) return null;
  const tiers: { key: 'single' | 'double' | 'triple'; label: string; description: string; rate: number }[] = [
    { key: 'single', label: 'Single sharing', description: 'Solo traveller, dedicated room.', rate: cheapest.singleSharingInr },
    { key: 'double', label: 'Double sharing', description: 'Two adults sharing — most-booked.', rate: cheapest.doubleSharingInr },
    { key: 'triple', label: 'Triple sharing', description: 'Three adults sharing — most economical.', rate: cheapest.tripleSharingInr },
  ];

  return (
    <Section
      id="compare-tiers"
      title="Compare tiers"
      subtitle={`Per-adult INR — based on the ${cheapest.priceType.toLowerCase()} rate from the package's price matrix.`}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {tiers.map((t) => (
          <Card key={t.key} className={cn(t.key === 'double' && 'border-brand-300 ring-1 ring-brand-200/50')}>
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-1">{t.label}</p>
                {t.key === 'double' ? (
                  <Badge variant="brand" className="text-[9px]">
                    Most popular
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-ink-3">{t.description}</p>
              <p className="font-mono text-2xl font-bold tabular-nums text-ink-1">
                ₹{t.rate.toLocaleString('en-IN')}
                <span className="ml-1 text-[10px] font-normal text-ink-3">/ adult</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}

// ────────── Best price months ──────────

export function BestPriceMonthsSection({ pkg }: { pkg: AdminHolidayPackage }) {
  const months = useMemo(() => bestPriceMonths(pkg.priceMatrix), [pkg.priceMatrix]);
  const covered = months.filter((m) => m.cheapestInr != null);
  if (covered.length === 0) return null;

  const sorted = [...covered].sort((a, b) => (a.cheapestInr ?? 0) - (b.cheapestInr ?? 0));
  const cheapestId = sorted[0]?.ym;
  const peakId = sorted[sorted.length - 1]?.ym;

  return (
    <Section
      id="best-price-months"
      title="Best price months"
      subtitle="Auto-derived from the package price matrix (next 6 months)."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {months.map((m) => {
          const isCheapest = m.ym === cheapestId && m.cheapestInr != null;
          const isPeak = m.ym === peakId && peakId !== cheapestId && m.cheapestInr != null;
          return (
            <Card
              key={m.ym}
              className={cn(
                isCheapest && 'border-success/40 bg-success-soft/40',
                isPeak && 'border-warning/40 bg-warning-soft/40',
              )}
            >
              <CardContent className="space-y-1 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  {m.monthLabel}
                </p>
                {m.cheapestInr ? (
                  <>
                    <p className="font-mono text-sm font-bold tabular-nums text-ink-1">
                      ₹{m.cheapestInr.toLocaleString('en-IN')}
                    </p>
                    {isCheapest ? (
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-success">
                        Cheapest
                      </p>
                    ) : isPeak ? (
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-warning">
                        Peak
                      </p>
                    ) : (
                      <p className="text-[9px] text-ink-3">/ adult</p>
                    )}
                  </>
                ) : (
                  <p className="text-[10px] text-ink-3">no rate</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

// ────────── Cancellation ──────────

export function CancellationSection({
  schedule,
  policyText,
}: {
  schedule: HolidayCancellationSlab[];
  policyText: string[];
}) {
  if (schedule.length === 0 && policyText.length === 0) return null;
  return (
    <Section id="cancellation" title="Cancellation policy">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        {schedule.length > 0 ? (
          <Card className="overflow-hidden p-0">
            <div className="border-b bg-surface-2/40 px-4 py-2">
              <p className="eyebrow text-ink-3">Time-based slabs</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface-2/30 text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Hours before departure</th>
                  <th className="px-4 py-2 text-right font-semibold">Charge</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-4 py-2.5 font-mono tabular-nums text-ink-1">
                      ≥ {s.hoursBeforeDeparture}h
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-ink-1">
                      {s.chargePercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
        {policyText.length > 0 ? (
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="eyebrow text-ink-3">Policy notes</p>
              <ul className="space-y-2">
                {policyText.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} />
                    <span
                      className="prose prose-sm max-w-none text-sm text-ink-2 dark:prose-invert"
                      dangerouslySetInnerHTML={{ __html: p }}
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Section>
  );
}

// ────────── Important notes ──────────

export function ImportantNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Section id="important-notes" title="Important notes">
      <Card className="border-warning/40 bg-warning-soft/30">
        <CardContent className="space-y-2 p-5">
          <ul className="space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={2} />
                <span
                  className="prose prose-sm max-w-none text-sm text-ink-2 dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: n }}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Section>
  );
}

// ────────── FAQ ──────────

export function FAQ({ pkg }: { pkg: AdminHolidayPackage }) {
  // Dynamic FAQ — visa wording adapts based on package's visa hints.
  const faqs = useMemo(() => {
    const out: { q: string; a: string }[] = [
      {
        q: 'How is the price calculated?',
        a: 'The displayed total = (per-adult sharing rate × adults + child rates × children) + 5% markup + 5% GST. Switch sharing-type or pax in the booking rail to see the live breakdown.',
      },
      {
        q: 'Are flights included in the package price?',
        a: pkg.flightIncluded
          ? 'Yes — international flights are part of this package. The exact carrier and class are quoted at booking confirmation.'
          : 'No — flights are not part of this package. Bundle them via our flights desk and we will issue a single quote.',
      },
      {
        q: 'Is travel insurance included?',
        a: pkg.insuranceBundled
          ? 'Yes — basic travel insurance is bundled. Customers can upgrade at booking.'
          : 'No, but you can add it from the insurance product before checkout.',
      },
    ];
    if (pkg.visaCountriesHinted.length > 0) {
      out.push({
        q: 'Do my travellers need a visa?',
        a: `This itinerary touches ${pkg.visaCountriesHinted.length} countries that may require a visa for Indian passport holders (${pkg.visaCountriesHinted.join(', ')}). Check the Visa product for exact requirements and processing times.`,
      });
    } else {
      out.push({
        q: 'Do my travellers need a visa?',
        a: 'This package is domestic — no international visa required. Carry a government-issued photo ID for hotel check-in.',
      });
    }
    out.push({
      q: 'Can I cancel after booking?',
      a:
        pkg.cancellationSchedule.length > 0
          ? 'Yes — see the Cancellation section above for the time-based charge slabs.'
          : 'Cancellation terms are confirmed at quote-time; reach the trade desk for the live policy.',
    });
    return out;
  }, [pkg]);

  return (
    <Section id="faq" title="Frequently asked">
      <div className="space-y-2">
        {faqs.map((f) => (
          <details
            key={f.q}
            className="group rounded-md border bg-surface-1 p-4 transition-colors open:bg-surface-2/30"
          >
            <summary className="flex cursor-pointer list-none items-start gap-2 text-sm font-semibold text-ink-1">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" strokeWidth={1.75} />
              <span className="flex-1">{f.q}</span>
              <ChevronDown className="mt-0.5 h-4 w-4 text-ink-4 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 pl-6 text-xs leading-relaxed text-ink-3">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

// ────────── Section wrapper ──────────

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <header>
        <h2 className="text-lg font-bold text-ink-1">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

