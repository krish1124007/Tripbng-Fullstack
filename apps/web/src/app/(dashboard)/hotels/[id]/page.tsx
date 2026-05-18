'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Hotel as HotelIcon,
  Info,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Users as UsersIcon,
  Utensils,
  Wifi,
  Wind,
} from 'lucide-react';
import { toast } from 'sonner';
import type { HotelOption } from '@tripbng/shared';
import { Badge, Button, Card, CardContent, EmptyState } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';
import { findHotelInCache } from '@/lib/hotel-cache';
import { useCart } from '@/lib/cart';
import { formatDateShort, nightsBetween } from '@/components/hotels/utils';

/**
 * /hotels/[id] — hotel detail page. Reads the hotel from session-cached search
 * results (sessionStorage, populated by /hotels/search). When the search has
 * expired or the user lands on this URL directly, we show a "Search expired"
 * empty state. Once the backend ships GET /api/v1/hotels/:id this page can
 * fall back to a network fetch.
 */
export default function HotelDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const addToCart = useCart((s) => s.addItem);

  const [data, setData] = useState<{
    hotel: HotelOption;
    checkIn: string;
    checkOut: string;
    rooms: number;
    guests: number;
    nationality: string;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Read once on mount — sessionStorage isn't available SSR.
  useEffect(() => {
    const found = findHotelInCache(id);
    if (found) {
      setData({
        hotel: found.hotel,
        checkIn: found.cache.checkIn,
        checkOut: found.cache.checkOut,
        rooms: found.cache.rooms,
        guests: found.cache.guests,
        nationality: found.cache.nationality,
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
        icon={HotelIcon}
        title="Search session expired"
        description="Hotel details are loaded from your last search. Run the search again to view this hotel."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/hotels')}>
            <ArrowLeft className="h-4 w-4" /> Back to hotels
          </Button>
        }
      />
    );
  }

  const { hotel: h, checkIn, checkOut, rooms, guests, nationality } = data;
  const nights = nightsBetween(checkIn, checkOut);

  const onBook = () => {
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
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-1">
              {Array.from({ length: h.stars }).map((_, i) => (
                <Star
                  key={i}
                  className="h-4 w-4 fill-accent-500 text-accent-500"
                  strokeWidth={1.5}
                />
              ))}
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {h.brand}
              </span>
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-1">{h.name}</h1>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-3">
              <MapPin className="h-3.5 w-3.5" /> {h.area}, {h.city}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success" className="text-xs">
              <span className="font-mono tabular-nums">{h.reviewScore.toFixed(1)}</span>
              <span className="text-[9px] opacity-70">/10</span>
            </Badge>
            <span className="text-xs text-ink-3">
              {h.reviewCount.toLocaleString('en-IN')} reviews
            </span>
            <Badge variant={h.refundable ? 'success' : 'neutral'} className="text-xs">
              {h.refundable ? 'Refundable' : 'Non-refundable'}
            </Badge>
          </div>
        </div>

        {/* Image gallery — uses the gradient as the visual until a real
            CDN-served image lands on HotelOption.imageUrl. */}
        <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr] md:grid-rows-2 md:h-72">
          <div
            className={cn(
              'relative h-48 overflow-hidden rounded-lg bg-gradient-to-br md:row-span-2 md:h-full',
              h.imageGradient,
            )}
          >
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              <Sparkles className="h-2.5 w-2.5" /> Featured shot
            </span>
          </div>
          <div className="hidden h-full overflow-hidden rounded-lg bg-gradient-to-br from-amber-200 to-rose-300 md:block dark:from-amber-300/30 dark:to-rose-400/30" />
          <div className="hidden h-full overflow-hidden rounded-lg bg-gradient-to-br from-emerald-200 to-cyan-300 md:block dark:from-emerald-300/30 dark:to-cyan-400/30" />
          <div className="hidden h-full overflow-hidden rounded-lg bg-gradient-to-br from-sky-200 to-indigo-300 md:block dark:from-sky-300/30 dark:to-indigo-400/30" />
          <div className="hidden h-full overflow-hidden rounded-lg bg-gradient-to-br from-fuchsia-200 to-orange-300 md:block dark:from-fuchsia-300/30 dark:to-orange-400/30" />
        </div>
      </section>

      {/* Two-column layout */}
      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        {/* Main content */}
        <div className="space-y-5">
          {/* About */}
          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="eyebrow text-ink-3">About this hotel</p>
              <h2 className="text-lg font-semibold text-ink-1">
                {h.stars}-star stay in {h.area}
              </h2>
              <p className="text-sm leading-relaxed text-ink-2">
                {h.name} is a {h.stars}-star property in {h.area}, {h.city}. Booked through TripBng's
                contracted-rate desk, this {h.refundable ? 'refundable' : 'non-refundable'}{' '}
                option includes {h.inclusion.toLowerCase()}.
              </p>
              <p className="text-xs text-ink-3">
                <Info className="mr-1 inline h-3 w-3" /> Detailed property descriptions arrive once
                a hotel supplier (Hotelbeds / Travelport) is wired in — tracked under the products
                module roadmap.
              </p>
            </CardContent>
          </Card>

          {/* Amenities */}
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Amenities</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {h.amenities.map((a) => (
                  <div key={a} className="flex items-center gap-2 text-sm text-ink-2">
                    <AmenityIcon name={a} />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Available room */}
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Available room</p>
              <div className="grid gap-4 rounded-md border bg-surface-2/30 p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <BedDouble className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                    <p className="text-base font-semibold text-ink-1">{h.roomType}</p>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">
                    <span className="font-semibold">Inclusions:</span>{' '}
                    <span className="text-ink-3">{h.inclusion}</span>
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    <li className="rounded-full bg-surface-1 px-2 py-0.5 text-[10px] font-medium text-ink-3 ring-1 ring-stroke-1">
                      Sleeps {guests}
                    </li>
                    <li className="rounded-full bg-surface-1 px-2 py-0.5 text-[10px] font-medium text-ink-3 ring-1 ring-stroke-1">
                      {nights} {nights === 1 ? 'night' : 'nights'}
                    </li>
                    <li
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
                        h.refundable
                          ? 'bg-success-soft text-success ring-success/20'
                          : 'bg-surface-1 text-ink-3 ring-stroke-1',
                      )}
                    >
                      {h.refundable ? 'Free cancellation' : 'No refund'}
                    </li>
                  </ul>
                </div>
                <div className="md:text-right">
                  <p className="font-mono text-2xl font-bold tabular-nums text-ink-1">
                    {formatRupees(h.perNightPaise / 100)}
                  </p>
                  <p className="text-[11px] text-ink-3">per night, all-in</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Policies */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="eyebrow text-ink-3">Policies</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-2 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Check-in / Check-out</p>
                    <p className="text-xs text-ink-3">
                      Standard check-in 14:00, check-out 11:00 (local time). Early check-in /
                      late check-out subject to availability.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Cancellation</p>
                    <p className="text-xs text-ink-3">
                      {h.refundable
                        ? 'Free cancellation per supplier fare rules — full charge applies after the cut-off window.'
                        : 'This rate is non-refundable. The full booking amount is forfeit on cancellation.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <UsersIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Guests &amp; rooms</p>
                    <p className="text-xs text-ink-3">
                      Booking covers {rooms} {rooms === 1 ? 'room' : 'rooms'} for {guests}{' '}
                      {guests === 1 ? 'guest' : 'guests'}. Extra-bed and child-policy charges are
                      collected at the property.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                  <div>
                    <p className="font-semibold text-ink-1">Trade desk support</p>
                    <p className="text-xs text-ink-3">
                      Reach the TripBng trade desk 24×7 for amendments, no-shows, or property
                      escalations.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reviews */}
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Guest reviews</p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-14 w-14 place-items-center rounded-md bg-success-soft text-success">
                    <span className="font-mono text-2xl font-bold tabular-nums">
                      {h.reviewScore.toFixed(1)}
                    </span>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink-1">
                      {scoreLabel(h.reviewScore)}
                    </p>
                    <p className="text-xs text-ink-3">
                      Based on {h.reviewCount.toLocaleString('en-IN')} verified guest reviews
                    </p>
                  </div>
                </div>
                <p className="ml-auto max-w-md text-xs text-ink-3">
                  Individual review text comes from the connected supplier — surfaced inline once
                  the Hotelbeds / Travelport adapter ships.
                </p>
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
                  <p className="eyebrow text-ink-3">From</p>
                  <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">
                    {formatRupees(h.perNightPaise / 100)}
                  </p>
                  <p className="text-xs text-ink-3">per night</p>
                </div>
                <div className="rounded-md border bg-surface-2/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-ink-3">
                      <CalendarIcon className="h-3 w-3" /> Check-in
                    </span>
                    <span className="font-mono font-semibold text-ink-1">
                      {formatDateShort(checkIn)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-ink-3">
                      <CalendarIcon className="h-3 w-3" /> Check-out
                    </span>
                    <span className="font-mono font-semibold text-ink-1">
                      {formatDateShort(checkOut)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-ink-3">
                      <UsersIcon className="h-3 w-3" /> Stay
                    </span>
                    <span className="font-mono font-semibold text-ink-1">
                      {nights} {nights === 1 ? 'night' : 'nights'} · {rooms}{' '}
                      {rooms === 1 ? 'rm' : 'rms'} · {guests}{' '}
                      {guests === 1 ? 'gst' : 'gsts'}
                    </span>
                  </div>
                </div>
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink-2">Total</span>
                    <span className="font-mono text-xl font-bold tabular-nums text-ink-1">
                      {formatRupees(h.totalPaise / 100)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    Includes taxes &amp; fees · {h.inclusion}
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
            <p className="text-[10px] uppercase tracking-wider text-ink-3">From</p>
            <p className="font-mono text-lg font-bold tabular-nums text-ink-1">
              {formatRupees(h.perNightPaise / 100)}
              <span className="ml-1 text-[10px] font-medium text-ink-3">/ night</span>
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

function scoreLabel(score: number): string {
  if (score >= 9) return 'Exceptional';
  if (score >= 8) return 'Excellent';
  if (score >= 7) return 'Very good';
  if (score >= 6) return 'Good';
  return 'Average';
}

function AmenityIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const className = 'h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300';
  if (lower.includes('wifi') || lower.includes('internet'))
    return <Wifi className={className} strokeWidth={1.75} />;
  if (lower.includes('breakfast') || lower.includes('restaurant') || lower.includes('food'))
    return <Utensils className={className} strokeWidth={1.75} />;
  if (lower.includes('ac') || lower.includes('air'))
    return <Wind className={className} strokeWidth={1.75} />;
  return <CheckCircle2 className={className} strokeWidth={1.75} />;
}
