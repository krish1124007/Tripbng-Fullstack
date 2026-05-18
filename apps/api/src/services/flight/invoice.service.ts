// Flight invoice service.
//
// Public entry: `generateInvoiceForFlightBooking(bookingId)`.
//
// When called:
//   - Booking must be TICKETED (we don't issue invoices for HOLDs or
//     FAILEDs).
//   - Booking must have GST details captured on the booking form
//     (gst.number + gst.companyName + gst.address). Bookings without
//     GST are skipped — agency can't claim ITC anyway.
//   - No existing invoice for this booking (idempotent — re-runs
//     return the existing row + `created: false`).
//
// Mirrors the BusInvoice pattern (apps/api/src/services/bus/invoice.service.ts)
// so finance can reconcile the two product lines through identical
// schemas later. The only flight-specific bit is the air-transport
// SAC code (996425) and the travel-class-aware GST rate.

import { Types } from 'mongoose';
import { AppError, CODE_PREFIX } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { nextCode } from '../../utils/codes.js';
import { recordAudit } from '../audit.service.js';
import { Booking, type BookingDoc } from '../../models/Booking.js';
import { FlightInvoice, type FlightInvoiceDoc } from '../../models/FlightInvoice.js';
import { Agency } from '../../models/Agency.js';

// ────────── Pure GST math (same as bus) ──────────

export interface ComputedLine {
  description: string;
  hsnSacCode: string;
  taxableValuePaise: number;
  gstRateBp: number;
  gstAmountPaise: number;
  totalPaise: number;
}

/** Compute one invoice line's GST + total. Pure helper. */
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

/** Split a GST amount into CGST/SGST/IGST based on the intra-state flag. */
export function splitGst(args: {
  gstAmountPaise: number;
  intraState: boolean;
}): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
  const total = Math.max(0, Math.round(args.gstAmountPaise));
  if (!args.intraState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: total };
  }
  const cgst = Math.floor(total / 2);
  const sgst = total - cgst;
  return { cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0 };
}

// ────────── Public API ──────────

export interface GenerateInvoiceResult {
  invoice: FlightInvoiceDoc;
  created: boolean;
}

/**
 * Generate a tax invoice for a confirmed flight booking. Idempotent:
 * re-running returns the existing invoice + `created: false`.
 *
 * Skips silently (returns null) when:
 *   - Booking doesn't exist
 *   - Booking isn't TICKETED
 *   - Booking has no GST details captured
 *
 * Throws AppError only on infrastructure failures — callers (booking
 * confirm hook) should NOT fail the booking flow on invoice errors.
 * Invoice generation is best-effort: a missing invoice can always be
 * generated later via `POST /:id/flight-invoice/regenerate`.
 */
export async function generateInvoiceForFlightBooking(
  bookingId: string | Types.ObjectId,
): Promise<GenerateInvoiceResult | null> {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    logger.warn({ bookingId: String(bookingId) }, 'flight-invoice: booking not found');
    return null;
  }
  if (booking.productType !== 'FLIGHT') {
    logger.warn(
      { bookingId: String(bookingId), productType: booking.productType },
      'flight-invoice: not a flight booking',
    );
    return null;
  }
  if (booking.status !== 'TICKETED') {
    logger.debug(
      { bookingId: String(bookingId), status: booking.status },
      'flight-invoice: booking not TICKETED, skipping',
    );
    return null;
  }
  if (
    !booking.gst?.number ||
    !booking.gst.companyName ||
    !booking.gst.address
  ) {
    logger.debug(
      { bookingId: String(bookingId) },
      'flight-invoice: no GST details on booking, skipping',
    );
    return null;
  }

  // Idempotency — return existing row when present.
  const existing = await FlightInvoice.findOne({
    tenantId: booking.tenantId,
    bookingId: booking._id,
  });
  if (existing) {
    return { invoice: existing, created: false };
  }

  // Fetch the agency for `billTo.name` fallback if not explicitly
  // overridden by the booking's gst.companyName.
  const agency = await Agency.findById(booking.agencyId).select('companyName').lean();

  // ────────── Build line items ──────────
  //
  // Two lines: (a) air-passenger transport service (5% / 12%), and
  // (b) TripBng facilitation fee (18%, computed off platform markup).
  //
  // We compute from the booking's frozen pricing snapshot so the
  // numbers don't drift if markups change later.

  const lines: ComputedLine[] = [];

  // Air-transport line — base fare + taxes (taxes from airline are
  // already-baked statutory levies; we treat them as part of the
  // taxable transport service value).
  const transportTaxable =
    (booking.pricing?.baseFarePaise ?? 0) + (booking.pricing?.taxesPaise ?? 0);
  if (transportTaxable > 0) {
    const isBusinessOrFirst =
      booking.travelClass === 'BUSINESS' || booking.travelClass === 'FIRST';
    const transportRate = isBusinessOrFirst
      ? env.TRIPBNG_FLIGHT_BUSINESS_GST_BP
      : env.TRIPBNG_FLIGHT_ECONOMY_GST_BP;
    lines.push(
      computeLine(
        `Air passenger transport — ${booking.sector ?? 'route'} (${booking.travelClass})`,
        '996425',
        transportTaxable,
        transportRate,
      ),
    );
  }

  // Facilitation fee — TripBng's markup is treated as a separately
  // taxable service line. Only included when there's a markup.
  const facilitationTaxable =
    (booking.pricing?.platformMarkupPaise ?? 0) +
    (booking.pricing?.distributorMarkupPaise ?? 0);
  if (facilitationTaxable > 0) {
    lines.push(
      computeLine(
        'TripBng facilitation fee',
        '998551',
        facilitationTaxable,
        env.TRIPBNG_SERVICE_GST_BP,
      ),
    );
  }

  // Zero-value fallback so the model invariant (≥1 line) holds.
  if (lines.length === 0) {
    lines.push(
      computeLine(
        `Air passenger transport — ${booking.sector ?? 'route'}`,
        '996425',
        booking.pricing?.grossAmountPaise ?? 0,
        0,
      ),
    );
  }

  // ────────── Totals + state split ──────────

  const subtotalPaise = lines.reduce((s, l) => s + l.taxableValuePaise, 0);
  const totalGstPaise = lines.reduce((s, l) => s + l.gstAmountPaise, 0);

  // GST split — agency's state code from their GSTIN's first two
  // chars. Empty / malformed GSTIN falls back to inter-state.
  const billToStateCode = booking.gst.number.slice(0, 2).toUpperCase();
  const intraState = billToStateCode === env.TRIPBNG_STATE_CODE.toUpperCase();
  const split = splitGst({ gstAmountPaise: totalGstPaise, intraState });
  const totalPaise =
    subtotalPaise + split.cgstPaise + split.sgstPaise + split.igstPaise;

  const invoiceNumber = await nextCode(CODE_PREFIX.FLIGHT_INVOICE);

  // ────────── Persist ──────────

  let invoice: FlightInvoiceDoc;
  try {
    invoice = await FlightInvoice.create({
      tenantId: booking.tenantId,
      bookingId: booking._id,
      agencyId: booking.agencyId,
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
        name: booking.gst.companyName ?? agency?.companyName ?? 'Customer',
        gstin: booking.gst.number,
        pan: '',
        address: booking.gst.address,
        // We don't capture the customer's full state name on the form
        // — pull it from agency record or leave blank for v1.
        state: agency?.companyName ? '' : '',
        stateCode: billToStateCode,
        email: booking.contact?.email ?? '',
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
    if (isDuplicateKeyError(err)) {
      // Race — another worker beat us to the unique index.
      const existing2 = await FlightInvoice.findOne({
        tenantId: booking.tenantId,
        bookingId: booking._id,
      });
      if (existing2) return { invoice: existing2, created: false };
    }
    throw err;
  }

  await recordAudit({
    tenantId: String(booking.tenantId),
    actorId: String(booking.bookedByUserId ?? booking.agencyId),
    actorRole: 'system',
    action: 'flight.invoice.generated',
    resource: 'flightInvoice',
    resourceId: String(invoice._id),
    after: {
      invoiceNumber,
      bookingCode: booking.bookingCode,
      subtotalPaise,
      totalPaise,
      gstSplitKind: invoice.gstSplitKind,
    },
  });

  logger.info(
    {
      invoiceNumber,
      bookingCode: booking.bookingCode,
      subtotalPaise,
      totalPaise,
      gstSplitKind: invoice.gstSplitKind,
    },
    'flight invoice generated',
  );

  return { invoice, created: true };
}

/**
 * Cancel an existing flight invoice. Used when the booking itself is
 * cancelled — leaves the invoice row in place (audit trail) but flips
 * its status to CANCELLED so finance can spot it on the next report.
 *
 * Does NOT issue a credit note — Indian GST allows in-place invoice
 * cancellation as long as the original was never paid out + the
 * cancellation falls in the same financial month.
 */
export async function cancelFlightInvoice(
  bookingId: string | Types.ObjectId,
): Promise<void> {
  const inv = await FlightInvoice.findOne({ bookingId });
  if (!inv || inv.status === 'CANCELLED') return;
  inv.status = 'CANCELLED';
  inv.cancelledAt = new Date();
  await inv.save();
  logger.info(
    { invoiceNumber: inv.invoiceNumber, bookingId: String(bookingId) },
    'flight invoice cancelled',
  );
}

/**
 * Get the invoice for a booking. Returns null when none exists (e.g.
 * non-GST booking, or invoice generation failed silently and was
 * never retried).
 */
export async function getInvoiceForFlightBooking(
  tenantId: string | Types.ObjectId,
  bookingId: string | Types.ObjectId,
): Promise<FlightInvoiceDoc | null> {
  return FlightInvoice.findOne({
    tenantId: new Types.ObjectId(String(tenantId)),
    bookingId: new Types.ObjectId(String(bookingId)),
  });
}

// ────────── Local helpers ──────────

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number })?.code === 11_000;
}

// AppError is imported for symmetry with the bus service even if we
// don't currently throw it from the public path — keeps the import
// stable across future refactors.
void AppError;
