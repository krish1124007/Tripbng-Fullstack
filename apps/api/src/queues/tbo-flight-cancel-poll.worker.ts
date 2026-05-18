// Flight cancel-poll worker — re-checks Air/GetChangeRequestStatus until
// terminal. Mirrors the hotel cancel-poll pattern (queues/tbo-cancel-poll.worker.ts)
// but operates on the Booking row directly rather than a separate
// HotelCancellationJob document.
//
// Flow:
//   1. services/booking.cancelBooking dispatches Air/SendChangeRequest and
//      stamps the Booking with supplierCancellationRef + status=PENDING.
//      Then enqueues the first poll (60s delay).
//   2. This worker calls adapter.getChangeRequestStatus(changeRequestId).
//   3. Updates booking.supplierCancellationStatus to PENDING / IN_PROGRESS /
//      PROCESSED / REJECTED / FAILED based on the response.
//   4. On non-terminal status, re-enqueues itself with TBO_CANCEL_POLL_INTERVAL_MS
//      delay. Caps at TBO_CANCEL_POLL_MAX_ATTEMPTS to avoid infinite loops.
//   5. On terminal status: refund/charge mismatches between TBO and our
//      local math get logged at fatal level for ops review (we trust our
//      local math, not TBO's, but flag divergences).

import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { Booking } from '../models/Booking.js';
import { getTboFlightAdapterIfConfigured } from '../adapters/registry.js';
import { SupplierAdapterError } from '../adapters/types.js';
import { enqueueFlightCancelPoll, type FlightCancelPollJob } from './index.js';

const TERMINAL = new Set<string>(['PROCESSED', 'REJECTED']);

export async function tboFlightCancelPollProcessor(
  job: Job<FlightCancelPollJob>,
): Promise<void> {
  const { bookingId, attempt } = job.data;
  const booking = await Booking.findById(bookingId).select(
    'supplierCode supplierCancellationRef supplierCancellationStatus pricing',
  );
  if (!booking) {
    logger.warn({ bookingId }, 'tbo.flight-cancel-poll: booking not found');
    return;
  }
  // Only TBO bookings should be in this queue. Defensive guard in case the
  // queue ever gets cross-contaminated by an ops mistake.
  if (booking.supplierCode !== 'TBO') {
    logger.warn(
      { bookingId, supplier: booking.supplierCode },
      'tbo.flight-cancel-poll: non-TBO booking dispatched to flight queue — skipping',
    );
    return;
  }
  if (!booking.supplierCancellationRef) {
    logger.warn(
      { bookingId },
      'tbo.flight-cancel-poll: no supplierCancellationRef — nothing to poll',
    );
    return;
  }
  // Already settled — exit cleanly. Idempotent on stale jobs.
  if (
    booking.supplierCancellationStatus &&
    TERMINAL.has(booking.supplierCancellationStatus)
  ) {
    return;
  }
  if (attempt >= env.TBO_CANCEL_POLL_MAX_ATTEMPTS) {
    logger.error(
      {
        bookingId,
        attempt,
        cancellationRef: booking.supplierCancellationRef,
      },
      'tbo.flight-cancel-poll: max attempts exceeded — leaving in current state for ops',
    );
    return;
  }

  const adapter = getTboFlightAdapterIfConfigured();
  if (!adapter) {
    // TBO got disabled mid-flight; can't poll. Leave the booking flagged.
    logger.warn(
      { bookingId },
      'tbo.flight-cancel-poll: TBO adapter not configured — abandoning poll',
    );
    return;
  }

  const changeRequestId = Number.parseInt(booking.supplierCancellationRef, 10);
  if (!Number.isFinite(changeRequestId) || changeRequestId <= 0) {
    logger.error(
      { bookingId, ref: booking.supplierCancellationRef },
      'tbo.flight-cancel-poll: invalid ChangeRequestId — abandoning poll',
    );
    return;
  }

  try {
    const result = await adapter.getChangeRequestStatus(changeRequestId);
    booking.supplierCancellationStatus = result.status === 'UNKNOWN'
      ? booking.supplierCancellationStatus // don't overwrite known state with UNKNOWN
      : result.status;
    booking.supplierCancellationLastPolledAt = new Date();
    await booking.save();

    logger.info(
      {
        bookingId,
        attempt,
        status: result.status,
        refundAmountPaise: result.refundAmountPaise,
        cancellationChargePaise: result.cancellationChargePaise,
      },
      'tbo.flight-cancel-poll: poll done',
    );

    // Terminal — log divergence for ops, then exit.
    if (result.status === 'PROCESSED') {
      // We already credited the wallet locally during cancelBooking().
      // TBO's RefundAmount is informational; flag if it materially
      // diverges from our number (>1 INR difference = manual review).
      const ourRefund = booking.pricing?.agencyPayablePaise ?? 0;
      const tboRefund = result.refundAmountPaise ?? null;
      if (tboRefund !== null && Math.abs(tboRefund - ourRefund) > 100) {
        logger.fatal(
          {
            bookingId,
            ourRefundPaise: ourRefund,
            tboRefundPaise: tboRefund,
            diffPaise: tboRefund - ourRefund,
          },
          'tbo.flight-cancel-poll: refund amount mismatch — manual reconciliation needed',
        );
      }
      return;
    }
    if (result.status === 'REJECTED') {
      logger.fatal(
        { bookingId, remarks: result.remarks },
        'tbo.flight-cancel-poll: TBO rejected the cancel — local refund already credited; ops needs to unwind or rebook',
      );
      return;
    }

    // Non-terminal — re-enqueue.
    await enqueueFlightCancelPoll(
      { bookingId, attempt: attempt + 1 },
      env.TBO_CANCEL_POLL_INTERVAL_MS,
    );
  } catch (err) {
    // Transient supplier failure — re-enqueue and keep going. Persistent
    // failures eventually hit MAX_ATTEMPTS and get abandoned.
    const code =
      err instanceof SupplierAdapterError ? err.code : 'unknown';
    logger.warn(
      { err, bookingId, attempt, code },
      'tbo.flight-cancel-poll: poll failed — re-enqueuing',
    );
    await enqueueFlightCancelPoll(
      { bookingId, attempt: attempt + 1 },
      env.TBO_CANCEL_POLL_INTERVAL_MS,
    );
  }
}
