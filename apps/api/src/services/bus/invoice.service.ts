// Bus invoice service.
//
// One entry point for the booking flow: `generateInvoiceForBooking(bookingId)`.
// Produces a tax invoice when:
//   - the booking is BOOKED (not BLOCKED / FAILED / cancelled)
//   - the booking has a `gstProfileId` attached
//   - no invoice already exists for this booking
//
// Idempotency: the unique index on (tenantId, bookingId) means a second
// call for the same booking surfaces a duplicate-key error from Mongo.
// We catch + return the existing row, so callers can re-trigger
// generation safely.
//
// Money: all paise. GST rates as basis points (1800 = 18%). The sum
// of `gstAmountPaise` across all lines equals `cgst + sgst + igst`
// (with at most ±1 paise rounding drift on odd-fraction rates).

import { Types } from 'mongoose';
import { AppError, CODE_PREFIX } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { nextCode } from '../../utils/codes.js';
import { recordAudit } from '../audit.service.js';
import { BusBooking, type BusBookingDoc } from '../../models/BusBooking.js';
import { BusInvoice, type BusInvoiceDoc } from '../../models/BusInvoice.js';
import { GstProfile, type GstProfileDoc } from '../../models/GstProfile.js';
import { Agency } from '../../models/Agency.js';

// ────────── Pure GST math ──────────
//
// Two cases:
//
//   1. Bill-from state == bill-to state (intra-state):
//      - CGST = ½ × gstRate × taxableValue
//      - SGST = ½ × gstRate × taxableValue
//      - IGST = 0
//
//   2. Bill-from state != bill-to state (inter-state):
//      - CGST = 0
//      - SGST = 0
//      - IGST = gstRate × taxableValue
//
// We compute per-line then sum at the invoice level so each line on
// the printed PDF is fully formed and re-checkable.

export interface ComputedLine {
  description: string;
  hsnSacCode: string;
  taxableValuePaise: number;
  gstRateBp: number;
  gstAmountPaise: number;
  totalPaise: number;
}

/**
 * Pure helper — compute one invoice line's GST + total.
 * Money in paise; rate in basis points.
 */
export function computeLine(
  description: string,
  hsnSacCode: string,
  taxableValuePaise: number,
  gstRateBp: number,
): ComputedLine {
  const taxable = Math.max(0, Math.round(taxableValuePaise));
  const gst = Math.round((taxable * Math.max(0, gstRateBp)) / 10_000);
  return {
    description,
    hsnSacCode,
    taxableValuePaise: taxable,
    gstRateBp,
    gstAmountPaise: gst,
    totalPaise: taxable + gst,
  };
}

/**
 * Pure helper — split a GST amount into CGST/SGST/IGST based on
 * whether bill-from + bill-to states match.
 */
export function splitGst(args: {
  gstAmountPaise: number;
  intraState: boolean;
}): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
  const total = Math.max(0, Math.round(args.gstAmountPaise));
  if (!args.intraState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: total };
  }
  // Floor cgst + use the residual on sgst so the sum is exact.
  const cgst = Math.floor(total / 2);
  const sgst = total - cgst;
  return { cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0 };
}

// ────────── Public API ──────────

export interface GenerateInvoiceResult {
  invoice: BusInvoiceDoc;
  /** Whether this call created the row (vs. returning a cached existing one). */
  created: boolean;
}

/**
 * Generate an invoice for a booking. Idempotent: re-runs return the
 * existing row + `created: false`.
 *
 * Caller (booking.service post-BOOKED hook) doesn't await the result —
 * invoice generation is a best-effort downstream of the wallet debit
 * and BookTicket commit. A failed invoice generation must NOT roll back
 * the booking.
 */
export async function generateInvoiceForBooking(
  bookingId: string | Types.ObjectId,
): Promise<GenerateInvoiceResult> {
  const booking = await BusBooking.findById(bookingId);
  if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });
  if (booking.status !== 'BOOKED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${booking.status}; only BOOKED bookings get invoices`,
    });
  }
  if (!booking.gstProfileId) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'booking has no gstProfileId; skip invoice generation',
    });
  }

  // Idempotency.
  const existing = await BusInvoice.findOne({
    tenantId: booking.tenantId,
    bookingId: booking._id,
  });
  if (existing) {
    return { invoice: existing, created: false };
  }

  const profile = await GstProfile.findOne({
    _id: booking.gstProfileId,
    tenantId: booking.tenantId,
  }).lean();
  if (!profile) {
    throw new AppError('NOT_FOUND', { reason: 'gstProfile not found for this booking' });
  }
  // Ensure the agency hasn't been swapped — defensive multi-tenant guard.
  const agency = await Agency.findOne({ _id: booking.agencyId, tenantId: booking.tenantId })
    .select({ _id: 1 })
    .lean();
  if (!agency) {
    throw new AppError('NOT_FOUND', { reason: 'agency not found for this booking' });
  }

  const intraState = profile.state.trim().toLowerCase() === env.TRIPBNG_STATE.trim().toLowerCase();

  // ── Lines ──
  // Two pass-through buckets:
  //   1. Bus operator service line — base fare + OSC + service tax.
  //      GST rate from env (5% for AC, 0 for non-AC; configurable).
  //   2. TripBNG facilitation fee — bookingFeePaise. 18% GST default.
  //
  // The "supplier-side GST is already baked in" case (TBO/SeatSeller
  // gives net of GST) is handled by setting TRIPBNG_BUS_OPERATOR_GST_BP=0
  // in env. Phase 8 ships the conservative path: split GST per line.

  const lines: ComputedLine[] = [];

  // Operator line: base + osc + tax (sum captures the full bus-side spend).
  const operatorTaxable =
    (booking.fareBreakup.baseFarePaise ?? 0) +
    (booking.fareBreakup.operatorServiceChargePaise ?? 0) +
    (booking.fareBreakup.serviceTaxPaise ?? 0);
  if (operatorTaxable > 0) {
    const operatorRate = booking.trip.isAc ? env.TRIPBNG_BUS_OPERATOR_GST_BP : 0;
    lines.push(
      computeLine(
        `Bus passenger transport — ${booking.trip.operatorName || 'Operator'} (${booking.trip.sourceCityName} → ${booking.trip.destinationCityName})`,
        '996412',
        operatorTaxable,
        operatorRate,
      ),
    );
  }

  // Facilitation fee line — only if there's a bookingFeePaise component.
  const facilTaxable = booking.fareBreakup.bookingFeePaise ?? 0;
  if (facilTaxable > 0) {
    lines.push(
      computeLine(
        'TripBNG facilitation fee',
        '998551',
        facilTaxable,
        env.TRIPBNG_SERVICE_GST_BP,
      ),
    );
  }

  if (lines.length === 0) {
    // Edge case — no taxable value. Persist an invoice for paper-trail
    // continuity but with a single zero-line so the model invariant
    // (≥1 line) holds.
    lines.push(
      computeLine(
        `Bus passenger transport — ${booking.trip.operatorName || 'Operator'}`,
        '996412',
        booking.fareBreakup.totalPaise,
        0,
      ),
    );
  }

  const subtotalPaise = lines.reduce((s, l) => s + l.taxableValuePaise, 0);
  const totalGstPaise = lines.reduce((s, l) => s + l.gstAmountPaise, 0);
  const split = splitGst({ gstAmountPaise: totalGstPaise, intraState });
  const totalPaise = subtotalPaise + split.cgstPaise + split.sgstPaise + split.igstPaise;

  const invoiceNumber = await nextCode(CODE_PREFIX.BUS_INVOICE);

  let invoice: BusInvoiceDoc;
  try {
    invoice = await BusInvoice.create({
      tenantId: booking.tenantId,
      bookingId: booking._id,
      agencyId: booking.agencyId,
      gstProfileId: profile._id,
      invoiceNumber,
      issueDate: new Date(),
      billFrom: {
        name: env.TRIPBNG_LEGAL_NAME,
        gstin: env.TRIPBNG_GSTIN,
        pan: env.TRIPBNG_PAN,
        address: env.TRIPBNG_ADDRESS,
        state: env.TRIPBNG_STATE,
        stateCode: env.TRIPBNG_STATE_CODE,
        email: '',
      },
      billTo: {
        name: profile.registrationName,
        gstin: profile.gstin,
        pan: '',
        address: profile.address,
        state: profile.state,
        stateCode: profile.gstin.slice(0, 2),
        email: profile.email,
      },
      lines: lines.map((l) => ({ ...l })),
      subtotalPaise,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise,
      totalPaise,
      gstSplitKind: intraState ? 'INTRA_STATE' : 'INTER_STATE',
      status: 'ISSUED',
    });
  } catch (err) {
    // Race: another worker beat us to the unique index. Return the row
    // they wrote so the caller still gets an idempotent response.
    if (isDuplicateKeyError(err)) {
      const existing2 = await BusInvoice.findOne({
        tenantId: booking.tenantId,
        bookingId: booking._id,
      });
      if (existing2) return { invoice: existing2, created: false };
    }
    throw err;
  }

  await recordAudit({
    tenantId: String(booking.tenantId),
    actorId: String(booking.bookedByUserId),
    actorRole: 'system',
    action: 'bus.invoice.generated',
    resource: 'busInvoice',
    resourceId: String(invoice._id),
    after: {
      invoiceNumber,
      bookingRef: booking.bookingRef,
      subtotalPaise,
      totalPaise,
      gstSplitKind: invoice.gstSplitKind,
    },
  });

  logger.info(
    {
      invoiceId: String(invoice._id),
      invoiceNumber,
      bookingId: String(booking._id),
      bookingRef: booking.bookingRef,
      totalPaise,
      gstSplitKind: invoice.gstSplitKind,
    },
    'bus.invoice: generated',
  );

  return { invoice, created: true };
}

/** Cancel an invoice when the booking is cancelled. Sets status=CANCELLED;
 *  does NOT issue a credit note (Phase 8 ships the simplest path —
 *  full credit-note workflow is a future polish). */
export async function cancelInvoiceForBooking(
  bookingId: string | Types.ObjectId,
  cancellationId: Types.ObjectId,
): Promise<BusInvoiceDoc | null> {
  const invoice = await BusInvoice.findOne({ bookingId });
  if (!invoice) return null;
  if (invoice.status === 'CANCELLED') return invoice;
  invoice.status = 'CANCELLED';
  invoice.cancelledByCancellationId = cancellationId;
  invoice.cancelledAt = new Date();
  await invoice.save();
  return invoice;
}

// ────────── Internals ──────────

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Resolve the gstProfile + bill-to fields used by the booking flow's
 *  SeatSeller blockTicket request. Returned shape matches
 *  SeatSellerGstDetails verbatim. */
export async function resolveSeatSellerGstDetails(
  gstProfileId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId,
): Promise<{
  registrationName: string;
  gstin: string;
  address: string;
  email: string;
  state: string;
} | null> {
  const profile = await GstProfile.findOne({ _id: gstProfileId, tenantId }).lean();
  if (!profile) return null;
  return {
    registrationName: profile.registrationName,
    gstin: profile.gstin,
    address: profile.address,
    email: profile.email,
    state: profile.state,
  };
}

/** Public read helper. Tenant-scoped lookup. */
export async function getInvoiceForBooking(
  tenantId: string,
  bookingId: string,
): Promise<BusInvoiceDoc | null> {
  if (!Types.ObjectId.isValid(bookingId)) return null;
  return BusInvoice.findOne({ tenantId, bookingId });
}

/** Used by tests to verify the GstProfile chain — exported alongside
 *  for the route layer's convenience. */
export type { GstProfileDoc };
