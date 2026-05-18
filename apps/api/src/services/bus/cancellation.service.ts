// Bus cancellation service.
//
// Three public entry points:
//
//   previewCancellation(actor, bookingId, seatsToCancel?)
//     Wraps SeatSeller getCancellationData. Returns the operator-side
//     preview WITHOUT committing — the agent reviews + confirms in the UI.
//     LIVE every call (CLAUDE.md §7 forbidden cache list).
//
//   cancelBooking(actor, bookingId, opts)
//     Commit. Calls SeatSeller cancelTicket, posts the wallet refund,
//     persists a BusCancellation row, transitions BusBooking status to
//     CANCELLED (full) or PARTIALLY_CANCELLED (some seats remain).
//
//   processOperatorCancellation(tin)
//     Background-worker entry. The bus-cancellation-poller picks up
//     SeatSeller's busCancellationInfo list and calls this per tin.
//     Different reason codes trigger different refund math.
//
// Money convention: integer paise. The user-cancel path uses
// SeatSeller's calculated charge directly (operator is the source of
// truth for fees). Our local cancellation-policy parser is available
// for cross-validation but not used as primary — production parity
// with the operator UI matters more than enforcing our own math.

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { recordAudit } from '../audit.service.js';
import { postCredit } from '../wallet/ledger.js';
import {
  BusBooking,
  type BusBookingDoc,
  type BusBookingStatus,
} from '../../models/BusBooking.js';
import {
  BusCancellation,
  type BusCancellationDoc,
  type BusCancellationReason,
} from '../../models/BusCancellation.js';
import { getSeatSellerClient } from '../../adapters/seatseller/factory.js';
import { SeatSellerError } from '../../adapters/seatseller/errors.js';
import type {
  SeatSellerCancellationData,
  SeatSellerTicket,
} from '../../adapters/seatseller/types.js';

// ────────── Actor ──────────

export interface BusCancellationActor {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string;
  ipAddress?: string | null;
}

// ────────── Preview ──────────

export interface CancellationPreview {
  bookingId: string;
  bookingRef: string;
  /** Per-seat refund preview — surfaced to the agent before commit. */
  seats: Array<{
    seatName: string;
    baseFarePaise: number;
    cancellationChargePaise: number;
    refundPaise: number;
  }>;
  totalChargePaise: number;
  totalRefundPaise: number;
  /** Echo of SeatSeller's response — debug only. */
  raw?: SeatSellerCancellationData;
}

/**
 * Fetch the live cancellation preview for a booking. Always hits
 * SeatSeller — the cancel preview is policy-time-sensitive (charges
 * change as departure approaches).
 */
export async function previewCancellation(
  actor: BusCancellationActor,
  bookingId: string,
): Promise<CancellationPreview> {
  if (!Types.ObjectId.isValid(bookingId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid bookingId' });
  }
  const booking = await BusBooking.findOne({
    _id: bookingId,
    tenantId: actor.tenantId,
    agencyId: actor.agencyId,
  });
  if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });
  if (!booking.tin) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${booking.status}; no SeatSeller tin to cancel`,
    });
  }
  if (!isCancellable(booking.status)) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${booking.status}; cannot preview cancellation`,
    });
  }

  const client = getSeatSellerClient();
  if (!client) {
    throw new SeatSellerError('SEATSELLER_DISABLED', 'Bus cancellation is disabled');
  }
  const data = await client.getCancellationData(booking.tin);

  // Convert SeatSeller's rupees-on-the-wire to paise. Round at the
  // boundary so we never carry float drift downstream.
  const seats = data.seats.map((s) => ({
    seatName: s.seatName,
    baseFarePaise: rupeesToPaise(s.baseFareINR),
    cancellationChargePaise: rupeesToPaise(s.cancellationChargeINR),
    refundPaise: rupeesToPaise(s.refundINR),
  }));

  return {
    bookingId: String(booking._id),
    bookingRef: booking.bookingRef,
    seats,
    totalChargePaise: rupeesToPaise(data.totalChargeINR),
    totalRefundPaise: rupeesToPaise(data.totalRefundINR),
    raw: data,
  };
}

// ────────── Commit (user cancellation) ──────────

export interface CancelBookingInput {
  /** When set, cancel only these seats (partial). Empty/missing = full cancel. */
  seatsToCancel?: string[];
  /** Free-form reason captured for audit. Optional but encouraged. */
  note?: string;
}

export interface CancelBookingResult {
  booking: BusBookingDoc;
  cancellation: BusCancellationDoc;
  refundPaise: number;
  chargePaise: number;
}

/**
 * Commit a user-initiated cancellation. Algorithm:
 *
 *   1. Validate booking + cancellable status
 *   2. SeatSeller cancelTicket
 *   3. Persist BusCancellation row (status=INITIATED)
 *   4. Post wallet refund (postCredit)
 *   5. Mark cancellation COMPLETED + stamp refundTxnId
 *   6. Transition BusBooking: full → CANCELLED, partial → PARTIALLY_CANCELLED
 *   7. Audit + return
 *
 * Failure handling:
 *   - SeatSeller cancelTicket throws → no rows persisted, error propagates
 *   - Wallet refund fails AFTER cancelTicket succeeded → cancellation row
 *     stays FAILED + we log fatal so finance can manually post the credit.
 *     Booking transitions still happen (the seats ARE cancelled at the
 *     supplier); the agent doesn't lose the cancellation flow over a
 *     wallet hiccup.
 */
export async function cancelBooking(
  actor: BusCancellationActor,
  bookingId: string,
  input: CancelBookingInput = {},
): Promise<CancelBookingResult> {
  if (!Types.ObjectId.isValid(bookingId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid bookingId' });
  }
  const booking = await BusBooking.findOne({
    _id: bookingId,
    tenantId: actor.tenantId,
    agencyId: actor.agencyId,
  });
  if (!booking) throw new AppError('NOT_FOUND', { reason: 'booking not found' });
  if (!booking.tin) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${booking.status}; no SeatSeller tin to cancel`,
    });
  }
  if (!isCancellable(booking.status)) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${booking.status}; cannot cancel`,
    });
  }

  // Resolve which seats to cancel. Empty / missing → full booking.
  const liveSeats = booking.passengers.map((p) => p.seatName);
  const requested = input.seatsToCancel?.filter((s) => s.length > 0) ?? [];
  const seatsToCancel = requested.length > 0 ? requested : liveSeats;

  // Validate every requested seat is part of this booking and isn't
  // already cancelled (we'd otherwise double-charge wallets on stacked
  // partial cancels).
  const alreadyCancelled = await BusCancellation.find({
    bookingId: booking._id,
    status: { $in: ['INITIATED', 'COMPLETED'] },
  })
    .select({ seatsCancelled: 1 })
    .lean();
  const alreadyCancelledSeats = new Set<string>(
    alreadyCancelled.flatMap((c) => c.seatsCancelled),
  );
  for (const s of seatsToCancel) {
    if (!liveSeats.includes(s)) {
      throw new AppError('VALIDATION_ERROR', { reason: `seat ${s} is not on this booking` });
    }
    if (alreadyCancelledSeats.has(s)) {
      throw new AppError('VALIDATION_ERROR', { reason: `seat ${s} is already cancelled` });
    }
  }

  const client = getSeatSellerClient();
  if (!client) {
    throw new SeatSellerError('SEATSELLER_DISABLED', 'Bus cancellation is disabled');
  }

  // ── SeatSeller cancelTicket ──
  const ssRes = await client.cancelTicket({
    tin: booking.tin,
    seatsToCancel: requested.length > 0 ? requested : undefined,
  });

  const refundPaise = rupeesToPaise(ssRes.refundAmountINR);
  const chargePaise = rupeesToPaise(ssRes.cancellationChargeINR);

  // ── Persist cancellation row ──
  const cancellation = await BusCancellation.create({
    tenantId: booking.tenantId,
    bookingId: booking._id,
    seatsCancelled: ssRes.cancelledSeats.length > 0 ? ssRes.cancelledSeats : seatsToCancel,
    cancellationChargePaise: chargePaise,
    refundAmountPaise: refundPaise,
    reason: 'USER',
    rawResponse: ssRes,
    cancellationReference: ssRes.cancellationReference ?? null,
    status: 'INITIATED',
    initiatedByUserId: new Types.ObjectId(actor.userId),
    note: input.note ?? '',
    confirmedAt: new Date(),
  });

  // ── Wallet refund ──
  if (refundPaise > 0) {
    try {
      const refundTxn = await postCredit({
        tenantId: actor.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: actor.agencyId,
        type: 'REFUND_CREDIT',
        amountPaise: refundPaise,
        performedBy: actor.userId,
        bookingId: String(booking._id),
        relatedTxnId: booking.walletDebitTxnId ? String(booking.walletDebitTxnId) : undefined,
        description: `Bus cancellation refund — ${booking.bookingRef} (seats ${ssRes.cancelledSeats.join(', ')})`,
        ipAddress: actor.ipAddress ?? null,
      });
      cancellation.refundTxnId = refundTxn._id;
      cancellation.status = 'COMPLETED';
      await cancellation.save();
    } catch (err) {
      cancellation.status = 'FAILED';
      await cancellation.save();
      logger.fatal(
        { err, bookingId: String(booking._id), refundPaise },
        'bus.cancellation: REFUND POST FAILED — manual reconciliation required',
      );
      // Don't rethrow — the supplier already cancelled. The booking
      // transition + cancellation row stand; finance handles the
      // wallet credit out-of-band.
    }
  } else {
    // No refund (full charge / 0% slab) — mark COMPLETED immediately.
    cancellation.status = 'COMPLETED';
    await cancellation.save();
  }

  // ── BusBooking transition ──
  const allCancelledSeats = new Set<string>([...alreadyCancelledSeats, ...cancellation.seatsCancelled]);
  const fullCancel = liveSeats.every((s) => allCancelledSeats.has(s));
  booking.status = fullCancel ? 'CANCELLED' : 'PARTIALLY_CANCELLED';
  booking.cancelledAt = new Date();
  if (cancellation.refundTxnId && !booking.walletRefundTxnId) {
    booking.walletRefundTxnId = cancellation.refundTxnId;
  }
  await booking.save();

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: fullCancel ? 'bus.booking.cancelled' : 'bus.booking.partially_cancelled',
    resource: 'busBooking',
    resourceId: String(booking._id),
    after: {
      seatsCancelled: cancellation.seatsCancelled,
      chargePaise,
      refundPaise,
      bookingStatus: booking.status,
    },
    ip: actor.ipAddress ?? null,
  });

  logger.info(
    {
      bookingId: String(booking._id),
      bookingRef: booking.bookingRef,
      seats: cancellation.seatsCancelled,
      refundPaise,
      chargePaise,
      status: booking.status,
    },
    'bus.cancellation: committed',
  );

  return { booking, cancellation, refundPaise, chargePaise };
}

// ────────── Commit (operator cancellation) ──────────
//
// Called by the bus-cancellation-poller worker when SeatSeller's
// busCancellationInfo surfaces a tin we have on file. Different
// reasons trigger different refund math:
//   - BUS_CANCELLATION (operator off-trip)        → full refund (incl. OSC)
//   - BO_CANCELLATION  (operator-admin action)    → full refund
//   - ALTERNATE_ARRANGEMENT                       → partial refund (use
//                                                   SeatSeller's number)

export async function processOperatorCancellation(tin: string): Promise<{
  bookingId: string | null;
  refundPaise: number;
  reason: BusCancellationReason | null;
  skipped?: 'not-found' | 'already-cancelled' | 'operator-disabled' | 'pre-tin';
}> {
  const client = getSeatSellerClient();
  if (!client) return { bookingId: null, refundPaise: 0, reason: null, skipped: 'operator-disabled' };

  const booking = await BusBooking.findOne({ tin });
  if (!booking) return { bookingId: null, refundPaise: 0, reason: null, skipped: 'not-found' };
  if (booking.status === 'CANCELLED' || booking.status === 'OPERATOR_CANCELLED') {
    return {
      bookingId: String(booking._id),
      refundPaise: 0,
      reason: null,
      skipped: 'already-cancelled',
    };
  }

  // Pull the canonical ticket — gives us cancellationReason/Message +
  // refundAmount that the bare busCancellationInfo doesn't carry.
  const ticket = await client.getTicket(tin);
  const reason = mapTicketReason(ticket);
  const refundPaise = ticketRefundPaise(ticket, booking);

  // Persist a cancellation row + refund the wallet. We don't call
  // cancelTicket here — SeatSeller already did that on the operator
  // side; we're only mirroring state.
  const liveSeats = booking.passengers.map((p) => p.seatName);

  const cancellation = await BusCancellation.create({
    tenantId: booking.tenantId,
    bookingId: booking._id,
    seatsCancelled: liveSeats,
    cancellationChargePaise: 0, // operator cancellations don't charge the user
    refundAmountPaise: refundPaise,
    reason,
    rawResponse: { ticket },
    note: ticket.cancellationMessage ?? '',
    cancellationReference: null,
    initiatedByUserId: null,
    status: 'INITIATED',
    confirmedAt: ticket.cancelledAt ? new Date(ticket.cancelledAt) : new Date(),
  });

  if (refundPaise > 0) {
    try {
      // Resolve agency for wallet credit. Operator-cancel rows have no
      // user actor; we use the booking's bookedByUserId for the
      // performedBy field as a stand-in.
      const refundTxn = await postCredit({
        tenantId: String(booking.tenantId),
        walletKind: 'AGENCY',
        walletOwnerId: String(booking.agencyId),
        type: 'REFUND_CREDIT',
        amountPaise: refundPaise,
        performedBy: String(booking.bookedByUserId),
        bookingId: String(booking._id),
        relatedTxnId: booking.walletDebitTxnId ? String(booking.walletDebitTxnId) : undefined,
        description: `Bus operator-cancellation refund — ${booking.bookingRef} (${reason})`,
      });
      cancellation.refundTxnId = refundTxn._id;
      cancellation.status = 'COMPLETED';
      await cancellation.save();
      if (!booking.walletRefundTxnId) {
        booking.walletRefundTxnId = refundTxn._id;
      }
    } catch (err) {
      cancellation.status = 'FAILED';
      await cancellation.save();
      logger.fatal(
        { err, bookingId: String(booking._id), refundPaise, tin },
        'bus.cancellation.operator: REFUND POST FAILED — manual reconciliation required',
      );
    }
  } else {
    cancellation.status = 'COMPLETED';
    await cancellation.save();
  }

  booking.status = 'OPERATOR_CANCELLED';
  booking.operatorCancelledAt = ticket.cancelledAt ? new Date(ticket.cancelledAt) : new Date();
  await booking.save();

  await recordAudit({
    tenantId: String(booking.tenantId),
    actorId: null,
    actorRole: 'system',
    action: 'bus.booking.operator_cancelled',
    resource: 'busBooking',
    resourceId: String(booking._id),
    after: { reason, refundPaise, tin },
  });

  return { bookingId: String(booking._id), refundPaise, reason };
}

// ────────── Helpers ──────────

function isCancellable(status: BusBookingStatus): boolean {
  return status === 'BOOKED' || status === 'PARTIALLY_CANCELLED';
}

function rupeesToPaise(v: number | undefined): number {
  if (v === undefined || v === null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.round(v * 100));
}

function mapTicketReason(ticket: SeatSellerTicket): BusCancellationReason {
  const raw = (ticket.cancellationReason ?? '').toUpperCase();
  if (raw.includes('BUS_CANCEL')) return 'BUS_CANCELLATION';
  if (raw.includes('BO_CANCEL')) return 'BO_CANCELLATION';
  if (raw.includes('ALTERNATE')) return 'ALTERNATE_ARRANGEMENT';
  // Default to BUS_CANCELLATION when SeatSeller doesn't classify —
  // most permissive on the refund side, ops can re-classify if needed.
  return 'BUS_CANCELLATION';
}

function ticketRefundPaise(ticket: SeatSellerTicket, booking: BusBookingDoc): number {
  // Trust SeatSeller's number when present; otherwise fall back to the
  // booking's totalPaise — operator cancellations refund 100% by default.
  if (ticket.refundAmountINR != null && ticket.refundAmountINR >= 0) {
    return rupeesToPaise(ticket.refundAmountINR);
  }
  return booking.fareBreakup.totalPaise;
}

// Re-export mapper helpers for tests + the poller worker.
export { mapTicketReason as _mapTicketReasonForTests };
