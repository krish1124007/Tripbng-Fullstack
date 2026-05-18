// TBO search response → normalized HotelOffer[].
//
// This is the only place TBO-shaped types leak. Everything past this layer
// (services, routes, frontend) sees the supplier-agnostic HotelOffer.
//
// Money: TBO returns amounts as decimal rupees (sometimes as strings).
// We multiply by 100 + Math.round to get paise integers. NaN / null inputs
// produce 0 — better to surface a "free" offer that's obviously wrong than
// to drop the result silently.
//
// Currency: per-hotel TBO field; default to INR when missing. We don't FX-
// convert here — that's a future enhancement when we go multi-currency.
//
// `offerId` format: `TBO:{bookingCode}`. The frontend treats this as opaque.

import type { HotelOffer, MealPlan, RoomOffer } from '@tripbng/shared';
import {
  normalizeStringList,
  toNumberOrNull,
  trimOrNull,
  unwrapList,
} from '../parsers.js';
import type {
  TboCancellationPolicy,
  TboSearchHotel,
  TboSearchResponse,
  TboSearchRoom,
} from '../types/search.js';

export interface MappedSearchResult {
  offers: HotelOffer[];
  errors: Array<{ hotelCode: string | null; code: string; message: string }>;
}

/**
 * Translate one TBO Search response (one chunk's worth of hotels) into
 * normalized HotelOffer[]. Hotels missing essential fields (no rooms, no
 * BookingCode) get filtered into `errors` so the caller can surface a count
 * to the UI without polluting the offers list.
 *
 * `nights` is required because TBO returns total fares but we want
 * per-night display values too — pass the same value the search request
 * sent as `NoOfNights`.
 */
export function mapSearchResponse(
  response: TboSearchResponse,
  args: { nights: number },
): MappedSearchResult {
  const hotels = unwrapList<TboSearchHotel>(response as unknown as Record<string, unknown>, [
    'HotelSearchResult.HotelResults',
    'HotelResults',
    'Hotels',
  ]);

  const offers: HotelOffer[] = [];
  const errors: MappedSearchResult['errors'] = [];

  for (const h of hotels) {
    const hotelCode = trimOrNull(h.HotelCode);
    if (!hotelCode) {
      errors.push({ hotelCode: null, code: 'MISSING_HOTEL_CODE', message: 'hotel without HotelCode' });
      continue;
    }

    const rooms = (h.Rooms ?? h.RoomDetails ?? []).map(mapRoom).filter((r): r is RoomOffer => r !== null);
    if (rooms.length === 0) {
      errors.push({
        hotelCode,
        code: 'NO_AVAILABLE_ROOMS',
        message: `${h.HotelName ?? hotelCode} returned no rooms`,
      });
      continue;
    }

    const totalNetPaise = rooms.reduce((sum, r) => sum + r.totalNetPaise, 0);
    const totalSellingPaise = rooms.reduce((sum, r) => sum + r.totalSellingPaise, 0);
    const perNightPaise = args.nights > 0 ? Math.round(totalSellingPaise / args.nights) : totalSellingPaise;

    // Take the worst-case cancellation policy from across rooms — used to
    // drive the `isRefundable` summary flag at the offer level.
    const isRefundable = rooms.every((r) => r.isRefundable);
    const firstRoom = (h.Rooms ?? h.RoomDetails ?? [])[0];
    const cancellation = (firstRoom?.CancellationPolicies ?? []).map(mapCancellation);

    const offer: HotelOffer = {
      offerId: `TBO:${rooms[0]!.bookingCode}`,
      supplier: 'TBO',
      hotel: {
        code: hotelCode,
        name: trimOrNull(h.HotelName) ?? hotelCode,
        starRating: toNumberOrNull(h.StarRating ?? h.HotelRating),
        address: trimOrNull(h.HotelAddress),
        cityId: null,
        countryCode: null,
        geo: {
          lat: toNumberOrNull(h.Latitude),
          lng: toNumberOrNull(h.Longitude),
        },
        images: trimOrNull(h.HotelPicture)
          ? [{ url: h.HotelPicture as string, caption: null }]
          : [],
        amenities: normalizeStringList(h.HotelFacilities),
      },
      rooms,
      pricing: {
        currency: trimOrNull(h.Currency) ?? 'INR',
        perNightPaise,
        totalNetPaise,
        totalSellingPaise,
        // Search results don't carry a tax breakup — that lands in PreBook.
        taxes: [],
      },
      policies: {
        isRefundable,
        cancellation,
        lastCancellationDate: null,
        mealPlan: deriveMealPlan(firstRoom?.MealType),
      },
      // Search-time defaults — PreBook fills in the real values.
      rules: {
        panRequired: false,
        passportRequired: false,
        gstAllowed: false,
        sameNameAllowed: true,
        specialCharAllowed: false,
        nameMinLength: 1,
        nameMaxLength: 40,
        isPackageFare: rooms.some((r) => r.isPackageFare),
        packageDetailsRequired: false,
      },
    };
    offers.push(offer);
  }

  return { offers, errors };
}

function mapRoom(room: TboSearchRoom): RoomOffer | null {
  const bookingCode = trimOrNull(room.BookingCode);
  if (!bookingCode) return null;
  const totalFare = decimalToPaise(room.TotalFare ?? sumDayRates(room.DayRates));
  const totalTax = decimalToPaise(room.TotalTax);

  return {
    bookingCode,
    name: roomName(room.Name) ?? 'Room',
    inclusions: trimOrNull(room.Inclusion),
    mealPlan: deriveMealPlan(room.MealType),
    isRefundable: room.IsRefundable === true,
    isPackageFare: room.IsPackageFare === true,
    // Net = the rate TBO charges us. Selling = same as net at search time
    // (markup is applied in the service layer using the configured rate).
    totalNetPaise: totalFare,
    totalSellingPaise: totalFare + totalTax,
  };
}

function mapCancellation(p: TboCancellationPolicy) {
  const charge = decimalToCharge(p.CancellationCharge);
  return {
    fromDate: trimOrNull(p.FromDate) ?? new Date().toISOString(),
    chargeType: p.ChargeType === 'FixedAmount' ? ('FixedAmount' as const) : ('Percentage' as const),
    charge,
  };
}

function decimalToPaise(v: unknown): number {
  const n = toNumberOrNull(v);
  if (n === null) return 0;
  // TBO sends rupees — could be 1234 or 1234.56. Round to nearest paise.
  return Math.max(0, Math.round(n * 100));
}

function decimalToCharge(v: unknown): number {
  const n = toNumberOrNull(v);
  if (n === null) return 0;
  return Math.max(0, n);
}

function sumDayRates(rates: TboSearchRoom['DayRates']): number {
  if (!Array.isArray(rates)) return 0;
  return rates.reduce<number>((sum, r) => {
    const v = toNumberOrNull(r.Amount);
    return sum + (v ?? 0);
  }, 0);
}

function roomName(name: TboSearchRoom['Name']): string | null {
  if (!name) return null;
  if (typeof name === 'string') return trimOrNull(name);
  if (Array.isArray(name) && name.length > 0) return trimOrNull(name[0]);
  return null;
}

function deriveMealPlan(meal: string | undefined | null): MealPlan | null {
  if (!meal) return null;
  const normalized = meal.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (normalized === 'roomonly' || normalized === 'rooms') return 'RoomOnly';
  if (normalized.includes('breakfast')) return 'Breakfast';
  if (normalized.includes('halfboard') || normalized === 'hb') return 'HalfBoard';
  if (normalized.includes('fullboard') || normalized === 'fb') return 'FullBoard';
  if (normalized.includes('allinclusive') || normalized === 'ai') return 'AllInclusive';
  return null;
}
