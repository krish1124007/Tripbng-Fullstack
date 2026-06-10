// Manual-issuance matcher — Phase 5 of the admin panel spec.
//
// Given a booking that's about to be ticketed, decide whether any matching
// Map Source row says "skip the supplier API and land in PENDING_MANUAL".
//
// Match semantics
// ---------------
// A Map Source qualifies when ALL of:
//   - tenant + supplierCode (via the Supplier row) + productType lines up
//   - travelType matches request's DOMESTIC / INTERNATIONAL (or is BOTH)
//   - status is ACTIVE
//   - agency's agencyGroupIds intersect the row's (empty groups = all)
//   - manualIssuance.pendingBooking is true (master switch)
//
// Once qualified, the AND-criteria block decides if THIS specific booking
// matches:
//   - maximumPax: passenger count ≤ value (null = ignore)
//   - minAmountPaisePerPax / maxAmountPaisePerPax: per-pax fare in window
//   - tripType: booking.tripType matches (ROUNDTRIP↔ROUND_TRIP, MULTICITY↔MULTI_CITY)
//   - fromDate / toDate: booking.travelDate inside window
//   - bookingDateFrom / bookingDateTo: now() inside window
//   - applyForNonStopFlight / applyForStopFlight: stops match
//   - sector: booking.sector in the row's comma-separated list
//
// Fields the data model carries that the BOOKING side doesn't surface yet:
//   - bookingClass + fareBasis are stored as criteria, but Booking has
//     no fareClass / fareBasis fields today. The matcher silently ignores
//     these two fields rather than refusing to match — a small "skipped:[]"
//     list lands in the returned diagnostics so ops can see what was
//     un-checkable.
//
// Multiple matching rows
// ----------------------
// First matching row wins (deterministic — rows are sorted by priority ASC
// then createdAt DESC). The returned `mapSourceId` is the rule that triggered
// the manual route.

import { Types } from 'mongoose';
import { Supplier } from '../../models/Supplier.js';
import { SupplierSource, type SupplierSourceDoc } from '../../models/SupplierSource.js';
import type { BookingDoc } from '../../models/Booking.js';
import { logger } from '../../config/logger.js';
import { deriveTravelType } from '../../data/airports.js';
import type {
  ConditionFieldSchema,
  ConditionNode,
} from '@tripbng/shared';
import {
  ConditionTreeError,
  evaluateConditionTree,
  type ContextValue,
} from '../../utils/condition-tree.js';

/**
 * Field schema for the manual-issuance condition tree. Drives the admin
 * UI's field picker AND the runtime evaluator's type coercion. Keys are
 * snake_case so they survive a JSON round trip cleanly + grep-search.
 */
export const MANUAL_ISSUANCE_FIELDS: ConditionFieldSchema[] = [
  { key: 'pax_count', label: 'Passenger count', type: 'NUMBER' },
  {
    key: 'per_pax_paise',
    label: 'Per-passenger amount (paise)',
    type: 'NUMBER',
    description: 'Total agency-payable amount ÷ pax count.',
  },
  {
    key: 'total_paise',
    label: 'Total amount (paise)',
    type: 'NUMBER',
  },
  {
    key: 'trip_type',
    label: 'Trip type',
    type: 'ENUM',
    options: [
      { value: 'ONEWAY', label: 'One way' },
      { value: 'ROUNDTRIP', label: 'Round trip' },
      { value: 'MULTICITY', label: 'Multi-city' },
    ],
  },
  { key: 'sector', label: 'Sector', type: 'STRING' },
  { key: 'travel_date', label: 'Travel date', type: 'DATE' },
  { key: 'booking_date', label: 'Booking date', type: 'DATE' },
  { key: 'is_nonstop', label: 'Non-stop flight', type: 'BOOLEAN' },
];

export interface MatchContext {
  tenantId: string;
  agencyId: string;
  agencyGroupIds: string[];
}

export interface MatchResult {
  matched: boolean;
  /** The Map Source row id that triggered the match. Null when no row matched. */
  mapSourceId: string | null;
  /** Human-readable summary — useful for the booking audit row. */
  reason: string | null;
  /** Criteria fields the matcher couldn't evaluate because the booking
   *  doesn't carry the data (e.g. fareClass). Empty when nothing was
   *  skipped. Ops can investigate if a booking should have matched but
   *  didn't because of a skipped field. */
  skippedFields: string[];
}

/** Normalise a tripType string between Booking + Map Source vocabularies. */
function normalizeTripType(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.toUpperCase().replace(/_/g, '');
  if (v === 'ONEWAY') return 'ONEWAY';
  if (v === 'ROUNDTRIP') return 'ROUNDTRIP';
  if (v === 'MULTICITY') return 'MULTICITY';
  return v;
}

function parseCsv(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}

interface BookingDigest {
  passengerCount: number;
  perPaxAmountPaise: number;
  totalAmountPaise: number;
  tripType: string | null;
  travelDate: Date;
  bookingDate: Date;
  sector: string;
  hasNonStop: boolean;
  hasStop: boolean;
}

function digestBooking(booking: BookingDoc): BookingDigest {
  const pax = booking.passengers?.length ?? 0;
  const total = booking.pricing?.agencyPayablePaise ?? 0;
  const perPax = pax > 0 ? Math.round(total / pax) : total;
  const segs = booking.segments ?? [];
  const hasNonStop = segs.length > 0 && (segs[0]?.stopOver ?? 0) === 0 && segs.length === 1;
  const hasStop = segs.length > 1 || segs.some((s) => (s.stopOver ?? 0) > 0);
  return {
    passengerCount: pax,
    perPaxAmountPaise: perPax,
    totalAmountPaise: total,
    tripType: normalizeTripType(booking.tripType),
    travelDate: booking.travelDate,
    bookingDate: booking.createdAt ?? new Date(),
    sector: (booking.sector ?? '').toUpperCase(),
    hasNonStop,
    hasStop,
  };
}

/** Test a single Map Source's manualIssuance criteria against the booking
 *  digest. Returns true when every populated field matches. */
function criteriaMatch(
  mi: NonNullable<SupplierSourceDoc['manualIssuance']>,
  d: BookingDigest,
  skipped: string[],
): boolean {
  if (mi.maximumPax != null && d.passengerCount > mi.maximumPax) return false;
  if (mi.minAmountPaisePerPax != null && d.perPaxAmountPaise < mi.minAmountPaisePerPax)
    return false;
  if (mi.maxAmountPaisePerPax != null && d.perPaxAmountPaise > mi.maxAmountPaisePerPax)
    return false;

  if (mi.tripType) {
    const target = normalizeTripType(mi.tripType);
    if (target && d.tripType !== target) return false;
  }

  if (mi.fromDate && d.travelDate < new Date(mi.fromDate as unknown as Date)) return false;
  if (mi.toDate && d.travelDate > new Date(mi.toDate as unknown as Date)) return false;

  if (mi.bookingDateFrom && d.bookingDate < new Date(mi.bookingDateFrom as unknown as Date))
    return false;
  if (mi.bookingDateTo && d.bookingDate > new Date(mi.bookingDateTo as unknown as Date))
    return false;

  // Stop / non-stop — both true means "any flight"; both false means "no
  // flight-type criteria" (skip the gate). Exactly one true narrows.
  if (mi.applyForNonStopFlight && !mi.applyForStopFlight && !d.hasNonStop) return false;
  if (mi.applyForStopFlight && !mi.applyForNonStopFlight && !d.hasStop) return false;

  if (mi.sector) {
    const wanted = parseCsv(mi.sector);
    if (wanted.length > 0 && !wanted.includes(d.sector)) return false;
  }

  // bookingClass + fareBasis criteria — Booking doesn't carry these fields
  // today. Skip silently and surface in diagnostics rather than treating a
  // missing field as a fail. If/when adapters propagate the values through
  // the hold response, this branch becomes a real comparison.
  if (mi.bookingClass) skipped.push('bookingClass');
  if (mi.fareBasis) skipped.push('fareBasis');

  return true;
}

/**
 * Resolve whether the supplied booking should be routed to PENDING_MANUAL
 * instead of having `adapter.ticket()` called.
 */
export async function matchManualIssuance(
  booking: BookingDoc,
  ctx: MatchContext,
): Promise<MatchResult> {
  // Resolve the supplier id from the booking's stored supplierCode.
  const supplier = await Supplier.findOne({
    tenantId: ctx.tenantId,
    code: booking.supplierCode,
  })
    .select({ _id: 1 })
    .lean();
  if (!supplier) {
    return { matched: false, mapSourceId: null, reason: null, skippedFields: [] };
  }

  const firstSeg = booking.segments?.[0];
  const originCode = firstSeg?.origin?.code;
  const destinationCode = firstSeg?.destination?.code;
  const travelType =
    originCode && destinationCode
      ? deriveTravelType(originCode, destinationCode)
      : 'DOMESTIC';

  const candidates = (await SupplierSource.find({
    tenantId: ctx.tenantId,
    supplierId: supplier._id,
    productType: booking.productType ?? 'FLIGHT',
    status: 'ACTIVE',
    $or: [{ travelType }, { travelType: 'BOTH' }],
    // Sub-document field — Mongoose supports dot notation in filters.
    'manualIssuance.pendingBooking': true,
  })
    .sort({ priority: 1, createdAt: -1 })
    .lean()) as unknown as SupplierSourceDoc[];

  if (candidates.length === 0) {
    return { matched: false, mapSourceId: null, reason: null, skippedFields: [] };
  }

  // Filter to rows whose agency-group set covers this agency.
  const agencyGroupSet = new Set(ctx.agencyGroupIds);
  const eligible = candidates.filter((s) => {
    const groups = ((s as unknown as { agencyGroupIds?: Array<Types.ObjectId | string> })
      .agencyGroupIds ?? []
    ).map((g) => g.toString());
    if (groups.length === 0) return true;
    return groups.some((g) => agencyGroupSet.has(g));
  });

  if (eligible.length === 0) {
    return { matched: false, mapSourceId: null, reason: null, skippedFields: [] };
  }

  const digest = digestBooking(booking);
  for (const src of eligible) {
    const mi = src.manualIssuance;
    if (!mi || !mi.pendingBooking) continue;
    const skipped: string[] = [];

    // Phase-G: prefer the new condition tree when it's authored. A
    // malformed tree falls back to the legacy criteria with a loud log
    // — the alternative (refusing to match) would silently regress on
    // a config bug.
    const tree = (mi as unknown as { conditionTree?: ConditionNode | null }).conditionTree;
    const srcId = String((src as unknown as { _id: Types.ObjectId })._id);
    const matched = tree
      ? evaluateTreeOrFallback(tree, mi, digest, skipped, srcId)
      : criteriaMatch(mi, digest, skipped);

    if (matched) {
      const mapSourceId = String(
        (src as unknown as { _id: Types.ObjectId })._id,
      );
      const reason = buildReason(src, digest);
      logger.info(
        {
          bookingId: String(booking._id),
          mapSourceId,
          supplierCode: booking.supplierCode,
          reason,
          skippedFields: skipped,
          matchedVia: tree ? 'CONDITION_TREE' : 'LEGACY_CRITERIA',
        },
        'manual-issuance match — booking will land in PENDING_MANUAL',
      );
      return { matched: true, mapSourceId, reason, skippedFields: skipped };
    }
  }

  return { matched: false, mapSourceId: null, reason: null, skippedFields: [] };
}

/**
 * Evaluate the condition tree; on a structural error fall back to the
 * legacy criteria block. The fallback path makes the rollout safe: a
 * tree authored against an older field schema (e.g. after a schema
 * field rename) can't break a previously-working booking flow.
 */
function evaluateTreeOrFallback(
  tree: ConditionNode,
  mi: NonNullable<SupplierSourceDoc['manualIssuance']>,
  digest: BookingDigest,
  skipped: string[],
  mapSourceId: string,
): boolean {
  try {
    const result = evaluateConditionTree(tree, digest, {
      schema: MANUAL_ISSUANCE_FIELDS,
      extract: (field, ctx) => digestFieldExtractor(field, ctx) as ContextValue,
    });
    return result.matched;
  } catch (err) {
    if (err instanceof ConditionTreeError) {
      logger.warn(
        { err, mapSourceId, code: err.code, path: err.path },
        'manual-issuance: conditionTree threw — falling back to legacy criteria',
      );
      return criteriaMatch(mi, digest, skipped);
    }
    throw err;
  }
}

/** Map ConditionFieldSchema.key → BookingDigest field. The cast at the
 *  evaluator boundary above keeps this function readable + free of
 *  per-case TS narrowing noise. */
function digestFieldExtractor(field: ConditionFieldSchema, digest: BookingDigest): unknown {
  switch (field.key) {
    case 'pax_count':
      return digest.passengerCount;
    case 'per_pax_paise':
      return digest.perPaxAmountPaise;
    case 'total_paise':
      return digest.totalAmountPaise;
    case 'trip_type':
      return digest.tripType;
    case 'sector':
      return digest.sector;
    case 'travel_date':
      return digest.travelDate;
    case 'booking_date':
      return digest.bookingDate;
    case 'is_nonstop':
      return digest.hasNonStop;
    default:
      return undefined;
  }
}

function buildReason(src: SupplierSourceDoc, d: BookingDigest): string {
  const name = (src as unknown as { name?: string }).name ?? 'Map Source';
  return `${name} matched (${d.sector}, ${d.passengerCount} pax, ₹${(d.totalAmountPaise / 100).toFixed(2)})`;
}
