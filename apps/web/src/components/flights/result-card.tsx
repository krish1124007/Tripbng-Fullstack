'use client';

// Result card — one flight option row.
//
// Three-column desktop grid: [airline 220px] [times 1fr] [price 260px].
// Each column owns a distinct kind of data:
//
//   • AIRLINE COLUMN — what the agent is selling: carrier, flight #,
//     and *one* meta line (supplier / source / refund status). Three
//     coloured pills competing for attention has been replaced with a
//     single muted meta strip.
//
//   • TIMES COLUMN — when it departs / arrives. Big mono numbers, the
//     duration above a thin timeline, day-offset badges if the arrival
//     spills onto another calendar day. This is the agent's primary
//     scan target.
//
//   • PRICE COLUMN — the deal. Gross at the top, then a compact INC /
//     NET ledger, a single fare-type pill (combines bucket + cabin +
//     RBD), then the seat-urgency cue and finally the Book CTA. The
//     ledger no longer competes visually with the gross price.
//
// View-details strip: a single right-aligned link. It no longer
// repeats Seats / Booking Class / Supplier — that data is already
// visible on the card body, repeating it just adds noise.

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  IndianRupee,
  Luggage,
  PlaneTakeoff,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Utensils,
  Armchair,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button, Card, CardContent } from '@/components/ui';
import { AirlineLogo } from '@/components/airline-logo';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { FlightDetailsPanel } from './details-panel';
import { QuoteExportDialog } from './quote-export';
import {
  classifyFare,
  computeFareBestOf,
  formatDuration,
  formatTime,
  getFareBenefits,
  type BenefitKey,
  type BenefitState,
  type FareBenefit,
  type FareBestOf,
  type FlightResult,
} from './utils';

interface ResultCardProps {
  /** All fare variants for one underlying flight (same airline+flight+times).
   *  Always sorted cheapest first by the grouping helper. */
  fares: FlightResult[];
  isCheapest: boolean;
  isFastest: boolean;
  isBest: boolean;
  /** Receives the *selected* fare at the moment of the click. */
  onBook: (r: FlightResult) => void;
}

export function ResultCard({
  fares,
  isCheapest,
  isFastest,
  isBest,
  onBook,
}: ResultCardProps) {
  // Selection state — default to the cheapest fare (index 0 since the
  // group is sorted cheapest-first).
  const [selectedIdx, setSelectedIdx] = useState(0);
  const safeIdx = Math.min(selectedIdx, fares.length - 1);
  const r = fares[safeIdx]!;
  const cheapestFare = fares[0]!;

  // Per-fare "best of" annotations within this group.
  const bestOf = useMemo(() => computeFareBestOf(fares), [fares]);

  const seg0 = r.segments[0]!;
  const segLast = r.segments[r.segments.length - 1]!;
  const lowSeats = r.seatsRemaining != null && r.seatsRemaining > 0 && r.seatsRemaining <= 5;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  // Commission math — INC = totalGross − totalAgencyPayable (agent's
  // margin), NET = totalAgencyPayable (what they remit to platform).
  const inc = r.totalGrossPaise - r.totalAgencyPayablePaise;
  const net = r.totalAgencyPayablePaise;
  const incPct = r.totalGrossPaise > 0 ? (inc / r.totalGrossPaise) * 100 : 0;

  const fareType = classifyFare(r);
  // Booking class is the first char of fareClass when present.
  const bookingClass = r.fareClass ? r.fareClass.charAt(0) : null;

  // Day offset — does the flight land on a different calendar day?
  // We compare local-date strings ("2026-05-21") of dep + arr.
  const depDate = new Date(seg0.departure).toLocaleDateString('en-CA');
  const arrDate = new Date(segLast.arrival).toLocaleDateString('en-CA');
  const dayOffset =
    depDate !== arrDate
      ? Math.round(
          (new Date(arrDate).getTime() - new Date(depDate).getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

  const ribbon = isCheapest
    ? ({ label: 'Cheapest', tone: 'brand', icon: Sparkles } as const)
    : isFastest
    ? ({ label: 'Fastest', tone: 'accent', icon: Zap } as const)
    : isBest
    ? ({ label: 'Best value', tone: 'success', icon: ShieldCheck } as const)
    : null;

  return (
    <Card
      className={cn(
        'group relative overflow-hidden transition-all duration-fast',
        'hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5',
        detailsOpen && 'ring-1 ring-brand-200 dark:ring-brand-500/30',
      )}
    >
      {/* Best-of ribbon — single coloured tag, top-left only */}
      {ribbon ? (
        <div className="absolute left-0 top-0 z-10">
          <RibbonTag tone={ribbon.tone} icon={ribbon.icon} label={ribbon.label} />
        </div>
      ) : null}

      {/* ── Top row · Flight info + Selected fare's price ──
          Three-column grid: airline (200) | times (1fr) | price (240).
          The price column is intentionally LEAN — just the selected
          fare's totals + Book CTA. The fare picker (when multi-fare)
          lives in its own full-width section below so the times
          column doesn't get starved of horizontal space. */}
      <CardContent
        className={cn(
          'grid gap-5 p-4 md:grid-cols-[200px_minmax(0,1fr)_240px] md:items-center md:gap-5 md:p-5',
          ribbon && 'pt-7 md:pt-6',
        )}
      >
        <AirlineColumn r={r} />
        <TimesColumn r={r} dayOffset={dayOffset} />
        <PriceColumn
          r={r}
          inc={inc}
          net={net}
          incPct={incPct}
          fareType={fareType}
          bookingClass={bookingClass}
          lowSeats={!!lowSeats}
          isMultiFare={fares.length > 1}
          onBook={() => onBook(r)}
          onShare={() => setQuoteOpen(true)}
        />
      </CardContent>

      {/* ── Middle row · Fare picker (multi-fare only) ──
          A full-width section with a responsive grid of fare cards.
          Auto-fit means on a wide card we get 2-3 columns; on mobile
          they stack. Gives the picker the breathing room the price
          column couldn't. */}
      {fares.length > 1 ? (
        <FarePickerSection
          fares={fares}
          bestOf={bestOf}
          selectedIdx={safeIdx}
          cheapestPaise={cheapestFare.totalGrossPaise}
          onSelect={setSelectedIdx}
        />
      ) : null}

      {/* ── View-details toggle bar ──
          Single, right-aligned link. No repeated meta. */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        className={cn(
          'flex w-full items-center justify-end gap-1.5 border-t px-4 py-2 text-[11px] font-semibold transition-colors md:px-5',
          detailsOpen
            ? 'border-brand-200 bg-brand-50/60 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300'
            : 'border-stroke-1 bg-surface-2/30 text-ink-3 hover:bg-surface-2/60 hover:text-brand-700',
        )}
      >
        {detailsOpen ? 'Hide details' : 'View flight details, fare breakup, rules & baggage'}
        {detailsOpen ? (
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>

      {detailsOpen ? <FlightDetailsPanel r={r} /> : null}

      {/* Quote-export dialog — mounted at root so its portal escapes
          card's overflow-hidden. Rendered on demand only. */}
      {quoteOpen ? (
        <QuoteExportDialog r={r} open={quoteOpen} onOpenChange={setQuoteOpen} />
      ) : null}
    </Card>
  );
}

// ────────── Ribbon ──────────
//
// One slanted tag in the top-left. Replaces the old multi-badge strip
// that wasted a whole row of vertical space.

function RibbonTag({
  tone,
  icon: Icon,
  label,
}: {
  tone: 'brand' | 'accent' | 'success';
  icon: typeof Sparkles;
  label: string;
}) {
  const toneClass = {
    brand: 'bg-brand-600 text-white shadow-brand-600/40',
    accent: 'bg-amber-500 text-white shadow-amber-500/40',
    success: 'bg-emerald-600 text-white shadow-emerald-600/40',
  }[tone];
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-br-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm',
        toneClass,
      )}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
      {label}
    </div>
  );
}

// ────────── Column 1 · Airline ──────────

function AirlineColumn({ r }: { r: FlightResult }) {
  const seg0 = r.segments[0]!;
  const allFlightNos = r.segments.map((s) => s.flightNumber).join(', ');
  // Build a single meta line:  "LCC · via ETRAV · Non-refundable"
  // — joining with bullets instead of stacking pills.
  const meta: string[] = [];
  meta.push(r.source); // LCC / API / SERIES
  if (r.supplierCode && r.supplierCode !== r.source) {
    meta.push(`via ${r.supplierCode}`);
  }

  return (
    <div className="flex items-start gap-3">
      <AirlineLogo code={seg0.airline.code} name={seg0.airline.name} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight text-ink-1">
          {seg0.airline.name ?? seg0.airline.code}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-ink-3">{allFlightNos}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-medium leading-tight">
          {meta.map((m, i) => (
            <span key={`${m}-${i}`} className="text-ink-3">
              <span className="font-mono uppercase tracking-wider">{m}</span>
              {i < meta.length - 1 ? <span className="ml-1.5 text-ink-4">·</span> : null}
            </span>
          ))}
          <RefundDot refundable={r.refundable} />
        </div>
      </div>
    </div>
  );
}

function RefundDot({ refundable }: { refundable: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        refundable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
      )}
      title={refundable ? 'Refundable fare' : 'Non-refundable fare'}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          refundable ? 'bg-emerald-500' : 'bg-rose-500',
        )}
      />
      {refundable ? 'Refundable' : 'Non-refundable'}
    </span>
  );
}

// ────────── Column 2 · Times ──────────

function TimesColumn({ r, dayOffset }: { r: FlightResult; dayOffset: number }) {
  const seg0 = r.segments[0]!;
  const segLast = r.segments[r.segments.length - 1]!;
  const stopsLabel =
    r.stops === 0 ? 'Non-stop' : `${r.stops} stop${r.stops > 1 ? 's' : ''}`;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-5">
      {/* Departure */}
      <div>
        <p className="font-mono text-[26px] font-bold tabular-nums leading-none tracking-tight text-ink-1">
          {formatTime(seg0.departure)}
        </p>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-mono text-[13px] font-bold text-ink-1">{seg0.origin.code}</span>
          <span className="truncate text-[11px] text-ink-3">{seg0.origin.name ?? ''}</span>
        </div>
        {seg0.origin.terminal ? (
          <p className="mt-0.5 text-[10px] text-ink-4">Terminal {seg0.origin.terminal}</p>
        ) : null}
      </div>

      {/* Duration + timeline */}
      <div className="flex flex-col items-center gap-1 px-2 text-[10px] text-ink-3">
        <span className="flex items-center gap-1 font-mono font-semibold text-ink-2">
          <Clock className="h-3 w-3" strokeWidth={1.75} />
          {formatDuration(r.totalDuration)}
        </span>
        <div className="relative w-24 md:w-28">
          <div className="h-px w-full bg-gradient-to-r from-stroke-1 via-stroke-2 to-stroke-1" />
          <PlaneTakeoff
            aria-hidden
            className={cn(
              'absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-90',
              r.stops === 0 ? 'text-emerald-500' : 'text-amber-500',
            )}
            strokeWidth={2.25}
            fill="currentColor"
          />
          {/* Stop dots, one per layover */}
          {r.stops > 0
            ? Array.from({ length: r.stops }).map((_, i) => (
                <span
                  key={i}
                  className="absolute -top-[3px] h-[7px] w-[7px] rounded-full border-2 border-surface-1 bg-amber-500"
                  style={{ left: `${((i + 1) * 100) / (r.stops + 1)}%`, transform: 'translateX(-50%)' }}
                />
              ))
            : null}
        </div>
        <span
          className={cn(
            'font-semibold',
            r.stops === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {stopsLabel}
        </span>
      </div>

      {/* Arrival */}
      <div className="text-right">
        <p className="flex items-baseline justify-end gap-1.5 font-mono text-[26px] font-bold tabular-nums leading-none tracking-tight text-ink-1">
          {formatTime(segLast.arrival)}
          {dayOffset > 0 ? (
            <span
              className="rounded-sm bg-amber-100 px-1 py-0.5 font-sans text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              title={`Arrives ${dayOffset} day${dayOffset > 1 ? 's' : ''} later`}
            >
              +{dayOffset}d
            </span>
          ) : null}
        </p>
        <div className="mt-1.5 flex items-baseline justify-end gap-1.5">
          <span className="font-mono text-[13px] font-bold text-ink-1">
            {segLast.destination.code}
          </span>
          <span className="truncate text-[11px] text-ink-3">{segLast.destination.name ?? ''}</span>
        </div>
        {segLast.destination.terminal ? (
          <p className="mt-0.5 text-[10px] text-ink-4">Terminal {segLast.destination.terminal}</p>
        ) : null}
      </div>
    </div>
  );
}

// ────────── Column 3 · Price + Book ──────────
//
// LEAN by design. Always shows ONLY the selected fare's price block
// (gross + INC/NET + Book + Share + low-seats chip). The fare picker
// (when multi-fare) lives in a separate full-width section below the
// CardContent, so this column can stay a tidy 240px without clipping.

function PriceColumn({
  r,
  inc,
  net,
  incPct,
  fareType,
  bookingClass,
  lowSeats,
  isMultiFare,
  onBook,
  onShare,
}: {
  r: FlightResult;
  inc: number;
  net: number;
  incPct: number;
  fareType: ReturnType<typeof classifyFare>;
  bookingClass: string | null;
  lowSeats: boolean;
  isMultiFare: boolean;
  onBook: () => void;
  onShare: () => void;
}) {
  const cabinShort = cabinShortLabel(r.travelClass);

  return (
    <div className="flex min-w-0 flex-col gap-2 border-t pt-4 md:items-stretch md:border-l md:border-t-0 md:pl-5 md:pt-0">
      {/* Gross fare — label switches when the picker is rendered below */}
      <div className="flex items-baseline justify-between md:flex-col md:items-end md:gap-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          {isMultiFare ? 'Selected fare' : 'Total fare'}
        </span>
        <p className="font-mono text-[26px] font-extrabold tabular-nums leading-none tracking-tight text-ink-1">
          {formatPaiseAsINR(r.totalGrossPaise)}
        </p>
      </div>

      {/* Commission ledger — INC + NET for the selected fare */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <div
          className={cn(
            'rounded-md border px-2 py-1.5',
            inc > 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-stroke-1 bg-surface-2 text-ink-3',
          )}
          title={
            inc > 0
              ? `Incentive · your commission (${incPct.toFixed(1)}%)`
              : 'No incentive on this fare'
          }
        >
          <div className="flex items-center gap-1">
            <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} />
            <span className="font-mono font-bold uppercase tracking-wider">INC</span>
          </div>
          <p className="mt-0.5 font-mono text-[12px] font-bold tabular-nums leading-tight">
            {formatPaiseAsINR(inc)}
          </p>
        </div>
        <div
          className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1.5 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
          title="Net fare · what you remit to TripBng"
        >
          <p className="font-mono font-bold uppercase tracking-wider">NET</p>
          <p className="mt-0.5 font-mono text-[12px] font-bold tabular-nums leading-tight">
            {formatPaiseAsINR(net)}
          </p>
        </div>
      </div>

      {/* Fare-type pill — bucket · cabin · RBD. Always rendered; the
          picker below adds richer detail when multi-fare. */}
      <div className="flex items-center gap-1.5 md:justify-end">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
            fareType.toneClass,
          )}
          title={fareType.tooltip}
        >
          {fareType.code}
          <span className="text-[9px] font-semibold opacity-70">·</span>
          <span className="font-semibold normal-case tracking-normal">{cabinShort}</span>
          {bookingClass ? (
            <>
              <span className="text-[9px] font-semibold opacity-70">·</span>
              <span className="font-mono">{bookingClass}</span>
            </>
          ) : null}
        </span>
      </div>

      {/* Low-seats urgency — only when relevant */}
      {r.seatsRemaining != null && lowSeats ? (
        <div className="flex items-center justify-end gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
          <Users className="h-3 w-3" strokeWidth={2} />
          Only {r.seatsRemaining} seat{r.seatsRemaining === 1 ? '' : 's'} left
        </div>
      ) : null}

      <div className="mt-1 grid grid-cols-[auto_1fr] gap-1.5">
        <button
          type="button"
          onClick={onShare}
          aria-label="Share quote with customer"
          title="Send fare quote to customer (PNG · PDF · WhatsApp)"
          className="inline-flex items-center justify-center gap-1 rounded-md border border-stroke-1 bg-surface-1 px-2.5 text-[11px] font-semibold text-ink-2 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:border-emerald-500/30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
        >
          <Send className="h-3.5 w-3.5" strokeWidth={2} />
          Share
        </button>
        <Button
          onClick={onBook}
          className="w-full shadow-sm transition-shadow hover:shadow-md"
        >
          Book <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ────────── Fare picker section ──────────
//
// Full-width row that lives BETWEEN CardContent and the view-details
// toggle when a flight has multiple fare bundles. Uses an auto-fit
// CSS grid so the cards lay out 1-up on narrow screens, 2-up on
// tablet, 3-up on wide. The picker has its own light header so the
// section reads as a sub-region of the card, not a continuation of
// the times row.

function FarePickerSection({
  fares,
  bestOf,
  selectedIdx,
  cheapestPaise,
  onSelect,
}: {
  fares: FlightResult[];
  bestOf: FareBestOf[];
  selectedIdx: number;
  cheapestPaise: number;
  onSelect: (idx: number) => void;
}) {
  // Compact mode — show top 3 by default when there are 5+ fares.
  // Selected fare is always rendered so the user never loses track.
  const COMPACT_LIMIT = 3;
  const [expanded, setExpanded] = useState(false);
  const overflow = Math.max(0, fares.length - COMPACT_LIMIT);
  const showAll = overflow === 0 || expanded;
  const visibleFares = showAll
    ? fares.map((f, i) => ({ fare: f, index: i }))
    : (() => {
        const head = fares
          .slice(0, COMPACT_LIMIT)
          .map((f, i) => ({ fare: f, index: i }));
        if (selectedIdx >= COMPACT_LIMIT) {
          head.push({ fare: fares[selectedIdx]!, index: selectedIdx });
        }
        return head;
      })();

  return (
    <div className="border-t bg-gradient-to-b from-brand-50/40 via-surface-1 to-surface-1 px-4 py-3 dark:from-brand-500/5 md:px-5 md:py-4">
      {/* Section header */}
      <div className="mb-2.5 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            Choose your fare
          </span>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
            {fares.length} options
          </span>
        </div>
        {overflow > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            {expanded ? (
              <>
                Show fewer
                <ChevronUp className="h-3 w-3" strokeWidth={2} />
              </>
            ) : (
              <>
                Show {overflow} more
                <ChevronDown className="h-3 w-3" strokeWidth={2} />
              </>
            )}
          </button>
        ) : null}
      </div>

      {/* Fare grid — auto-fit so 2 fares show side-by-side on wide
          cards, 3 fares show three-up, and on narrow viewports they
          stack vertically. minmax(160px,1fr) keeps the cards from
          forcing horizontal scroll inside the result card on small
          phones (375px viewport ≈ 330px effective card width). */}
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      >
        {visibleFares.map(({ fare: f, index: i }) => (
          <FareOptionRow
            key={f.id}
            fare={f}
            isSelected={i === selectedIdx}
            isCheapestInGroup={i === 0}
            isBestMargin={bestOf[i]?.isBestMargin ?? false}
            isBestRefundable={bestOf[i]?.isBestRefundable ?? false}
            showRadio
            premiumOverCheapest={f.totalGrossPaise - cheapestPaise}
            onSelect={() => onSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}

// ────────── Fare option row ──────────
//
// One row per available fare bundle on a flight. Single-fare cards use
// it for the canonical price block (no radio, no premium delta). Multi-
// fare cards stack these vertically and toggle the selected one.

function FareOptionRow({
  fare,
  isSelected,
  isCheapestInGroup,
  isBestMargin,
  isBestRefundable,
  showRadio,
  premiumOverCheapest,
  onSelect,
}: {
  fare: FlightResult;
  isSelected: boolean;
  isCheapestInGroup: boolean;
  isBestMargin: boolean;
  isBestRefundable: boolean;
  showRadio: boolean;
  premiumOverCheapest: number;
  onSelect: () => void;
}) {
  const fareType = classifyFare(fare);
  const cabinShort = cabinShortLabel(fare.travelClass);
  const bookingClass = fare.fareClass ? fare.fareClass.charAt(0) : null;

  // Single-fare cards render this as a pure presentational block (no
  // click target, no radio chrome). Multi-fare cards make it a button.
  if (!showRadio) {
    return (
      <div className="flex flex-col items-end gap-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          Total fare
        </span>
        <p className="font-mono text-[26px] font-extrabold tabular-nums leading-none tracking-tight text-ink-1">
          {formatPaiseAsINR(fare.totalGrossPaise)}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
      className={cn(
        'group/fare relative w-full min-w-0 overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-all',
        isSelected
          ? 'border-brand-500 bg-brand-50/80 shadow-sm ring-1 ring-brand-200 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-500/30'
          : 'border-stroke-1 bg-surface-1 hover:border-brand-300 hover:bg-brand-50/30 dark:hover:bg-brand-500/5',
      )}
    >
      {/* Top row — radio + price + premium */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-2 transition-colors',
              isSelected
                ? 'border-brand-600 bg-brand-600 dark:border-brand-400 dark:bg-brand-400'
                : 'border-ink-4 bg-surface-1 group-hover/fare:border-brand-400',
            )}
          >
            {isSelected ? (
              <span className="h-1 w-1 rounded-full bg-white" />
            ) : null}
          </span>
          <p
            className={cn(
              'font-mono text-[15px] font-extrabold tabular-nums leading-none',
              isSelected ? 'text-brand-700 dark:text-brand-200' : 'text-ink-1',
            )}
          >
            {formatPaiseAsINR(fare.totalGrossPaise)}
          </p>
        </div>
        {/* Stacked badges + premium — vertical column on the right.
            Multiple superlatives can apply to the same fare (e.g. the
            cheapest fare also has the best margin), so we stack rather
            than collapse them into one. */}
        <div className="flex flex-col items-end gap-0.5">
          {isCheapestInGroup ? (
            <BestOfBadge tone="emerald" icon={Sparkles}>
              Cheapest
            </BestOfBadge>
          ) : null}
          {isBestMargin ? (
            <BestOfBadge tone="brand" icon={TrendingUp}>
              Best margin
            </BestOfBadge>
          ) : null}
          {isBestRefundable ? (
            <BestOfBadge tone="amber" icon={ShieldCheck}>
              Best refund
            </BestOfBadge>
          ) : null}
          {!isCheapestInGroup && premiumOverCheapest > 0 ? (
            <span className="font-mono text-[9px] font-semibold tabular-nums text-ink-3">
              +{formatPaiseAsINR(premiumOverCheapest)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Bottom row — fare-type pill · cabin · RBD · refund dot */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 font-bold uppercase tracking-wider',
            fareType.toneClass,
          )}
          title={fareType.tooltip}
        >
          {fareType.code}
        </span>
        <span className="text-ink-2">
          {cabinShort}
          {bookingClass ? <span className="font-mono"> · {bookingClass}</span> : null}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 font-medium',
            fare.refundable
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              fare.refundable ? 'bg-emerald-500' : 'bg-rose-500',
            )}
          />
          {fare.refundable ? 'Refundable' : 'Non-refundable'}
        </span>
      </div>

      {/* Benefits strip — what's included in this bundle. Skipped on
          single-fare cards because they get a richer view in the
          dedicated details panel. */}
      {showRadio ? <BenefitsStrip benefits={getFareBenefits(fare)} /> : null}
    </button>
  );
}

// ────────── Benefits strip ──────────
//
// Compact icon row rendered at the bottom of each FareOptionRow. Each
// chip shows one benefit with a state-driven tone:
//   • included    → emerald + filled icon + value
//   • chargeable  → amber + "+₹" suffix
//   • excluded    → muted + crossed-out icon
//
// We render a fixed set of six benefits so the row is always the same
// width — empty slots are filled with greyed-out placeholders rather
// than absent. This keeps the visual rhythm consistent across fare
// rows in the same group.

const BENEFIT_ICONS: Record<BenefitKey, typeof Luggage> = {
  baggage: Luggage,
  cabin: Briefcase,
  meal: Utensils,
  seat: Armchair,
  change: ArrowRightLeft,
  refund: RotateCcw,
};

function BenefitsStrip({ benefits }: { benefits: FareBenefit[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-stroke-1/60 pt-1.5">
      {benefits.map((b) => (
        <BenefitChip key={b.key} benefit={b} />
      ))}
    </div>
  );
}

function BenefitChip({ benefit }: { benefit: FareBenefit }) {
  const Icon = BENEFIT_ICONS[benefit.key];
  const stateClass = benefitStateClass(benefit.state);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-semibold',
        stateClass,
      )}
      title={benefitTitle(benefit)}
    >
      {benefit.state === 'included' ? (
        <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.5} />
      ) : benefit.state === 'excluded' ? (
        <XCircle className="h-2.5 w-2.5" strokeWidth={2} />
      ) : (
        <IndianRupee className="h-2.5 w-2.5" strokeWidth={2} />
      )}
      <Icon className="h-2.5 w-2.5" strokeWidth={2} />
      {benefit.detail ? (
        <span className="font-mono">{benefit.detail.replace(/\s+/g, '')}</span>
      ) : benefit.state === 'chargeable' ? (
        <span className="text-[8px] font-bold tracking-wider">PAID</span>
      ) : null}
    </span>
  );
}

function benefitStateClass(state: BenefitState): string {
  switch (state) {
    case 'included':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'chargeable':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
    case 'excluded':
    default:
      return 'bg-surface-2 text-ink-4 line-through';
  }
}

function benefitTitle(b: FareBenefit): string {
  const verb =
    b.state === 'included' ? 'Included' : b.state === 'chargeable' ? 'Chargeable' : 'Not available';
  return b.detail ? `${b.label}: ${b.detail} (${verb})` : `${b.label}: ${verb}`;
}

// ────────── Best-of badge ──────────
//
// Tiny pill used in the top-right corner of a FareOptionRow to call
// out a superlative — Cheapest, Best margin, or Best refundable. Each
// tone maps to the colour we use elsewhere for that semantic:
//   • Cheapest         → emerald (matches the gross-fare positive vibe)
//   • Best margin      → brand   (commission goodness — TripBng blue)
//   • Best refundable  → amber   (cautious, "if you need flexibility")

function BestOfBadge({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'emerald' | 'brand' | 'amber';
  icon: typeof Sparkles;
  children: React.ReactNode;
}) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200/60 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  }[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1',
        toneClass,
      )}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
      {children}
    </span>
  );
}

// ────────── Helpers ──────────

function cabinShortLabel(travelClass: string): string {
  switch (travelClass) {
    case 'ECONOMY':
      return 'Economy';
    case 'PREMIUM_ECONOMY':
      return 'Prem. Eco';
    case 'BUSINESS':
      return 'Business';
    case 'FIRST':
      return 'First';
    default:
      return travelClass;
  }
}
