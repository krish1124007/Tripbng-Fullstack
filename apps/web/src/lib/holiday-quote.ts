// Pure quote resolver for admin-authored holiday packages.
//
// The b2c spec calls for a server-side `/holidays/packages/:id/quote`
// endpoint, but for our B2B internal tool the resolution logic is small and
// doesn't depend on per-tenant pricing rules — so it runs client-side off the
// priceMatrix already attached to the package detail. When server-side parity
// matters (e.g., for a server-rendered quote PDF), this same function can be
// imported into apps/api with no shape changes.
//
// Algorithm (matches the prompt verbatim):
//   1. If priceMatrix.length > 0, filter rows where:
//        fromDate ≤ departureDate ≤ toDate
//        AND fromPax ≤ totalPax ≤ toPax
//        AND priceType === 'Normal'
//      Among matches, prefer the smallest date window (most specific).
//      perAdult = sharing-type field on that row.
//      subtotal = adults × perAdult + childrenWithBed × cwbRate + childrenWithoutBed × cwobRate
//      Apply 5% markup + 5% GST (in that order).
//   2. Otherwise: legacy fallback using the package's `fromPerAdultPaise` ÷ 100.

import type { AdminHolidayPackage, HolidayPriceRow } from '@tripbng/shared';

export type SharingType = 'single' | 'double' | 'triple';

export interface QuoteSelection {
  departureDate: string; // YYYY-MM-DD
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
  sharingType: SharingType;
}

export interface QuoteBreakdown {
  /** The matched price row's id, or null if matrix-less / no match. */
  matchedRowId: string | null;
  /** Free-text label for surfacing on the customer page ("Matched 6-pax bulk rate"). */
  matchedLabel: string | null;
  /** Per-adult INR rate from the matched row's sharing field. */
  perAdultInr: number;
  /** Per-child-with-bed INR rate. */
  perChildWithBedInr: number;
  /** Per-child-without-bed INR rate. */
  perChildWithoutBedInr: number;
  /** adults × perAdult + childrenWithBed × cwbRate + childrenWithoutBed × cwobRate (rupees). */
  subtotalInr: number;
  /** 5% markup applied on subtotal (rupees). */
  markupInr: number;
  /** 5% GST applied on subtotal + markup (rupees). */
  gstInr: number;
  /** subtotal + markup + GST (rupees). */
  totalInr: number;
  /** Same as totalInr × 100, for currency-formatter compatibility. */
  totalPaise: number;
  /** Whether the matrix path resolved a row (true) or fell back to legacy (false). */
  matrixHit: boolean;
}

const MARKUP_RATE = 0.05; // 5%
const GST_RATE = 0.05; // 5%

export function quoteHolidayPackage(
  pkg: AdminHolidayPackage,
  selection: QuoteSelection,
): QuoteBreakdown {
  const totalPax =
    Math.max(0, selection.adults) +
    Math.max(0, selection.childrenWithBed) +
    Math.max(0, selection.childrenWithoutBed);

  const matched = matchRow(pkg.priceMatrix, selection.departureDate, totalPax);

  if (matched) {
    const perAdult = sharingRate(matched, selection.sharingType);
    const perCwb = matched.childWithBedInr;
    const perCwob = matched.childWithoutBedInr;

    const subtotal =
      selection.adults * perAdult +
      selection.childrenWithBed * perCwb +
      selection.childrenWithoutBed * perCwob;
    const markup = Math.round(subtotal * MARKUP_RATE);
    const gst = Math.round((subtotal + markup) * GST_RATE);
    const total = subtotal + markup + gst;

    return {
      matchedRowId: matched.id ?? null,
      matchedLabel:
        matched.rateVolume ??
        `${matched.fromPax}–${matched.toPax} pax · ${matched.priceType}`,
      perAdultInr: perAdult,
      perChildWithBedInr: perCwb,
      perChildWithoutBedInr: perCwob,
      subtotalInr: subtotal,
      markupInr: markup,
      gstInr: gst,
      totalInr: total,
      totalPaise: total * 100,
      matrixHit: true,
    };
  }

  // Legacy fallback — no matrix or no match. Use the cheapest-derived
  // fromPerAdultPaise on the package as a flat per-adult rate.
  const fromPaise = safeBigIntToNumber(pkg.fromPerAdultPaise);
  const perAdult = Math.round(fromPaise / 100);
  const subtotal = selection.adults * perAdult;
  const markup = Math.round(subtotal * MARKUP_RATE);
  const gst = Math.round((subtotal + markup) * GST_RATE);
  const total = subtotal + markup + gst;

  return {
    matchedRowId: null,
    matchedLabel: pkg.priceMatrix.length === 0 ? 'Indicative starting fare' : 'No matrix match — fallback rate',
    perAdultInr: perAdult,
    perChildWithBedInr: 0,
    perChildWithoutBedInr: 0,
    subtotalInr: subtotal,
    markupInr: markup,
    gstInr: gst,
    totalInr: total,
    totalPaise: total * 100,
    matrixHit: false,
  };
}

/** Returns the most specific row matching (date, pax) among 'Normal' priceType rows. */
function matchRow(
  matrix: HolidayPriceRow[],
  departureDate: string,
  totalPax: number,
): HolidayPriceRow | null {
  if (matrix.length === 0) return null;
  const dep = new Date(departureDate).getTime();
  if (Number.isNaN(dep)) return null;

  const candidates = matrix
    .filter((r) => r.priceType === 'Normal')
    .filter((r) => {
      const from = toDate(r.fromDate).getTime();
      const to = toDate(r.toDate).getTime();
      return from <= dep && dep <= to && r.fromPax <= totalPax && totalPax <= r.toPax;
    });

  if (candidates.length === 0) return null;

  // Smallest date window first (most specific = narrowest from→to).
  candidates.sort(
    (a, b) =>
      toDate(a.toDate).getTime() -
      toDate(a.fromDate).getTime() -
      (toDate(b.toDate).getTime() - toDate(b.fromDate).getTime()),
  );
  return candidates[0] ?? null;
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function sharingRate(row: HolidayPriceRow, sharing: SharingType): number {
  if (sharing === 'single') return row.singleSharingInr;
  if (sharing === 'double') return row.doubleSharingInr;
  return row.tripleSharingInr;
}

function safeBigIntToNumber(s: string): number {
  if (!s) return 0;
  try {
    const big = BigInt(s);
    return Number(big);
  } catch {
    return 0;
  }
}

// ────────── Best-price-months helper ──────────

export interface MonthRate {
  /** YYYY-MM */
  ym: string;
  monthLabel: string; // "Jul 2026"
  /** Cheapest sharing rate found in any row that overlaps this month. null = no coverage. */
  cheapestInr: number | null;
}

/** Build a 6-month forward-looking strip of cheapest rates per month. Used
 *  by the "Best price months" section on the customer page. */
export function bestPriceMonths(
  matrix: HolidayPriceRow[],
  fromMonth: Date = new Date(),
  count = 6,
): MonthRate[] {
  const out: MonthRate[] = [];
  const start = new Date(Date.UTC(fromMonth.getUTCFullYear(), fromMonth.getUTCMonth(), 1));

  for (let i = 0; i < count; i++) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 0));
    const ym = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthLabel = monthStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

    let cheapest = Number.POSITIVE_INFINITY;
    for (const r of matrix) {
      const f = toDate(r.fromDate).getTime();
      const t = toDate(r.toDate).getTime();
      if (t < monthStart.getTime() || f > monthEnd.getTime()) continue;
      // Cheapest sharing in this row.
      for (const v of [r.singleSharingInr, r.doubleSharingInr, r.tripleSharingInr]) {
        if (v > 0 && v < cheapest) cheapest = v;
      }
    }
    out.push({
      ym,
      monthLabel,
      cheapestInr: Number.isFinite(cheapest) ? cheapest : null,
    });
  }
  return out;
}
