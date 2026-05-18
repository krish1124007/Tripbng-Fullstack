'use client';

// /visa/countries/[id] — slug-based country page that surfaces admin-authored
// "Curated visa products" up top, plus generic supporting content (visa-type
// hint, common documents, how-it-works, FAQs) below — mirroring the existing
// ISO-2-keyed /visa/[country] page so customers landing here from an admin
// link still get a complete browse experience.

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  Loader2,
  Phone,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import type { AdminVisaProductSummary } from '@tripbng/shared';
import { Badge, Button, Card, CardContent, EmptyState } from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { COMMON_TOURIST_DOCS, COUNTRIES } from '@/components/visa/utils';

interface CountryResponse {
  countryId: string;
  products: AdminVisaProductSummary[];
}

export default function VisaCountryCuratedPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const countryId = (params?.id ?? '').toLowerCase();

  const data = useApiQuery<CountryResponse>(
    ['visa-country', countryId],
    `/api/v1/visa/countries/${countryId}`,
  );

  // Best-effort match into the static COUNTRIES list (which is keyed by ISO-2)
  // so we can surface flag + region + TAT hint when the slug aligns.
  const staticMeta = useMemo(() => {
    const products = data.data?.products ?? [];
    const iso2 = products[0]?.countryIso2?.toUpperCase();
    if (iso2) return COUNTRIES.find((c) => c.value === iso2);
    return COUNTRIES.find((c) => c.label.toLowerCase().replace(/\s+/g, '-') === countryId);
  }, [data.data, countryId]);

  const products = data.data?.products ?? [];
  const countryName = products[0]?.countryName ?? staticMeta?.label ?? countryId;
  const flag = staticMeta?.flag ?? '🛂';

  if (data.isLoading) {
    return (
      <div className="grid h-72 place-items-center text-ink-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          Loading country…
        </div>
      </div>
    );
  }

  if (data.error) {
    const code = data.error instanceof ApiCallError ? data.error.message : 'Failed to load';
    return (
      <EmptyState
        icon={StickyNote}
        title="Country not found"
        description={code}
        action={
          <Button variant="secondary" onClick={() => router.push('/visa')}>
            <ArrowLeft className="h-4 w-4" /> Back to visa
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Back nav */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push('/visa')}
        className="-ml-2 text-ink-3 hover:text-ink-1"
      >
        <ArrowLeft className="h-4 w-4" /> All visa countries
      </Button>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-brand-50 to-accent-50 p-6 dark:from-brand-500/15 dark:to-accent-500/15 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              Visa policy
            </p>
            <h1 className="mt-1 inline-flex items-center gap-3 text-3xl font-bold tracking-tight text-ink-1 md:text-4xl">
              <span className="text-4xl">{flag}</span>
              {countryName}
            </h1>
            {staticMeta?.blurb ? (
              <p className="mt-2 max-w-2xl text-sm text-ink-2">{staticMeta.blurb}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="text-xs">
              {products.length} curated product{products.length === 1 ? '' : 's'}
            </Badge>
            {staticMeta?.tat ? (
              <Badge variant="outline" className="bg-surface-1/80">
                <Clock className="h-3 w-3" /> Typical TAT {staticMeta.tat}
              </Badge>
            ) : null}
          </div>
        </div>
      </section>

      {/* Curated products from admin */}
      <section className="space-y-3 scroll-mt-24" id="curated-products">
        <header>
          <h2 className="text-lg font-bold text-ink-1">Curated visa products</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Admin-authored visa products for {countryName}. Each card opens the rich detail page
            with documents, process steps, and a live quote.
          </p>
        </header>
        {products.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No curated products yet"
            description={`Admin-authored visa products for ${countryName} appear here once published. Use the legacy quote form below for now.`}
            action={
              <Button
                variant="secondary"
                onClick={() => router.push(`/visa/quote?country=${countryId}&visaType=tourist`)}
              >
                Get a quote
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>

      {/* Legacy supporting content */}
      <section className="space-y-3 scroll-mt-24" id="how-we-file">
        <header>
          <h2 className="text-lg font-bold text-ink-1">How TripBng files your visa</h2>
        </header>
        <Card>
          <CardContent className="p-5">
            <ol className="relative space-y-3 border-l-2 border-dashed border-stroke-1 pl-5">
              <Step
                n={1}
                title="Pick a curated product or quote a custom request"
                body="Curated products carry pre-filled documents, fees, and SLAs. Custom requests go through our trade desk."
              />
              <Step
                n={2}
                title="Upload documents"
                body="Add to itinerary, then upload each applicant's documents inside the cart."
              />
              <Step
                n={3}
                title="We file with the mission"
                body="Our trade desk lodges the application within 24 hours and sends a tracking link per applicant."
              />
              <Step
                n={4}
                title="Status updates + outcome"
                body="In-app status updates at each milestone. Auto-refund on rejection (govt fee minus DR)."
              />
            </ol>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3 scroll-mt-24" id="common-documents">
        <header>
          <h2 className="text-lg font-bold text-ink-1">Common documents (typical tourist visa)</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Generic checklist surfaced for browse-time orientation. Each curated product carries
            its own exact list under the Documents tab.
          </p>
        </header>
        <Card>
          <CardContent className="p-5">
            <ul className="grid gap-2 sm:grid-cols-2">
              {COMMON_TOURIST_DOCS.map((d) => (
                <li key={d} className="flex items-start gap-2 text-sm text-ink-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-3">
              <Info className="mt-0.5 h-3 w-3 shrink-0" /> Country-specific extras (e.g. yellow-fever
              cert, sponsor letter) appear on the curated product's detail page.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3 scroll-mt-24" id="faq">
        <header>
          <h2 className="text-lg font-bold text-ink-1">FAQs</h2>
        </header>
        <Card>
          <CardContent className="space-y-2 p-5">
            <Faq
              q="What if a curated product doesn't match my customer?"
              a="Use the legacy quote form via /visa with the same country selected — it routes to the trade desk for a custom quote."
            />
            <Faq
              q="Is the TAT guaranteed?"
              a={`The TAT shown on each curated product is the supplier-published norm. Embassy holidays, document gaps, and verification calls can extend it — we surface delays via in-app status updates.`}
            />
            <Faq
              q="What happens if the visa is rejected?"
              a="The government fee minus a documentation-recovery (DR) charge is auto-refunded to the agency wallet. The TripBng service fee is non-refundable on rejection."
            />
          </CardContent>
        </Card>
      </section>

      <Card className="border-brand-200 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/10">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Phone className="h-4 w-4 text-brand-600 dark:text-brand-300" />
          <p className="text-xs text-ink-2">
            <span className="font-semibold text-ink-1">Need help filing?</span> The TripBng visa
            desk is reachable 24×7 via the topbar notifications icon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductCard({ p }: { p: AdminVisaProductSummary }) {
  const totalBase = p.consulateFeeInr + p.serviceFeeInr;
  return (
    <Card className="overflow-hidden p-0 transition-colors hover:border-brand-300">
      {p.bannerImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.bannerImage}
          alt={p.name}
          className="h-32 w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="h-32 w-full bg-gradient-to-br from-brand-100 to-accent-100 dark:from-brand-500/20 dark:to-accent-500/20" />
      )}
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="brand" className="text-[9px] capitalize">
            {p.purpose}
          </Badge>
          <Badge variant="outline" className="text-[9px]">
            {p.processingMode}
          </Badge>
          <Badge variant="outline" className="text-[9px] capitalize">
            {p.entryType}-entry
          </Badge>
          {p.urgentAvailable ? (
            <Badge variant="warning" className="text-[9px]">
              Urgent
            </Badge>
          ) : null}
        </div>
        <p className="text-sm font-bold text-ink-1">{p.name}</p>
        <p className="font-mono text-[11px] text-ink-3">
          {p.processingDays}d processing · TAT shown on detail
        </p>
        <div className="mt-1 flex items-end justify-between gap-2 border-t pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-3">Base · per pax</p>
            <p className="font-mono text-base font-bold tabular-nums text-ink-1">
              ₹{totalBase.toLocaleString('en-IN')}
            </p>
          </div>
          <Button
            asChild
            variant="secondary"
            size="sm"
          >
            <a href={`/visa/products/${p.id}`}>
              Open <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="relative">
      <span className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full bg-brand-100 font-mono text-[10px] font-bold text-brand-700 ring-4 ring-surface-1 dark:bg-brand-500/20 dark:text-brand-300">
        {n}
      </span>
      <p className="text-sm font-semibold text-ink-1">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{body}</p>
    </li>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-md border bg-surface-2/40 p-3">
      <summary className="flex cursor-pointer list-none items-start gap-2 text-sm font-semibold text-ink-1">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        <span className="flex-1">{q}</span>
        <span className="text-xs text-ink-4 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <p className="mt-2 pl-6 text-xs leading-relaxed text-ink-3">{a}</p>
    </details>
  );
}
