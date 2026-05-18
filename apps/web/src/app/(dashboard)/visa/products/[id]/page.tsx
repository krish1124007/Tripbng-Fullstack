'use client';

// Customer-facing detail page for an admin-authored visa product.
// Long-scroll layout: hero → quick-facts → sticky section nav → eligibility →
// documents → process timeline → inclusions/exclusions → FAQ → cancellation →
// important notes, with a sticky right rail driving the live quote.

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, StickyNote } from 'lucide-react';
import type { AdminVisaProduct } from '@tripbng/shared';
import { Button, EmptyState } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { SectionNav, type SectionNavItem } from '@/components/holidays-detail/section-nav';
import { BookingRail } from '@/components/visa-detail/booking-rail';
import {
  CancellationSection,
  DocumentsChecklist,
  Eligibility,
  FAQ,
  Hero,
  ImportantNotes,
  InclusionsExclusions,
  ProcessTimeline,
  QuickFacts,
  Summary,
  TradeDeskStrip,
} from '@/components/visa-detail/sections';

export default function VisaProductDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const detail = useApiQuery<AdminVisaProduct>(
    ['visa-product', id],
    `/api/v1/visa/products/${id}`,
  );

  const navItems = useMemo<SectionNavItem[]>(() => {
    const p = detail.data;
    if (!p) return [];
    const items: SectionNavItem[] = [];
    if (p.summary) items.push({ id: 'summary', label: 'About' });
    items.push({ id: 'eligibility', label: 'Eligibility' });
    if (p.documents.length > 0) items.push({ id: 'documents', label: 'Documents' });
    if (p.processSteps.length > 0) items.push({ id: 'process', label: 'Process' });
    if (p.inclusions.length > 0 || p.exclusions.length > 0)
      items.push({ id: 'whats-included', label: "What's included" });
    if (p.faqs.length > 0) items.push({ id: 'faq', label: 'FAQ' });
    if (p.cancellationSchedule.length > 0 || p.cancellationPolicyText.length > 0)
      items.push({ id: 'cancellation', label: 'Cancellation' });
    if (p.specialNotes.length > 0) items.push({ id: 'important-notes', label: 'Important notes' });
    return items;
  }, [detail.data]);

  if (detail.isLoading) {
    return (
      <div className="grid h-72 place-items-center text-ink-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading product…
        </div>
      </div>
    );
  }

  if (detail.error) {
    const code = detail.error instanceof ApiCallError ? detail.error.message : 'Failed to load';
    return (
      <EmptyState
        icon={StickyNote}
        title="Visa product not found"
        description={code}
        action={
          <Button variant="secondary" onClick={() => router.push('/visa')}>
            <ArrowLeft className="h-4 w-4" /> Back to visa
          </Button>
        }
      />
    );
  }

  const product = detail.data;
  if (!product) return null;

  return (
    <div className="space-y-6 pb-12">
      <Hero product={product} />
      <QuickFacts product={product} />
      <SectionNav items={navItems} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Long-scroll body */}
        <div className="space-y-8">
          <Summary html={product.summary} />
          <Eligibility eligibility={product.eligibility} />
          <DocumentsChecklist documents={product.documents} />
          <ProcessTimeline steps={product.processSteps} />
          <InclusionsExclusions
            inclusions={product.inclusions}
            exclusions={product.exclusions}
          />
          <FAQ faqs={product.faqs} />
          <CancellationSection
            schedule={product.cancellationSchedule}
            policyText={product.cancellationPolicyText}
          />
          <ImportantNotes notes={product.specialNotes} />
          <TradeDeskStrip />
        </div>

        {/* Sticky right rail */}
        <aside className="hidden lg:block">
          <BookingRail product={product} />
        </aside>
      </div>

      {/* Mobile booking rail — drops in below the long-scroll instead of being sticky */}
      <div className="lg:hidden">
        <BookingRail product={product} />
      </div>
    </div>
  );
}
