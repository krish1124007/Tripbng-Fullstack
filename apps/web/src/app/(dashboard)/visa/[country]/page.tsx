'use client';

import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Globe,
  HelpCircle,
  Info,
  Phone,
  ShieldCheck,
  StickyNote,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, EmptyState } from '@/components/ui';
import {
  COMMON_TOURIST_DOCS,
  COUNTRIES,
  VISA_TYPES,
  todayPlus,
  visaKindBadgeTone,
  type VisaType,
} from '@/components/visa/utils';

/**
 * /visa/[country] — country information page (no API call, reads from the
 * static COUNTRIES list under components/visa/utils.ts). Lets agents browse
 * visa policy by destination before pulling a live quote.
 *
 * Param shape: ISO-2 country code, case-insensitive ("AE", "th", "Sg").
 */
export default function VisaCountryPage() {
  const router = useRouter();
  const params = useParams<{ country: string }>();
  const code = (params?.country ?? '').toUpperCase();
  const meta = COUNTRIES.find((c) => c.value === code);

  if (!meta) {
    return (
      <EmptyState
        icon={StickyNote}
        title="Country not found"
        description="We don't have a curated visa policy page for that country yet — request a quote and we'll surface it."
        action={
          <Button variant="secondary" size="sm" onClick={() => router.push('/visa')}>
            <ArrowLeft className="h-4 w-4" /> Back to visa
          </Button>
        }
      />
    );
  }

  const goQuote = (visaType: VisaType = 'tourist') =>
    router.push(
      `/visa/quote?country=${meta.value}&visaType=${visaType}` +
        `&nationality=IN&travelDate=${todayPlus(21)}&applicants=1`,
    );

  const types: VisaType[] = meta.typesAvailable ?? ['tourist'];

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      {/* Back nav */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="-ml-2 text-ink-3 hover:text-ink-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-brand-50 to-accent-50 p-6 dark:from-brand-500/15 dark:to-accent-500/15 md:p-8">
        <div className="relative z-10 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={visaKindBadgeTone(meta.kind)}>
              <FileText className="h-2.5 w-2.5" /> {meta.kind}
            </Badge>
            <Badge variant="outline" className="bg-surface-1/80">
              <Clock className="h-2.5 w-2.5" /> TAT {meta.tat}
            </Badge>
            {meta.fromFare ? (
              <Badge variant="outline" className="bg-surface-1/80">
                from {meta.fromFare}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                Visa policy
              </p>
              <h1 className="mt-1 inline-flex items-center gap-3 text-3xl font-bold tracking-tight text-ink-1 md:text-4xl">
                <span className="text-4xl">{meta.flag}</span>
                {meta.label}
              </h1>
              {meta.blurb ? (
                <p className="mt-2 max-w-2xl text-sm text-ink-2">{meta.blurb}</p>
              ) : null}
            </div>
            <Button onClick={() => goQuote('tourist')} size="lg" className="shadow-brand">
              Get exact quote <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Quick facts strip */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Fact icon={FileText} label="Visa kind" value={meta.kind} />
        <Fact icon={Clock} label="Processing" value={meta.tat} />
        <Fact
          icon={Globe}
          label="From India · pricing"
          value={meta.fromFare ?? 'On request'}
          sub="indicative — confirms on quote"
        />
      </section>

      {/* Two-column layout */}
      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Visa types available */}
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Visa types you can file</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {types.map((t) => {
                  const label = VISA_TYPES.find((vt) => vt.value === t)?.label ?? t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => goQuote(t)}
                      className="group flex items-center justify-between rounded-md border bg-surface-2/30 p-4 text-left transition-all duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink-1">{label} visa</p>
                        <p className="mt-0.5 text-xs text-ink-3">
                          Quote, file, and track via TripBng
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-ink-4 transition-all duration-fast group-hover:translate-x-0.5 group-hover:text-brand-600" />
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Common documents */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow text-ink-3">Common documents</p>
                <ClipboardCheck className="h-4 w-4 text-ink-3" />
              </div>
              <p className="mt-1 text-xs text-ink-3">
                Typical document set for a tourist visa from India to {meta.label}. Exact requirements
                are surfaced on the quote page.
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {COMMON_TOURIST_DOCS.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-sm text-ink-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-3">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> Country-specific extras (e.g. yellow-fever
                cert, sponsor letter) appear on the quote view once you submit a search.
              </p>
            </CardContent>
          </Card>

          {/* How it works */}
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">How TripBng files your visa</p>
              <ol className="relative space-y-3 border-l-2 border-dashed border-stroke-1 pl-5">
                <Step n={1} title="Get a quote" body="Submit destination, visa type, and applicant count to see fees, TAT, and the document checklist." />
                <Step n={2} title="Upload documents" body="Add to itinerary, then upload each applicant's documents inside the cart." />
                <Step n={3} title="We file with the mission" body="Our trade desk lodges the application within 24 hours and sends a tracking link per applicant." />
                <Step n={4} title="Status updates + outcome" body="Get in-app status updates at each milestone. Auto-refund on rejection (govt fee minus DR)." />
              </ol>
            </CardContent>
          </Card>

          {/* FAQs (generic) */}
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="eyebrow text-ink-3">FAQs</p>
              <Faq
                q="Is the timeline guaranteed?"
                a={`The TAT shown (${meta.tat}) is the supplier-published norm. Embassy holidays, document gaps, and verification calls can extend it — we surface delays via in-app status updates.`}
              />
              <Faq
                q="What happens if the visa is rejected?"
                a="The government fee minus a documentation-recovery (DR) charge is auto-refunded to the agency wallet. The TripBng service fee is non-refundable on rejection."
              />
              <Faq
                q="Can I file for multiple applicants in one go?"
                a="Yes — pick the applicant count on the quote form. Documents are uploaded per applicant inside the cart, and our team files them together where the mission allows."
              />
            </CardContent>
          </Card>
        </div>

        {/* Sticky right sidebar — desktop */}
        <aside className="hidden md:block">
          <div className="sticky top-4 space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5">
                <div>
                  <p className="eyebrow text-ink-3">Get exact quote</p>
                  <p className="mt-1 text-2xl font-bold text-ink-1">
                    {meta.fromFare ?? 'On request'}
                  </p>
                  <p className="text-xs text-ink-3">indicative starting fare</p>
                </div>
                <div className="rounded-md border bg-surface-2/40 p-3 text-xs">
                  <Row icon={<FileText className="h-3 w-3" />} label="Type">
                    {meta.kind}
                  </Row>
                  <Row icon={<Clock className="h-3 w-3" />} label="TAT">
                    {meta.tat}
                  </Row>
                  <Row icon={<CalendarIcon className="h-3 w-3" />} label="Travel">
                    Within 90 days, typically
                  </Row>
                </div>
                <Button onClick={() => goQuote('tourist')} className="w-full">
                  Quote tourist visa <ArrowRight className="h-4 w-4" />
                </Button>
                <p className="flex items-center justify-center gap-1 text-[10px] text-ink-3">
                  <ShieldCheck className="h-3 w-3 text-success" /> Auto-refund on rejection
                </p>
                <div className="border-t pt-3">
                  <p className="flex items-start gap-2 text-[11px] text-ink-3">
                    <Phone className="mt-0.5 h-3 w-3 shrink-0" />
                    Need help filing? The TripBng visa desk is reachable 24×7 via the topbar
                    notifications icon.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>

      {/* Mobile sticky bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-surface-1 px-4 py-3 shadow-lg md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-3">Get exact quote</p>
            <p className="text-base font-bold text-ink-1">
              {meta.fromFare ?? 'On request'}
            </p>
          </div>
          <Button onClick={() => goQuote('tourist')} size="lg" className="flex-1">
            Get quote
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
          <p className="text-sm font-bold text-ink-1">{value}</p>
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
      <summary className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-ink-1 list-none">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        <span className="flex-1">{q}</span>
        <span className="text-xs text-ink-4 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <p className="mt-2 pl-6 text-xs leading-relaxed text-ink-3">{a}</p>
    </details>
  );
}
