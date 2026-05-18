// Pending booking poller — resolves the "TBO accepted but isn't confirmed
// yet" state.
//
// Triggered when book.service routes a Book result with HotelBookingStatus
// =Pending. We delay the FIRST poll by INITIAL_DELAY (≥120s per TBO),
// then re-enqueue every INTERVAL until either:
//   - status resolves (CONFIRMED, FAILED, …), or
//   - MAX_ATTEMPTS attempts have been made.
//
// On max-attempts, we leave the booking in PENDING_SUPPLIER and add a
// statusHistory note for ops. (Future: alert the ops inbox.)

import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { HotelBooking } from '../models/HotelBooking.js';
import { mapBookingDetailResponse } from '../adapters/tbo/mappers/book.mapper.js';
import { fetchBookingDetail } from '../services/tbo/booking-detail.service.js';
import { TboError } from '../adapters/tbo/errors.js';
import { getTboPendingBookingPollQueue } from './index.js';
import { buildLifecycleVars } from '../services/tbo/book.service.js';
import { enqueueAlert } from '../services/alerts/index.js';
import { refundHotelBookingDebit } from '../services/tbo/refund.js';

interface PendingPollJob {
  bookingId: string;
}

export async function tboPendingBookingPollProcessor(job: Job<PendingPollJob>): Promise<void> {
  const { bookingId } = job.data;
  const booking = await HotelBooking.findById(bookingId);
  if (!booking) {
    logger.warn({ bookingId }, 'tbo.pending-poll: booking not found');
    return;
  }

  // Bail out if status already moved on (e.g. user cancelled, admin synced).
  if (booking.status !== 'PENDING_SUPPLIER') {
    logger.info({ bookingId, status: booking.status }, 'tbo.pending-poll: status changed, stopping');
    return;
  }

  const attempts = (booking.pendingPoll?.attempts ?? 0) + 1;

  let outcome;
  try {
    const { raw } = await fetchBookingDetail(bookingId);
    outcome = mapBookingDetailResponse(raw);
    booking.rawResponses = { ...(booking.rawResponses ?? {}), bookingDetail: raw };
  } catch (err) {
    // Transport / TBO error — log and either retry or give up.
    logger.warn(
      { err: err instanceof TboError ? err.code : err, bookingId, attempts },
      'tbo.pending-poll: detail fetch failed',
    );
    outcome = null;
  }

  booking.pendingPoll = { attempts, lastPolledAt: new Date() };

  if (outcome?.kind === 'confirmed') {
    booking.supplierRefs = {
      ...(booking.supplierRefs ?? {}),
      confirmationNo: outcome.refs.confirmationNo ?? booking.supplierRefs?.confirmationNo ?? null,
      bookingId: outcome.refs.bookingId ?? booking.supplierRefs?.bookingId ?? null,
      bookingRefNo: outcome.refs.bookingRefNo ?? booking.supplierRefs?.bookingRefNo ?? null,
      invoiceNumber: outcome.refs.invoiceNumber ?? booking.supplierRefs?.invoiceNumber ?? null,
      bookingCode: booking.supplierRefs?.bookingCode ?? null,
      traceId: booking.supplierRefs?.traceId ?? null,
    };
    booking.confirmedAt = new Date();
    booking.vouchredAt = new Date();
    booking.status = 'VOUCHERED';
    booking.statusHistory.push({
      status: 'VOUCHERED',
      at: new Date(),
      by: booking.bookedByUserId as Types.ObjectId,
      note: `pending-poll resolved → confirmed after ${attempts} attempt(s)`,
    });
    await booking.save();
    void enqueueAlert(
      { event: 'HOTEL_BOOKING_CONFIRMED', vars: buildLifecycleVars(booking) },
      [
        { kind: 'user', id: String(booking.bookedByUserId) },
        { kind: 'booking_contact', bookingId: String(booking._id) },
      ],
      {
        tenantId: String(booking.tenantId),
        correlationKey: `hotel-booking:${String(booking._id)}`,
      },
    ).catch(() => undefined);
    return;
  }

  if (outcome?.kind === 'held') {
    booking.status = 'HELD';
    booking.statusHistory.push({
      status: 'HELD',
      at: new Date(),
      by: booking.bookedByUserId as Types.ObjectId,
      note: `pending-poll resolved → held; awaiting voucher`,
    });
    await booking.save();
    return;
  }

  if (outcome?.kind === 'failed') {
    // Refund the wallet debit posted at Book time. Mutates booking
    // in-place; we save below so refund txn id + status transition land in
    // the same Mongo write.
    const refundResult = await refundHotelBookingDebit({
      doc: booking,
      amountPaise: booking.pricing?.totalSellingPaise ?? 0,
      description: `Hotel booking ${booking.hotel?.name ?? booking.supplierRefs?.bookingCode} — supplier rejected (${outcome.error.code})`,
      performedByUserId: String(booking.bookedByUserId),
    });

    booking.status = 'BOOK_FAILED';
    booking.statusHistory.push({
      status: 'BOOK_FAILED',
      at: new Date(),
      by: booking.bookedByUserId as Types.ObjectId,
      note: `pending-poll resolved → failed: ${outcome.error.message}; refund=${refundResult.outcome}`,
    });
    await booking.save();

    if (refundResult.outcome === 'failed') {
      // Refund failed — already logged.fatal inside the helper. The booking
      // is still marked BOOK_FAILED (status is right; only wallet is wrong).
      logger.error(
        { bookingId, refundReason: refundResult.reason },
        'tbo.pending-poll: status transitioned but REFUND FAILED — manual reconciliation required',
      );
    } else {
      logger.info(
        { bookingId, error: outcome.error, refund: refundResult.outcome },
        'tbo.pending-poll: SUPPLIER FAILED — refunded',
      );
    }

    void enqueueAlert(
      {
        event: 'HOTEL_BOOKING_FAILED',
        vars: {
          ...buildLifecycleVars(booking),
          failureReason: outcome.error.message,
        },
      },
      [
        { kind: 'user', id: String(booking.bookedByUserId) },
        ...(booking.agencyId
          ? [{ kind: 'agency' as const, id: String(booking.agencyId) }]
          : []),
      ],
      {
        tenantId: String(booking.tenantId),
        correlationKey: `hotel-booking:${String(booking._id)}`,
      },
    ).catch(() => undefined);
    return;
  }

  // Still pending (or fetch failed). Re-enqueue if under the limit.
  if (attempts >= env.TBO_PENDING_POLL_MAX_ATTEMPTS) {
    booking.statusHistory.push({
      status: 'PENDING_SUPPLIER',
      at: new Date(),
      by: booking.bookedByUserId as Types.ObjectId,
      note: `pending-poll giving up after ${attempts} attempts; manual ops review needed`,
    });
    await booking.save();
    logger.error(
      { bookingId, attempts },
      'tbo.pending-poll: max attempts exceeded — booking stuck PENDING_SUPPLIER',
    );
    return;
  }

  await booking.save();
  await getTboPendingBookingPollQueue().add(
    'poll',
    { bookingId },
    { delay: env.TBO_PENDING_POLL_INTERVAL_MS },
  );
}
