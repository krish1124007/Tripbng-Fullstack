// Voucher service — turn a HELD booking into a VOUCHERED one.
//
// Two call patterns:
//   1. BullMQ worker fires this at (lastCancellationDate − VOUCHER_LEAD_HOURS).
//   2. Admin can trigger manually via POST /api/v1/hotels/bookings/:id/voucher.
//
// Both routes hit `voucherHotelBooking(bookingId, ctx)` below. The function
// is idempotent on Status — calling it on an already-VOUCHERED booking is
// a no-op (returns the existing supplier refs).

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import {
  HotelBooking,
  type HotelBookingDoc,
  type HotelBookingStatus,
} from '../../models/HotelBooking.js';
import type {
  TboVoucherRequest,
  TboVoucherResponse,
} from '../../adapters/tbo/types/lifecycle.js';
import { tboCall } from './client.js';
import { enqueueAlert } from '../alerts/index.js';
import { buildLifecycleVars } from './book.service.js';

export interface VoucherContext {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string | null;
}

export interface VoucherResult {
  kind: 'voucherized' | 'no_op';
  confirmationNo: string | null;
  invoiceNumber: string | null;
}

export async function voucherHotelBooking(
  bookingId: string,
  ctx: VoucherContext,
): Promise<VoucherResult> {
  if (!Types.ObjectId.isValid(bookingId)) throw new AppError('NOT_FOUND');
  const filter: Record<string, unknown> = { _id: bookingId, tenantId: ctx.tenantId };
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') filter.agencyId = ctx.agencyId;
  const doc = await HotelBooking.findOne(filter);
  if (!doc) throw new AppError('NOT_FOUND');

  if (doc.status === 'VOUCHERED') {
    return {
      kind: 'no_op',
      confirmationNo: doc.supplierRefs?.confirmationNo ?? null,
      invoiceNumber: doc.supplierRefs?.invoiceNumber ?? null,
    };
  }
  if (doc.status !== 'HELD' && doc.status !== 'CONFIRMED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot voucher booking in status ${doc.status}`,
    });
  }
  const supplierBookingId = doc.supplierRefs?.bookingId;
  if (!supplierBookingId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'no supplier BookingId — cannot voucher' });
  }

  const body: TboVoucherRequest = {
    ClientId: '',
    TokenId: '',
    EndUserIp: '',
    BookingId: supplierBookingId,
  };

  const res = await tboCall<TboVoucherResponse>({
    method: 'GenerateVoucher',
    host: 'hotelBe',
    path: '/GenerateVoucher',
    body: body as unknown as Record<string, unknown>,
    ctx: { bookingId: String(doc._id), bookingCode: doc.supplierRefs?.bookingCode ?? null },
  });

  if (res.VoucherStatus !== true) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `TBO GenerateVoucher returned VoucherStatus=${res.VoucherStatus ?? 'undefined'}`,
    });
  }

  if (res.ConfirmationNo) {
    doc.supplierRefs = {
      ...(doc.supplierRefs ?? {}),
      confirmationNo: res.ConfirmationNo,
      invoiceNumber: res.InvoiceNumber ?? doc.supplierRefs?.invoiceNumber ?? null,
      bookingCode: doc.supplierRefs?.bookingCode ?? null,
      bookingId: doc.supplierRefs?.bookingId ?? null,
      bookingRefNo: doc.supplierRefs?.bookingRefNo ?? null,
      traceId: doc.supplierRefs?.traceId ?? null,
    };
  }

  doc.rawResponses = { ...(doc.rawResponses ?? {}), voucher: res };
  doc.vouchredAt = new Date();
  await transitionStatus(doc, 'VOUCHERED', ctx.userId, 'TBO GenerateVoucher → success');

  logger.info(
    {
      bookingId: String(doc._id),
      confirmationNo: doc.supplierRefs?.confirmationNo,
    },
    'tbo.voucher: success',
  );

  // Notify the booker that the held booking is now confirmed.
  void enqueueAlert(
    { event: 'HOTEL_BOOKING_CONFIRMED', vars: buildLifecycleVars(doc) },
    [
      { kind: 'user', id: String(doc.bookedByUserId ?? ctx.userId) },
      { kind: 'booking_contact', bookingId: String(doc._id) },
    ],
    {
      tenantId: ctx.tenantId,
      correlationKey: `hotel-booking:${String(doc._id)}`,
    },
  ).catch(() => undefined);

  return {
    kind: 'voucherized',
    confirmationNo: doc.supplierRefs?.confirmationNo ?? null,
    invoiceNumber: doc.supplierRefs?.invoiceNumber ?? null,
  };
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
