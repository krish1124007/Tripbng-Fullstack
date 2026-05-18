'use client';

// Inline section components for the rich visa-product detail page.
// Read-only renderers each taking a slice of AdminVisaProduct. Kept in one
// file because they share imports and only render together on
// /visa/products/[id].

import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Fingerprint,
  Globe,
  HelpCircle,
  IdCard,
  Info,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Stamp,
  Users as UsersIcon,
  XCircle,
} from 'lucide-react';
import type {
  AdminVisaProduct,
  VisaApplicationState,
  VisaCancellationSlab,
  VisaEligibility,
  VisaFaq,
  VisaProcessStep,
  VisaProductDocument,
} from '@tripbng/shared';
import { Badge, Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/utils';

// ────────── Hero ──────────

export function Hero({ product }: { product: AdminVisaProduct }) {
  const images = useImages(product);
  const [active, setActive] = useState(0);
  const cover = images[active];
  const ratingScore = product.rating?.score;

  const next = () =>
    setActive((i) => (images.length === 0 ? 0 : (i + 1) % images.length));
  const prev = () =>
    setActive((i) =>
      images.length === 0 ? 0 : (i - 1 + images.length) % images.length,
    );

  return (
    <section className="relative -mx-4 overflow-hidden md:-mx-6">
      <div className="relative h-[260px] w-full bg-gradient-to-br from-brand-200 to-accent-200 md:h-[360px] dark:from-brand-500/30 dark:to-accent-500/30">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={product.name}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

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

        {ratingScore != null ? (
          <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-ink-1 shadow">
            <Star className="h-3 w-3 fill-accent-500 text-accent-500" strokeWidth={1.5} />
            <span className="font-mono tabular-nums">{ratingScore.toFixed(1)}</span>
            {product.rating?.count ? (
              <span className="text-[10px] text-ink-3">
                ({product.rating.count.toLocaleString('en-IN')})
              </span>
            ) : null}
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 px-6 pb-5 md:px-10">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand" className="capitalize">
              {product.purpose} visa
            </Badge>
            <Badge variant="outline" className="bg-white/80 text-ink-1">
              {product.processingMode}
            </Badge>
            <Badge variant="outline" className="bg-white/80 text-ink-1 capitalize">
              {product.entryType}-entry
            </Badge>
            {product.biometricRequired ? (
              <Badge variant="accent">
                <Fingerprint className="h-2.5 w-2.5" /> Biometric
              </Badge>
            ) : null}
            {product.urgentAvailable ? (
              <Badge variant="warning">
                <Sparkles className="h-2.5 w-2.5" /> Urgent available
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/80">
            <Globe className="h-3 w-3" /> {product.countryName} · {product.region}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white md:text-4xl">
            {product.name}
          </h1>
        </div>
      </div>

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

function useImages(product: AdminVisaProduct): string[] {
  const all: string[] = [];
  if (product.bannerImage) all.push(product.bannerImage);
  for (const g of product.gallery) if (!all.includes(g)) all.push(g);
  return all;
}

// ────────── Quick-facts strip ──────────

export function QuickFacts({ product }: { product: AdminVisaProduct }) {
  const items = [
    {
      icon: Clock,
      label: 'Processing',
      value: `${product.processingDays} day${product.processingDays === 1 ? '' : 's'}`,
    },
    {
      icon: ShieldCheck,
      label: 'Validity',
      value: `${product.validityDays} day${product.validityDays === 1 ? '' : 's'}`,
    },
    {
      icon: CalendarIcon,
      label: 'Stay',
      value: `${product.stayDays} day${product.stayDays === 1 ? '' : 's'}`,
    },
    {
      icon: Stamp,
      label: 'Entries',
      value: product.entryType === 'single' ? 'Single' : 'Multiple',
    },
    {
      icon: Fingerprint,
      label: 'Biometric',
      value: product.biometricRequired ? 'Required' : 'Not required',
    },
    {
      icon: Globe,
      label: 'Region',
      value: product.region,
    },
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

// ────────── Summary (HTML rich text) ──────────

export function Summary({ html }: { html: string }) {
  if (!html) return null;
  return (
    <Section id="summary" title="About this visa">
      <Card>
        <CardContent className="p-5">
          <div
            className="prose prose-sm max-w-none text-sm text-ink-2 dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </CardContent>
      </Card>
    </Section>
  );
}

// ────────── Eligibility ──────────

export function Eligibility({ eligibility }: { eligibility: VisaEligibility }) {
  const tiles = [
    {
      icon: Globe,
      label: 'Eligible nationalities',
      value:
        eligibility.eligibleNationalities.length === 0
          ? 'All nationalities'
          : eligibility.eligibleNationalities.join(', '),
    },
    {
      icon: UsersIcon,
      label: 'Age range',
      value:
        eligibility.minAgeYears == null && eligibility.maxAgeYears == null
          ? 'No age limit'
          : `${eligibility.minAgeYears ?? 0} – ${eligibility.maxAgeYears ?? '∞'} years`,
    },
    {
      icon: ShieldCheck,
      label: 'Prior visa',
      value: eligibility.requiresPriorVisa ? 'Required' : 'Not required',
    },
    {
      icon: Sparkles,
      label: 'Success note',
      value: eligibility.successNote ? 'See details below' : '—',
    },
  ];

  return (
    <Section id="eligibility" title="Eligibility">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="flex items-start gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <t.icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  {t.label}
                </p>
                <p className="break-words text-sm font-bold text-ink-1">{t.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {eligibility.successNote ? (
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow mb-2 text-ink-3">Editorial note</p>
            <div
              className="prose prose-sm max-w-none text-sm text-ink-2 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: eligibility.successNote }}
            />
          </CardContent>
        </Card>
      ) : null}
    </Section>
  );
}

// ────────── Documents checklist ──────────

export function DocumentsChecklist({ documents }: { documents: VisaProductDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <Section
      id="documents"
      title="Documents checklist"
      subtitle="What each applicant needs to upload before the application can be lodged."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {documents.map((d) => (
          <DocCard key={d.id ?? d.code} d={d} />
        ))}
      </div>
    </Section>
  );
}

function DocCard({ d }: { d: VisaProductDocument }) {
  const sizeMb = Math.round(d.maxSizeBytes / (1024 * 1024));
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <DocIcon code={d.code} />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-ink-1">{d.label}</p>
            <Badge
              variant={d.required ? 'success' : 'neutral'}
              className="text-[9px]"
            >
              {d.required ? 'Required' : 'Optional'}
            </Badge>
            <Badge variant="outline" className="text-[9px]">
              {d.perApplicant ? 'Per applicant' : 'One per booking'}
            </Badge>
          </div>
          {d.description ? (
            <div
              className="prose prose-sm max-w-none text-xs text-ink-3 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: d.description }}
            />
          ) : null}
          {d.photoSpec ? (
            <p className="rounded-md border bg-surface-2/40 p-2 text-[11px] text-ink-3">
              <span className="font-semibold text-ink-2">Photo spec:</span>{' '}
              {[
                d.photoSpec.widthPx && d.photoSpec.heightPx
                  ? `${d.photoSpec.widthPx}×${d.photoSpec.heightPx} px`
                  : null,
                d.photoSpec.background ? `${d.photoSpec.background} background` : null,
                d.photoSpec.notes,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-3">
            <span className="font-mono uppercase">{d.formats.join(' · ')}</span>
            <span className="text-ink-4">·</span>
            <span>≤ {sizeMb} MB</span>
            <span className="text-ink-4">·</span>
            <span>
              {d.applicantTypes
                .map((t) => (t === 'ADT' ? 'Adult' : t === 'CHD' ? 'Child' : 'Infant'))
                .join(' · ')}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DocIcon({ code }: { code: string }) {
  const k = code.toLowerCase();
  const className = 'h-4 w-4';
  if (k.includes('passport') || k.includes('photo') || k.includes('id'))
    return <IdCard className={className} strokeWidth={1.75} />;
  return <FileText className={className} strokeWidth={1.75} />;
}

// ────────── Process steps timeline ──────────

export function ProcessTimeline({ steps }: { steps: VisaProcessStep[] }) {
  if (steps.length === 0) return null;
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  return (
    <Section id="process" title="How it works">
      <ol className="relative space-y-4 border-l-2 border-dashed border-stroke-1 pl-6 md:pl-8">
        {sorted.map((s, i) => (
          <li key={s.id ?? i} className="relative">
            <span
              className={cn(
                'absolute -left-[33px] top-0 grid h-7 w-7 place-items-center rounded-full font-mono text-[10px] font-bold ring-4 ring-surface-0 md:-left-[37px]',
                i === 0
                  ? 'bg-brand-500 text-white'
                  : i === sorted.length - 1
                    ? 'bg-accent-500 text-white'
                    : 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
              )}
            >
              {s.order}
            </span>
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-ink-1">{s.title}</h3>
                  {s.estimatedDays != null ? (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      ~{s.estimatedDays} day{s.estimatedDays === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                </div>
                {s.descriptionHtml ? (
                  <div
                    className="prose prose-sm max-w-none text-xs leading-relaxed text-ink-2 dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: s.descriptionHtml }}
                  />
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
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

// ────────── FAQ ──────────

export function FAQ({ faqs }: { faqs: VisaFaq[] }) {
  if (faqs.length === 0) return null;
  return (
    <Section id="faq" title="Frequently asked">
      <div className="space-y-2">
        {faqs.map((f) => (
          <details
            key={f.id ?? f.question}
            className="group rounded-md border bg-surface-1 p-4 transition-colors open:bg-surface-2/30"
          >
            <summary className="flex cursor-pointer list-none items-start gap-2 text-sm font-semibold text-ink-1">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" strokeWidth={1.75} />
              <span className="flex-1">{f.question}</span>
              <ChevronDown className="mt-0.5 h-4 w-4 text-ink-4 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 whitespace-pre-line pl-6 text-xs leading-relaxed text-ink-3">
              {f.answer}
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}

// ────────── Cancellation ──────────

export function CancellationSection({
  schedule,
  policyText,
}: {
  schedule: VisaCancellationSlab[];
  policyText: string[];
}) {
  if (schedule.length === 0 && policyText.length === 0) return null;
  return (
    <Section id="cancellation" title="Cancellation policy">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        {schedule.length > 0 ? (
          <Card className="overflow-hidden p-0">
            <div className="border-b bg-surface-2/40 px-4 py-2">
              <p className="eyebrow text-ink-3">Stage-based slabs</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface-2/30 text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Application stage</th>
                  <th className="px-4 py-2 text-right font-semibold">Charge</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-4 py-2.5 text-ink-1 capitalize">
                      {stageLabel(s.stage)}
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

function stageLabel(s: VisaApplicationState): string {
  return s.replace(/_/g, ' ');
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

// ────────── Contact strip (always rendered) ──────────

export function TradeDeskStrip() {
  return (
    <Card className="border-brand-200 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/10">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <Phone className="h-4 w-4 text-brand-600 dark:text-brand-300" />
        <p className="text-xs text-ink-2">
          <span className="font-semibold text-ink-1">Need help filing?</span> The TripBng visa
          desk is reachable 24×7 via the topbar notifications icon.
        </p>
      </CardContent>
    </Card>
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
