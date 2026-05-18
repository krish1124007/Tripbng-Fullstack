import { z } from 'zod';
import { PAX_TYPE, TRAVEL_CLASS } from '../enums.js';

export const TRIP_TYPE = ['ONEWAY', 'ROUNDTRIP', 'MULTICITY'] as const;
export type TripType = (typeof TRIP_TYPE)[number];

export const FareSourceTag = ['SERIES', 'LCC', 'FSC', 'API'] as const;
export type FareSourceTagT = (typeof FareSourceTag)[number];

export const SearchSegmentSchema = z.object({
  origin: z.string().length(3, '3-letter IATA').toUpperCase(),
  destination: z.string().length(3, '3-letter IATA').toUpperCase(),
  date: z.coerce.date(),
});
export type SearchSegment = z.infer<typeof SearchSegmentSchema>;

export const SearchRequestSchema = z
  .object({
    tripType: z.enum(TRIP_TYPE).default('ONEWAY'),
    segments: z.array(SearchSegmentSchema).min(1).max(6),
    travelClass: z.enum(TRAVEL_CLASS).default('ECONOMY'),
    pax: z
      .object({
        adults: z.number().int().min(1).max(9).default(1),
        children: z.number().int().min(0).max(9).default(0),
        infants: z.number().int().min(0).max(4).default(0),
      })
      .refine((p) => p.infants <= p.adults, {
        message: 'infants cannot exceed adults',
        path: ['infants'],
      }),
    directOnly: z.boolean().optional(),
    refundableOnly: z.boolean().optional(),
    airlines: z.array(z.string()).optional(),
  })
  .refine((d) => (d.tripType === 'ROUNDTRIP' ? d.segments.length === 2 : true), {
    message: 'ROUNDTRIP requires exactly 2 segments',
    path: ['segments'],
  });
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const FareBreakdownSchema = z.object({
  baseFarePaise: z.number().int(),
  taxesPaise: z.number().int(),
  policyAdjustmentPaise: z.number().int(),
  platformMarkupPaise: z.number().int(),
  distributorMarkupPaise: z.number().int(),
  agencyMarkupPaise: z.number().int(),
  discountPaise: z.number().int(),
  gstPaise: z.number().int(),
  grossAmountPaise: z.number().int(),
  netToSupplierPaise: z.number().int(),
  agencyPayablePaise: z.number().int(),
  distributorEarningsPaise: z.number().int(),
  platformEarningsPaise: z.number().int(),
  currency: z.string().default('INR'),
});
export type FareBreakdown = z.infer<typeof FareBreakdownSchema>;

export const ResultSegmentSchema = z.object({
  flightNumber: z.string(),
  airline: z.object({
    code: z.string(),
    name: z.string().optional(),
    logo: z.string().optional(),
  }),
  origin: z.object({
    code: z.string(),
    terminal: z.string().optional(),
    name: z.string().optional(),
  }),
  destination: z.object({
    code: z.string(),
    terminal: z.string().optional(),
    name: z.string().optional(),
  }),
  departure: z.string().datetime(),
  arrival: z.string().datetime(),
  duration: z.number().int(),
  stopOver: z.number().int(),
});
export type ResultSegment = z.infer<typeof ResultSegmentSchema>;

export const SearchResultSchema = z.object({
  id: z.string(),
  supplierCode: z.string(),
  supplierName: z.string(),
  source: z.enum(FareSourceTag),
  inventoryId: z.string().nullable(),

  segments: z.array(ResultSegmentSchema),
  totalDuration: z.number().int(),
  stops: z.number().int(),

  travelClass: z.enum(TRAVEL_CLASS),
  refundable: z.boolean(),
  baggageCheckin: z.string().nullable(),
  baggageCabin: z.string().nullable(),

  seatsRemaining: z.number().int().nullable(),
  fareRuleDescription: z.string().nullable(),

  /**
   * Vendor fare class / booking class as returned by the supplier
   * (e.g. "RCIP", "YOWIN", "SAVER", "FLEX_PLUS"). First character is
   * typically the RBD (booking class). Used by the UI to render the
   * MAIN/FLX/SME pill and the "Class R" chip on the result card.
   * Nullable because some legacy suppliers don't surface it.
   */
  fareClass: z.string().nullable().default(null),

  perPax: z.object({
    adult: FareBreakdownSchema,
    child: FareBreakdownSchema,
    infant: FareBreakdownSchema,
  }),

  totalGrossPaise: z.number().int(),
  totalAgencyPayablePaise: z.number().int(),
  totalNetToSupplierPaise: z.number().int(),
  currency: z.string(),

  // Token used for hold/confirm so the supplier can re-fetch the same fare.
  fareToken: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  searchId: z.string(),
  request: SearchRequestSchema,
  results: z.array(SearchResultSchema),
  errors: z.array(
    z.object({
      supplierCode: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  ),
  cachedAt: z.string().datetime(),
  ttlSeconds: z.number().int(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SearchSummarySchema = z.object({
  total: z.number().int(),
  bySupplier: z.record(z.number().int()),
  byAirline: z.record(z.number().int()),
  durationRange: z.object({ minMinutes: z.number().int(), maxMinutes: z.number().int() }),
  priceRange: z.object({ minPaise: z.number().int(), maxPaise: z.number().int() }),
});
export type SearchSummary = z.infer<typeof SearchSummarySchema>;

export const PassengerInputSchema = z.object({
  type: z.enum(PAX_TYPE),
  title: z.enum(['MR', 'MRS', 'MS', 'MSTR', 'MISS']),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['M', 'F']).optional(),
  nationality: z.string().length(2).optional(),
  passport: z
    .object({
      number: z.string().min(4),
      expiry: z.coerce.date(),
      issuingCountry: z.string().length(2),
    })
    .optional(),
  fareCategory: z
    .enum(['REGULAR', 'STUDENT', 'SENIOR', 'ARMED_FORCES', 'MEDICAL'])
    .default('REGULAR'),
});
export type PassengerInput = z.infer<typeof PassengerInputSchema>;

// ────────── SSR selections (meals / baggage / seats) ──────────
//
// Captured by the UI from /api/v1/search/flights/ssr and forwarded into the
// /bookings/hold call. Optional everywhere — agents who don't add any
// add-ons just leave the field unset.
//
// Routing fields (airlineCode, flightNumber, wayType, origin, destination)
// are forwarded verbatim from the SSR catalog response. Non-TBO suppliers
// may not need them, but TBO requires them per-segment so we carry them
// uniformly.

const SsrPickRoutingSchema = z.object({
  /** "${origin}-${destination}" — stable identifier for grouping. */
  segmentId: z.string().min(1),
  airlineCode: z.string().max(4).optional(),
  flightNumber: z.string().max(8).optional(),
  /** 1=Outbound, 2=Inbound. */
  wayType: z.union([z.literal(1), z.literal(2)]).optional(),
  origin: z.string().length(3).optional(),
  destination: z.string().length(3).optional(),
});

export const SsrMealPickSchema = SsrPickRoutingSchema.extend({
  code: z.string().min(1).max(40),
  description: z.string().max(200),
  pricePaise: z.number().int().min(0),
  currency: z.string().length(3).default('INR'),
});
export type SsrMealPick = z.infer<typeof SsrMealPickSchema>;

export const SsrBaggagePickSchema = SsrPickRoutingSchema.extend({
  code: z.string().min(1).max(40),
  description: z.string().max(200),
  weightKg: z.number().int().min(0).max(100),
  pricePaise: z.number().int().min(0),
  currency: z.string().length(3).default('INR'),
});
export type SsrBaggagePick = z.infer<typeof SsrBaggagePickSchema>;

export const SsrSeatPickSchema = SsrPickRoutingSchema.extend({
  code: z.string().min(1).max(10),
  rowNo: z.number().int().min(1).max(99),
  seatNo: z.string().min(1).max(2),
  /** "Window" / "Aisle" / "Middle" — UI hint. */
  seatType: z.string().max(20).optional(),
  pricePaise: z.number().int().min(0),
  currency: z.string().length(3).default('INR'),
  /** 0-based passenger index — TBO sends one SeatPreference per (pax × seat). */
  paxIndex: z.number().int().min(0).max(40),
});
export type SsrSeatPick = z.infer<typeof SsrSeatPickSchema>;

export const SsrSelectionsSchema = z.object({
  meals: z.array(SsrMealPickSchema).optional(),
  baggage: z.array(SsrBaggagePickSchema).optional(),
  seats: z.array(SsrSeatPickSchema).optional(),
});
export type SsrSelections = z.infer<typeof SsrSelectionsSchema>;
