'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronDown, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import type { VisaQuote } from '@tripbng/shared';
import { Badge, Button, EmptyState } from '@/components/ui';
import { QuoteView } from '@/components/visa/quote-view';
import {
  VisaSearchForm,
  type VisaSearchFormValues,
} from '@/components/visa/visa-search-form';
import { VisaSearchAnimation } from '@/components/visa/visa-search-animation';
import { COUNTRIES, type VisaType } from '@/components/visa/utils';
import { useApiMutation } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { useCart } from '@/lib/cart';

/**
 * /visa/quote — URL-driven visa quote page. Reads country / visa type /
 * applicants / travel date from the URL, fires the API on mount + on every
 * URL change, and renders the QuoteView (fee breakdown, docs, applicants,
 * submit CTA).
 */
export default function VisaQuotePage() {
  return (
    <Suspense fallback={<VisaSearchAnimation />}>
      <VisaQuoteInner />
    </Suspense>
  );
}

function VisaQuoteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const addToCart = useCart((s) => s.addItem);
  const [quote, setQuote] = useState<VisaQuote | null>(null);
  const [docsChecked, setDocsChecked] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);

  const country = params.get('country')?.toUpperCase() ?? '';
  const visaType = (params.get('visaType') ?? 'tourist') as VisaType;
  const nationality = params.get('nationality') ?? 'IN';
  const travelDate = params.get('travelDate') ?? '';
  const applicants = params.get('applicants') ?? '1';

  const meta = COUNTRIES.find((c) => c.value === country);

  const search = useApiMutation<
    {
      country: string;
      visaType: string;
      travelDate: string;
      applicants: number;
    },
    VisaQuote
  >('/api/v1/visa/quote', 'POST', {
    onSuccess: (data) => {
      setQuote(data);
      setDocsChecked(new Set());
    },
    onError: (err) =>
      toast.error(err instanceof ApiCallError ? err.message : 'Visa quote failed'),
  });

  // Auto-fire on URL signature change.
  const lastSig = useRef<string>('');
  useEffect(() => {
    if (!country || !travelDate) return;
    const sig = `${country}|${visaType}|${travelDate}|${applicants}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    search.mutate({
      country,
      visaType,
      travelDate,
      applicants: parseInt(applicants, 10) || 1,
    });
  }, [country, visaType, travelDate, applicants, search]);

  const toggleDoc = (doc: string) => {
    setDocsChecked((prev) => {
      const next = new Set(prev);
      if (next.has(doc)) next.delete(doc);
      else next.add(doc);
      return next;
    });
  };

  const onSubmit = () => {
    if (!quote) return;
    addToCart({
      id: `visa:${country}:${visaType}:${applicants}`,
      kind: 'visa',
      title: `${quote.flag} ${quote.countryName} · ${quote.visaKind}`,
      subtitle: `${visaType} visa · ${quote.applicants} applicant${quote.applicants > 1 ? 's' : ''} · TAT ${quote.processingDays}`,
      datePrimary: travelDate,
      priceRupees: quote.totalRupees,
      qty: quote.applicants,
      meta: {
        govtFee: quote.govtFeeRupees,
        serviceFee: quote.serviceFeeRupees,
        courierFee: quote.courierFeeRupees,
        validUntil: quote.validUntil,
      },
    });
    toast.success('Visa application added to your itinerary', {
      description: 'Open the cart in the topbar to review or generate a quote.',
    });
  };

  const onModify = (v: VisaSearchFormValues) => {
    router.replace(
      `/visa/quote?country=${v.country}&visaType=${v.visaType}` +
        `&nationality=${v.nationality}&travelDate=${v.travelDate}&applicants=${v.applicants}`,
    );
    setShowForm(false);
  };

  if (!country || !travelDate) {
    return (
      <EmptyState
        icon={StickyNote}
        title="No quote to show"
        description="Start a visa quote from the visa landing page."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/visa')}>
            Go to visa
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Sticky summary header */}
      <div className="sticky top-0 z-20 -mx-4 border-b bg-surface-1/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/visa')}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> Search
          </Button>

          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="inline-flex items-center gap-1.5 text-lg font-bold text-ink-1">
              <span className="text-xl">{meta?.flag ?? '🛂'}</span>
              {meta?.label ?? country}
            </p>
            <p className="text-xs capitalize text-ink-3">
              {visaType} · {applicants} applicant{Number(applicants) === 1 ? '' : 's'}
              {meta?.kind ? ` · ${meta.kind}` : ''}
            </p>
          </div>

          {meta ? (
            <Badge variant="accent" className="hidden sm:inline-flex">
              TAT: {meta.tat}
            </Badge>
          ) : null}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm((v) => !v)}
            className="ml-auto"
          >
            {showForm ? 'Hide' : 'Modify'} search
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showForm ? 'rotate-180' : ''}`}
            />
          </Button>
        </div>

        {showForm ? (
          <div className="mt-3 animate-slide-down">
            <VisaSearchForm
              variant="compact"
              loading={search.isPending}
              ctaLabel="Re-quote"
              initial={{ country, visaType, nationality, travelDate, applicants }}
              onSubmit={onModify}
            />
          </div>
        ) : null}
      </div>

      {search.isPending && !quote ? (
        <VisaSearchAnimation countryFlag={meta?.flag} countryName={meta?.label} />
      ) : !quote ? (
        <EmptyState
          icon={StickyNote}
          title="Loading…"
          description="Hang on while we calculate the quote."
        />
      ) : (
        <QuoteView
          quote={quote}
          visaType={visaType}
          travelDate={travelDate}
          docsChecked={docsChecked}
          toggleDoc={toggleDoc}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}
