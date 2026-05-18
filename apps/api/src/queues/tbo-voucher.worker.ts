// Voucher worker — fires at (lastCancellationDate − VOUCHER_LEAD_HOURS)
// for HELD bookings. Idempotent: voucherHotelBooking returns no_op when the
// booking is already VOUCHERED.
//
// Failures are non-fatal — BullMQ's exponential backoff retries up to N
// attempts. After max retries the job moves to the failed queue and ops
// can manually trigger via POST /bookings/:id/voucher.

import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { HotelBooking } from '../models/HotelBooking.js';
import { voucherHotelBooking } from '../services/tbo/voucher.service.js';

interface VoucherJob {
  bookingId: string;
}

export async function tboVoucherProcessor(job: Job<VoucherJob>): Promise<void> {
  const { bookingId } = job.data;
  const booking = await HotelBooking.findById(bookingId).select('status bookedByUserId tenantId agencyId').lean();
  if (!booking) {
    logger.warn({ bookingId }, 'tbo.voucher-worker: booking not found');
    return;
  }
  if (booking.status !== 'HELD') {
    logger.info(
      { bookingId, status: booking.status },
      'tbo.voucher-worker: status no longer HELD, skipping',
    );
    return;
  }

  // Use the bookedByUser as the actor — this is a system-driven flow but
  // we want the audit trail to attribute to a real user when possible.
  const result = await voucherHotelBooking(bookingId, {
    tenantId: String(booking.tenantId),
    userId: String(booking.bookedByUserId),
    role: 'AGENCY',
    agencyId: booking.agencyId ? String(booking.agencyId) : null,
  });
  logger.info(
    { bookingId, kind: result.kind, confirmationNo: result.confirmationNo },
    'tbo.voucher-worker: done',
  );
}
