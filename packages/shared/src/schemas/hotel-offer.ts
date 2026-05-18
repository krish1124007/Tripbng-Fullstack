// Normalized hotel-offer contract — supplier-agnostic shape the frontend
// renders against. Every supplier adapter (TBO today; Agoda / Hotelbeds /
// RateHawk later) maps its native search response into this shape.
//
// Money is in paise (integer) for parity with the rest of the codebase
// (wallet, booking, payments). Currency stays explicit per offer because
// some suppliers will return non-INR rates that we'll need to display
// with FX conversion later.
//
// `offerId` is a TripBNG-internal identifier wrapping (supplier, BookingCode)
// — the frontend uses it for prebook + book without ever knowing it's a TBO
// BookingCode underneath.

import { z } from 'zod';

export const HOTEL_SUPPLIER = ['TBO', 'AGODA', 'HOTELBEDS', 'MOCK'] as const;
export type HotelSupplier = (typeof HOTEL_SUPPLIER)[number];

export const MEAL_PLAN = [
  'RoomOnly',
  'Breakfast',
  'HalfBoard',
  'FullBoard',
  'AllInclusive',
] as const;
export type MealPlan = (typeof MEAL_PLAN)[number];

// ────────── Search request ──────────

export const PaxRoomSchema = z.object({
  adults: z.number().int().min(1).max(9),
  children: z.number().int().min(0).max(9).default(0),
  /** One entry per child — each must be 0-17. */
  childrenAges: z.array(z.number().int().min(0).max(17)).default([]),
});
export type PaxRoom = z.infer<typeof PaxRoomSchema>;

export const HotelAvailRequestSchema = z
  .object({
    destination: z.discriminatedUnion('type', [
      z.object({ type: z.literal('city'), cityId: z.string().min(1) }),
      z.object({
        type: z.literal('hotel'),
        hotelCodes: z.array(z.string().min(1)).min(1).max(50),
      }),
    ]),
    /** ISO yyyy-mm-dd. */
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rooms: z.array(PaxRoomSchema).min(1).max(6),
    /** ISO alpha-2 — guest's nationality (TBO requires this). */
    guestNationality: z.string().length(2),
    filters: z
      .object({
        refundable: z.boolean().optional(),
        mealPlan: z.enum(['All', 'WithMeal', 'RoomOnly']).optional(),
        maxPriceTotalPaise: z.number().int().min(0).optional(),
        minStarRating: z.number().int().min(0).max(5).optional(),
      })
      .optional(),
    /** Limit fan-out fan-in. Default: 1000 hotels max for a city search. */
    maxResults: z.number().int().min(1).max(5000).default(1000),
  })
  .refine((v) => new Date(v.checkOut) > new Date(v.checkIn), {
    message: 'checkOut must be strictly after checkIn',
    path: ['checkOut'],
  });
export type HotelAvailRequest = z.infer<typeof HotelAvailRequestSchema>;

// ────────── Offer + sub-shapes ──────────

export const HotelGeoSchema = z.object({
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export const HotelImageSchema = z.object({
  url: z.string(),
  caption: z.string().nullable(),
});

export const TaxLineSchema = z.object({
  /** TBO uses CGST/SGST/IGST/TCS/TDS for Indian transactions. Foreign
   *  transactions may use a generic 'OTHER'. */
  taxType: z.enum(['CGST', 'SGST', 'IGST', 'TCS', 'TDS', 'OTHER']),
  taxableAmountPaise: z.number().int().min(0),
  taxPercentage: z.number().min(0),
  taxAmountPaise: z.number().int().min(0),
});
export type TaxLine = z.infer<typeof TaxLineSchema>;

export const CancellationRuleSchema = z.object({
  fromDate: z.string(), // ISO datetime
  /** Charge type — 'Percentage' or 'FixedAmount' per TBO. */
  chargeType: z.enum(['Percentage', 'FixedAmount']),
  /** Either a percentage (0-100) or amount in paise depending on chargeType. */
  charge: z.number().min(0),
});
export type CancellationRule = z.infer<typeof CancellationRuleSchema>;

export const RoomOfferSchema = z.object({
  /** TBO BookingCode — required for PreBook + Book. We expose this verbatim
   *  on the offer because it must round-trip unchanged through the entire
   *  pathway (TBO certification requirement). */
  bookingCode: z.string(),
  name: z.string(),
  inclusions: z.string().nullable(),
  mealPlan: z.enum(MEAL_PLAN).nullable(),
  isRefundable: z.boolean(),
  /** True when the supplier sells this as a non-decomposable package fare
   *  (rare; flagged on the offer for the frontend to show a notice). */
  isPackageFare: z.boolean(),
  /** Per-room totals over the entire stay. */
  totalNetPaise: z.number().int().min(0),
  totalSellingPaise: z.number().int().min(0),
});
export type RoomOffer = z.infer<typeof RoomOfferSchema>;

export const HotelOfferSchema = z.object({
  /** TripBNG offer id — opaque from the frontend's POV. Format:
   *  `{supplier}:{bookingCode}` for v1; subject to change. */
  offerId: z.string(),
  supplier: z.enum(HOTEL_SUPPLIER),
  hotel: z.object({
    code: z.string(),
    name: z.string(),
    starRating: z.number().nullable(),
    address: z.string().nullable(),
    cityId: z.string().nullable(),
    countryCode: z.string().nullable(),
    geo: HotelGeoSchema,
    images: z.array(HotelImageSchema),
    amenities: z.array(z.string()),
  }),
  rooms: z.array(RoomOfferSchema).min(1),
  pricing: z.object({
    currency: z.string().default('INR'),
    perNightPaise: z.number().int().min(0),
    totalNetPaise: z.number().int().min(0),
    totalSellingPaise: z.number().int().min(0),
    taxes: z.array(TaxLineSchema),
  }),
  policies: z.object({
    isRefundable: z.boolean(),
    cancellation: z.array(CancellationRuleSchema),
    lastCancellationDate: z.string().nullable(),
    mealPlan: z.enum(MEAL_PLAN).nullable(),
  }),
  /** Surfaced from PreBook (re-validated rules); on bare Search results
   *  these may be all-default until PreBook lands. */
  rules: z.object({
    panRequired: z.boolean(),
    passportRequired: z.boolean(),
    gstAllowed: z.boolean(),
    sameNameAllowed: z.boolean(),
    specialCharAllowed: z.boolean(),
    nameMinLength: z.number().int().min(1).default(1),
    nameMaxLength: z.number().int().min(1).default(40),
    isPackageFare: z.boolean().default(false),
    packageDetailsRequired: z.boolean().default(false),
  }),
});
export type HotelOffer = z.infer<typeof HotelOfferSchema>;

// ────────── Search response ──────────

export const HotelAvailResponseSchema = z.object({
  /** Internal search id — used for analytics + reprice cache lookups. */
  searchId: z.string(),
  request: HotelAvailRequestSchema,
  offers: z.array(HotelOfferSchema),
  /** Per-supplier soft errors — TBO sometimes returns "no rates available
   *  for this hotel" inline rather than dropping the hotel from the list.
   *  Surface them so the frontend can show "12 hotels unavailable". */
  errors: z.array(
    z.object({
      hotelCode: z.string().nullable(),
      code: z.string(),
      message: z.string(),
    }),
  ),
  cachedAt: z.string(),
  ttlSeconds: z.number().int().min(0),
});
export type HotelAvailResponse = z.infer<typeof HotelAvailResponseSchema>;

// ────────── PreBook ──────────

export const HotelPreBookRequestSchema = z.object({
  /** offerId from the search response. */
  offerId: z.string(),
});
export type HotelPreBookRequest = z.infer<typeof HotelPreBookRequestSchema>;

export const HotelPreBookResponseSchema = z.object({
  /** Internal Booking._id of the DRAFT booking row. */
  draftBookingId: z.string(),
  /** Re-validated offer — may have updated price + taxes vs Search result. */
  offer: HotelOfferSchema,
  /** True when PreBook returned a different total than search-time. */
  priceChanged: z.boolean(),
  /** Source-of-truth supplier rules to drive the dynamic guest form. */
  rules: HotelOfferSchema.shape.rules,
});
export type HotelPreBookResponse = z.infer<typeof HotelPreBookResponseSchema>;

// ────────── Booking list query ──────────

export const HOTEL_BOOKING_LIST_STATUS = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'BOOK_FAILED',
  'HELD',
  'PENDING_SUPPLIER',
  'CONFIRMED',
  'VOUCHERED',
  'CANCEL_REQUESTED',
  'CANCEL_PROCESSING',
  'CANCELLED',
  'CANCEL_REJECTED',
] as const;
export type HotelBookingListStatus = (typeof HOTEL_BOOKING_LIST_STATUS)[number];

export const HotelBookingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Status filter — accepts a CSV of statuses, or a single value. Empty
   *  = all. */
  status: z
    .union([z.enum(HOTEL_BOOKING_LIST_STATUS), z.array(z.enum(HOTEL_BOOKING_LIST_STATUS))])
    .optional(),
  /** Free-text search across booking code, hotel name, supplier confirmation. */
  q: z.string().min(1).max(120).optional(),
  /** ISO yyyy-mm-dd inclusive lower bound on check-in. */
  from: z.coerce.date().optional(),
  /** ISO yyyy-mm-dd inclusive upper bound on check-in. */
  to: z.coerce.date().optional(),
  /** Filter by cost-centre code (exact match). */
  costCentreCode: z.string().min(1).max(20).optional(),
  /** Filter by GL code (exact match). */
  glCode: z.string().min(1).max(20).optional(),
  /** Filter by project code (exact match). */
  projectCode: z.string().min(1).max(40).optional(),
});
export type HotelBookingListQuery = z.infer<typeof HotelBookingListQuerySchema>;
