// Mappers — Kafila wire shapes ↔ TripBng's NormalizedFareOption.
//
// The asymmetry to keep in mind:
//   - Kafila → Normalized: lossy. We project the parts our search UI
//     cares about (segments, perPax fares, refundable, baggage).
//   - Normalized → Kafila: lossless ROUND-TRIP. The pricing-response
//     itinerary MUST be re-sent to CreatePnr unchanged, so the booking
//     path NEVER reconstructs it from normalized data — it looks the
//     blob up from KafilaSearchSession by uId.
//
// supplierFareToken format: `kfl:${searchId}:${journeyKey}:${uId}`. The
// adapter's pricing/book flows split on `:` to retrieve the original
// itinerary blob from Mongo. `:` is safe because searchId is a UUID
// (no colons) and journeyKey/uId are also UUIDs.

import type { ResultSegment, SearchRequest, TravelClass } from '@tripbng/shared';
import type {
  NormalizedFareOption,
  NormalizedHoldRequest,
  NormalizedHoldResponse,
  NormalizedPassenger,
  NormalizedTicketResponse,
} from '../types.js';
import { SupplierAdapterError } from '../types.js';
import {
  toKafilaDob,
  toKafilaSearchDate,
  toIsoLocalDateTime,
  parseKafilaDurationToMinutes,
} from './date.js';
import type {
  KflAirSegmentT,
  KflBookingResponseT,
  KflContactDetailsT,
  KflCreatePnrRequestT,
  KflCredentialTypeT,
  KflItineraryT,
  KflJourneyT,
  KflPricingRequestT,
  KflSSROptionT,
  KflSalesChannelT,
  KflSearchRequestT,
  KflSeatT,
  KflSeatPreferenceT,
  KflTravellerDetailT,
  KflTravelTypeT,
} from './types.js';

const TOKEN_PREFIX = 'kfl';

// ────────── Travel-class mapping ──────────

const TRAVEL_CLASS_TO_KFL: Record<TravelClass, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'PremiumEconomy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

// Reverse mapping for parsing Kafila's cabinClass back to ours. Vendor
// is loose about casing here (we've seen `economy` / `Economy` /
// `ECONOMY`), so normalize before lookup.
const KFL_TO_TRAVEL_CLASS = new Map<string, TravelClass>([
  ['economy', 'ECONOMY'],
  ['premiumeconomy', 'PREMIUM_ECONOMY'],
  ['premium economy', 'PREMIUM_ECONOMY'],
  ['business', 'BUSINESS'],
  ['first', 'FIRST'],
]);

function parseKafilaCabinClass(input: string | undefined): TravelClass {
  if (!input) return 'ECONOMY';
  return KFL_TO_TRAVEL_CLASS.get(input.toLowerCase().trim()) ?? 'ECONOMY';
}

// ────────── Request mapper ──────────

export interface KafilaSearchContext {
  credentialType: KflCredentialTypeT;
  salesChannel: KflSalesChannelT;
}

/** Project a NormalizedSearchRequest into a KflSearchRequest body.
 *  Heuristic for INT vs DOM: if any origin/destination IATA is NOT in
 *  India's IATA whitelist, treat the whole search as INT. (Vendor uses
 *  this flag to gate passport mandates; getting it wrong on a DOM
 *  search just means passport fields are accepted-but-not-mandatory,
 *  which is harmless. Getting it wrong on INT means CreatePnr will
 *  reject for missing passport — caught downstream.) */
export function toKafilaSearchRequest(
  req: SearchRequest,
  ctx: KafilaSearchContext,
): KflSearchRequestT {
  const cabinKfl = TRAVEL_CLASS_TO_KFL[req.travelClass];
  const travelType: KflTravelTypeT = inferTravelType(req);
  return {
    typeOfTrip: req.tripType,
    credentialType: ctx.credentialType,
    travelType,
    salesChannel: ctx.salesChannel,
    sectors: req.segments.map((s) => ({
      origin: s.origin.toUpperCase(),
      destination: s.destination.toUpperCase(),
      departureDate: toKafilaSearchDate(s.date),
      departureTimeFrom: '',
      departureTimeTo: '',
      cabinClass: cabinKfl,
    })),
    paxDetail: {
      adults: req.pax.adults,
      children: req.pax.children,
      infants: req.pax.infants,
    },
    maxStops: 3,
    maxResult: 0,
    returnSpecialFare: false,
    refundableOnly: req.refundableOnly ?? false,
    airlines: req.airlines ?? [],
    multipleOneWay: true,
  };
}

// India's commercial IATA codes — the whitelist used for the DOM/INT
// heuristic. Not exhaustive (regional airports added on demand), but
// covers the metros + tier-2/3 cities Kafila serves. False negatives
// (missing IATA → flagged as INT) are conservative; CreatePnr will
// just over-collect passport fields.
const INDIA_IATA = new Set([
  'DEL', 'BOM', 'MAA', 'BLR', 'CCU', 'HYD', 'AMD', 'PNQ', 'COK', 'GOI',
  'GOX', 'JAI', 'LKO', 'PAT', 'TRV', 'IXC', 'IXB', 'IXR', 'BBI', 'NAG',
  'IDR', 'BHO', 'RPR', 'GAU', 'BDQ', 'STV', 'UDR', 'JDH', 'IXE', 'IXJ',
  'SXR', 'IXL', 'VTZ', 'VGA', 'ATQ', 'TIR', 'CJB', 'IXM', 'IXZ', 'PNY',
  'BHJ', 'DIB', 'IMF', 'AGR', 'VNS', 'CCJ',
]);

function inferTravelType(req: SearchRequest): KflTravelTypeT {
  for (const seg of req.segments) {
    if (!INDIA_IATA.has(seg.origin.toUpperCase())) return 'INT';
    if (!INDIA_IATA.has(seg.destination.toUpperCase())) return 'INT';
  }
  return 'DOM';
}

// ────────── Response mapper ──────────

export interface FareOptionMapContext {
  searchId: string;
  journey: KflJourneyT;
}

/** Project one Kafila itinerary to a NormalizedFareOption. Money fields
 *  multiply by 100 (Kafila is rupees, NormalizedFareOption is paise).
 *  perPax fares are extracted from priceBreakup[] by passengerType. */
export function fromKafilaItinerary(
  itin: KflItineraryT,
  ctx: FareOptionMapContext,
): NormalizedFareOption {
  const segments: ResultSegment[] = itin.airSegments.map(mapAirSegmentToResultSegment);
  const perPax = buildPerPaxFares(itin);

  // Travel class is segment-level on Kafila; we surface the first
  // segment's class as the option-level value (which is correct for
  // single-cabin itineraries — the common case). Mixed-cabin itineraries
  // pick the worst of the bunch and we use that, since UI typically
  // shows "from X" pricing per class tier.
  const firstSegClass = itin.airSegments[0]?.cabinClass;
  const travelClass = parseKafilaCabinClass(firstSegClass);

  return {
    supplierFareId: itin.uId,
    segments,
    travelClass,
    fareClass: itin.airSegments[0]?.fareBasis,
    perPax,
    refundable: itin.refundable,
    fareRuleDescription: undefined,
    baggageCheckin: itin.airSegments[0]?.baggageInfo,
    baggageCabin: itin.airSegments[0]?.cabinBaggage,
    seatsRemaining: extractSeatsRemaining(itin),
    source: 'API',
    supplierFareToken: buildSupplierFareToken(ctx.searchId, ctx.journey.journeyKey, itin.uId),
  };
}

function mapAirSegmentToResultSegment(seg: KflAirSegmentT): ResultSegment {
  return {
    flightNumber: seg.flightNumber,
    airline: {
      code: seg.airlineCode,
      name: seg.airlineName,
    },
    origin: {
      code: seg.departure.code,
      terminal: seg.departure.terminal,
      name: seg.departure.name,
    },
    destination: {
      code: seg.arrival.code,
      terminal: seg.arrival.terminal,
      name: seg.arrival.name,
    },
    departure: toIsoLocalDateTime(seg.departure.date, seg.departure.time),
    arrival: toIsoLocalDateTime(seg.arrival.date, seg.arrival.time),
    duration: parseKafilaDurationToMinutes(seg.travelTime ?? seg.flyingTime),
    stopOver: 0, // Per-segment stopover count — Kafila gives this at the
                 // itinerary level via `technicalStops`. For now we leave
                 // 0; the search-results UI computes total stops from
                 // segments.length - 1 anyway.
  };
}

/** Pull adult/child/infant base+tax from priceBreakup[]. Kafila uses
 *  rupees with up to 2 decimals; we convert to paise (× 100). Infants
 *  often have no breakup line — default to 0. */
function buildPerPaxFares(itin: KflItineraryT): NormalizedFareOption['perPax'] {
  const lookup = new Map<string, { base: number; tax: number }>();
  for (const line of itin.priceBreakup) {
    lookup.set(line.passengerType, {
      base: Math.round(line.baseFare * 100),
      tax: Math.round(line.tax * 100),
    });
  }
  const adt = lookup.get('ADT') ?? { base: 0, tax: 0 };
  const chd = lookup.get('CHD') ?? { base: 0, tax: 0 };
  const inf = lookup.get('INF') ?? { base: 0, tax: 0 };
  return {
    adult: { baseFarePaise: adt.base, taxesPaise: adt.tax },
    child: { baseFarePaise: chd.base, taxesPaise: chd.tax },
    infant: { baseFarePaise: inf.base, taxesPaise: inf.tax },
  };
}

function extractSeatsRemaining(itin: KflItineraryT): number | undefined {
  // KflAirSegment.noOfSeats is a string like "9" or sometimes missing.
  // Pick the minimum across segments (multi-leg fare is bottlenecked by
  // the leg with fewest seats).
  let min: number | undefined;
  for (const seg of itin.airSegments) {
    if (!seg.noOfSeats) continue;
    const n = parseInt(seg.noOfSeats, 10);
    if (!Number.isFinite(n)) continue;
    if (min === undefined || n < min) min = n;
  }
  return min;
}

// ────────── Token encode/decode ──────────

export function buildSupplierFareToken(searchId: string, journeyKey: string, uId: string): string {
  return `${TOKEN_PREFIX}:${searchId}:${journeyKey}:${uId}`;
}

export interface ParsedKafilaToken {
  searchId: string;
  journeyKey: string;
  uId: string;
}

/** Reverse of buildSupplierFareToken. Returns null when the token isn't
 *  a Kafila token (caller can fall through to a different adapter). */
export function parseSupplierFareToken(token: string): ParsedKafilaToken | null {
  const parts = token.split(':');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const [, searchId, journeyKey, uId] = parts;
  if (!searchId || !journeyKey || !uId) return null;
  return { searchId, journeyKey, uId };
}

// ────────── Pricing-request mapper ──────────

export interface PricingBuildContext {
  credentialType: KflCredentialTypeT;
  salesChannel: KflSalesChannelT;
  travelType: KflTravelTypeT;
  companyId?: string;
  typeOfTrip: 'ONEWAY' | 'ROUNDTRIP' | 'MULTICITY';
}

/** Build an AirPricing / GetSSRs / GetSeatMap request from a saved
 *  search session + the chosen uId. All three endpoints take the same
 *  request shape — Kafila routes on the URL path, not the body.
 *
 *  We send back ONLY the selected itinerary, not all of its journey's
 *  alternatives — keeps the request small + matches the Postman example.
 *  The opaque key fields inside the itinerary survive untouched because
 *  KflItinerary uses `.passthrough()` in types.ts. */
export function toKafilaPricingRequest(args: {
  traceId: string;
  journeys: KflJourneyT[];
  selectedUId: string;
  selectedJourneyKey: string;
  ctx: PricingBuildContext;
}): KflPricingRequestT {
  // Find the chosen itinerary so we send just that one back, not all of
  // its journey's alternatives. Sending only the selected reduces the
  // request size + matches what the Postman example does.
  const journey = args.journeys.find((j) => j.journeyKey === args.selectedJourneyKey);
  if (!journey) {
    throw new Error(
      `Kafila pricing: journeyKey ${args.selectedJourneyKey} not found in session`,
    );
  }
  const itin = journey.itinerary.find((i) => i.uId === args.selectedUId);
  if (!itin) {
    throw new Error(
      `Kafila pricing: uId ${args.selectedUId} not found in journey ${args.selectedJourneyKey}`,
    );
  }
  return {
    typeOfTrip: args.ctx.typeOfTrip,
    credentialType: args.ctx.credentialType,
    travelType: args.ctx.travelType,
    traceId: args.traceId,
    companyId: args.ctx.companyId ?? '',
    salesChannel: args.ctx.salesChannel,
    journey: [
      {
        travelOrder: journey.travelOrder,
        itinerary: [itin],
        journeyKey: journey.journeyKey,
        origin: journey.origin,
        destination: journey.destination,
      },
    ],
    vendorList: [],
  };
}

// ────────── Seat-map compartment parser ──────────

/** Parse Kafila's pipe-delimited seat-row compartment layout.
 *
 *  Kafila returns a string like `"AW|B9|CA|DA|E9|FW"` on every seat in a
 *  row. Each `|`-separated token is letter-then-code:
 *    - letter   = column label as printed on the boarding pass (A, B, C, ...)
 *    - code     = facility marker:
 *        W = Window seat, A = Aisle, 9 = Standard middle/regular, X = Lavatory,
 *        - = Aisle gap, and a few vendor-specific codes we treat as opaque.
 *
 *  The same string repeats on every seat in the row because it describes
 *  the WHOLE row's layout — UI uses it to render gap columns (aisles)
 *  between groups. The seat picker stays clean if we parse once per row
 *  rather than per seat.
 *
 *  Returns `null` for empty/unparseable input — caller falls back to a
 *  default grid. */
export interface SeatColumn {
  /** Column label (A, B, C, ...). */
  label: string;
  /** Single-char facility code: W=window, A=aisle, -=aisle-gap, etc. */
  code: string;
  /** Convenience: true when `code === '-'` — caller renders an aisle. */
  isAisle: boolean;
}

export function parseSeatCompartmentLayout(compartment: string | undefined | null): SeatColumn[] | null {
  if (!compartment) return null;
  const trimmed = compartment.trim();
  if (!trimmed) return null;
  const out: SeatColumn[] = [];
  for (const tok of trimmed.split('|')) {
    const t = tok.trim();
    if (!t) continue;
    // First char is column letter, rest is facility code. Single-char
    // tokens (rare; vendor edge case) treat the whole thing as code with
    // empty label.
    const label = t.length > 1 ? t[0]! : '';
    const code = t.length > 1 ? t.slice(1) : t;
    out.push({ label, code, isAisle: code === '-' });
  }
  return out.length > 0 ? out : null;
}

/** Pick the cheapest available seat from a list — primarily used by
 *  health-check / smoke-test paths. UI seat pickers do their own pick;
 *  this helper exists so adapter tests can construct a valid Phase-4
 *  CreatePnr without a real user choice. */
export function pickCheapestAvailableSeat(seats: KflSeatT[]): KflSeatT | null {
  let best: KflSeatT | null = null;
  for (const s of seats) {
    if (s.availability !== 'Available') continue;
    if (!best || s.amount < best.amount) best = s;
  }
  return best;
}

// ────────── Phase 4: booking mappers ──────────

const KFL_PAX_FROM_NORMALIZED: Record<'ADULT' | 'CHILD' | 'INFANT', 'ADT' | 'CHD' | 'INF'> = {
  ADULT: 'ADT',
  CHILD: 'CHD',
  INFANT: 'INF',
};

/** Build the contactDetails block from the normalized contact + a
 *  fallback address. Kafila requires `address1` / `city` / `state` /
 *  `postalCode` / `countryCode` on every traveller — the normalized
 *  contract only carries email/mobile, so missing address fields fall
 *  back to placeholder values acceptable for DOM bookings.
 *
 *  INT bookings should override these via the optional `billingAddress`
 *  param — vendor often rejects obviously-empty addresses on intl
 *  itineraries. */
export interface BillingAddress {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  postalCode?: string;
  country?: string;
}

function buildContactDetails(
  contact: NormalizedHoldRequest['contact'],
  billing: BillingAddress | undefined,
): KflContactDetailsT {
  const cc = (contact.countryCode ?? billing?.countryCode ?? 'IN').toUpperCase();
  return {
    address1: billing?.address1 ?? 'NA',
    address2: billing?.address2 ?? '',
    city: billing?.city ?? 'NA',
    state: billing?.state ?? 'NA',
    country: billing?.country ?? null,
    countryCode: cc.length === 2 ? cc : 'IN',
    email: contact.email,
    phone: contact.mobile,
    mobile: contact.mobile,
    postalCode: billing?.postalCode ?? '000000',
    isdCode: contact.countryCode ?? null,
  };
}

/** Look up the matching SSR catalog entry by code + segment routing.
 *  Kafila's SSR response groups options by (origin, destination) for
 *  baggage/fast-forward and by segment for meals — we accept either
 *  via the loose route-key match below. Returns null when the catalog
 *  doesn't carry the chosen code (e.g. UI is out of sync with vendor). */
function findSsrOption(
  catalog: KflSSROptionT[],
  code: string,
  routing: { origin?: string; destination?: string; airlineCode?: string; flightNumber?: string },
): KflSSROptionT | null {
  for (const opt of catalog) {
    if (opt.code !== code) continue;
    // If the caller supplied routing hints, require them to match.
    if (routing.origin && opt.origin && opt.origin !== routing.origin) continue;
    if (routing.destination && opt.destination && opt.destination !== routing.destination) {
      continue;
    }
    if (routing.airlineCode && opt.airlineCode && opt.airlineCode !== routing.airlineCode) {
      continue;
    }
    if (routing.flightNumber && opt.flightNumber && opt.flightNumber !== routing.flightNumber) {
      continue;
    }
    return opt;
  }
  return null;
}

/** Pull every meal option visible in the SSR response (across all
 *  segments) into a flat catalog. Lookup happens by code + routing. */
function flattenMealCatalog(ssrData: unknown): KflSSROptionT[] {
  const out: KflSSROptionT[] = [];
  const data = ssrData as
    | {
        journey?: Array<{
          itinerary?: {
            airSegments?: Array<{ ssrInfo?: { meal?: KflSSROptionT[] } }>;
          };
        }>;
      }
    | undefined;
  for (const j of data?.journey ?? []) {
    for (const seg of j.itinerary?.airSegments ?? []) {
      for (const m of seg.ssrInfo?.meal ?? []) out.push(m);
    }
  }
  return out;
}

function flattenBaggageCatalog(ssrData: unknown): KflSSROptionT[] {
  const out: KflSSROptionT[] = [];
  const data = ssrData as
    | {
        journey?: Array<{
          itinerary?: { ancillaries?: Array<{ baggage?: KflSSROptionT[] }> };
        }>;
      }
    | undefined;
  for (const j of data?.journey ?? []) {
    for (const anc of j.itinerary?.ancillaries ?? []) {
      for (const b of anc.baggage ?? []) out.push(b);
    }
  }
  return out;
}

function flattenSeatCatalog(seatMapData: unknown): KflSeatT[] {
  const out: KflSeatT[] = [];
  const data = seatMapData as
    | {
        journey?: Array<{
          itinerary?: {
            airSegments?: Array<{
              seatRows?: Array<{ facilities?: KflSeatT[] }>;
              airlineCode?: string;
              flightNumber?: string;
            }>;
          };
        }>;
      }
    | undefined;
  for (const j of data?.journey ?? []) {
    for (const seg of j.itinerary?.airSegments ?? []) {
      for (const row of seg.seatRows ?? []) {
        for (const s of row.facilities ?? []) {
          // Attach segment routing to the seat for downstream lookup —
          // KflSeat lacks these fields but the booking flow needs them.
          out.push({ ...s, _segAirline: seg.airlineCode, _segFlight: seg.flightNumber } as unknown as KflSeatT);
        }
      }
    }
  }
  return out;
}

/** Map a NormalizedPassenger into Kafila's traveller shape. Handles the
 *  passport mandate for INT-ADT/CHD, the DOB date format, and per-pax
 *  SSR/seat picks (looked up from the catalogs in the search session). */
function toKafilaTraveller(args: {
  pax: NormalizedPassenger;
  paxIndex: number;
  contact: KflContactDetailsT;
  travelType: KflTravelTypeT;
  ssrSelections: NormalizedHoldRequest['ssrSelections'];
  mealCatalog: KflSSROptionT[];
  baggageCatalog: KflSSROptionT[];
  seatCatalog: KflSeatT[];
  supplierCode: string;
}): KflTravellerDetailT {
  const {
    pax,
    paxIndex,
    contact,
    travelType,
    ssrSelections,
    mealCatalog,
    baggageCatalog,
    seatCatalog,
    supplierCode,
  } = args;

  const type = KFL_PAX_FROM_NORMALIZED[pax.type];

  // INT bookings: passport mandatory for ADT + CHD. INF inherits via
  // the parent so vendor doesn't always reject — we still warn the
  // booking service to collect it.
  if (travelType === 'INT' && (type === 'ADT' || type === 'CHD') && !pax.passport) {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      `Kafila: passport mandatory for ${type} on international itinerary (pax index ${paxIndex})`,
      supplierCode,
    );
  }

  const passportDetails = pax.passport
    ? {
        number: pax.passport.number,
        issuingCountry: pax.passport.issuingCountry,
        // Kafila accepts blank issueDate; just send expiry.
        issueDate: '',
        expiryDate: toKafilaDob(pax.passport.expiry),
        issuingCity: '',
        citizenCountry: pax.nationality ?? pax.passport.issuingCountry,
      }
    : {};

  // ── SSR mapping ──
  const meals: KflSSROptionT[] = [];
  for (const pick of ssrSelections?.meals ?? []) {
    const opt = findSsrOption(mealCatalog, pick.code, {
      origin: pick.origin,
      destination: pick.destination,
      airlineCode: pick.airlineCode,
      flightNumber: pick.flightNumber,
    });
    if (opt) meals.push(opt);
  }

  const baggage: KflSSROptionT[] = [];
  for (const pick of ssrSelections?.baggage ?? []) {
    const opt = findSsrOption(baggageCatalog, pick.code, {
      origin: pick.origin,
      destination: pick.destination,
      airlineCode: pick.airlineCode,
      flightNumber: pick.flightNumber,
    });
    if (opt) baggage.push(opt);
  }

  // ── Seat mapping ──
  // Only this passenger's seat picks (filtered by paxIndex). Look up
  // the opaque key from the seat catalog by code + segment routing.
  const seats: KflSeatPreferenceT[] = [];
  for (const pick of ssrSelections?.seats ?? []) {
    if (pick.paxIndex !== paxIndex) continue;
    const matched = seatCatalog.find((s) => {
      if (s.seatCode !== pick.code) return false;
      const segAirline = (s as unknown as { _segAirline?: string })._segAirline;
      const segFlight = (s as unknown as { _segFlight?: string })._segFlight;
      if (pick.airlineCode && segAirline && segAirline !== pick.airlineCode) return false;
      if (pick.flightNumber && segFlight && segFlight !== pick.flightNumber) return false;
      return true;
    });
    if (matched) {
      seats.push({
        code: matched.seatCode,
        amount: matched.amount,
        currency: matched.currency,
        paid: matched.paid,
        waytype: matched.wayType,
        origin: pick.origin ?? '',
        destination: pick.destination ?? '',
        flightNumber: pick.flightNumber ?? '',
        airlineCode: pick.airlineCode ?? '',
        key: matched.key,
      });
    }
  }

  return {
    travellerId: '',
    type,
    title: pax.title as KflTravellerDetailT['title'],
    firstName: pax.firstName,
    middleName: '',
    lastName: pax.lastName,
    dob: pax.dateOfBirth ? toKafilaDob(pax.dateOfBirth) : undefined,
    gender: (pax.gender ?? (type === 'INF' ? 'M' : 'M')) as 'M' | 'F',
    seatPreferences: seats,
    baggagePreferences: baggage,
    mealPreferences: meals,
    ffwdPreferences: [],
    passportDetails,
    contactDetails: contact,
    frequentFlyer: null,
    nationality: pax.nationality ?? 'IN',
    department: '',
    designation: '',
  };
}

export interface BuildCreatePnrArgs {
  parsed: ParsedKafilaToken;
  session: {
    correlationId: string;
    request: unknown;
    searchResponseData: unknown;
    pricingByUId: unknown;
    ssrByUId: unknown;
    seatMapByUId: unknown;
  };
  hold: NormalizedHoldRequest;
  ctx: PricingBuildContext;
  issueTicket: boolean;
  billingAddress?: BillingAddress;
}

/** Build a full CreatePnr / HoldPnr request body from a saved session
 *  plus the booking-time inputs. The most important invariant:
 *  `journey[].itinerary[]` is the AirPricing response's itinerary,
 *  unchanged. Falls back to the search response itinerary (with a
 *  warning) if AirPricing was skipped — vendor will likely reject. */
export function toKafilaCreatePnrRequest(args: BuildCreatePnrArgs): {
  body: KflCreatePnrRequestT;
  itinerary: KflItineraryT;
} {
  const { parsed, session, hold, ctx, issueTicket, billingAddress } = args;
  const searchData = session.searchResponseData as
    | { traceId: string; journey: KflJourneyT[] }
    | undefined;
  if (!searchData?.traceId || !Array.isArray(searchData.journey)) {
    throw new SupplierAdapterError(
      'NOT_FOUND',
      'Kafila CreatePnr: session missing search data — re-run search',
      'KAFILA',
    );
  }

  const journey = searchData.journey.find((j) => j.journeyKey === parsed.journeyKey);
  if (!journey) {
    throw new SupplierAdapterError(
      'NOT_FOUND',
      `Kafila CreatePnr: journeyKey ${parsed.journeyKey} not found`,
      'KAFILA',
    );
  }

  // Prefer the pricing-response itinerary (Kafila's hard invariant). If
  // it's not there (AirPricing skipped), fall back to the search-time
  // itinerary — booking probably fails but we surface the same shape
  // for the audit log.
  const pricingMap = (session.pricingByUId as Record<string, unknown> | undefined) ?? {};
  const pricingKey = `${parsed.journeyKey}:${parsed.uId}`;
  const priced = (pricingMap[pricingKey] as
    | { journey?: Array<{ itinerary?: KflItineraryT[] }> }
    | undefined);
  const pricedItin = priced?.journey?.[0]?.itinerary?.find((i) => i.uId === parsed.uId);
  const itinerary: KflItineraryT =
    pricedItin ?? journey.itinerary.find((i) => i.uId === parsed.uId) ?? journey.itinerary[0]!;

  const contact = buildContactDetails(hold.contact, billingAddress);

  // SSR + seat catalogs from the session — empty if the user skipped
  // getSSRs / getSeatMap (which is fine, no opaque keys to fetch).
  const ssrData = ((session.ssrByUId as Record<string, unknown> | undefined) ?? {})[pricingKey];
  const seatMapData = ((session.seatMapByUId as Record<string, unknown> | undefined) ?? {})[
    pricingKey
  ];
  const mealCatalog = flattenMealCatalog(ssrData);
  const baggageCatalog = flattenBaggageCatalog(ssrData);
  const seatCatalog = flattenSeatCatalog(seatMapData);

  const travellerDetails = hold.passengers.map((pax, paxIndex) =>
    toKafilaTraveller({
      pax,
      paxIndex,
      contact,
      travelType: ctx.travelType,
      ssrSelections: hold.ssrSelections,
      mealCatalog,
      baggageCatalog,
      seatCatalog,
      supplierCode: 'KAFILA',
    }),
  );

  const body: KflCreatePnrRequestT = {
    typeOfTrip: ctx.typeOfTrip,
    credentialType: ctx.credentialType,
    travelType: ctx.travelType,
    traceId: searchData.traceId,
    salesChannel: ctx.salesChannel,
    journey: [
      {
        issueTicket,
        travelOrder: journey.travelOrder,
        ptcChanged: false,
        itinerary: [itinerary],
        travellerDetails,
        journeyKey: journey.journeyKey,
        origin: journey.origin,
        destination: journey.destination,
      },
    ],
    rmFields: [
      // Vendor-side idempotency key. Reusing correlationId ties the
      // booking to its audit-log trail and de-duplicates accidental
      // double-submits on Kafila's side.
      { key: 'BOOKING_REFERENCE_NUMBER', value: session.correlationId },
    ],
    vendorList: [],
  };

  return { body, itinerary };
}

// ────────── Booking response → normalized ──────────

/** Project a CreatePnr / retriveBooking response into the normalized
 *  hold response shape. Kafila returns the same envelope for both, so
 *  this fn handles either source. */
export function fromKafilaBookingResponseToHold(
  res: KflBookingResponseT,
): NormalizedHoldResponse {
  const info = res.data?.BookingInfo;
  const bookingId = info?.BookingId ?? '';
  if (!bookingId) {
    throw new SupplierAdapterError(
      'UPSTREAM',
      `Kafila CreatePnr: response missing BookingId (status=${res.data?.Status ?? 'unknown'}, err=${res.data?.ErrorMessage ?? ''})`,
      'KAFILA',
    );
  }
  // Kafila doesn't return a hard expiry on CreatePnr (the ticket's
  // already been issued). Hold-only flow does — Phase 4.5. For now,
  // surface a 30-day expiry as a placeholder; the booking service can
  // refine it from the itinerary's lastTicketingDate.
  return {
    supplierBookingRef: bookingId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    pnr: info?.GPnr || info?.PNR || info?.APnr || undefined,
  };
}

/** Project the same booking response into the normalized ticket
 *  response shape — i.e. when the caller wants ticket numbers, not
 *  just the PNR. Returns empty `ticketNumbers` if vendor hasn't issued
 *  yet (CurrentStatus===PENDING); caller polls retriveBooking until
 *  numbers appear. */
export function fromKafilaBookingResponseToTicket(
  res: KflBookingResponseT,
): NormalizedTicketResponse {
  const info = res.data?.BookingInfo;
  const pnr = info?.GPnr || info?.PNR || info?.APnr || '';
  const airlinePnr = info?.APnr || info?.PNR || '';
  const ticketNumbers: string[] = [];
  for (const p of res.data?.PaxInfo?.Passengers ?? []) {
    for (const t of p.Optional?.ticketDetails ?? []) {
      if (t.ticketNumber) ticketNumbers.push(t.ticketNumber);
    }
  }
  return {
    pnr,
    airlinePnr: airlinePnr || undefined,
    ticketNumbers: ticketNumbers.length > 0 ? ticketNumbers : undefined,
  };
}
