// Cancel orchestration.
//
// Two phases:
//   1. requestCancel() — calls TBO SendChangeRequest (RequestType=4 HotelCancel),
//      creates a HotelCancellationJob row, transitions the booking to
//      CANCEL_REQUESTED, enqueues a poll.
//   2. pollCancelStatus(jobId) — calls TBO GetChangeRequestStatus, updates
//      the job + (on terminal status) credits the refund and transitions
//      the booking to CANCELLED / CANCEL_REJECTED.
//
// Refund money flow (when ChangeRequestStatus = Processed):
//   - TBO returns RefundAmount (decimal rupees) and CancellationCharge.
//   - We post a wallet credit for the refund (paise integer).
//   - We tag the credit on the cancellation job (refundCreditedAt set) so
//     duplicate Processed responses don't double-credit.

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import {
  HotelBooking,
  type HotelBookingDoc,
  type HotelBookingStatus,
} from '../../models/HotelBooking.js';
import {
  HotelCancellationJob,
  type HotelCancellationJobDoc,
  type CancelJobStatus,
} from '../../models/HotelCancellationJob.js';
import { postCredit } from '../wallet/ledger.js';
import {
  TBO_CHANGE_REQUEST_STATUS,
  type TboChangeRequestPayload,
  type TboChangeRequestResponse,
  type TboChangeRequestStatusRequest,
  type TboChangeRequestStatusResponse,
} from '../../adapters/tbo/types/lifecycle.js';
import { toNumberOrNull } from '../../adapters/tbo/parsers.js';
import { tboCall } from './client.js';
import { getTboCancelPollQueue } from '../../queues/index.js';
import { env } from '../../config/env.js';
import { enqueueAlert } from '../alerts/index.js';
import { buildLifecycleVars } from './book.service.js';

export interface CancelContext {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string | null;
  ipAddress?: string | null;
}

export interface RequestCancelInput {
  bookingId: string;
  remarks: string;
}

export interface RequestCancelResult {
  jobId: string;
  changeRequestId: number | null;
  status: CancelJobStatus;
}

/** Step 1: kick off the cancel. Returns immediately after enqueueing the
 *  poll — the caller polls /cancel-status to track progress. */
export async function requestCancel(
  ctx: CancelContext,
  input: RequestCancelInput,
): Promise<RequestCancelResult> {
  if (!Types.ObjectId.isValid(input.bookingId)) throw new AppError('NOT_FOUND');
  const filter: Record<string, unknown> = {
    _id: input.bookingId,
    tenantId: ctx.tenantId,
  };
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') filter.agencyId = ctx.agencyId;
  const booking = await HotelBooking.findOne(filter);
  if (!booking) throw new AppError('NOT_FOUND');

  // Only confirmed/vouchered bookings can be cancelled. HOLD goes through a
  // separate "release the hold" pathway (Phase 4 — out of scope here).
  if (booking.status !== 'CONFIRMED' && booking.status !== 'VOUCHERED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot cancel booking in status ${booking.status}`,
    });
  }
  const supplierBookingId = booking.supplierRefs?.bookingId;
  if (!supplierBookingId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'no supplier BookingId — cannot cancel' });
  }

  // Hit TBO synchronously to get the ChangeRequestId. If it succeeds we
  // create the job; if it fails we surface the error and don't.
  const body: TboChangeRequestPayload = {
    ClientId: '',
    TokenId: '',
    EndUserIp: '',
    BookingId: supplierBookingId,
    RequestType: 4,
    CancellationRemarks: input.remarks.slice(0, 500),
  };
  const res = await tboCall<TboChangeRequestResponse>({
    method: 'SendChangeRequest',
    host: 'hotelBe',
    path: '/SendChangeRequest',
    body: body as unknown as Record<string, unknown>,
    ctx: { bookingId: String(booking._id), bookingCode: booking.supplierRefs?.bookingCode ?? null },
  });

  if (!res.ChangeRequestId) {
    throw new AppError('SUPPLIER_UNAVAILABLE', {
      reason: 'TBO SendChangeRequest returned no ChangeRequestId',
    });
  }

  const job = await HotelCancellationJob.create({
    bookingId: booking._id,
    tenantId: new Types.ObjectId(ctx.tenantId),
    supplierBookingId,
    changeRequestId: res.ChangeRequestId,
    changeRequestStatus: 'Pending',
    remarks: input.remarks,
    requestedByUserId: new Types.ObjectId(ctx.userId),
  });

  await transitionStatus(booking, 'CANCEL_REQUESTED', ctx.userId, `cancel requested via TBO CR#${res.ChangeRequestId}`);

  // Enqueue first poll. BullMQ delay so the worker doesn't immediately
  // re-hit TBO before they've moved the request out of NotSet.
  await getTboCancelPollQueue().add(
    'poll-cancel',
    { jobId: String(job._id) },
    { delay: env.TBO_CANCEL_POLL_INTERVAL_MS },
  );

  logger.info(
    {
      bookingId: String(booking._id),
      jobId: String(job._id),
      changeRequestId: res.ChangeRequestId,
    },
    'tbo.cancel: change request opened',
  );

  return {
    jobId: String(job._id),
    changeRequestId: res.ChangeRequestId,
    status: 'Pending',
  };
}

/**
 * Step 2: one poll iteration. Called by the cancel-poll worker; idempotent
 * on terminal statuses.
 *
 * Returns whether the job is still in flight (caller decides whether to
 * re-enqueue) and the new status string for telemetry.
 */
export async function pollCancelStatus(
  jobId: string,
): Promise<{ done: boolean; status: CancelJobStatus }> {
  if (!Types.ObjectId.isValid(jobId)) throw new AppError('NOT_FOUND');
  const job = await HotelCancellationJob.findById(jobId);
  if (!job) throw new AppError('NOT_FOUND');
  if (job.completedAt) return { done: true, status: job.changeRequestStatus };
  if (!job.changeRequestId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'job has no ChangeRequestId' });
  }

  const body: TboChangeRequestStatusRequest = {
    ClientId: '',
    TokenId: '',
    EndUserIp: '',
    ChangeRequestId: job.changeRequestId,
  };
  const res = await tboCall<TboChangeRequestStatusResponse>({
    method: 'GetChangeRequestStatus',
    host: 'hotelBe',
    path: '/GetChangeRequestStatus',
    body: body as unknown as Record<string, unknown>,
    ctx: { bookingId: String(job.bookingId) },
  });

  job.pollAttempts = (job.pollAttempts ?? 0) + 1;
  job.lastPolledAt = new Date();

  const code = res.ChangeRequestStatus ?? TBO_CHANGE_REQUEST_STATUS.NOT_SET;
  job.changeRequestStatus = mapCancelStatus(code);
  job.cancellationChargePaise = decimalToPaise(res.CancellationCharge);
  job.refundAmountPaise = decimalToPaise(res.RefundAmount);

  // Terminal — Processed or Rejected.
  if (
    code === TBO_CHANGE_REQUEST_STATUS.PROCESSED ||
    code === TBO_CHANGE_REQUEST_STATUS.REJECTED
  ) {
    job.completedAt = new Date();
    if (code === TBO_CHANGE_REQUEST_STATUS.PROCESSED) {
      await maybeIssueRefund(job);
      await applyTerminalToBooking(job, 'CANCELLED', `TBO change request processed (CR#${job.changeRequestId})`);
    } else {
      await applyTerminalToBooking(
        job,
        'CANCEL_REJECTED',
        `TBO change request rejected (CR#${job.changeRequestId}): ${res.Remarks ?? 'no reason given'}`,
      );
    }
    await job.save();
    return { done: true, status: job.changeRequestStatus };
  }

  await job.save();
  return { done: false, status: job.changeRequestStatus };
}

// ────────── helpers ──────────

async function maybeIssueRefund(job: HotelCancellationJobDoc): Promise<void> {
  if (job.refundCreditedAt) return; // already credited
  if (!job.refundAmountPaise || job.refundAmountPaise <= 0) return;

  const booking = await HotelBooking.findById(job.bookingId);
  if (!booking?.agencyId) {
    logger.warn(
      { jobId: String(job._id) },
      'tbo.cancel: cannot refund — booking has no agencyId',
    );
    return;
  }

  try {
    const credit = await postCredit({
      tenantId: String(job.tenantId),
      walletKind: 'AGENCY',
      walletOwnerId: String(booking.agencyId),
      type: 'REFUND_CREDIT',
      amountPaise: job.refundAmountPaise,
      performedBy: String(job.requestedByUserId),
      description: `Hotel booking ${booking.hotel?.name ?? booking.supplierRefs?.bookingCode} — cancellation refund (CR#${job.changeRequestId})`,
      relatedTxnId: booking.walletDebitTxnId ? String(booking.walletDebitTxnId) : undefined,
      metadata: { hotelBookingId: String(booking._id), changeRequestId: job.changeRequestId },
    });
    job.refundCreditedAt = new Date();
    job.walletRefundTxnId = credit._id;
    booking.walletRefundTxnId = credit._id;
    await booking.save();
  } catch (err) {
    logger.fatal(
      { err, jobId: String(job._id), refundPaise: job.refundAmountPaise },
      'tbo.cancel: REFUND CREDIT FAILED — manual reconciliation required',
    );
  }
}

async function applyTerminalToBooking(
  job: HotelCancellationJobDoc,
  status: HotelBookingStatus,
  note: string,
): Promise<void> {
  const booking = await HotelBooking.findById(job.bookingId);
  if (!booking) return;
  booking.cancelledAt = new Date();
  await transitionStatus(booking, status, String(job.requestedByUserId), note);

  // Notify the booker on the CANCELLED terminal — but not on
  // CANCEL_REJECTED (that's an ops-investigation case; future enhancement).
  if (status === 'CANCELLED') {
    void enqueueAlert(
      {
        event: 'HOTEL_BOOKING_CANCELLED',
        vars: {
          ...buildLifecycleVars(booking),
          refundPaise: job.refundAmountPaise ?? 0,
          cancellationFeePaise: job.cancellationChargePaise ?? 0,
        },
      },
      [
        { kind: 'user', id: String(booking.bookedByUserId) },
        { kind: 'booking_contact', bookingId: String(booking._id) },
      ],
      {
        tenantId: String(booking.tenantId),
        correlationKey: `hotel-booking:${String(booking._id)}`,
      },
    ).catch(() => undefined);
  }
}

async function transitionStatus(
  doc: HotelBookingDoc,
  status: HotelBookingStatus,
  byUserId: string,
  note: string,
): Promise<void> {
  doc.status = status;
  doc.statusHistory.push({
    status,
    at: new Date(),
    by: new Types.ObjectId(byUserId),
    note,
  });
  await doc.save();
}

function mapCancelStatus(code: number): CancelJobStatus {
  switch (code) {
    case TBO_CHANGE_REQUEST_STATUS.NOT_SET:
      return 'NotSet';
    case TBO_CHANGE_REQUEST_STATUS.PENDING:
      return 'Pending';
    case TBO_CHANGE_REQUEST_STATUS.IN_PROGRESS:
      return 'InProgress';
    case TBO_CHANGE_REQUEST_STATUS.PROCESSED:
      return 'Processed';
    case TBO_CHANGE_REQUEST_STATUS.REJECTED:
      return 'Rejected';
    default:
      return 'Pending';
  }
}

function decimalToPaise(v: unknown): number {
  const n = toNumberOrNull(v);
  if (n === null) return 0;
  return Math.max(0, Math.round(n * 100));
}
