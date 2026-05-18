// TBO flight Search transforms.
//
// Pure functions: TBO Air Search request/response ↔ canonical
// NormalizedFareOption[]. No HTTP, no DB, no time-of-day logic.
//
// Money: TBO returns fare amounts as decimal rupees (sometimes string,
// sometimes number). We convert to integer paise at this boundary so
// downstream pricing math stays in integers.
//
// Pax split: TBO returns a per-pax-type breakdown (PassengerType=1/2/3).
// We split into adult/child/infant and divide by PassengerCount to get
// per-pax base + tax — matching the contract eTrav uses.

import type {
  NormalizedFareOption,
  NormalizedHoldRequest,
  NormalizedPassenger,
  NormalizedSearchRequest,
  NormalizedSsrSelections,
} from '../types.js';
import type { ResultSegment, TravelClass } from '@tripbng/shared';
import type {
  TboAirSSREnvelope,
  TboAirSearchRequest,
  TboAirSearchResult,
  TboBaggageOption,
  TboBaggageSelection,
  TboBookPassenger,
  TboBookingItinerary,
  TboCabinClass,
  TboFareBreakdownPerPax,
  TboFareRule,
  TboFareSegment,
  TboJourneyType,
  TboMealOption,
  TboMealSelection,
  TboPassengerFare,
  TboPaxType,
  TboSeat,
  TboSeatDynamic,
  TboSeatSelection,
} from './types.js';

// ────────── Request ──────────

/** TBO TripType: 1=Oneway, 2=Return, 3=MultiCity. */
function mapTripTypeToTbo(req: NormalizedSearchRequest['request']): TboJourneyType {
  switch (req.tripType) {
    case 'ONEWAY':
      return 1;
    case 'ROUNDTRIP':
      return 2;
    case 'MULTICITY':
      return 3;
    default:
      return 1;
  }
}

/** Map our TravelClass to TBO's FlightCabinClass enum. */
function mapCabinToTbo(cls: TravelClass): TboCabinClass {
  switch (cls) {
    case 'ECONOMY':
      return 2;
    case 'PREMIUM_ECONOMY':
      return 3;
    case 'BUSINESS':
      return 4;
    case 'FIRST':
      return 6;
    default:
      return 2;
  }
}

/**
 * Build the TBO Air Search payload from a normalized search request. Caller
 * injects EndUserIp + TokenId after — those come from env + auth service,
 * not from the request shape.
 */
export function buildTboSearchRequest(
  req: NormalizedSearchRequest,
): Omit<TboAirSearchRequest, 'EndUserIp' | 'TokenId'> {
  const cabin = mapCabinToTbo(req.request.travelClass);
  return {
    AdultCount: String(req.request.pax.adults),
    ChildCount: String(req.request.pax.children ?? 0),
    InfantCount: String(req.request.pax.infants ?? 0),
    JourneyType: mapTripTypeToTbo(req.request),
    DirectFlight: false,
    OneStopFlight: false,
    Sources: null,
    PreferredAirlines: null,
    Segments: req.request.segments.map((s) => ({
      Origin: s.origin,
      Destination: s.destination,
      FlightCabinClass: cabin,
      // TBO requires 'yyyy-MM-ddTHH:mm:ss' EXACTLY — no Z, no timezone.
      // The schema coerces `date` into a Date object (z.coerce.date()),
      // so a naive template string would emit Date.toString() like
      // "Tue May 12 2026 00:00:00 GMT+0530..." which TBO rejects with
      // "Invalid Date Format". Format explicitly via formatTboDate.
      PreferredDepartureTime: formatTboDate(s.date),
    })),
  };
}

/**
 * Format a Date as TBO's `yyyy-MM-ddTHH:mm:ss` (no timezone suffix). Use UTC
 * components so a date-only input ("2026-05-12") doesn't shift across the
 * boundary in IST → UTC conversion. TBO ignores the time portion for
 * date-based searches; "T00:00:00" is the canonical placeholder.
 *
 * Accepts both Date and string for resilience against schema drift —
 * z.coerce.date() returns Date today but if the schema ever flips back to
 * z.string() this still works.
 */
function formatTboDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) {
    // Fall back to today rather than emitting a malformed string TBO will
    // reject anyway. The caller's request will most likely fail upstream
    // for other reasons too — no point burying the date error.
    const today = new Date();
    return `${today.toISOString().slice(0, 10)}T00:00:00`;
  }
  // toISOString is "2026-05-12T00:00:00.000Z" — slice off the millis + Z.
  return `${date.toISOString().slice(0, 19)}`;
}

// ────────── Response ──────────

/** Coerce a TBO money value (string or number, decimal rupees) to integer
 *  paise. Returns 0 on null/undefined/NaN — never throws. */
export function decimalToPaise(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

/** TBO fare breakdown is keyed by PassengerType (1/2/3) and contains
 *  PassengerCount + total BaseFare + Tax for that type (across all pax).
 *  Convert into per-pax (single-pax) base + tax in paise. */
function perPaxFromBreakdown(
  breakdown: TboFareBreakdownPerPax[] | undefined,
  paxType: 1 | 2 | 3,
): { baseFarePaise: number; taxesPaise: number } {
  const row = (breakdown ?? []).find((b) => b.PassengerType === paxType);
  if (!row || !row.PassengerCount || row.PassengerCount <= 0) {
    return { baseFarePaise: 0, taxesPaise: 0 };
  }
  const baseTotal = decimalToPaise(row.BaseFare);
  // Tax + YQ are both genuine taxes from the user's perspective; AdditionalTxnFee
  // is a service charge surfaced by some sources. Sum into "taxes" for our
  // simplified per-pax view; the raw breakdown is preserved on the supplierFareToken
  // side via TBO's ResultIndex which the adapter round-trips on FareQuote.
  const taxTotal =
    decimalToPaise(row.Tax) +
    decimalToPaise(row.YQTax) +
    decimalToPaise(row.AdditionalTxnFeeOfrd) +
    decimalToPaise(row.PGCharge);
  return {
    baseFarePaise: Math.round(baseTotal / row.PassengerCount),
    taxesPaise: Math.round(taxTotal / row.PassengerCount),
  };
}

/** Normalise a TBO segment datetime to an ISO-8601 string (matches the
 *  shared ResultSegment.departure / arrival contract). TBO returns
 *  "2026-05-10T08:30:00" which is already valid ISO; we re-parse + format
 *  to guarantee a Z-suffixed UTC string. */
function parseTboDateTime(s: string | undefined): string {
  if (!s) return new Date(0).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** TBO duration is in MINUTES — match eTrav's adapter contract (minutes). */
function tboDurationMinutes(s: number | undefined): number {
  if (typeof s !== 'number' || !Number.isFinite(s)) return 0;
  return Math.max(0, Math.round(s));
}

/** Convert one TBO segment to our ResultSegment shape. */
function segmentToNormalized(s: TboFareSegment): ResultSegment {
  const airline = s.Airline?.AirlineCode ?? '';
  const flightNum = s.Airline?.FlightNumber ?? '';
  return {
    flightNumber: `${airline}${flightNum}`,
    airline: {
      code: airline,
      name: s.Airline?.AirlineName || undefined,
    },
    origin: {
      code: s.Origin?.Airport?.AirportCode ?? '',
      terminal: s.Origin?.Airport?.Terminal || undefined,
      name: s.Origin?.Airport?.CityName || s.Origin?.Airport?.AirportName || undefined,
    },
    destination: {
      code: s.Destination?.Airport?.AirportCode ?? '',
      terminal: s.Destination?.Airport?.Terminal || undefined,
      name:
        s.Destination?.Airport?.CityName || s.Destination?.Airport?.AirportName || undefined,
    },
    departure: parseTboDateTime(s.Origin?.DepTime),
    arrival: parseTboDateTime(s.Destination?.ArrTime),
    duration: tboDurationMinutes(s.Duration),
    stopOver: s.StopOver === true ? 1 : 0,
  };
}

/**
 * Pack the TBO identifiers needed for FareRule / FareQuote / SSR / Book /
 * Ticket into a single opaque token. The fare-quote/book adapter methods
 * (when wired in subsequent phases) will unpack this to make the next call.
 *
 * Format mirrors what eTrav does — base64url-encoded JSON. Only TBO knows
 * what's inside; nothing outside the adapter unpacks it.
 */
export function packTboFareToken(input: {
  resultIndex: string;
  traceId: string;
  source: string;
  isLcc: boolean;
}): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

export interface TboFareTokenPayload {
  resultIndex: string;
  traceId: string;
  source: string;
  isLcc: boolean;
}

export function unpackTboFareToken(token: string): TboFareTokenPayload {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    return JSON.parse(json) as TboFareTokenPayload;
  } catch {
    throw new Error('invalid TBO fareToken');
  }
}

/**
 * Map a single TBO Air search result (one fare for one flight) to our
 * NormalizedFareOption. The adapter calls this once per result row after
 * flattening TBO's `Results[outbound|inbound][]` envelope.
 *
 * `searchTraceId` is the TBO TraceId returned at the top level of the
 * search response; it must round-trip on every subsequent call (FareRule,
 * FareQuote, SSR, Book) so the adapter packs it into supplierFareToken.
 */
export function mapResultToOption(
  result: TboAirSearchResult,
  ctx: { searchTraceId: string; travelClass: TravelClass },
): NormalizedFareOption {
  // Flatten the segment groups: [[OB1, OB2], [IB1]] → [OB1, OB2, IB1]. The
  // dedup engine cares about ordered segment keys across the full journey,
  // not about which leg they belong to; TBO's Segments[][] structure is
  // a TBO-internal organisation we collapse here.
  const allSegments: TboFareSegment[] = [];
  for (const group of result.Segments ?? []) {
    for (const seg of group ?? []) allSegments.push(seg);
  }

  const adult = perPaxFromBreakdown(result.FareBreakdown, 1);
  const child = perPaxFromBreakdown(result.FareBreakdown, 2);
  const infant = perPaxFromBreakdown(result.FareBreakdown, 3);

  const firstSeg = allSegments[0];
  const baggage = firstSeg?.Baggage ?? undefined;
  const cabinBaggage = firstSeg?.CabinBaggage ?? undefined;

  const fareToken = packTboFareToken({
    resultIndex: result.ResultIndex,
    traceId: ctx.searchTraceId,
    source: result.Source ?? '',
    isLcc: result.IsLCC === true,
  });

  return {
    supplierFareId: result.ResultIndex,
    segments: allSegments.map(segmentToNormalized),
    travelClass: ctx.travelClass,
    fareClass: firstSeg?.Airline?.FareClass ?? undefined,
    perPax: {
      adult: { baseFarePaise: adult.baseFarePaise, taxesPaise: adult.taxesPaise },
      child: { baseFarePaise: child.baseFarePaise, taxesPaise: child.taxesPaise },
      infant: { baseFarePaise: infant.baseFarePaise, taxesPaise: infant.taxesPaise },
    },
    refundable: result.IsRefundable === true,
    fareRuleDescription: result.FareRules?.[0]?.FareRuleDetail ?? undefined,
    baggageCheckin: baggage,
    baggageCabin: cabinBaggage,
    seatsRemaining: undefined, // TBO doesn't surface this on Search
    source: result.IsLCC === true ? 'LCC' : 'API',
    supplierFareToken: fareToken,
    policyId: undefined,
    fareRuleId: undefined,
  };
}

// ────────── FareRule → canonical route response ──────────

export interface CanonicalFareRule {
  /** Per-OD pair identifier the UI groups by — '${origin}-${destination}' or
   *  the upstream FareRuleIndex when origin/dest are missing. */
  segmentId: string;
  /** Human-readable label — typically airline + fare basis code. Falls back
   *  to fareFamilyCode, then a generic 'Fare rule' label. */
  name: string;
  /** Raw HTML the UI renders in a sandboxed iframe. */
  html: string;
}

/**
 * Translate TBO FareRules[] into the canonical `{ segmentId, name, html }[]`
 * shape served by /api/v1/search/flights/farerule. Pure function — no I/O,
 * safe to unit-test without a live TBO call.
 */
export function mapTboFareRulesForRoute(rules: TboFareRule[]): CanonicalFareRule[] {
  return rules.map((r) => ({
    segmentId:
      r.Origin && r.Destination ? `${r.Origin}-${r.Destination}` : (r.FareRuleIndex ?? ''),
    name:
      [r.Airline, r.FareBasisCode].filter(Boolean).join(' ') ||
      (r.FareFamilyCode ?? 'Fare rule'),
    html: r.FareRuleDetail ?? r.FareRestriction ?? '',
  }));
}

// ────────── FareQuote → canonical route response ──────────

export interface CanonicalRequiredPaxField {
  paxType: 'ADULT' | 'CHILD' | 'INFANT';
  required: string[];
  optional: string[];
  /** TBO's FareQuote doesn't enumerate mandatory SSRs the way eTrav does;
   *  null is the conservative default. Real SSR requirements come from the
   *  separate Air/SSR call (Phase 1.5). */
  mandatorySsrs: string[] | null;
}

export interface CanonicalReprice {
  priceChanged: boolean;
  cancellationPolicyChanged: boolean;
  /** Total selling price in paise across all pax. Sum of FareBreakdown rows
   *  (each row covers one pax type × PassengerCount). */
  newTotalPaise: number;
  requiredPaxDetails: CanonicalRequiredPaxField[];
  /** TBO doesn't surface a "frequent flyer accepted" flag. We always return
   *  false; the eTrav-shaped UI keeps its default copy. */
  frequentFlyerAccepted: boolean;
  /** Last date/time TBO will accept the Ticket call. Surfaced for UI hints. */
  lastTicketDate: string | null;
  /** Authoritative LCC marker — drives the no-Hold ticket-direct pathway in
   *  Phase 8. Surfaced now so the UI can show LCC indicators. */
  isLcc: boolean;
}

/**
 * Translate a TBO FareQuote result into the canonical reprice response
 * shape served by /api/v1/search/flights/reprice. Pure function.
 *
 * @param result            The Results block from a successful FareQuote.
 * @param originalTotalPaise Optional: search-time total. Used as a fallback
 *                           drift signal when TBO's IsPriceChanged is unset.
 */
export function mapTboFareQuoteForRoute(
  result: import('./types.js').TboAirFareQuoteResult,
  originalTotalPaise?: number | null,
): CanonicalReprice {
  // ── newTotalPaise: sum across the per-pax-type breakdown ──
  let newTotalPaise = 0;
  for (const row of result.FareBreakdown ?? []) {
    newTotalPaise +=
      decimalToPaise(row.BaseFare) +
      decimalToPaise(row.Tax) +
      decimalToPaise(row.YQTax) +
      decimalToPaise(row.AdditionalTxnFeeOfrd) +
      decimalToPaise(row.PGCharge);
  }
  // Fallback to the flat Fare object if FareBreakdown is missing/empty.
  if (newTotalPaise === 0 && result.Fare) {
    newTotalPaise =
      decimalToPaise(result.Fare.BaseFare) +
      decimalToPaise(result.Fare.Tax) +
      decimalToPaise(result.Fare.YQTax) +
      decimalToPaise(result.Fare.AdditionalTxnFeeOfrd) +
      decimalToPaise(result.Fare.PGCharge);
  }

  // ── priceChanged: prefer TBO's flag; verify against original total ──
  const tboFlag = result.IsPriceChanged === true;
  const driftedFromOriginal =
    originalTotalPaise != null &&
    newTotalPaise > 0 &&
    Math.abs(newTotalPaise - originalTotalPaise) >= 100; // ignore <₹1 drift
  const priceChanged = tboFlag || driftedFromOriginal;

  // ── requiredPaxDetails: derive per-pax-type field lists ──
  // TBO's FareQuote returns flag-level requirements (Pan/Passport at
  // Book/Ticket, GSTAllowed). It does NOT enumerate per-field requirements
  // the way eTrav's Required_PAX_Details does. We synthesize using
  // Indian-flight conventions:
  //   ADULT:  title/firstName/lastName always required
  //   CHILD:  + dob required (age check at gate)
  //   INFANT: + dob required
  //   passport*: required for ALL pax types when IsPassportRequiredAtBook
  //              OR IsPassportRequiredAtTicket is true
  //   pan:    optional UI hint only; collected on the booker form, not per-pax
  const passportRequired =
    result.IsPassportRequiredAtBook === true || result.IsPassportRequiredAtTicket === true;

  const buildFields = (paxType: 'ADULT' | 'CHILD' | 'INFANT'): CanonicalRequiredPaxField => {
    const required: string[] = ['title', 'firstName', 'lastName'];
    const optional: string[] = ['gender', 'nationality'];
    if (paxType === 'CHILD' || paxType === 'INFANT') {
      required.push('dob');
    } else {
      optional.unshift('dob');
    }
    if (passportRequired) {
      required.push('passportNumber', 'passportExpiry', 'passportIssuingCountry');
    } else {
      optional.push('passportNumber', 'passportExpiry', 'passportIssuingCountry');
    }
    return { paxType, required, optional, mandatorySsrs: null };
  };

  return {
    priceChanged,
    cancellationPolicyChanged: result.IsCancellationPolicyChanged === true,
    newTotalPaise,
    requiredPaxDetails: [buildFields('ADULT'), buildFields('CHILD'), buildFields('INFANT')],
    frequentFlyerAccepted: false,
    lastTicketDate: result.LastTicketDate ?? null,
    isLcc: result.IsLCC === true,
  };
}

// ────────── SSR → canonical route response ──────────

/** TBO seat type code → human-readable label. Returns 'Unknown' for codes
 *  outside the documented enum (defensive — sandbox builds vary). */
function seatTypeLabel(t: number | undefined): string {
  switch (t) {
    case 1:
      return 'Window';
    case 2:
      return 'Aisle';
    case 3:
      return 'Middle';
    default:
      return 'Unknown';
  }
}

/** TBO availability code 1 = Available; everything else (Reserved,
 *  Restricted, NoSeat, NotAvailable) we treat as not bookable. */
function isSeatAvailable(t: number | undefined): boolean {
  return t === 1;
}

/** Pull a numeric weight (KG) out of TBO's mixed string/number Weight field.
 *  E.g. "5 KG" → 5; "10" → 10; null → 0. */
function parseBaggageKg(v: unknown): number {
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(\.\d+)?/);
    if (!m) return 0;
    const n = Number(m[0]);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
  return 0;
}

export interface CanonicalMealOption {
  code: string;
  label: string;
  description: string | null;
  pricePaise: number;
  currency: string;
}

export interface CanonicalBaggageOption {
  code: string;
  label: string;
  weightKg: number;
  pricePaise: number;
  currency: string;
}

export interface CanonicalSeat {
  code: string;
  rowNo: number;
  seatNo: string;
  seatType: string;
  available: boolean;
  pricePaise: number;
  currency: string;
}

export interface CanonicalSeatRow {
  rowNo: number;
  seats: CanonicalSeat[];
}

export interface CanonicalSsrSegment {
  /** "${origin}-${destination}". Stable identifier the UI groups against
   *  the segments returned in Search. */
  segmentId: string;
  origin: string | null;
  destination: string | null;
  meals: CanonicalMealOption[];
  baggage: CanonicalBaggageOption[];
  /** Seat rows in display order — sorted by rowNo asc. Empty when TBO
   *  doesn't return a seat map for the segment (some LCC sources don't). */
  seatRows: CanonicalSeatRow[];
  currency: string;
}

export interface CanonicalSSR {
  segments: CanonicalSsrSegment[];
}

/** Group an array by an origin-destination pair, returning a Map keyed
 *  on `${origin}-${destination}`. Items missing origin/destination are
 *  bucketed under 'unknown'. */
function groupByOd<T extends { Origin?: string; Destination?: string }>(
  items: T[] | undefined,
): Map<string, { origin: string | null; destination: string | null; items: T[] }> {
  const out = new Map<
    string,
    { origin: string | null; destination: string | null; items: T[] }
  >();
  for (const item of items ?? []) {
    const key =
      item.Origin && item.Destination ? `${item.Origin}-${item.Destination}` : 'unknown';
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { origin: item.Origin ?? null, destination: item.Destination ?? null, items: [] };
      out.set(key, bucket);
    }
    bucket.items.push(item);
  }
  return out;
}

function mapMeals(items: TboMealOption[]): CanonicalMealOption[] {
  return items.map((m) => ({
    code: (m.Code ?? '').trim() || `MEAL-${Math.random().toString(36).slice(2, 8)}`,
    label: (m.Description ?? m.AirlineDescription ?? 'Meal').trim(),
    description: m.AirlineDescription ?? null,
    pricePaise: decimalToPaise(m.Price),
    currency: m.Currency ?? 'INR',
  }));
}

function mapBaggage(items: TboBaggageOption[]): CanonicalBaggageOption[] {
  return items.map((b) => ({
    code: (b.Code ?? '').trim() || `BAG-${Math.random().toString(36).slice(2, 8)}`,
    label: (b.Description ?? `Extra ${parseBaggageKg(b.Weight)} kg`).trim(),
    weightKg: parseBaggageKg(b.Weight),
    pricePaise: decimalToPaise(b.Price),
    currency: b.Currency ?? 'INR',
  }));
}

function mapSeat(s: TboSeat): CanonicalSeat {
  const rowNoNum =
    typeof s.RowNo === 'number'
      ? s.RowNo
      : typeof s.RowNo === 'string'
        ? Number.parseInt(s.RowNo, 10) || 0
        : 0;
  return {
    code: (s.Code ?? `${rowNoNum}${s.SeatNo ?? ''}`).trim(),
    rowNo: rowNoNum,
    seatNo: s.SeatNo ?? '',
    seatType: seatTypeLabel(s.SeatType),
    available: isSeatAvailable(s.AvailablityType),
    pricePaise: decimalToPaise(s.Price),
    currency: s.Currency ?? 'INR',
  };
}

/** Build the seat-map for a single segment by walking the SegmentSeat[][]
 *  shape. We dedupe rows by rowNo (TBO may return per-pax-type duplicates;
 *  we keep the first occurrence) and sort ascending. */
function mapSeatRowsForSegment(seg: TboSeatDynamic): CanonicalSeatRow[] {
  const byRow = new Map<number, CanonicalSeat[]>();
  for (const segSeat of seg.SegmentSeat ?? []) {
    for (const rowSeats of segSeat.RowSeats ?? []) {
      for (const seat of rowSeats.Seats ?? []) {
        const mapped = mapSeat(seat);
        // Skip rows that didn't parse — TBO sometimes emits header rows with
        // rowNo 0 and no SeatNo.
        if (mapped.rowNo <= 0 || !mapped.seatNo) continue;
        const existing = byRow.get(mapped.rowNo);
        if (!existing) {
          byRow.set(mapped.rowNo, [mapped]);
          continue;
        }
        // Skip duplicates within the same row (per-pax-type dupes).
        if (!existing.some((s) => s.code === mapped.code)) existing.push(mapped);
      }
    }
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rowNo, seats]) => ({
      rowNo,
      seats: seats.sort((a, b) => a.seatNo.localeCompare(b.seatNo)),
    }));
}

/**
 * Translate a TBO SSR envelope into the canonical per-segment shape the
 * /api/v1/search/flights/ssr route serves. Pure function.
 *
 * Per-segment grouping is by (Origin, Destination) — meals and baggage that
 * lack either field land in the "unknown" bucket and are surfaced with a
 * synthesised segmentId of "unknown" (so the UI can show them as
 * unattached add-ons rather than dropping them silently).
 */
export function mapTboSSRForRoute(envelope: TboAirSSREnvelope): CanonicalSSR {
  const mealItems: TboMealOption[] = [
    ...(envelope.Meal ?? []),
    ...((envelope.MealDynamic ?? []).flat() ?? []),
  ];
  const bagItems: TboBaggageOption[] = [
    ...(envelope.Baggage ?? []),
    ...((envelope.BaggageDynamic ?? []).flat() ?? []),
  ];

  const mealsByOd = groupByOd(mealItems);
  const bagsByOd = groupByOd(bagItems);
  const seatsByOd = new Map<
    string,
    { origin: string | null; destination: string | null; rows: CanonicalSeatRow[] }
  >();

  for (const seg of envelope.SeatDynamic ?? []) {
    const key =
      seg.Origin && seg.Destination ? `${seg.Origin}-${seg.Destination}` : 'unknown';
    const rows = mapSeatRowsForSegment(seg);
    if (!seatsByOd.has(key)) {
      seatsByOd.set(key, {
        origin: seg.Origin ?? null,
        destination: seg.Destination ?? null,
        rows,
      });
    } else {
      // Already-seen segment — append rows without duplicating (the TBO
      // SeatDynamic can repeat the same segment for return-trip envelopes).
      const existing = seatsByOd.get(key)!;
      const seenRowNos = new Set(existing.rows.map((r) => r.rowNo));
      for (const r of rows) if (!seenRowNos.has(r.rowNo)) existing.rows.push(r);
      existing.rows.sort((a, b) => a.rowNo - b.rowNo);
    }
  }

  // Union the segment keys across all three sources so segments that
  // only have meals (no seat map, common for some LCC sources) still appear.
  const allKeys = new Set<string>([
    ...mealsByOd.keys(),
    ...bagsByOd.keys(),
    ...seatsByOd.keys(),
  ]);

  const segments: CanonicalSsrSegment[] = [];
  for (const key of allKeys) {
    const mealBucket = mealsByOd.get(key);
    const bagBucket = bagsByOd.get(key);
    const seatBucket = seatsByOd.get(key);
    const origin = mealBucket?.origin ?? bagBucket?.origin ?? seatBucket?.origin ?? null;
    const destination =
      mealBucket?.destination ?? bagBucket?.destination ?? seatBucket?.destination ?? null;
    const meals = mealBucket ? mapMeals(mealBucket.items) : [];
    const baggage = bagBucket ? mapBaggage(bagBucket.items) : [];
    const seatRows = seatBucket?.rows ?? [];
    const currency =
      meals[0]?.currency ?? baggage[0]?.currency ?? seatRows[0]?.seats[0]?.currency ?? 'INR';
    segments.push({
      segmentId: key,
      origin,
      destination,
      meals,
      baggage,
      seatRows,
      currency,
    });
  }

  return { segments };
}

// ────────── Book/Ticket — passenger + fare-split helpers ──────────

/** Map our title constants ('MR'/'MRS'/'MS'/'MSTR'/'MISS') to TBO's
 *  Title strings ('Mr'/'Mrs'/'Ms'/'Mstr'/'Miss'). TBO accepts the
 *  capitalised string verbatim. */
function tboTitleFor(title: string): string {
  switch (title.toUpperCase()) {
    case 'MR':
      return 'Mr';
    case 'MRS':
      return 'Mrs';
    case 'MS':
      return 'Ms';
    case 'MSTR':
      return 'Mstr';
    case 'MISS':
      return 'Miss';
    default:
      // Permissive default — Mr is the safest fallback for an Adult
      // who didn't supply a title.
      return 'Mr';
  }
}

/** PaxType code: ADULT=1, CHILD=2, INFANT=3. */
function tboPaxTypeFor(t: NormalizedPassenger['type']): TboPaxType {
  switch (t) {
    case 'ADULT':
      return 1;
    case 'CHILD':
      return 2;
    case 'INFANT':
      return 3;
  }
}

/** Format a JS Date to TBO-friendly 'YYYY-MM-DD'. Returns undefined for
 *  null/invalid input — caller drops the field. */
function tboDateOnly(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/**
 * Per-pax fare-split — TBO §9.5 quirk.
 *
 * TBO's Book/Ticket request requires per-passenger Fare blocks where
 * BaseFare is `totalBaseFare / paxCount`, even when FareBreakdown shows
 * different per-pax-type values. Sum of per-pax allocations must equal
 * the FareQuote total to the paise — otherwise TBO rejects with a
 * "fare mismatch" error.
 *
 * Strategy: take the TOTAL across all pax types from FareBreakdown, divide
 * by total head-count, and assign equally. Remainder paise from rounding
 * are absorbed into the lead passenger's allocation so the sum still
 * matches exactly.
 */
export function perPaxFareSplit(
  breakdown: TboFareBreakdownPerPax[] | undefined,
  passengers: NormalizedPassenger[],
): TboPassengerFare[] {
  if (!breakdown || breakdown.length === 0 || passengers.length === 0) {
    return passengers.map(() => zeroFare());
  }

  // Sum totals across all pax-type rows. TBO returns these as decimal rupees;
  // we work in rupees here (not paise) because the Book/Ticket request takes
  // decimal numbers — TBO does its own paise rounding server-side. We keep
  // 2-decimal precision via Math.round on cents.
  const totals = {
    BaseFare: 0,
    Tax: 0,
    YQTax: 0,
    AdditionalTxnFeeOfrd: 0,
    AdditionalTxnFeePub: 0,
    PGCharge: 0,
  };
  for (const row of breakdown) {
    totals.BaseFare += toRupees(row.BaseFare);
    totals.Tax += toRupees(row.Tax);
    totals.YQTax += toRupees(row.YQTax);
    totals.AdditionalTxnFeeOfrd += toRupees(row.AdditionalTxnFeeOfrd);
    totals.AdditionalTxnFeePub += toRupees(row.AdditionalTxnFeePub);
    totals.PGCharge += toRupees(row.PGCharge);
  }

  const n = passengers.length;
  // Round each per-pax allocation to 2 dp (paise precision) to keep the
  // wire format clean. Track running sum to absorb the remainder into
  // pax index 0.
  const split = (total: number): { perPax: number; remainder: number } => {
    const perPaxRounded = Math.floor((total * 100) / n) / 100;
    const remainderPaise = Math.round(total * 100) - Math.round(perPaxRounded * 100) * n;
    return { perPax: perPaxRounded, remainder: remainderPaise / 100 };
  };

  const baseFare = split(totals.BaseFare);
  const tax = split(totals.Tax);
  const yq = split(totals.YQTax);
  const txnOfrd = split(totals.AdditionalTxnFeeOfrd);
  const txnPub = split(totals.AdditionalTxnFeePub);
  const pg = split(totals.PGCharge);

  const currency =
    breakdown[0]?.Currency ??
    'INR'; // TBO is INR-only for Indian agencies; default safe.

  return passengers.map((_, i) => ({
    Currency: currency,
    BaseFare: baseFare.perPax + (i === 0 ? baseFare.remainder : 0),
    Tax: tax.perPax + (i === 0 ? tax.remainder : 0),
    YQTax: yq.perPax + (i === 0 ? yq.remainder : 0),
    AdditionalTxnFeeOfrd: txnOfrd.perPax + (i === 0 ? txnOfrd.remainder : 0),
    AdditionalTxnFeePub: txnPub.perPax + (i === 0 ? txnPub.remainder : 0),
    PGCharge: pg.perPax + (i === 0 ? pg.remainder : 0),
  }));
}

function zeroFare(): TboPassengerFare {
  return {
    Currency: 'INR',
    BaseFare: 0,
    Tax: 0,
    YQTax: 0,
    AdditionalTxnFeeOfrd: 0,
    AdditionalTxnFeePub: 0,
    PGCharge: 0,
  };
}

function toRupees(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the TBO Passengers[] array for a Book or LCC-Ticket request.
 *
 * Lead-pax convention: TBO requires exactly one passenger with IsLeadPax=true.
 * We pick the first ADULT in the list. Contact details (email, mobile)
 * are written onto the lead passenger; other passengers receive only
 * their own identifying fields.
 */
export function buildTboPassengers(
  req: NormalizedHoldRequest,
  fareBreakdown: TboFareBreakdownPerPax[] | undefined,
): TboBookPassenger[] {
  const leadIdx = req.passengers.findIndex((p) => p.type === 'ADULT');
  const fares = perPaxFareSplit(fareBreakdown, req.passengers);

  return req.passengers.map((p, i) => {
    const isLead = i === leadIdx;
    const passenger: TboBookPassenger = {
      Title: tboTitleFor(p.title),
      FirstName: p.firstName,
      LastName: p.lastName,
      PaxType: tboPaxTypeFor(p.type),
      IsLeadPax: isLead,
      Fare: fares[i] ?? zeroFare(),
    };
    const dob = tboDateOnly(p.dateOfBirth);
    if (dob) passenger.DateOfBirth = dob;
    if (p.gender === 'M') passenger.Gender = 1;
    else if (p.gender === 'F') passenger.Gender = 2;
    if (p.nationality) passenger.Nationality = p.nationality;
    if (p.passport) {
      passenger.PassportNo = p.passport.number;
      passenger.PassportIssuingCountry = p.passport.issuingCountry;
      const exp = tboDateOnly(p.passport.expiry);
      if (exp) passenger.PassportExpiry = exp;
    }
    if (isLead) {
      passenger.ContactNo = req.contact.mobile;
      passenger.Email = req.contact.email;
    }
    return passenger;
  });
}

// ────────── SSR selections → TBO Book/Ticket payload ──────────

/**
 * Translate canonical NormalizedSsrSelections into TBO's per-segment
 * Meal/Baggage/SeatPreference arrays. Pure function.
 *
 * Each pick gets routed via `airlineCode + flightNumber + wayType + origin
 * + destination` — these come from the /flights/ssr response and are
 * forwarded by the UI verbatim. When any of those routing fields are
 * missing on the canonical pick, the corresponding TBO field is left
 * empty-string (TBO accepts empty strings for known-but-unused fields).
 *
 * Returns `undefined` when the input is null/empty so the adapter can
 * conditionally include the SSR keys in its request body.
 */
export function buildTboSsrPayload(
  selections: NormalizedSsrSelections | undefined,
): {
  Meal?: TboMealSelection[];
  Baggage?: TboBaggageSelection[];
  SeatPreference?: TboSeatSelection[];
} {
  if (!selections) return {};

  const meals = (selections.meals ?? []).map<TboMealSelection>((m) => ({
    AirlineCode: m.airlineCode ?? '',
    FlightNumber: m.flightNumber ?? '',
    WayType: m.wayType ?? 1,
    Code: m.code,
    Description: m.description,
    /** TBO wants decimal rupees here (matches FareBreakdown convention).
     *  We round to 2dp to keep the wire format clean. */
    Price: Math.round((m.pricePaise ?? 0)) / 100,
    Origin: m.origin ?? '',
    Destination: m.destination ?? '',
    Currency: m.currency ?? 'INR',
  }));

  const baggage = (selections.baggage ?? []).map<TboBaggageSelection>((b) => ({
    AirlineCode: b.airlineCode ?? '',
    FlightNumber: b.flightNumber ?? '',
    WayType: b.wayType ?? 1,
    Code: b.code,
    Description: b.description,
    Weight: b.weightKg,
    Price: Math.round((b.pricePaise ?? 0)) / 100,
    Origin: b.origin ?? '',
    Destination: b.destination ?? '',
    Currency: b.currency ?? 'INR',
  }));

  const seats = (selections.seats ?? []).map<TboSeatSelection>((s) => ({
    AirlineCode: s.airlineCode ?? '',
    FlightNumber: s.flightNumber ?? '',
    WayType: s.wayType ?? 1,
    Code: s.code,
    RowNo: s.rowNo,
    SeatNo: s.seatNo,
    Description: s.seatType,
    Price: Math.round((s.pricePaise ?? 0)) / 100,
    Origin: s.origin ?? '',
    Destination: s.destination ?? '',
    Currency: s.currency ?? 'INR',
  }));

  // Don't emit empty arrays — TBO sometimes interprets [] as "no SSR
  // requested" and other times as "no SSR available", inconsistently.
  // Omitting the key is cleaner.
  return {
    ...(meals.length > 0 ? { Meal: meals } : {}),
    ...(baggage.length > 0 ? { Baggage: baggage } : {}),
    ...(seats.length > 0 ? { SeatPreference: seats } : {}),
  };
}

// ────────── Booking-detail (Air/GetBookingDetails) ──────────

/**
 * Canonical booking-detail shape returned by retrieveBooking(). The adapter
 * contract only requires `{ supplierBookingRef, pnr?, status }`; we expose
 * a *slightly* richer shape internally so the caller (services/booking) can
 * also reconcile ticket numbers + per-pax tickets when ops triggers a
 * "refresh from supplier" action. Only `supplierBookingRef + pnr + status`
 * are returned upstream — extra fields are layered in via the optional
 * `extra` block.
 */
export interface CanonicalBookingDetails {
  supplierBookingRef: string;
  pnr?: string;
  status: string;
  /** Round-tripped raw fields useful for ops reconciliation. */
  extra?: {
    bookingStatus?: number;
    invoiceNo?: string;
    lastTicketDate?: string;
    ticketNumbers?: string[];
    /** Per-pax ticket map keyed by "FirstName LastName" — best-effort. */
    paxTickets?: Array<{
      title?: string;
      firstName?: string;
      lastName?: string;
      paxType?: number;
      ticketNumber?: string;
      ticketStatus?: string;
    }>;
  };
}

/**
 * Map TBO BookingStatus enum → string status. TBO's BookingStatus is mostly
 * undocumented across docs versions; we collapse to the four states our
 * Booking model cares about.
 *
 *   0 / undefined → 'PENDING'   (in-progress / unknown)
 *   1            → 'CONFIRMED'  (Confirmed at airline)
 *   2            → 'TICKETED'   (Ticket issued)
 *   3            → 'CANCELLED'
 *   4            → 'FAILED'     (Rejected)
 *   else         → fallback to TBO's free-text Status, else 'UNKNOWN'
 */
function mapTboBookingStatus(
  bookingStatus: number | undefined,
  fallbackStatus: string | undefined,
): string {
  switch (bookingStatus) {
    case 1:
      return 'CONFIRMED';
    case 2:
      return 'TICKETED';
    case 3:
      return 'CANCELLED';
    case 4:
      return 'FAILED';
    case 0:
      return 'PENDING';
    default:
      // Fall back to TBO's free-text — already 'Confirmed'/'Cancelled'/etc.
      // Normalize to upper-case so the caller's status switch is stable.
      return (fallbackStatus ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
  }
}

/**
 * Map TBO's FlightItinerary block to our canonical booking-detail shape.
 * Pure function; safe to unit-test in isolation.
 *
 * - `supplierBookingRef` falls back to whatever the caller passed in if
 *   TBO's response doesn't echo it back (some sandbox responses don't).
 * - `status` is derived from BookingStatus enum first, then free-text
 *   `Status` field.
 * - Ticket numbers are collected from the per-pax `Ticket.TicketNumber`
 *   field, deduped, empty-trimmed.
 */
export function mapTboItineraryToBookingDetails(
  itinerary: TboBookingItinerary | undefined,
  fallbackSupplierBookingRef: string,
): CanonicalBookingDetails {
  if (!itinerary) {
    return {
      supplierBookingRef: fallbackSupplierBookingRef,
      status: 'UNKNOWN',
    };
  }

  const supplierBookingRef = itinerary.BookingId
    ? String(itinerary.BookingId)
    : fallbackSupplierBookingRef;
  const pnr = itinerary.PNR && itinerary.PNR.trim().length > 0
    ? itinerary.PNR.trim()
    : undefined;
  const status = mapTboBookingStatus(itinerary.BookingStatus, itinerary.Status);

  const paxTickets = (itinerary.Passenger ?? []).map((p) => ({
    title: p.Title,
    firstName: p.FirstName,
    lastName: p.LastName,
    paxType: typeof p.PaxType === 'number' ? p.PaxType : undefined,
    ticketNumber: p.Ticket?.TicketNumber,
    ticketStatus: p.Ticket?.TicketStatus,
  }));

  // Dedupe + trim + drop blanks. Lead pax usually has the canonical number.
  const ticketNumbers = Array.from(
    new Set(
      paxTickets
        .map((p) => (p.ticketNumber ?? '').trim())
        .filter((n) => n.length > 0),
    ),
  );

  return {
    supplierBookingRef,
    pnr,
    status,
    extra: {
      bookingStatus: itinerary.BookingStatus,
      invoiceNo: itinerary.InvoiceNo,
      lastTicketDate: itinerary.LastTicketDate,
      ticketNumbers: ticketNumbers.length > 0 ? ticketNumbers : undefined,
      paxTickets: paxTickets.length > 0 ? paxTickets : undefined,
    },
  };
}

// ────────── ChangeRequest helpers (cancel-poll) ──────────

/** Map TBO's ChangeRequestStatus enum (0/1/2/3/4) to our canonical strings.
 *  TBO docs: 0=NotSet, 1=Pending, 2=InProgress, 3=Processed, 4=Rejected.
 *  Used by the flight cancel-poll worker to update booking state. */
export function mapChangeRequestStatusEnum(
  s: 0 | 1 | 2 | 3 | 4 | undefined,
): 'PENDING' | 'IN_PROGRESS' | 'PROCESSED' | 'REJECTED' | 'UNKNOWN' {
  switch (s) {
    case 1:
      return 'PENDING';
    case 2:
      return 'IN_PROGRESS';
    case 3:
      return 'PROCESSED';
    case 4:
      return 'REJECTED';
    default:
      return 'UNKNOWN';
  }
}

/** Convert TBO's decimal-rupee number/string to integer paise.
 *  Returns undefined when the input is null/undefined/non-numeric (TBO
 *  doesn't always populate refund fields — only at terminal status=3). */
export function decimalRupeesToPaise(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}
