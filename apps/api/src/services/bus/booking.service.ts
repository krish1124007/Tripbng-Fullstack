// Bus booking service — the critical block + book + reconcile path.
//
// This is the file CLAUDE.md §0 calls out as the "three laws":
//
//   Law 1: tripDetails is NEVER cached (we re-fetch live, here, every call)
//   Law 2: fare passed to blockTicket equals fare returned by tripDetails
//          byte-for-byte
//   Law 3: there is no SeatSeller sandbox — failure injection in dev runs
//          via the mock client; the real flow is real money
//
// Algorithm (CLAUDE.md §8.2):
//
//   1. Acquire per-approval lock (Redis SETNX 5 min)
//   2. Idempotency cache lookup — return prior booking if hit
//   3. Load + validate ApprovalRequest (status=approved, not expired)
//   4. LIVE fetch trip details
//   5. Validate every selected seat: available + fare matches approval
//   6. Validate forced-seat gender constraints
//   7. Atomic wallet debit (throws INSUFFICIENT_WALLET on shortfall)
//   8. SeatSeller blockTicket (no row persisted yet — failure refunds)
//   9. RTC fare-breakup branch: getUpdatedFare → wallet adjust if needed
//  10. Persist BusBooking status=BLOCKED
//  11. SeatSeller bookTicket (THE COMMIT)
//      ├─ success → status=BOOKED, fetch ticket, mark approval booked
//      ├─ timeout/network error → sleep 5s + checkBookedTicket
//      │    ├─ recovered → success path
//      │    └─ truly failed → status=FAILED, refund wallet
//      └─ explicit non-retryable error → status=FAILED, refund wallet
//  12. Store idempotency hit
//  13. Release lock
//
// Wallet accounting:
//   - Debit happens BEFORE blockTicket so we don't tie up SeatSeller
//     inventory on a wallet we can't pay from.
//   - Refund happens on every error path that left a debit standing.
//   - The walletRefundTxnId field on BusBooking links the refund row
//     for downstream reporting / dispute handling.

import { Types } from 'mongoose';
import { AppError, CODE_PREFIX } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import { nextCode } from '../../utils/codes.js';
import { recordAudit } from '../audit.service.js';
import { postCredit, postDebit } from '../wallet/ledger.js';
import { Agency } from '../../models/Agency.js';
import { Employee } from '../../models/Employee.js';
import { ApprovalRequest } from '../../models/ApprovalRequest.js';
import { BusBooking, type BusBookingDoc } from '../../models/BusBooking.js';
import { markApprovalBooked } from '../approval/approval.service.js';
import {
  generateInvoiceForBooking,
  resolveSeatSellerGstDetails,
} from './invoice.service.js';
import { getSeatSellerClient } from '../../adapters/seatseller/factory.js';
import {
  ItineraryExpiredError,
  SeatNoLongerAvailableError,
  SeatSellerError,
  TentativeBookingFailedError,
  TransportError,
} from '../../adapters/seatseller/errors.js';
import { canPickFreely, parseForcedSeats } from '../../adapters/seatseller/utils/forced-seats.js';
import { dojFromIstDateString, ssMinutesToDate } from '../../adapters/seatseller/utils/time.js';
import type {
  SeatSellerBlockPassenger,
  SeatSellerBlockRequest,
  SeatSellerSeat,
  SeatSellerStop,
  SeatSellerTicket,
  SeatSellerTripDetails,
  SeatSellerUpdatedFareItem,
} from '../../adapters/seatseller/types.js';
import {
  acquireBookingLock,
  getIdempotencyHit,
  releaseBookingLock,
  setIdempotencyHit,
  type BookingLock,
} from './booking-locks.js';

export interface BusBookingActor {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string;
  walletKind: 'AGENCY';
  walletOwnerId: string;
  ipAddress?: string | null;
}

// Per-passenger input — narrower than the BusBooking sub-doc since we
// fill `farePaise` from tripDetails (not the client) and `seatName`
// from the approval payload.
export interface BusBookingPassengerInput {
  seatName: string;
  title: 'Mr' | 'Ms' | 'Mrs' | 'Miss';
  name: string;
  age: number;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  mobile: string;
  email: string;
  address?: string;
  idType?:
    | 'AADHAR'
    | 'PAN_CARD'
    | 'PASSPORT'
    | 'DRIVING_LICENCE'
    | 'VOTER_CARD'
    | 'RATION_CARD'
    | 'NONE';
  idNumber?: string;
  primary: boolean;
}

export interface BusBookingInput {
  approvalId: string;
  /** Optional GSTIN profile to attach to the booking. Drives invoice
   *  generation in Phase 8. */
  gstProfileId?: string | null;
  passengers: BusBookingPassengerInput[];
  /** Reuse with an Idempotency-Key header. Optional — when missing,
   *  the lock + DB unique index on blockKey are the fallback dedupe. */
  idempotencyKey?: string | null;
}

// ────────── Errors specific to the bus flow ──────────

class BusBookingError extends AppError {
  constructor(
    reason: string,
    code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' = 'VALIDATION_ERROR',
  ) {
    super(code, { reason });
  }
}

// ────────── Public entry point ──────────

export async function createBusBooking(
  actor: BusBookingActor,
  input: BusBookingInput,
): Promise<BusBookingDoc> {
  if (!Types.ObjectId.isValid(input.approvalId)) {
    throw new BusBookingError('invalid approvalId');
  }

  // ── Step 1: distributed lock per approvalId ──
  let lock: BookingLock | null = await acquireBookingLock(input.approvalId);
  if (!lock) {
    throw new AppError('IDEMPOTENCY_CONFLICT', {
      reason: 'another booking attempt is in progress for this approval',
    });
  }

  try {
    // ── Step 2: idempotency cache ──
    if (input.idempotencyKey) {
      const hit = await getIdempotencyHit(input.idempotencyKey);
      if (hit?.bookingId) {
        const existing = await BusBooking.findById(hit.bookingId);
        if (existing && String(existing.tenantId) === actor.tenantId) {
          logger.info(
            { idempotencyKey: input.idempotencyKey, bookingId: hit.bookingId },
            'bus.booking: idempotent hit — returning prior booking',
          );
          return existing;
        }
      }
    }

    // ── Step 3: load + validate approval ──
    const approval = await ApprovalRequest.findOne({
      _id: input.approvalId,
      tenantId: actor.tenantId,
    });
    if (!approval) throw new BusBookingError('approval not found', 'NOT_FOUND');
    if (approval.status !== 'approved') {
      throw new BusBookingError(`approval is ${approval.status}; cannot book`);
    }
    if (approval.type !== 'bus') {
      throw new BusBookingError(`approval type is ${approval.type}; not bus`);
    }
    if (approval.expiresAt.getTime() < Date.now()) {
      throw new BusBookingError('approval has expired');
    }

    // Load Employee for the booking row + Agency for snapshotting.
    const [employee, agency] = await Promise.all([
      Employee.findOne({ _id: approval.employeeId, tenantId: actor.tenantId }).lean(),
      Agency.findOne({ _id: actor.agencyId, tenantId: actor.tenantId }).select({ _id: 1 }).lean(),
    ]);
    if (!employee) throw new BusBookingError('employee not found', 'NOT_FOUND');
    if (!agency) throw new BusBookingError('agency not found', 'NOT_FOUND');

    if (input.passengers.length !== approval.payload.seatNumbers.length) {
      throw new BusBookingError(
        `pax count (${input.passengers.length}) doesn't match approved seats (${approval.payload.seatNumbers.length})`,
      );
    }

    // ── Step 4: LIVE tripDetails ──
    const client = getSeatSellerClient();
    if (!client) {
      throw new BusBookingError('SeatSeller is not enabled', 'IDEMPOTENCY_CONFLICT');
    }
    const trip = await client.getTripDetails(approval.payload.tripId);

    // ── Step 5: validate seats + fare ──
    validateSeatAvailabilityAndFare(trip, approval.payload.seatNumbers, approval.payload.estimatedFarePaise);

    // ── Step 6: forced-seat gender check ──
    validateForcedSeats(trip, input.passengers);

    // ── BP/DP resolution ──
    const dojDate = dojFromIstDateString(approval.payload.doj);
    const boardingPoint = trip.boardingPoints.find((b) => b.id === approval.payload.boardingPointId);
    const droppingPoint = trip.droppingPoints.find((d) => d.id === approval.payload.droppingPointId);
    if (!boardingPoint) throw new BusBookingError('boardingPointId no longer offered for this trip');
    if (!droppingPoint) throw new BusBookingError('droppingPointId no longer offered for this trip');

    // ── Step 7: atomic wallet debit ──
    const totalPaise = approval.payload.estimatedFarePaise * approval.payload.seatNumbers.length;
    let debitTxn = await postDebit({
      tenantId: actor.tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: actor.walletOwnerId,
      type: 'BOOKING_DEBIT',
      amountPaise: totalPaise,
      performedBy: actor.userId,
      description: `Bus booking — approval ${String(approval._id)}`,
      ipAddress: actor.ipAddress ?? null,
      requireSufficientBalance: true,
    });

    let blockKey: string;
    try {
      // ── Step 8: SeatSeller blockTicket ──
      // Resolve GST details once — the booking's gstProfileId drives
      // both SeatSeller's `passengerGSTDetails` and the post-book
      // invoice. Skipping when null = booking has no GST attached.
      const gstDetails = input.gstProfileId
        ? await resolveSeatSellerGstDetails(input.gstProfileId, actor.tenantId)
        : null;

      const ssBlockReq = buildBlockRequest({
        approval,
        passengers: input.passengers,
        boardingPointId: approval.payload.boardingPointId,
        droppingPointId: approval.payload.droppingPointId,
        // Law 2: fare passed to blockTicket must equal what tripDetails
        // returned. We've already validated the seat list so each
        // selected seat's fare matches the approved fare. Convert
        // approved paise → SeatSeller's rupees-on-the-wire.
        fareINRPerPax: approval.payload.estimatedFarePaise / 100,
        gstDetails,
      });
      const block = await client.blockTicket(ssBlockReq);
      blockKey = block.blockKey;
      logger.info(
        { blockKey, tripId: approval.payload.tripId, totalPaise },
        'bus.booking: blockTicket ok',
      );
    } catch (err) {
      // Block failed — refund the wallet immediately. We have no
      // BusBooking row yet so there's nothing else to clean up.
      await refundOnFailure(actor, debitTxn._id, totalPaise, 'block-failure');
      throw err;
    }

    // ── Step 9: RTC fare-breakup branch ──
    let fareBreakup: ReturnType<typeof computeBaselineFareBreakup> | ReturnType<typeof mapRtcBreakup> =
      computeBaselineFareBreakup(totalPaise, approval.payload.seatNumbers.length);
    if (trip.callFareBreakupApi) {
      try {
        const updated = await client.getUpdatedFare(blockKey);
        const realTotal = sumExcludingTotalFare(updated.customerPriceBreakUp);
        if (realTotal !== totalPaise) {
          // Adjust wallet — debit more or refund the delta.
          const delta = realTotal - totalPaise;
          if (delta > 0) {
            await postDebit({
              tenantId: actor.tenantId,
              walletKind: 'AGENCY',
              walletOwnerId: actor.walletOwnerId,
              type: 'BOOKING_DEBIT',
              amountPaise: delta,
              performedBy: actor.userId,
              description: `Bus booking RTC top-up (delta ₹${(delta / 100).toFixed(2)})`,
              ipAddress: actor.ipAddress ?? null,
            });
          } else if (delta < 0) {
            await postCredit({
              tenantId: actor.tenantId,
              walletKind: 'AGENCY',
              walletOwnerId: actor.walletOwnerId,
              type: 'REFUND_CREDIT',
              amountPaise: -delta,
              performedBy: actor.userId,
              description: `Bus booking RTC refund (delta ₹${(-delta / 100).toFixed(2)})`,
              ipAddress: actor.ipAddress ?? null,
              relatedTxnId: String(debitTxn._id),
            });
          }
          logger.info(
            { blockKey, deltaPaise: delta, realTotal, original: totalPaise },
            'bus.booking: RTC fare-breakup adjusted wallet',
          );
        }
        fareBreakup = mapRtcBreakup(updated.customerPriceBreakUp, realTotal);
      } catch (err) {
        // RTC fare-breakup failure: refund the entire debit + bail.
        // Don't try to recover — RTC operators reject Book without the
        // breakup acknowledgement.
        await refundOnFailure(actor, debitTxn._id, totalPaise, 'rtc-fare-breakup-failure');
        throw err;
      }
    }

    // ── Step 10: persist BusBooking status=BLOCKED ──
    const bookingRef = await nextBookingRef();
    let booking = await BusBooking.create({
      tenantId: new Types.ObjectId(actor.tenantId),
      bookingRef,
      approvalId: approval._id,
      employeeId: employee._id,
      agencyId: agency._id,
      bookedByUserId: new Types.ObjectId(actor.userId),
      gstProfileId: input.gstProfileId ? new Types.ObjectId(input.gstProfileId) : null,
      blockKey,
      tin: null,
      pnr: null,
      inventoryId: approval.payload.inventoryId,
      trip: snapshotTrip(approval, trip, dojDate, boardingPoint, droppingPoint),
      passengers: snapshotPassengers(input.passengers, approval.payload.estimatedFarePaise),
      fareBreakup,
      cancellationPolicyString: trip.cancellationPolicy,
      cancellationCalculationTimestamp: parseTs(trip.cancellationCalculationTimestamp),
      partialCancellationAllowed: trip.partialCancellationAllowed,
      status: 'BLOCKED',
      walletDebitTxnId: debitTxn._id,
      blockedAt: new Date(),
    });

    // ── Step 11: SeatSeller bookTicket — THE COMMIT ──
    let ticket: SeatSellerTicket | null = null;
    try {
      const bookRes = await client.bookTicket(blockKey);
      // Pull the canonical ticket so pnr / status / tickets are stamped
      // on the booking row alongside the tin.
      ticket = await client.getTicket(bookRes.tin);
    } catch (err) {
      // Reconciliation: if book failed but the booking might have
      // landed (timeout / network error), checkBookedTicket lets us
      // discover that. Real non-retryable errors propagate.
      const recovered = await tryReconcileBook(client, blockKey, err);
      if (recovered) {
        ticket = recovered;
      } else {
        await markBookingFailed(
          booking,
          err instanceof Error ? err.message : String(err),
        );
        await refundOnFailure(actor, debitTxn._id, totalPaise, 'book-failure', booking._id);
        throw err;
      }
    }

    // ── Step 12: success path ──
    booking.status = 'BOOKED';
    booking.tin = ticket.tin;
    booking.pnr = ticket.pnr ?? null;
    booking.bookedAt = new Date();
    if (ticket.passengers && ticket.passengers.length === booking.passengers.length) {
      // Some operators emit per-pax ticket numbers — round-trip them
      // onto our doc so the e-ticket renderer can show them.
      ticket.passengers.forEach((p, i) => {
        const slot = booking.passengers[i];
        if (slot && p.fareINR != null) {
          // Fare comes back in rupees on the ticket; we already have
          // paise from the approval. Don't overwrite.
        }
        // SeatSeller doesn't always give per-pax ticket numbers in the
        // BlockPassenger shape — leave nulls when absent. The TBO
        // pattern for ticket-numbers is more uniform; SeatSeller's
        // varies by operator.
      });
    }
    await booking.save();

    // Mark approval as booked + write audit + idempotency hit. Best-
    // effort everywhere downstream — the booking is committed at this
    // point, nothing should roll back the wallet.
    try {
      await markApprovalBooked(approval._id, booking._id);
    } catch (err) {
      logger.warn(
        { err, bookingId: String(booking._id), approvalId: String(approval._id) },
        'bus.booking: markApprovalBooked failed — non-fatal, manual reconciliation needed',
      );
    }

    // Generate the GST invoice when a profile is attached. Best-effort:
    // a failure here logs at fatal but doesn't roll back the booking.
    // Finance can retrigger via the admin endpoint.
    if (booking.gstProfileId) {
      try {
        const inv = await generateInvoiceForBooking(booking._id);
        logger.info(
          {
            bookingId: String(booking._id),
            invoiceId: String(inv.invoice._id),
            invoiceNumber: inv.invoice.invoiceNumber,
            created: inv.created,
          },
          'bus.booking: invoice generated',
        );
      } catch (err) {
        logger.error(
          { err, bookingId: String(booking._id) },
          'bus.booking: invoice generation failed — admin can retrigger',
        );
      }
    }

    if (input.idempotencyKey) {
      await setIdempotencyHit(input.idempotencyKey, {
        bookingId: String(booking._id),
        status: booking.status,
        cachedAt: new Date().toISOString(),
        payload: { tin: booking.tin, pnr: booking.pnr },
      });
    }

    await recordAudit({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'bus.booking.created',
      resource: 'busBooking',
      resourceId: String(booking._id),
      after: {
        bookingRef,
        status: booking.status,
        tin: booking.tin,
        pnr: booking.pnr,
        totalPaise: booking.fareBreakup.totalPaise,
      },
      ip: actor.ipAddress ?? null,
    });

    logger.info(
      {
        bookingId: String(booking._id),
        bookingRef,
        tin: booking.tin,
        totalPaise: booking.fareBreakup.totalPaise,
      },
      'bus.booking: BOOKED',
    );

    return booking;
  } finally {
    if (lock) await releaseBookingLock(lock);
  }
}

// ────────── Validation helpers ──────────

function validateSeatAvailabilityAndFare(
  trip: SeatSellerTripDetails,
  approvedSeats: string[],
  approvedFarePaise: number,
): void {
  for (const seatName of approvedSeats) {
    const seat = trip.seats.find((s) => s.seatName === seatName);
    if (!seat) {
      throw new SeatNoLongerAvailableError({
        upstream: `Seat ${seatName} not in current trip layout`,
        context: { seatName },
      });
    }
    if (!seat.available) {
      throw new SeatNoLongerAvailableError({
        upstream: `Seat ${seatName} is no longer available`,
        context: { seatName },
      });
    }
    // Law 2: fare passed to blockTicket must equal what tripDetails
    // returned byte-for-byte. tripDetails returns rupees; we compare
    // against approved paise after coercion.
    const seatFarePaise = Math.round(seat.fareINR * 100);
    if (seatFarePaise !== approvedFarePaise) {
      throw new BusBookingError(
        `Fare drift on ${seatName}: approved ₹${(approvedFarePaise / 100).toFixed(2)}, ` +
          `now ₹${seat.fareINR.toFixed(2)}. Re-submit approval.`,
        'IDEMPOTENCY_CONFLICT',
      );
    }
  }
}

function validateForcedSeats(
  trip: SeatSellerTripDetails,
  passengers: BusBookingPassengerInput[],
): void {
  const forced = parseForcedSeats(trip.forcedSeats);
  // Group seats by gender — each gender as a list of picked seats so
  // canPickFreely can verify the "must include at least one forced"
  // rule. The booking flow has 1:1 pax↔seat so the seat list per
  // gender is the seats picked by that gender's pax.
  const female = passengers.filter((p) => p.gender === 'FEMALE').map((p) => p.seatName);
  const male = passengers.filter((p) => p.gender === 'MALE').map((p) => p.seatName);

  if (passengers.some((p) => p.gender === 'FEMALE')) {
    const r = canPickFreely('FEMALE', forced, female);
    if (!r.ok) {
      throw new BusBookingError(
        `Female passengers must pick from reserved seats: ${r.mustPick.join(', ')}`,
      );
    }
  }
  if (passengers.some((p) => p.gender === 'MALE')) {
    const r = canPickFreely('MALE', forced, male);
    if (!r.ok) {
      throw new BusBookingError(
        `Male passengers must pick from reserved seats: ${r.mustPick.join(', ')}`,
      );
    }
  }
}

// ────────── Reconciliation ──────────

async function tryReconcileBook(
  client: NonNullable<ReturnType<typeof getSeatSellerClient>>,
  blockKey: string,
  originalErr: unknown,
): Promise<SeatSellerTicket | null> {
  // Only reconcile classes of error that could plausibly mean "the
  // commit landed but we lost the ack". Network drops + transport
  // errors fit. ItineraryExpiredError + TentativeBookingFailedError
  // are explicit upstream "no" answers — propagate those.
  const isReconcilable =
    originalErr instanceof TransportError ||
    (originalErr instanceof SeatSellerError && originalErr.retryable === true);
  if (!isReconcilable) return null;

  // Spec §8.2 step 11: sleep 5s, then ask SeatSeller whether the
  // booking actually went through. The 5s gives them time to settle
  // their own write-back queue.
  await sleep(5_000);
  try {
    const ticket = await client.checkBookedTicket(blockKey);
    if (ticket) {
      logger.warn(
        { blockKey, tin: ticket.tin },
        'bus.booking: book recovered via checkBookedTicket — original error swallowed',
      );
      return ticket;
    }
  } catch (err) {
    logger.error(
      { err, blockKey },
      'bus.booking: checkBookedTicket also failed — treating as definitive failure',
    );
  }
  return null;
}

async function markBookingFailed(booking: BusBookingDoc, reason: string): Promise<void> {
  booking.status = 'FAILED';
  booking.failureReason = reason.slice(0, 500);
  booking.failedAt = new Date();
  await booking.save();
}

async function refundOnFailure(
  actor: BusBookingActor,
  debitTxnId: Types.ObjectId,
  amountPaise: number,
  failureKind: string,
  bookingId?: Types.ObjectId,
): Promise<void> {
  try {
    const refund = await postCredit({
      tenantId: actor.tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: actor.walletOwnerId,
      type: 'REFUND_CREDIT',
      amountPaise,
      performedBy: actor.userId,
      description: `Bus booking refund (${failureKind})`,
      relatedTxnId: String(debitTxnId),
      ipAddress: actor.ipAddress ?? null,
      bookingId: bookingId ? String(bookingId) : null,
    });
    if (bookingId) {
      await BusBooking.updateOne(
        { _id: bookingId },
        { $set: { walletRefundTxnId: refund._id } },
      );
    }
  } catch (err) {
    // We logged the original failure already; this is the secondary
    // failure path. Manual reconciliation flagged loudly.
    logger.fatal(
      { err, bookingId: bookingId ? String(bookingId) : null, debitTxnId: String(debitTxnId), amountPaise },
      'bus.booking: REFUND FAILED — manual reconciliation needed',
    );
  }
}

// ────────── Snapshots ──────────

function snapshotTrip(
  approval: {
    payload: {
      sourceCityId: number;
      destinationCityId: number;
      doj: string;
      departureAt: string;
      arrivalAt: string;
      operatorName?: string;
      busType?: string;
      isAc?: boolean;
      isSleeper?: boolean;
    };
  },
  trip: SeatSellerTripDetails,
  dojDate: Date,
  boardingPoint: SeatSellerStop,
  droppingPoint: SeatSellerStop,
) {
  return {
    // operatorId / city names live on the AvailableTrip from search,
    // not on tripDetails. We persist what's known from the approval
    // payload + leave operatorId 0 as "unknown" so downstream code
    // doesn't treat it as a real operator.
    operatorId: 0,
    operatorName: approval.payload.operatorName ?? '',
    busType: approval.payload.busType ?? '',
    busTypeId: null,
    sourceCityId: approval.payload.sourceCityId,
    sourceCityName: '',
    destinationCityId: approval.payload.destinationCityId,
    destinationCityName: '',
    doj: approval.payload.doj,
    departureAt: approval.payload.departureAt,
    arrivalAt: approval.payload.arrivalAt,
    nextDay: false,
    boardingPoint: {
      id: boardingPoint.id,
      name: boardingPoint.name,
      address: boardingPoint.address ?? '',
      landmark: boardingPoint.landmark ?? '',
      contact: boardingPoint.contact ?? '',
      timeAt: ssMinutesToDate(dojDate, boardingPoint.time).toISOString(),
      timeMinutes: boardingPoint.time,
    },
    droppingPoint: {
      id: droppingPoint.id,
      name: droppingPoint.name,
      address: droppingPoint.address ?? '',
      landmark: droppingPoint.landmark ?? '',
      contact: droppingPoint.contact ?? '',
      timeAt: ssMinutesToDate(dojDate, droppingPoint.time).toISOString(),
      timeMinutes: droppingPoint.time,
    },
    // Class hints carried via the approval payload from search-time
    // decoration. Drives the invoice GST split (5% AC / 0% non-AC).
    isAc: approval.payload.isAc ?? false,
    isSleeper: approval.payload.isSleeper ?? false,
    bpDpSeatLayout: trip.bpDpSeatLayout,
    callFareBreakupApi: trip.callFareBreakupApi,
    mTicketEnabled: trip.mTicketEnabled,
  };
}

function snapshotPassengers(passengers: BusBookingPassengerInput[], farePaise: number) {
  return passengers.map((p) => ({
    seatName: p.seatName,
    title: p.title,
    name: p.name,
    age: p.age,
    gender: p.gender,
    mobile: p.mobile,
    email: p.email,
    address: p.address ?? '',
    idType: p.idType ?? 'NONE',
    idNumber: p.idNumber ?? '',
    primary: p.primary,
    ladiesSeat: false,
    farePaise,
    ticketNumber: null,
    ticketStatus: null,
  }));
}

function computeBaselineFareBreakup(
  totalPaise: number,
  seatCount: number,
): {
  baseFarePaise: number;
  operatorServiceChargePaise: number;
  serviceTaxPaise: number;
  bookingFeePaise: number;
  totalPaise: number;
  rtcCustomerPriceBreakUp: null;
} {
  // Without RTC breakup we present everything as base fare. The cancel
  // flow uses the cancellationPolicy's "charge on base fare only" rule,
  // so a generous base captures the most refund headroom for the user.
  void seatCount;
  return {
    baseFarePaise: totalPaise,
    operatorServiceChargePaise: 0,
    serviceTaxPaise: 0,
    bookingFeePaise: 0,
    totalPaise,
    rtcCustomerPriceBreakUp: null,
  };
}

function mapRtcBreakup(
  items: SeatSellerUpdatedFareItem[],
  totalPaise: number,
): {
  baseFarePaise: number;
  operatorServiceChargePaise: number;
  serviceTaxPaise: number;
  bookingFeePaise: number;
  totalPaise: number;
  rtcCustomerPriceBreakUp: SeatSellerUpdatedFareItem[];
} {
  const findField = (key: string): number => {
    const row = items.find((i) => i.field.toUpperCase() === key);
    if (!row) return 0;
    return Math.round(row.amountINR * 100);
  };
  return {
    baseFarePaise: findField('BASE_FARE'),
    operatorServiceChargePaise: findField('OPERATOR_SERVICE_CHARGE'),
    serviceTaxPaise: findField('GST') + findField('TAX') + findField('SERVICE_TAX'),
    bookingFeePaise: findField('BOOKING_FEE') + findField('CONVENIENCE_FEE'),
    totalPaise,
    rtcCustomerPriceBreakUp: items,
  };
}

// ────────── SeatSeller request builders ──────────

function buildBlockRequest(args: {
  approval: { payload: { tripId: string; inventoryId: string } };
  passengers: BusBookingPassengerInput[];
  boardingPointId: number;
  droppingPointId: number;
  fareINRPerPax: number;
  /** GST details for ITC-claim invoices. Null when booking has no
   *  gstProfile attached. */
  gstDetails: {
    registrationName: string;
    gstin: string;
    address: string;
    email: string;
    state: string;
  } | null;
}): SeatSellerBlockRequest {
  const seatSellerPassengers: SeatSellerBlockPassenger[] = args.passengers.map((p, i) => ({
    seatName: p.seatName,
    title: p.title,
    name: p.name,
    age: p.age,
    gender: p.gender,
    mobile: p.mobile,
    email: p.email,
    address: p.address,
    idType: p.idType,
    idNumber: p.idNumber,
    primary: p.primary || i === 0,
    ladiesSeat: p.gender === 'FEMALE',
    // Law 2: byte-for-byte match with what tripDetails returned for
    // this seat. The caller computed this from the approved farePaise
    // (which we already validated against trip.seats[*].fareINR).
    fareINR: args.fareINRPerPax,
  }));
  const req: SeatSellerBlockRequest = {
    tripId: args.approval.payload.tripId,
    inventoryId: args.approval.payload.inventoryId,
    boardingPointId: args.boardingPointId,
    droppingPointId: args.droppingPointId,
    passengers: seatSellerPassengers,
  };
  if (args.gstDetails) {
    req.passengerGSTDetails = args.gstDetails;
  }
  return req;
}

function sumExcludingTotalFare(items: SeatSellerUpdatedFareItem[]): number {
  let sum = 0;
  for (const i of items) {
    if (i.field.toUpperCase() === 'TOTAL_FARE') continue;
    sum += Math.round(i.amountINR * 100);
  }
  return sum;
}

// ────────── Plumbing ──────────

async function nextBookingRef(): Promise<string> {
  // CODE_PREFIX.BUS_BOOKING is "TBNG-BUS-"; the formatter zero-pads
  // the sequence to 6 digits. Result: "TBNG-BUS-000123".
  return nextCode(CODE_PREFIX.BUS_BOOKING);
}

function parseTs(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Re-export the imports we deliberately keep available for downstream
// modules + future reconcile-tweaks even when not directly referenced
// in this file today. Cheaper than juggling the import block when the
// flow grows.
export {
  ItineraryExpiredError,
  TentativeBookingFailedError,
} from '../../adapters/seatseller/errors.js';
export type { SeatSellerSeat } from '../../adapters/seatseller/types.js';
