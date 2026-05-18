'use client';

import {
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock,
  type LucideIcon,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type { VisaQuote } from '@tripbng/shared';
import { Badge, Button, Card, CardContent, Separator } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';

interface QuoteViewProps {
  quote: VisaQuote;
  visaType: string;
  travelDate: string;
  docsChecked: Set<string>;
  toggleDoc: (doc: string) => void;
  onSubmit: () => void;
}

/**
 * Visa-quote view — fee breakdown, document checklist, applicants summary,
 * and the submit CTA. Extracted from the legacy single-file `/visa/page.tsx`
 * so it can be reused on `/visa/quote` (and any future preview surface).
 */
export function QuoteView({
  quote,
  visaType,
  travelDate,
  docsChecked,
  toggleDoc,
  onSubmit,
}: QuoteViewProps) {
  const completionPct = (docsChecked.size / Math.max(1, quote.documents.length)) * 100;
  const daysToTravel = Math.max(
    0,
    Math.round((new Date(travelDate).getTime() - Date.now()) / (24 * 3600 * 1000)),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      {/* Left column — main quote details */}
      <div className="space-y-5">
        <Card tone="brand" elevation="raised" className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-500/10"
          />
          <CardContent className="relative p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-3xl">{quote.flag}</span>
                  <p className="eyebrow text-brand-700 dark:text-brand-300">
                    Visa quote · {visaType}
                  </p>
                </div>
                <h2 className="mt-2 text-h2 text-ink-1">{quote.countryName}</h2>
                <p className="mt-1 text-sm text-ink-3">{quote.visaKind}</p>
              </div>
              <div className="text-right">
                <p className="eyebrow text-ink-3">Total payable</p>
                <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">
                  {formatRupees(quote.totalRupees)}
                </p>
                <p className="font-mono text-[10px] text-ink-3">
                  for {quote.applicants} applicant{quote.applicants > 1 ? 's' : ''}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <KeyStat label="Processing" value={quote.processingDays} icon={Clock} />
              <KeyStat label="Travel in" value={`${daysToTravel}d`} icon={CalendarIcon} />
              <KeyStat label="Validity" value="90 days" icon={ClipboardCheck} />
            </div>
          </CardContent>
        </Card>

        {/* Fee breakdown */}
        <Card>
          <CardContent className="p-6">
            <p className="eyebrow text-ink-3">Fee breakdown</p>
            <ul className="mt-4 space-y-2.5">
              <FeeRow
                label="Government fee"
                sub={`${formatRupees(quote.govtFeeRupees / Math.max(1, quote.applicants))} × ${quote.applicants}`}
                amount={quote.govtFeeRupees}
              />
              <FeeRow
                label="TripBng service fee"
                sub="Application processing, follow-ups, callbacks"
                amount={quote.serviceFeeRupees}
              />
              <FeeRow
                label="Courier"
                sub="Doorstep pickup + return delivery"
                amount={quote.courierFeeRupees}
              />
            </ul>
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-1">Grand total</span>
              <span className="font-mono text-xl font-bold tabular-nums text-ink-1">
                {formatRupees(quote.totalRupees)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">
              GST 18% applies on the service fee. Government fees are pass-through, no GST.
            </p>
          </CardContent>
        </Card>

        {/* Document checklist */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow text-ink-3">Documents to upload</p>
                <h3 className="mt-1 text-h3 text-ink-1">
                  {docsChecked.size} of {quote.documents.length} ready
                </h3>
              </div>
              <Badge variant={completionPct === 100 ? 'success' : 'warning'} dot>
                {Math.round(completionPct)}%
              </Badge>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-slow"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <ul className="mt-5 space-y-2">
              {quote.documents.map((d) => {
                const checked = docsChecked.has(d);
                return (
                  <li
                    key={d}
                    className={cn(
                      'flex items-center gap-3 rounded-md border p-3 transition-colors',
                      checked ? 'border-success/40 bg-success-soft/40' : 'bg-surface-1',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDoc(d)}
                      aria-label={checked ? `Mark ${d} as missing` : `Mark ${d} as ready`}
                    >
                      {checked ? (
                        <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} />
                      ) : (
                        <Circle className="h-5 w-5 text-ink-4" strokeWidth={1.5} />
                      )}
                    </button>
                    <span
                      className={cn(
                        'flex-1 text-sm',
                        checked ? 'text-ink-2 line-through' : 'text-ink-1',
                      )}
                    >
                      {d}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        toggleDoc(d);
                        toast.success('Document upload mocked', {
                          description:
                            'Real file upload + scan validation activates with the visa partner.',
                        });
                      }}
                    >
                      <Upload className="h-3.5 w-3.5" /> Upload
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Right column — applicants summary + submit CTA */}
      <div className="space-y-5">
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow text-ink-3">Applicants</p>
            <ul className="mt-3 space-y-2">
              {Array.from({ length: quote.applicants }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-md border bg-surface-1 p-3"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                    P{i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-1">Applicant {i + 1}</p>
                    <p className="font-mono text-[10px] text-ink-3">
                      Pending — open to fill details
                    </p>
                  </div>
                  <Button variant="ghost" size="sm">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card tone="brand">
          <CardContent className="p-5">
            <p className="eyebrow text-ink-3">When you submit</p>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-2">
              <ChecklistItem text={`We file with ${quote.countryName} mission within 24 hours`} />
              <ChecklistItem text="You get a tracking link per applicant" />
              <ChecklistItem text="In-app status updates at each milestone" />
              <ChecklistItem text="Auto-refund on rejection (govt fee minus DR)" />
            </ul>
            <Button onClick={onSubmit} size="lg" className="mt-5 w-full">
              Submit application <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="mt-2 text-center text-[10px] text-ink-3">
              Wallet debit of{' '}
              <span className="font-mono font-semibold">{formatRupees(quote.totalRupees)}</span> on
              submission.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KeyStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-md border bg-surface-1/70 p-3 backdrop-blur">
      <p className="eyebrow flex items-center gap-1.5 text-ink-3">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1 font-mono text-sm font-bold tabular-nums text-ink-1">{value}</p>
    </div>
  );
}

function FeeRow({ label, sub, amount }: { label: string; sub: string; amount: number }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-ink-1">{label}</p>
        <p className="text-[11px] text-ink-3">{sub}</p>
      </div>
      <span className="font-mono font-semibold tabular-nums text-ink-1">
        {formatRupees(amount)}
      </span>
    </li>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400"
        strokeWidth={2}
      />
      <span>{text}</span>
    </li>
  );
}
