// PreBook orchestration — re-validates a search-time offer against TBO and
// persists a DRAFT HotelBooking.
//
// Inputs:
//   - offerId from the search response (format `TBO:{bookingCode}`)
//   - the search-time HotelOffer (caller passes — we don't reconstruct from
//     cache because the cache may have expired between Search and PreBook)
//   - search-time stay window (checkIn, checkOut, rooms)
//
// Output:
//   - draftBookingId (HotelBooking._id), priceChanged flag, refreshed offer
//
// Idempotency: PreBook itself isn't idempotent at TBO. We DO write a fresh
// DRAFT row on every call though, even for the same offerId — by design.
// Two PreBooks an hour apart for the same offer can return different prices,
// and we want both rows in the audit trail. The frontend tracks the
// "current" draft via the latest draftBookingId in the user session.

import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import {
  type HotelAvailRequest,
  type HotelOffer,
  type HotelPreBookResponse,
} from '@tripbng/shared';
import { TboError } from '../../adapters/tbo/errors.js';
import { mergePreBookIntoOffer } from '../../adapters/tbo/mappers/prebook.mapper.js';
import type { TboPreBookResponse } from '../../adapters/tbo/types/prebook.js';
import { HotelBooking } from '../../models/HotelBooking.js';
import { tboCall } from './client.js';

export interface PreBookContext {
  tenantId: string;
  userId: string;
  agencyId: string | null;
  distributorId: string | null;
}

export interface PreBookArgs {
  offerId: string;
  /** Search-time offer — we use it as the static-data overlay so the DRAFT
   *  has hotel name/address/images/etc even when PreBook returns a sparse body. */
  searchOffer: HotelOffer;
  /** Stay window from the search request — needed for the DRAFT booking. */
  stay: Pick<HotelAvailRequest, 'checkIn' | 'checkOut' | 'rooms'>;
}

/**
 * Re-validate an offer with TBO and persist a DRAFT booking.
 */
export async function preBookHotel(
  ctx: PreBookContext,
  args: PreBookArgs,
): Promise<HotelPreBookResponse> {
  const bookingCode = extractBookingCode(args.offerId);
  if (!bookingCode) {
    throw new TboError('TBO_INVALID_REQUEST', 'invalid offerId — expected TBO:{bookingCode}', {
      method: 'PreBook',
      retryable: false,
    });
  }

  const startedAt = Date.now();
  const res = await tboCall<TboPreBookResponse>({
    method: 'PreBook',
    host: 'hotel',
    path: '/PreBook',
    body: { BookingCode: bookingCode, PaymentMode: 'Limit' },
    ctx: { bookingCode },
  });

  const merged = mergePreBookIntoOffer(args.searchOffer, res);

  // Persist a DRAFT booking row capturing every field the Book step will need.
  const checkIn = new Date(args.stay.checkIn);
  const checkOut = new Date(args.stay.checkOut);
  const nights = Math.max(
    1,
    Math.round((checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000)),
  );

  const draft = await HotelBooking.create({
    tenantId: new Types.ObjectId(ctx.tenantId),
    agencyId: ctx.agencyId ? new Types.ObjectId(ctx.agencyId) : null,
    distributorId: ctx.distributorId ? new Types.ObjectId(ctx.distributorId) : null,
    bookedByUserId: new Types.ObjectId(ctx.userId),
    supplier: 'TBO',
    supplierRefs: {
      bookingCode,
      traceId: res.TraceId ?? null,
    },
    hotel: {
      hotelCode: merged.offer.hotel.code,
      name: merged.offer.hotel.name,
      starRating: merged.offer.hotel.starRating,
      address: merged.offer.hotel.address,
      cityId: merged.offer.hotel.cityId,
      countryCode: merged.offer.hotel.countryCode,
    },
    checkIn,
    checkOut,
    nights,
    rooms: merged.offer.rooms.map((r, idx) => ({
      name: r.name,
      adults: args.stay.rooms[idx]?.adults ?? args.stay.rooms[0]?.adults ?? 1,
      children: args.stay.rooms[idx]?.children ?? args.stay.rooms[0]?.children ?? 0,
      childrenAges: args.stay.rooms[idx]?.childrenAges ?? [],
      mealPlan: r.mealPlan,
      isRefundable: r.isRefundable,
      bookingCode: r.bookingCode,
      inclusions: r.inclusions,
      totalNetPaise: r.totalNetPaise,
      totalSellingPaise: r.totalSellingPaise,
    })),
    pricing: {
      totalNetPaise: merged.offer.pricing.totalNetPaise,
      totalSellingPaise: merged.offer.pricing.totalSellingPaise,
      recommendedSellingPaise: merged.offer.pricing.totalNetPaise, // placeholder — TBO returns this in PreBook
      perNightPaise: merged.offer.pricing.perNightPaise,
    },
    taxBreakup: merged.offer.pricing.taxes.map((t) => ({
      taxType: t.taxType,
      taxableAmountPaise: t.taxableAmountPaise,
      taxPercentage: t.taxPercentage,
      taxAmountPaise: t.taxAmountPaise,
    })),
    cancellationPolicies: merged.offer.policies.cancellation.map((c) => ({
      fromDate: new Date(c.fromDate),
      chargeType: c.chargeType,
      charge: c.charge,
    })),
    isRefundable: merged.offer.policies.isRefundable,
    lastCancellationDate: merged.lastCancellationDate ? new Date(merged.lastCancellationDate) : null,
    isPriceChanged: merged.priceChanged,
    isCancellationPolicyChanged: merged.cancellationPolicyChanged,
    supplierRules: merged.offer.rules,
    rawRequests: { preBook: { BookingCode: bookingCode, PaymentMode: 'Limit' } },
    rawResponses: { preBook: res },
    status: 'DRAFT',
    statusHistory: [
      {
        status: 'DRAFT',
        at: new Date(),
        by: new Types.ObjectId(ctx.userId),
        note: 'PreBook successful',
      },
    ],
  });

  logger.info(
    {
      draftBookingId: String(draft._id),
      bookingCode,
      priceChanged: merged.priceChanged,
      durationMs: Date.now() - startedAt,
    },
    'tbo: prebook done',
  );

  return {
    draftBookingId: String(draft._id),
    offer: merged.offer,
    priceChanged: merged.priceChanged,
    rules: merged.offer.rules,
  };
}

function extractBookingCode(offerId: string): string | null {
  const m = offerId.match(/^TBO:(.+)$/);
  return m && m[1] ? m[1] : null;
}
