// GetBookingDetail — idempotent fetch of a booking's current supplier state.
//
// Used by:
//   1. The pending-booking poll worker.
//   2. The admin "Refresh from supplier" button on a booking-detail page.
//   3. Reconciliation jobs (later phase) that compare TBO state to ours.
//
// The function returns the raw response for the caller to do its own
// state transitions; we don't auto-mutate the HotelBooking row here.

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { HotelBooking } from '../../models/HotelBooking.js';
import type {
  TboBookingDetailRequest,
  TboBookingDetailResponse,
} from '../../adapters/tbo/types/lifecycle.js';
import { tboCall } from './client.js';

export interface FetchBookingDetailResult {
  raw: TboBookingDetailResponse;
  /** The HotelBooking._id we resolved against (echoed back so callers can
   *  persist updates). */
  bookingId: string;
}

export async function fetchBookingDetail(
  bookingId: string,
): Promise<FetchBookingDetailResult> {
  if (!Types.ObjectId.isValid(bookingId)) throw new AppError('NOT_FOUND');
  const doc = await HotelBooking.findById(bookingId).select('supplierRefs').lean();
  if (!doc) throw new AppError('NOT_FOUND');
  const supplierBookingId = doc.supplierRefs?.bookingId;
  if (!supplierBookingId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'no supplier BookingId on booking' });
  }
  const body: TboBookingDetailRequest = {
    ClientId: '',
    TokenId: '',
    EndUserIp: '',
    BookingId: supplierBookingId,
  };
  const res = await tboCall<TboBookingDetailResponse>({
    method: 'BookingDetail',
    host: 'hotelBe',
    path: '/BookingDetail',
    body: body as unknown as Record<string, unknown>,
    ctx: { bookingId, bookingCode: doc.supplierRefs?.bookingCode ?? null },
  });
  return { raw: res, bookingId };
}
