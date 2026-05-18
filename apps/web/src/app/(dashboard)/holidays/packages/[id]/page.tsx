'use client';

// Customer-facing detail page for an admin-authored holiday package.
// Long-scroll layout: hero carousel → quick-facts strip → sticky section nav
// → a series of detail sections → sticky right rail with the live quote and
// add-to-itinerary CTA.

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, TreePalm } from 'lucide-react';
import type { AdminHolidayPackage } from '@tripbng/shared';
import { Button, EmptyState } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { SectionNav, type SectionNavItem } from '@/components/holidays-detail/section-nav';
import { BookingRail } from '@/components/holidays-detail/booking-rail';
import {
  BestPriceMonthsSection,
  CancellationSection,
  CompareTiers,
  DayByDay,
  FAQ,
  FlightsSection,
  Hero,
  Highlights,
  ImportantNotes,
  InclusionsExclusions,
  QuickFacts,
  SightseeingSection,
  WhereYouStay,
} from '@/components/holidays-detail/sections';

export default function HolidayPackageDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const detail = useApiQuery<AdminHolidayPackage>(
    ['holiday-package', id],
    `/api/v1/holidays/packages/${id}`,
  );

  // Compute which anchor sections actually have content — sticky nav only
  // surfaces sections the customer can scroll to.
  const navItems = useMemo<SectionNavItem[]>(() => {
    const pkg = detail.data;
    if (!pkg) return [];
    const items: SectionNavItem[] = [{ id: 'highlights', label: 'Highlights' }];
    if (pkg.dayWise.length > 0) items.push({ id: 'day-by-day', label: 'Day by day' });
    if (Object.values(pkg.hotelsPerCity).flat().length > 0)
      items.push({ id: 'where-you-stay', label: 'Where you stay' });
    if (Object.values(pkg.sightseeingPerCity).flat().length > 0)
      items.push({ id: 'experiences', label: 'Experiences' });
    if (pkg.flights.length > 0) items.push({ id: 'flights', label: 'Flights' });
    if (pkg.inclusions.length > 0 || pkg.exclusions.length > 0)
      items.push({ id: 'whats-included', label: "What's included" });
    if (pkg.priceMatrix.length > 0) {
      items.push({ id: 'compare-tiers', label: 'Compare tiers' });
      items.push({ id: 'best-price-months', label: 'Best price months' });
    }
    if (pkg.cancellationSchedule.length > 0 || pkg.cancellationPolicyText.length > 0)
      items.push({ id: 'cancellation', label: 'Cancellation' });
    if (pkg.specialNotes.length > 0)
      items.push({ id: 'important-notes', label: 'Important notes' });
    items.push({ id: 'faq', label: 'FAQ' });
    return items;
  }, [detail.data]);

  if (detail.isLoading) {
    return (
      <div className="grid h-72 place-items-center text-ink-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading package…
        </div>
      </div>
    );
  }

  if (detail.error) {
    const code = detail.error instanceof ApiCallError ? detail.error.message : 'Failed to load';
    return (
      <EmptyState
        icon={TreePalm}
        title="Package not found"
        description={code}
        action={
          <Button variant="secondary" onClick={() => router.push('/holidays')}>
            <ArrowLeft className="h-4 w-4" /> Back to holidays
          </Button>
        }
      />
    );
  }

  const pkg = detail.data;
  if (!pkg) return null;

  return (
    <div className="space-y-6 pb-12">
      <Hero pkg={pkg} />
      <QuickFacts pkg={pkg} />
      <SectionNav items={navItems} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Long-scroll body */}
        <div className="space-y-8">
          <Highlights pkg={pkg} />
          <DayByDay days={pkg.dayWise} hotels={pkg.hotelsPerCity} />
          <WhereYouStay cities={pkg.cities} hotelsPerCity={pkg.hotelsPerCity} />
          <SightseeingSection cities={pkg.cities} sightseeingPerCity={pkg.sightseeingPerCity} />
          <FlightsSection flights={pkg.flights} />
          <InclusionsExclusions inclusions={pkg.inclusions} exclusions={pkg.exclusions} />
          <CompareTiers pkg={pkg} />
          <BestPriceMonthsSection pkg={pkg} />
          <CancellationSection
            schedule={pkg.cancellationSchedule}
            policyText={pkg.cancellationPolicyText}
          />
          <ImportantNotes notes={pkg.specialNotes} />
          <FAQ pkg={pkg} />
        </div>

        {/* Sticky right rail */}
        <aside className="hidden lg:block">
          <BookingRail pkg={pkg} />
        </aside>
      </div>

      {/* Mobile booking rail — drops in below the long-scroll instead of being sticky */}
      <div className="lg:hidden">
        <BookingRail pkg={pkg} />
      </div>
    </div>
  );
}
