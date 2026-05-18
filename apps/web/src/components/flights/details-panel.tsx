'use client';

// FlightDetailsPanel — the rich "View details" expansion that lives below
// each result card. Inspired by competitor B2B portals (eTrav, TBL,
// Akbar etc.) and built around the four sheets agents flip between
// before quoting a fare:
//
//   1. Flight Details      — segment-by-segment routing + layover meta
//   2. Fare Breakup        — per-pax base / taxes / total + commission
//   3. Fare Rules          — supplier-driven HTML rules (where available)
//   4. Baggage Information — per-pax check-in + cabin baggage by sector
//
// Design language:
//   • Sits flush against the bottom of the result card — same border, no
//     stray gap. The collapse boundary is a 1-px top border, not a
//     separate floating panel.
//   • The 4 tabs read as "sheets in a binder" — soft tab strip with a
//     2-px brand underline on the active tab.
//   • All numbers are tabular-nums so columns line up. All times are
//     mono. All codes (airport / fare basis / supplier) are mono.
//   • Each tab is a "facts table" not a marketing card. Maximum signal,
//     minimum chrome.

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  ClipboardCopy,
  Clock,
  FileText,
  Info,
  Loader2,
  Luggage,
  PlaneLanding,
  PlaneTakeoff,
  Receipt,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { AirlineLogo } from '@/components/airline-logo';
import { apiFetch, ApiCallError } from '@/lib/api';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { FlightResult } from './utils';
import { formatDuration, formatTime } from './utils';

// ────────── Public component ──────────

interface FlightDetailsPanelProps {
  r: FlightResult;
}

type TabKey = 'flight' | 'fare' | 'rules' | 'baggage';

export function FlightDetailsPanel({ r }: FlightDetailsPanelProps) {
  const [tab, setTab] = useState<TabKey>('flight');
  return (
    <div className="border-t bg-gradient-to-b from-brand-50/30 via-surface-1 to-surface-1 dark:from-brand-500/5">
      <TabStrip active={tab} onChange={setTab} />
      <div className="px-4 pb-5 pt-3 md:px-6 md:pb-6">
        {tab === 'flight' ? <FlightDetailsTab r={r} /> : null}
        {tab === 'fare' ? <FareBreakupTab r={r} /> : null}
        {tab === 'rules' ? <FareRulesTab r={r} /> : null}
        {tab === 'baggage' ? <BaggageTab r={r} /> : null}
      </div>
    </div>
  );
}

// ────────── Tab strip ──────────

const TABS: Array<{ key: TabKey; label: string; icon: typeof Info }> = [
  { key: 'flight', label: 'Flight Details', icon: PlaneTakeoff },
  { key: 'fare', label: 'Fare Breakup', icon: Receipt },
  { key: 'rules', label: 'Fare Rules', icon: FileText },
  { key: 'baggage', label: 'Baggage', icon: Luggage },
];

function TabStrip({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Flight details"
      className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-stroke-1 bg-surface-1 px-3 md:px-5"
    >
      {TABS.map((t) => {
        const isActive = active === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              'group relative flex shrink-0 items-center gap-2 px-4 py-3 text-[12px] font-semibold transition-colors duration-fast',
              isActive
                ? 'text-brand-700 dark:text-brand-300'
                : 'text-ink-3 hover:text-ink-1',
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4 transition-colors',
                isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-4 group-hover:text-ink-2',
              )}
              strokeWidth={isActive ? 2.25 : 1.75}
            />
            {t.label}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 -bottom-px h-[3px] rounded-t-full transition-all',
                isActive
                  ? 'bg-brand-600 opacity-100 dark:bg-brand-400'
                  : 'bg-brand-600/0 group-hover:bg-brand-600/30',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

// ────────── Tab 1 · Flight details (segment-by-segment) ──────────

function FlightDetailsTab({ r }: { r: FlightResult }) {
  const firstSeg = r.segments[0]!;
  const lastSeg = r.segments[r.segments.length - 1]!;
  const dayLabel = new Date(firstSeg.departure).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div>
      {/* Route header — Date · Origin → Destination */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
        <CalendarClock className="h-3.5 w-3.5 text-ink-4" strokeWidth={1.75} />
        <span className="font-semibold text-ink-1">{dayLabel}</span>
        <span className="text-ink-4">·</span>
        <span className="font-mono text-ink-2">
          {firstSeg.origin.code} → {lastSeg.destination.code}
        </span>
      </div>

      {/* Segments */}
      <div className="overflow-hidden rounded-lg border border-stroke-1 bg-surface-1">
        {r.segments.map((seg, idx) => (
          <div key={`${seg.flightNumber}-${idx}`}>
            <SegmentRow seg={seg} />
            {/* Layover divider — between this segment and the next */}
            {idx < r.segments.length - 1 ? (
              <LayoverDivider minutes={seg.stopOver} airportCode={seg.destination.code} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SegmentRow({ seg }: { seg: FlightResult['segments'][number] }) {
  return (
    <div className="grid gap-4 px-4 py-4 md:grid-cols-[180px_1fr_120px_1fr] md:items-center md:gap-4 md:px-5">
      {/* Airline column */}
      <div className="flex items-start gap-2.5">
        <AirlineLogo code={seg.airline.code} name={seg.airline.name} size={32} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink-1">
            {seg.airline.name ?? seg.airline.code}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-3">
            {seg.airline.code} {seg.flightNumber}
          </p>
        </div>
      </div>

      {/* Departure */}
      <div className="md:border-l md:border-stroke-1 md:pl-4">
        <p className="font-mono text-[20px] font-bold tabular-nums leading-none text-ink-1">
          {formatTime(seg.departure)}
        </p>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-mono text-[13px] font-bold text-ink-1">{seg.origin.code}</span>
          <span className="truncate text-[11px] text-ink-3">{seg.origin.name ?? ''}</span>
        </div>
        {seg.origin.terminal ? (
          <p className="mt-0.5 text-[10px] font-medium text-ink-4">
            Terminal {seg.origin.terminal}
          </p>
        ) : null}
      </div>

      {/* Duration / route indicator */}
      <div className="flex flex-col items-center justify-center gap-1 text-[10px] text-ink-3">
        <span className="flex items-center gap-1 font-mono font-semibold text-ink-2">
          <Clock className="h-3 w-3" strokeWidth={1.75} />
          {formatDuration(seg.duration)}
        </span>
        <div className="relative w-full max-w-[100px]">
          <div className="h-px w-full bg-gradient-to-r from-stroke-1 via-stroke-2 to-stroke-1" />
          <PlaneTakeoff
            aria-hidden
            className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-90 text-emerald-500"
            strokeWidth={2.25}
            fill="currentColor"
          />
        </div>
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Non-stop</span>
      </div>

      {/* Arrival */}
      <div className="md:text-right">
        <p className="font-mono text-[20px] font-bold tabular-nums leading-none text-ink-1">
          {formatTime(seg.arrival)}
        </p>
        <div className="mt-1.5 flex items-baseline gap-1.5 md:justify-end">
          <span className="font-mono text-[13px] font-bold text-ink-1">
            {seg.destination.code}
          </span>
          <span className="truncate text-[11px] text-ink-3">{seg.destination.name ?? ''}</span>
        </div>
        {seg.destination.terminal ? (
          <p className="mt-0.5 text-[10px] font-medium text-ink-4">
            Terminal {seg.destination.terminal}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LayoverDivider({ minutes, airportCode }: { minutes: number; airportCode: string }) {
  return (
    <div className="flex items-center justify-center gap-2 border-y border-dashed border-warning/40 bg-warning/5 px-4 py-2 text-[11px] font-medium text-warning">
      <PlaneLanding className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span>
        Layover at <span className="font-mono font-bold">{airportCode}</span>
      </span>
      <span className="text-warning/70">·</span>
      <span className="font-mono">{formatDuration(minutes)}</span>
      <span className="text-warning/70">·</span>
      <span>Change of flight required</span>
    </div>
  );
}

// ────────── Tab 2 · Fare Breakup ──────────

function FareBreakupTab({ r }: { r: FlightResult }) {
  const inc = r.totalGrossPaise - r.totalAgencyPayablePaise;
  const incPct = r.totalGrossPaise > 0 ? (inc / r.totalGrossPaise) * 100 : 0;

  return (
    <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
      {/* Per-pax breakup table */}
      <div className="overflow-hidden rounded-lg border border-stroke-1 bg-surface-1">
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 border-b border-stroke-1 bg-surface-2/50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          <span>Pax Type</span>
          <span className="text-right">Base Fare</span>
          <span className="text-right">Taxes &amp; Others</span>
          <span className="text-right">Total</span>
        </div>
        <FareBreakupRow label="Adult" bd={r.perPax.adult} />
        {r.perPax.child.grossAmountPaise > 0 ? (
          <FareBreakupRow label="Child" bd={r.perPax.child} />
        ) : null}
        {r.perPax.infant.grossAmountPaise > 0 ? (
          <FareBreakupRow label="Infant" bd={r.perPax.infant} />
        ) : null}
        {/* Total */}
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 border-t-2 border-stroke-2 bg-brand-50/40 px-4 py-2.5 text-[13px] font-bold text-ink-1 dark:bg-brand-500/10">
          <span>Total Amount</span>
          <span />
          <span />
          <span className="text-right font-mono tabular-nums">
            {formatPaiseAsINR(r.totalGrossPaise)}
          </span>
        </div>
      </div>

      {/* Commission breakdown sidecar */}
      <div className="space-y-2">
        <div className="rounded-lg border border-stroke-1 bg-surface-1 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">
            <Sparkles className="h-3 w-3 text-brand-500" strokeWidth={2} />
            Your earnings on this fare
          </p>
          <div className="space-y-2 text-[12px]">
            <KV
              label="Gross fare (customer pays)"
              value={formatPaiseAsINR(r.totalGrossPaise)}
              accent="ink"
            />
            <KV
              label="Net fare (you remit)"
              value={formatPaiseAsINR(r.totalAgencyPayablePaise)}
              accent="brand"
            />
            <div className="border-t pt-2">
              <KV
                label={`Incentive (INC) · ${incPct.toFixed(1)}%`}
                value={formatPaiseAsINR(inc)}
                accent={inc > 0 ? 'success' : 'muted'}
                bold
              />
            </div>
          </div>
          <p className="mt-3 text-[10px] leading-snug text-ink-4">
            INC is your commission on this fare. You collect Gross from the customer and pay Net to
            TripBng — the difference is yours.
          </p>
        </div>

        {/* Fare-token + copy for support — buried but available */}
        <div className="rounded-lg border border-dashed border-stroke-1 bg-surface-2/30 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            <Info className="h-3 w-3" strokeWidth={2} />
            Reference (for support)
          </p>
          <div className="space-y-1 text-[11px]">
            <SupportRow label="Supplier" value={r.supplierName ?? r.supplierCode} />
            {r.fareClass ? <SupportRow label="Fare basis" value={r.fareClass} mono /> : null}
            <CopyableRow label="Fare token" value={r.fareToken} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FareBreakupRow({
  label,
  bd,
}: {
  label: string;
  bd: FlightResult['perPax']['adult'];
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_1fr] items-center gap-2 border-b border-stroke-1 px-4 py-2 text-[12px] text-ink-2 last:border-b-0">
      <span className="font-medium text-ink-1">{label}</span>
      <span className="text-right font-mono tabular-nums">
        {formatPaiseAsINR(bd.baseFarePaise)}
      </span>
      <span className="text-right font-mono tabular-nums">
        {formatPaiseAsINR(bd.taxesPaise)}
      </span>
      <span className="text-right font-mono font-semibold tabular-nums text-ink-1">
        {formatPaiseAsINR(bd.grossAmountPaise)}
      </span>
    </div>
  );
}

function KV({
  label,
  value,
  accent = 'ink',
  bold = false,
}: {
  label: string;
  value: string;
  accent?: 'ink' | 'brand' | 'success' | 'muted';
  bold?: boolean;
}) {
  const accentClass = {
    ink: 'text-ink-1',
    brand: 'text-brand-700 dark:text-brand-300',
    success: 'text-success',
    muted: 'text-ink-3',
  }[accent];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-ink-3">{label}</span>
      <span
        className={cn(
          'font-mono tabular-nums',
          bold ? 'text-[14px] font-bold' : 'font-semibold',
          accentClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SupportRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-ink-4">{label}</span>
      <span className={cn('text-[11px] font-medium text-ink-2', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-ink-4">{label}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard API not available — silently no-op.
          }
        }}
        className="inline-flex max-w-[140px] items-center gap-1 truncate font-mono text-[10px] text-brand-700 hover:underline dark:text-brand-300"
        title={value}
      >
        <span className="truncate">{value}</span>
        <ClipboardCopy className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
        {copied ? <span className="text-success">✓</span> : null}
      </button>
    </div>
  );
}

// ────────── Tab 3 · Fare Rules ──────────
//
// Only ETRAV ships a structured HTML fare-rule payload today. For other
// suppliers we fall back to the `fareRuleDescription` field (string) or
// a "rules unavailable" placeholder.

interface FareRuleResponse {
  rules: Array<{
    segmentId: string;
    name: string;
    /** Full HTML document — render inside a sandboxed iframe. */
    html: string;
  }>;
}

function FareRulesTab({ r }: { r: FlightResult }) {
  const supportsLiveRules = r.supplierCode === 'ETRAV';
  const [rules, setRules] = useState<FareRuleResponse['rules'] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supportsLiveRules) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<FareRuleResponse>('/api/v1/search/flights/farerule', {
      method: 'POST',
      body: { supplierCode: r.supplierCode, fareToken: r.fareToken },
    })
      .then((res) => {
        if (cancelled) return;
        setRules(res.rules);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiCallError) setError(err.message);
        else setError('Could not load fare rules. Please retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supportsLiveRules, r.supplierCode, r.fareToken]);

  // ── Cancellation / change rules fallback summary ────────────────
  // Even when the supplier doesn't ship a structured rule blob, we
  // still know whether the fare is refundable + sometimes a free-text
  // description. Surface that so the panel is never empty.
  const summary: Array<{ label: string; value: string; tone?: 'success' | 'warning' | 'ink' }> = [
    {
      label: 'Refundable',
      value: r.refundable ? 'Yes' : 'No',
      tone: r.refundable ? 'success' : 'warning',
    },
    { label: 'Fare basis', value: r.fareClass ?? '—' },
    {
      label: 'Inventory source',
      value: r.source === 'SERIES' ? 'Series / Consolidator' : r.source,
    },
  ];

  return (
    <div>
      {/* Always-on summary chips at top */}
      <div className="mb-3 overflow-hidden rounded-lg border border-stroke-1 bg-surface-1">
        <div className="grid grid-cols-1 divide-y divide-stroke-1 md:grid-cols-3 md:divide-x md:divide-y-0">
          {summary.map((s) => (
            <div key={s.label} className="px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {s.label}
              </p>
              <p
                className={cn(
                  'mt-0.5 font-mono text-[13px] font-semibold',
                  s.tone === 'success' && 'text-success',
                  s.tone === 'warning' && 'text-warning',
                  (!s.tone || s.tone === 'ink') && 'text-ink-1',
                )}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Live HTML rules (ETRAV only) */}
      {supportsLiveRules ? (
        <div className="overflow-hidden rounded-lg border border-stroke-1 bg-surface-1">
          {rules && rules.length > 1 ? (
            <div className="flex items-center gap-1 overflow-x-auto border-b border-stroke-1 bg-surface-2/40 px-2">
              {rules.map((rl, i) => (
                <button
                  key={`${rl.segmentId}-${i}`}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={cn(
                    'shrink-0 border-b-2 px-3 py-2 text-[11px] font-semibold transition-colors',
                    i === activeIndex
                      ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                      : 'border-transparent text-ink-3 hover:text-ink-1',
                  )}
                >
                  Segment {rl.segmentId} · {rl.name}
                </button>
              ))}
            </div>
          ) : null}

          {loading ? (
            <div className="grid h-48 place-items-center text-ink-3">
              <div className="flex flex-col items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-brand-500" strokeWidth={2} />
                Loading rules from supplier…
              </div>
            </div>
          ) : error ? (
            <div className="grid h-48 place-items-center">
              <div className="max-w-sm text-center">
                <span className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-full bg-warning/10 text-warning">
                  <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <p className="text-[13px] font-semibold text-ink-1">{error}</p>
                <p className="mt-1 text-[11px] text-ink-3">
                  The supplier may have lost the search session — re-search to refresh.
                </p>
              </div>
            </div>
          ) : rules && rules.length > 0 ? (
            <iframe
              key={activeIndex}
              title={`Fare rules — ${rules[activeIndex]?.name ?? 'rule'}`}
              srcDoc={rules[activeIndex]?.html ?? ''}
              sandbox=""
              className="h-[420px] w-full bg-white"
            />
          ) : (
            <div className="grid h-32 place-items-center text-[12px] text-ink-3">
              No fare rules returned.
            </div>
          )}
        </div>
      ) : (
        // Fallback panel for suppliers without live rules
        <div className="rounded-lg border border-dashed border-stroke-1 bg-surface-2/30 p-4">
          <div className="flex items-start gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-warning/10 text-warning">
              <Info className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-ink-1">
                Live fare rules not available from this supplier
              </p>
              {r.fareRuleDescription ? (
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-ink-2">
                  {r.fareRuleDescription}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-3">
                  Refer to the supplier&apos;s booking confirmation email or contact support before
                  the customer requests a refund / date change.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────── Tab 4 · Baggage ──────────

function BaggageTab({ r }: { r: FlightResult }) {
  const firstSeg = r.segments[0]!;
  const lastSeg = r.segments[r.segments.length - 1]!;
  const sectorLabel = `${firstSeg.origin.code}–${lastSeg.destination.code}`;
  const checkin = r.baggageCheckin ?? '—';
  const cabin = r.baggageCabin ?? '—';

  return (
    <div className="space-y-4">
      {/* Check-in baggage */}
      <BaggageBlock
        title="Check-in Baggage"
        icon={Luggage}
        sector={sectorLabel}
        adult={checkin}
        child="—"
        infant="—"
      />

      {/* Hand / cabin baggage */}
      <BaggageBlock
        title="Hand Baggage"
        icon={Briefcase}
        sector={sectorLabel}
        adult={cabin}
        child="—"
        infant="—"
      />

      <p className="flex items-center gap-1.5 text-[11px] text-ink-4">
        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
        Excess baggage charges apply if the limit is exceeded — verify at the airline counter.
      </p>
    </div>
  );
}

function BaggageBlock({
  title,
  icon: Icon,
  sector,
  adult,
  child,
  infant,
}: {
  title: string;
  icon: typeof Luggage;
  sector: string;
  adult: string;
  child: string;
  infant: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-stroke-1 bg-surface-1">
      <div className="flex items-center gap-2 border-b border-stroke-1 bg-surface-2/40 px-4 py-2">
        <Icon className="h-3.5 w-3.5 text-brand-500" strokeWidth={1.75} />
        <p className="text-[12px] font-bold text-ink-1">{title}</p>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 border-b border-stroke-1 bg-surface-2/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        <span>Sector</span>
        <span className="text-center">Adult</span>
        <span className="text-center">Child</span>
        <span className="text-center">Infant</span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] items-center gap-2 px-4 py-2.5 text-[12px]">
        <span className="font-mono font-semibold text-ink-1">{sector}</span>
        <span className="text-center font-mono font-semibold text-ink-1">{adult}</span>
        <span className="text-center font-mono text-ink-3">{child}</span>
        <span className="text-center font-mono text-ink-3">{infant}</span>
      </div>
    </div>
  );
}
