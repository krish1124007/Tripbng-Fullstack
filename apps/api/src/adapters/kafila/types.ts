// Kafila V2 wire-level types.
//
// Source of truth: Kafila Postman collection (NOT the PDF docs — those are
// stale and disagree on field names, notably the login payload).
//
// Schemas in this file mirror §8 of the Kafila CLAUDE.md spec exactly.
// When in doubt about whether to add an optional field, prefer Zod's
// `.passthrough()` — Kafila's responses are large nested blobs and the
// pricing-response itinerary MUST be re-sent unchanged to CreatePnr, so we
// don't want strict validation to drop unrecognized keys.

import { z } from 'zod';

// ────────── Login ──────────

/** Login request body. Postman is authoritative:
 *  `{ userId, apiKey, apiSecret }`. The stale PDF docs that show
 *  `{ userId, password }` are wrong — every error you'd hit using `password`
 *  is just "invalid credentials" with no hint about the field name. */
export const KflLoginRequest = z.object({
  userId: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});
export type KflLoginRequestT = z.infer<typeof KflLoginRequest>;

/** Login response envelope. `status: 1` is success; anything else is an
 *  error and `message` will carry the reason. The token is a JWT valid
 *  for 8 hours; we cache it for 7h 30min via KAFILA_JWT_TTL_SECONDS. */
export const KflLoginResponse = z.object({
  status: z.number().optional(),
  message: z.string().optional(),
  token: z.string().optional(),
});
export type KflLoginResponseT = z.infer<typeof KflLoginResponse>;

// ────────── Generic envelope ──────────

/** Every non-login Kafila response carries this envelope around the
 *  endpoint-specific `data` field. Adapters parse the envelope first,
 *  then their own schema against `data`. */
export const KflEnvelope = z.object({
  status: z.number(),
  message: z.string().optional(),
});
export type KflEnvelopeT = z.infer<typeof KflEnvelope>;

// ────────── Shared enums + scalars ──────────

export const KflTripType = z.enum(['ONEWAY', 'ROUNDTRIP', 'MULTICITY']);
export type KflTripTypeT = z.infer<typeof KflTripType>;

/** Credential-type echoed in most request bodies. Drives whether the
 *  call hits Kafila's TEST or LIVE backend (same base URL, different
 *  routing tables on their side). */
export const KflCredentialType = z.enum(['TEST', 'LIVE']);
export type KflCredentialTypeT = z.infer<typeof KflCredentialType>;

/** Travel type — Domestic vs International. Drives mandatory passport
 *  details for ADT/CHD on INT bookings. */
export const KflTravelType = z.enum(['DOM', 'INT']);
export type KflTravelTypeT = z.infer<typeof KflTravelType>;

/** Sales channel echoed in every request body. API for B2B server-server
 *  calls; B2B / B2C surface to end-users — vendor's pricing engine treats
 *  the three differently. */
export const KflSalesChannel = z.enum(['API', 'B2B', 'B2C']);
export type KflSalesChannelT = z.infer<typeof KflSalesChannel>;

export const KflCabinClass = z.enum(['Economy', 'PremiumEconomy', 'Business', 'First']);
export const KflPaxType = z.enum(['ADT', 'CHD', 'INF']);
export const KflGender = z.enum(['M', 'F']);
export const KflTitle = z.enum(['MR', 'MRS', 'MS', 'MSTR', 'MISS']);

export const KflPaxDetail = z.object({
  adults: z.coerce.number().int().min(1).max(9),
  children: z.coerce.number().int().min(0).max(8).default(0),
  infants: z.coerce.number().int().min(0).max(4).default(0),
});

/** Airport reference — appears on every segment's `departure` + `arrival`.
 *  `date` is DD-MM-YYYY (Kafila's search/booking date format — different
 *  from the YYYY-MM-DD format used for traveller DOB). */
export const KflAirportRef = z.object({
  code: z.string().length(3),
  name: z.string().optional().default(''),
  cityCode: z.string().optional().default(''),
  cityName: z.string().optional().default(''),
  countryCode: z.string().optional().default(''),
  countryName: z.string().optional().default(''),
  date: z.string(),  // DD-MM-YYYY
  time: z.string(),  // HH:MM
  terminal: z.string().optional().default(''),
});

export const KflTaxBreakup = z.object({
  taxType: z.string(),
  amount: z.number(),
});

export const KflAirPenalty = z.object({
  type: z.enum(['Change', 'Cancel']),
  duration: z.string().optional().default(''),
  amount: z.number(),
});

export const KflPriceBreakup = z.object({
  passengerType: KflPaxType,
  noOfPassenger: z.number().int(),
  baseFare: z.number(),
  tax: z.number(),
  taxBreakup: z.array(KflTaxBreakup).default([]),
  airPenalty: z.array(KflAirPenalty).default([]),
  fareCalc: z.string().optional().default(''),
});

export const KflDeal = z
  .object({
    NETFARE: z.number(),
    TDISC: z.number(),
    TDS: z.number(),
    GST: z.number(),
    DISCOUNT: z.object({
      DIS: z.number(),
      SF: z.number(),
      PDIS: z.number(),
      CB: z.number(),
    }),
  })
  .nullable();

// Vendor sends nulls for almost every "hours" field on routes that
// don't carry a change/refund window. Declaring these as `.nullable()`
// matches reality — strict `z.string()` (per the spec) blows up search
// because Kafila populates these inconsistently across operators.
// We don't actively read any of these — they exist for round-trip
// integrity to CreatePnr, where the itinerary is sent back unchanged.
export const KflFareRule = z
  .object({
    cbnbg: z.string().nullable(),
    chknbg: z.string().nullable(),
    cbh: z.string().nullable(),
    cwbh: z.string().nullable(),
    rbh: z.string().nullable(),
    rwbh: z.string().nullable(),
    cbha: z.number().nullable(),
    cwbha: z.number().nullable(),
    rbha: z.number().nullable(),
    rwbha: z.number().nullable(),
    sf: z.number().nullable(),
    cc: z.number().nullable(),
    rc: z.number().nullable(),
  })
  .partial()
  .passthrough();

export const KflBrand = z.object({
  brandCode: z.string().optional().default(''),
  brandName: z.string().optional().default(''),
  features: z.array(z.any()).default([]),
});

/** Per-segment air detail. `.passthrough()` because Kafila returns many
 *  vendor-specific fields we don't actively map but DO need to send back
 *  unchanged to CreatePnr — never drop unknown keys. */
export const KflAirSegment = z
  .object({
    operatingCarrier: z.object({ code: z.string() }).optional(),
    group: z.string().optional(),
    flyingTime: z.string().optional(),
    travelTime: z.string().optional(),
    baggageInfo: z.string().optional(),
    cabinBaggage: z.string().optional(),
    noOfSeats: z.string().optional(),
    fareBasis: z.string().optional(),
    productClass: z.string().optional(),
    fareFamily: z.string().optional(),
    fareType: z.string().optional(),
    rbds: z.string().optional(),
    technicalStops: z.array(z.any()).default([]),
    // Vendor sometimes returns a nested `{hours, minutes}` object here
    // instead of a string (verified live). We pass it through unchanged
    // — none of our search/booking paths read transitTime today.
    transitTime: z.unknown().optional(),
    brand: KflBrand.optional(),
    segRef: z.string(),
    airlineCode: z.string().length(2),
    airlineName: z.string().optional(),
    flightNumber: z.string(),
    classOfService: z.string().optional(),
    cabinClass: z.string().optional(),
    departure: KflAirportRef,
    arrival: KflAirportRef,
    equipmentType: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type KflAirSegmentT = z.infer<typeof KflAirSegment>;

/** Itinerary = one bookable fare option within a journey. `.passthrough()`
 *  for the same reason as KflAirSegment — vendor-specific fields must
 *  survive the round trip to CreatePnr. */
export const KflItinerary = z
  .object({
    baseFare: z.number(),
    taxes: z.number(),
    totalPrice: z.number(),
    roe: z.number().default(1),
    originalCurrency: z.string().optional().default(''),
    currency: z.string().default('INR'),
    officeId: z.string().nullable().optional(),
    valCarrier: z.string(),
    priceBreakup: z.array(KflPriceBreakup),
    refundable: z.boolean(),
    dealCode: z.string().optional().default(''),
    lastTicketingDate: z.string().optional().default(''),
    hostTokens: z.array(z.any()).default([]),
    errors: z.array(z.any()).default([]),
    xKey: z.string().optional().default(''),
    isGSTMandatory: z.boolean().optional().default(false),
    isLCC: z.boolean().optional().default(false),
    deal: KflDeal.optional(),
    fareRule: KflFareRule.optional(),
    uId: z.string(),
    provider: z.string(),  // 1A | SG | 6E | AI
    airSegments: z.array(KflAirSegment),
  })
  .passthrough();
export type KflItineraryT = z.infer<typeof KflItinerary>;

export const KflJourney = z.object({
  bin: z.string().optional().default(''),
  wSAPId: z.string().optional().default(''),
  travelOrder: z.number().int(),
  journeyKey: z.string(),
  origin: z.string().length(3),
  destination: z.string().length(3),
  ptcChanged: z.boolean().optional().default(false),
  itinerary: z.array(KflItinerary),
});
export type KflJourneyT = z.infer<typeof KflJourney>;

// ────────── Search (LowFareSearch) ──────────

export const KflSector = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureDate: z.string().regex(/^\d{2}-\d{2}-\d{4}$/),  // DD-MM-YYYY
  departureTimeFrom: z.string().optional().default(''),
  departureTimeTo: z.string().optional().default(''),
  cabinClass: z.string().optional().default(''),
});

export const KflSearchRequest = z.object({
  typeOfTrip: KflTripType,
  credentialType: KflCredentialType,
  travelType: KflTravelType,
  salesChannel: KflSalesChannel,
  sectors: z.array(KflSector).min(1),
  paxDetail: KflPaxDetail,
  maxStops: z.number().int().min(0).max(3).default(3),
  maxResult: z.number().int().min(0).default(0),
  returnSpecialFare: z.boolean().default(false),
  refundableOnly: z.boolean().default(false),
  airlines: z.array(z.string()).default([]),
  multipleOneWay: z.boolean().default(true),
});
export type KflSearchRequestT = z.infer<typeof KflSearchRequest>;

export const KflSearchResponse = z.object({
  success: z.boolean().optional(),
  status: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      isPriceChanged: z.boolean().optional().default(false),
      traceId: z.string(),
      journey: z.array(KflJourney).default([]),
    })
    .optional(),
});
export type KflSearchResponseT = z.infer<typeof KflSearchResponse>;

// ────────── Pricing (AirPricing) ──────────
//
// IMPORTANT: the response `journey[].itinerary[]` from AirPricing MUST be
// re-sent unchanged to CreatePnr. Hence `.passthrough()` on the itinerary
// schema — never strip unknown fields, even when normalizing.

export const KflPricingJourneyRequest = z.object({
  travelOrder: z.number(),
  itinerary: z.array(KflItinerary),
  journeyKey: z.string(),
  origin: z.string(),
  destination: z.string(),
});

export const KflPricingRequest = z.object({
  typeOfTrip: KflTripType,
  credentialType: KflCredentialType,
  travelType: KflTravelType,
  traceId: z.string(),
  companyId: z.string().optional().default(''),
  salesChannel: KflSalesChannel,
  journey: z.array(KflPricingJourneyRequest),
  vendorList: z.array(z.any()).default([]),
});
export type KflPricingRequestT = z.infer<typeof KflPricingRequest>;

export const KflPricingResponse = z.object({
  success: z.boolean().optional(),
  status: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      isPriceChanged: z.boolean().optional().default(false),
      traceId: z.string(),
      journey: z.array(KflJourney).default([]),
    })
    .optional(),
});
export type KflPricingResponseT = z.infer<typeof KflPricingResponse>;

// ────────── SSR (meals / baggage / fast-forward) ──────────
//
// All three add-on types share the same wire shape — the only thing that
// changes is where they live in the response. Meals are per-segment
// inside `airSegments[].ssrInfo.meal`; baggage + fast-forward are per-OD
// inside `ancillaries[].baggage` / `.fastForward`.
//
// `key` is opaque — pass back to CreatePnr unchanged inside the
// traveller's mealPreferences[] / baggagePreferences[] / ffwdPreferences[].

export const KflSSROption = z
  .object({
    name: z.string(),
    code: z.string(),
    amount: z.number(),
    currency: z.string().default('INR'),
    desc: z.string().optional().default(''),
    key: z.string(),
    origin: z.string(),
    destination: z.string(),
    airlineCode: z.string(),
    flightNumber: z.string(),
    wayType: z.number().int(),
    paid: z.boolean(),
  })
  .passthrough();
export type KflSSROptionT = z.infer<typeof KflSSROption>;

/** Re-exports under the spec's names — they're identical shapes but
 *  keep the labels so future readers can match the §8.5 catalog. */
export const KflMealChoice = KflSSROption;
export const KflBaggageChoice = KflSSROption;
export const KflFastForwardChoice = KflSSROption;

/** SSR response. The `journey[].itinerary` is singular (one object, not
 *  an array) — Kafila echoes back the one itinerary we sent, with SSRs
 *  attached. Round-trip requires one call per journeyKey. */
export const KflSSRResponse = z.object({
  success: z.boolean().optional(),
  status: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      isPriceChanged: z.boolean().optional().default(false),
      traceId: z.string(),
      journey: z.array(
        z.object({
          travelOrder: z.number().int(),
          itinerary: z
            .object({
              uId: z.string(),
              provider: z.string(),
              airSegments: z.array(
                z
                  .object({
                    ssrInfo: z
                      .object({
                        meal: z.array(KflSSROption).default([]),
                      })
                      .partial()
                      .optional(),
                    segRef: z.string(),
                    airlineCode: z.string(),
                    flightNumber: z.string(),
                    departure: KflAirportRef.optional(),
                    arrival: KflAirportRef.optional(),
                  })
                  .passthrough(),
              ),
              ancillaries: z
                .array(
                  z.object({
                    origin: z.string(),
                    destination: z.string(),
                    group: z.string().optional().default(''),
                    baggage: z.array(KflSSROption).default([]),
                    fastForward: z.array(KflSSROption).default([]),
                  }),
                )
                .default([]),
            })
            .passthrough(),
          journeyKey: z.string(),
          origin: z.string(),
          destination: z.string(),
        }),
      ),
    })
    .optional(),
});
export type KflSSRResponseT = z.infer<typeof KflSSRResponse>;

// ────────── Seat map ──────────

export const KflSeatCharacteristic = z.object({
  key: z.string(),
  description: z.string().optional().default(''),
});

export const KflSeat = z
  .object({
    type: z.literal('Seat'),
    seatCode: z.string(),
    availability: z.enum(['Available', 'Occupied', 'Blocked', 'NotAvailable']),
    paid: z.boolean(),
    characteristics: z.array(KflSeatCharacteristic).default([]),
    key: z.string(),
    currency: z.string().default('INR'),
    amount: z.number().default(0),
    /** Pipe-delimited layout token like `"AW|B9|CA|DA|E9|FW"` — each
     *  chunk is letter (column) + facility code. UI renders the row by
     *  splitting on `|`. See mappers.ts:parseSeatCompartmentLayout. */
    compartment: z.string().optional().default(''),
    deck: z.string().default('1'),
    wayType: z.number().int(),
  })
  .passthrough();
export type KflSeatT = z.infer<typeof KflSeat>;

export const KflSeatRow = z.object({
  number: z.string(),
  facilities: z.array(KflSeat),
});
export type KflSeatRowT = z.infer<typeof KflSeatRow>;

// ────────── Booking (HoldPnr / CreatePnr / retriveBooking) ──────────
//
// CRITICAL invariant: `journey[].itinerary[]` in CreatePnr MUST be the
// itinerary object Kafila returned from AirPricing — unchanged, same
// field ordering, same value types. The adapter pulls this from
// `KafilaSearchSession.pricingByUId[journeyKey:uId]`. If a caller
// forgot to run AirPricing first, the booking will likely fail with a
// vendor-side validation error.
//
// Date format gotcha: `dob` on the traveller is YYYY-MM-DD (NOT the
// DD-MM-YYYY format used in sectors). Mix them up and Kafila returns
// a vague "invalid date format" error.

export const KflPassportDetails = z.object({
  number: z.string().optional().default(''),
  issuingCountry: z.string().optional().default(''),
  issueDate: z.string().optional().default(''),
  expiryDate: z.string().optional().default(''),
  issuingCity: z.string().optional().default(''),
  citizenCountry: z.string().optional().default(''),
});
export type KflPassportDetailsT = z.infer<typeof KflPassportDetails>;

/** Per-traveller contact block. Kafila requires `address1` / `city` /
 *  `state` / `postalCode` / `countryCode` for every traveller — usually
 *  populated from the booking agent's billing address. Domestic
 *  bookings tolerate placeholder values; international ones often
 *  reject if the address is obviously empty. */
export const KflContactDetails = z.object({
  address1: z.string(),
  address2: z.string().optional().default(''),
  city: z.string(),
  state: z.string(),
  country: z.string().nullable().optional(),
  countryCode: z.string().length(2),
  email: z.string().email(),
  phone: z.string(),
  mobile: z.string(),
  postalCode: z.string(),
  isdCode: z.string().nullable().optional(),
});
export type KflContactDetailsT = z.infer<typeof KflContactDetails>;

/** Seat preference reuses the opaque `key` from GetSeatMap. The full
 *  field list duplicates KflSSROption (same opaque-key contract) but
 *  Kafila's traveller schema names it differently for legacy reasons. */
export const KflSeatPreference = z.object({
  code: z.string(),
  amount: z.number(),
  currency: z.string().default('INR'),
  paid: z.boolean(),
  waytype: z.number().int(),
  origin: z.string(),
  destination: z.string(),
  flightNumber: z.string(),
  airlineCode: z.string(),
  key: z.string(),
});
export type KflSeatPreferenceT = z.infer<typeof KflSeatPreference>;

export const KflTravellerDetail = z.object({
  travellerId: z.string().optional().default(''),
  type: KflPaxType,
  title: KflTitle,
  firstName: z.string(),
  middleName: z.string().optional().default(''),
  lastName: z.string(),
  age: z.string().optional(),
  /** YYYY-MM-DD — different from sector dates. Use toKafilaDob(). */
  dob: z.string().optional(),
  gender: KflGender,
  seatPreferences: z.array(KflSeatPreference).default([]),
  baggagePreferences: z.array(KflSSROption).default([]),
  mealPreferences: z.array(KflSSROption).default([]),
  ffwdPreferences: z.array(KflSSROption).default([]),
  passportDetails: KflPassportDetails.partial().default({}),
  contactDetails: KflContactDetails,
  frequentFlyer: z.array(z.any()).nullable().default(null),
  nationality: z.string(),
  department: z.string().optional().default(''),
  designation: z.string().optional().default(''),
});
export type KflTravellerDetailT = z.infer<typeof KflTravellerDetail>;

export const KflGstDetails = z.object({
  fullName: z.string().optional().default(''),
  emailAddress: z.string().optional().default(''),
  homePhone: z.string().optional().default(''),
  workPhone: z.string().optional().default(''),
  gstNumber: z.string().optional().default(''),
  companyName: z.string().optional().default(''),
  addressLine1: z.string().optional().default(''),
  addressLine2: z.string().optional().default(''),
  city: z.string().optional().default(''),
  provinceState: z.string().optional().default(''),
  postalCode: z.string().optional().default(''),
  countryCode: z.string().optional().default(''),
});
export type KflGstDetailsT = z.infer<typeof KflGstDetails>;

export const KflAgencyInfo = KflGstDetails.partial().extend({
  agencyCardId: z.string().optional(),
  agentEmailAddress: z.string().optional(),
  isBtaTACard: z.boolean().optional(),
});
export type KflAgencyInfoT = z.infer<typeof KflAgencyInfo>;

/** Reference-metadata key/value pair sent on CreatePnr. We use this for
 *  idempotency: rmFields gets a `{ key: "BOOKING_REFERENCE_NUMBER",
 *  value: <correlationId> }` entry so vendor-side deduplication catches
 *  accidental double-submits (network retries, webhook re-deliveries). */
export const KflRmField = z.object({
  key: z.string(),
  value: z.string(),
});
export type KflRmFieldT = z.infer<typeof KflRmField>;

export const KflCreatePnrRequest = z.object({
  typeOfTrip: KflTripType,
  credentialType: KflCredentialType,
  travelType: KflTravelType,
  traceId: z.string(),
  salesChannel: KflSalesChannel,
  journey: z.array(
    z.object({
      issueTicket: z.boolean(),
      travelOrder: z.number().int(),
      ptcChanged: z.boolean().default(false),
      /** MUST be from AirPricing response, unchanged. KflItinerary uses
       *  .passthrough() so vendor-specific fields survive the round trip. */
      itinerary: z.array(KflItinerary),
      travellerDetails: z.array(KflTravellerDetail),
      journeyKey: z.string(),
      origin: z.string(),
      destination: z.string(),
    }),
  ),
  gstDetails: KflGstDetails.optional(),
  agencyInfo: KflAgencyInfo.optional(),
  rmFields: z.array(KflRmField).default([]),
  vendorList: z.array(z.any()).default([]),
});
export type KflCreatePnrRequestT = z.infer<typeof KflCreatePnrRequest>;

// HoldPnr is the same shape as CreatePnr — just send `issueTicket: false`
// on each journey. Re-export for clarity.
export const KflHoldPnrRequest = KflCreatePnrRequest;
export type KflHoldPnrRequestT = z.infer<typeof KflHoldPnrRequest>;

// ────────── Booking response shapes ──────────

export const KflRecLoc = z.object({
  type: z.enum(['GDS', 'Airline']),
  pnr: z.string(),
});
export type KflRecLocT = z.infer<typeof KflRecLoc>;

export const KflTicketDetail = z
  .object({
    ticketNumber: z.string(),
    src: z.string().optional().default(''),
    des: z.string().optional().default(''),
  })
  .passthrough();
export type KflTicketDetailT = z.infer<typeof KflTicketDetail>;

export const KflEmdDetail = z
  .object({
    EMDNumber: z.string(),
    IssuedDate: z.string().optional().default(''),
    amount: z.number(),
    type: z.string(),
    currency: z.string().optional().default(''),
    origin: z.string().optional().default(''),
    destination: z.string().optional().default(''),
    status: z.string().optional().default(''),
  })
  .passthrough();
export type KflEmdDetailT = z.infer<typeof KflEmdDetail>;

/** CreatePnr + retriveBooking share this response shape. Most fields
 *  are .passthrough() friendly — vendor adds new fields on a regular
 *  basis and we don't want strict validation to drop them. */
export const KflBookingResponse = z.object({
  success: z.boolean().optional(),
  status: z.number().optional(),
  message: z.string().optional(),
  data: z
    .object({
      Status: z.string().optional(),
      BookingInfo: z
        .object({
          BookingId: z.string().optional(),
          BookingRemark: z.string().optional().default(''),
          PNR: z.string().optional().default(''),
          APnr: z.string().optional().default(''),
          GPnr: z.string().optional().default(''),
          LastTicketingTime: z.string().optional().default(''),
          IsError: z.boolean().optional().default(false),
          /** Kafila's documented values, but we allow any string —
           *  vendors slip new statuses (`TICKETED`, `IN_PROGRESS`) in
           *  without bumping their API version. */
          CurrentStatus: z.string().optional().default(''),
        })
        .passthrough()
        .optional(),
      PaxInfo: z
        .object({
          GstData: KflGstDetails.optional(),
          PaxEmail: z.string().optional().default(''),
          PaxMobile: z.string().optional().default(''),
          Passengers: z
            .array(
              z
                .object({
                  PaxType: KflPaxType.optional(),
                  passengarSerialNo: z.number().optional(),
                  Title: z.string().optional().default(''),
                  FName: z.string().optional().default(''),
                  LName: z.string().optional().default(''),
                  Gender: z.string().optional().default(''),
                  Dob: z.string().optional().default(''),
                  Optional: z
                    .object({
                      ticketDetails: z.array(KflTicketDetail).default([]),
                      EMDDetails: z.array(KflEmdDetail).default([]),
                    })
                    .passthrough()
                    .optional(),
                })
                .passthrough(),
            )
            .default([]),
          totalBaggagePrice: z.number().optional().default(0),
          totalMealPrice: z.number().optional().default(0),
          totalSeatPrice: z.number().optional().default(0),
          totalFastForwardPrice: z.number().optional().default(0),
          totalBasePrice: z.number().optional().default(0),
          totalTaxPrice: z.number().optional().default(0),
          totalBookingFees: z.number().optional().default(0),
          totalGstAmount: z.number().optional().default(0),
          totalPublishedPrice: z.number().optional().default(0),
        })
        .passthrough()
        .optional(),
      ErrorMessage: z.string().optional().default(''),
      WarningMessage: z.string().optional().default(''),
    })
    .passthrough()
    .optional(),
});
export type KflBookingResponseT = z.infer<typeof KflBookingResponse>;

// HoldPnr returns a different shape than CreatePnr — recLoc lives per
// journey, not on a flat BookingInfo. Kept for Phase 4.5 when we wire
// the "ticket later" workflow.
export const KflHoldPnrResponse = z.object({
  success: z.boolean().optional(),
  status: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      traceId: z.string(),
      journey: z
        .array(
          z.object({
            origin: z.string(),
            destination: z.string(),
            bookingStatus: z.string(),
            paymentStatus: z.string().optional().default(''),
            recLoc: z.array(KflRecLoc).default([]),
            itinerary: z.array(KflItinerary).default([]),
          }),
        )
        .default([]),
    })
    .optional(),
});
export type KflHoldPnrResponseT = z.infer<typeof KflHoldPnrResponse>;

// ────────── Seat map ──────────

export const KflSeatMapResponse = z.object({
  success: z.boolean().optional(),
  status: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      isPriceChanged: z.boolean().optional().default(false),
      traceId: z.string(),
      journey: z.array(
        z.object({
          travelOrder: z.number().int(),
          itinerary: z
            .object({
              uId: z.string(),
              provider: z.string(),
              airSegments: z.array(
                z
                  .object({
                    seatRows: z.array(KflSeatRow).default([]),
                    segRef: z.string(),
                    airlineCode: z.string(),
                    flightNumber: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
          journeyKey: z.string(),
          origin: z.string(),
          destination: z.string(),
        }),
      ),
    })
    .optional(),
});
export type KflSeatMapResponseT = z.infer<typeof KflSeatMapResponse>;
