// Pure transforms: dates, baggage strings, and the central
// eTrav → NormalizedFareOption mapper.
//
// These have no I/O so they are easy to unit-test against fixtures captured
// from staging once IP whitelisting is sorted.

import type { ResultSegment, TravelClass } from '@tripbng/shared';
import type { NormalizedFareOption, NormalizedSearchRequest } from '../types.js';
import {
  EtravBookingType,
  EtravCabinClass,
  EtravPaxType,
  type EtravAirSearchRequest,
  type EtravFare,
  type EtravFareDetail,
  type EtravFlight,
  type EtravFreeBaggage,
  type EtravSegment,
  type EtravTripInfo,
} from './types.js';

// ────────── Dates ──────────

/** Date → eTrav's MM/DD/YYYY (US) format. Always use this — never hand-format. */
export function toEtravDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Parse eTrav's segment datetime back to ISO 8601.
 * eTrav appears to send `YYYY-MM-DDTHH:mm:ss` (server-local) — we treat it as
 * IST since the API is India-hosted. Adjust if real fixtures show otherwise.
 */
export function parseEtravDateTime(s: string): string {
  // Already-ISO inputs pass through unchanged.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    // Append IST offset if no zone specified.
    return /[+-]\d{2}:?\d{2}|Z$/.test(s) ? s : `${s}+05:30`;
  }
  // MM/DD/YYYY HH:mm format — defensive fallback.
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) {
    const [, mm, dd, yyyy, hh, mi] = m;
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+05:30`;
  }
  // Last resort: best-effort Date parse.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** "HH:mm" duration → minutes. Returns 0 on parse failure. */
export function parseDurationToMinutes(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,3}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

// ────────── Free baggage parser ──────────

export interface ParsedBaggage {
  onward: string | null;
  return: string | null;
}

/**
 * eTrav concatenates baggage as "OB-30 KgRT-30 Kg" or "7 Kg7 Kg|" (one-way may
 * have no OB/RT prefixes — same value repeated). This best-effort parser
 * extracts onward (OB) and return (RT) chunks. Falls back to the raw string.
 */
export function parseBaggageString(raw: string | undefined | null): ParsedBaggage {
  if (!raw) return { onward: null, return: null };
  const trimmed = raw.trim();

  // Prefixed variant: OB-... RT-...
  const obRtMatch = trimmed.match(/OB-?([^R|]+?)(?:RT-?([^|]+?))?(?:\||$)/i);
  if (obRtMatch && obRtMatch[1]) {
    return {
      onward: obRtMatch[1].trim() || null,
      return: obRtMatch[2]?.trim() ?? null,
    };
  }

  // Unprefixed: "7 Kg7 Kg" — duplicated value, single value, or pipe-separated.
  const piped = trimmed
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (piped.length >= 2) return { onward: piped[0]!, return: piped[1]! };
  if (piped.length === 1) {
    // Try splitting at "Kg" — common enough pattern.
    const kgMatch = piped[0]!.match(/^([\d.]+\s*Kg)\s*([\d.]+\s*Kg)?$/i);
    if (kgMatch) {
      return { onward: kgMatch[1]!, return: kgMatch[2] ?? null };
    }
    return { onward: piped[0]!, return: null };
  }

  return { onward: trimmed, return: null };
}

/** Convenience: stringify both directions for storage on NormalizedFareOption. */
export function formatBaggageForStorage(b: EtravFreeBaggage | undefined): {
  checkin: string | null;
  cabin: string | null;
} {
  if (!b) return { checkin: null, cabin: null };
  const ck = parseBaggageString(b.Check_In_Baggage);
  const cb = parseBaggageString(b.Hand_Baggage);
  const fmt = (p: ParsedBaggage) =>
    p.onward && p.return && p.onward !== p.return
      ? `Onward: ${p.onward} · Return: ${p.return}`
      : (p.onward ?? p.return);
  return { checkin: fmt(ck), cabin: fmt(cb) };
}

// ────────── Currency ──────────

/** eTrav returns rupees (may be decimal). Our pipeline uses integer paise. */
export function rupeesToPaise(r: number): number {
  return Math.round(r * 100);
}

// ────────── Enum mappers ──────────

const TRAVEL_CLASS_TO_ETRAV: Record<TravelClass, EtravCabinClass> = {
  ECONOMY: EtravCabinClass.Economy,
  PREMIUM_ECONOMY: EtravCabinClass.PremiumEconomy,
  BUSINESS: EtravCabinClass.Business,
  FIRST: EtravCabinClass.First,
};

const ETRAV_TO_TRAVEL_CLASS: Record<EtravCabinClass, TravelClass> = {
  [EtravCabinClass.Economy]: 'ECONOMY',
  [EtravCabinClass.PremiumEconomy]: 'PREMIUM_ECONOMY',
  [EtravCabinClass.Business]: 'BUSINESS',
  [EtravCabinClass.First]: 'FIRST',
};

export const toEtravCabinClass = (tc: TravelClass): EtravCabinClass => TRAVEL_CLASS_TO_ETRAV[tc];

export const fromEtravCabinClass = (ec: EtravCabinClass): TravelClass =>
  ETRAV_TO_TRAVEL_CLASS[ec] ?? 'ECONOMY';

// ────────── Search request: NormalizedSearchRequest → EtravAirSearchRequest ──────────

/**
 * Build an Air_Search request body from our internal NormalizedSearchRequest.
 * Caller layers on the Auth_Header (it's per-request and contains creds, kept
 * out of pure transforms so this stays unit-testable).
 */
export function buildEtravSearchRequest(
  req: NormalizedSearchRequest,
): Omit<EtravAirSearchRequest, 'Auth_Header'> {
  const segments = req.request.segments;
  // Heuristic for Travel_Type: international iff any segment crosses
  // an Indian airport boundary. We don't carry country metadata on segments
  // currently — default to International to be safe (eTrav allows domestic
  // sectors under International too).
  const travelType = 1; // International — broadest semantic; refine later

  const bookingType: EtravBookingType =
    segments.length === 1
      ? EtravBookingType.OneWay
      : segments.length === 2
        ? EtravBookingType.RoundTrip
        : EtravBookingType.MultiCity;

  const tripInfo: EtravTripInfo[] = segments.map((s, i) => ({
    Origin: s.origin,
    Destination: s.destination,
    TravelDate: toEtravDate(s.date),
    Trip_Id: (bookingType === EtravBookingType.RoundTrip && i === 1 ? 1 : 0) as 0 | 1,
  }));

  return {
    Travel_Type: travelType,
    Booking_Type: bookingType,
    TripInfo: tripInfo,
    Adult_Count: req.request.pax.adults,
    Child_Count: req.request.pax.children,
    Infant_Count: req.request.pax.infants,
    Class_Of_Travel: toEtravCabinClass(req.request.travelClass),
    InventoryType: 0,
    Filtered_Airline: null,
  };
}

// ────────── Response: EtravFlight + Fare → NormalizedFareOption ──────────

interface MapResultContext {
  searchKey: string;
}

/** Per-pax-type → (basePaise, taxesPaise) extractor. Falls back to zero if pax type missing. */
function paxBreakdown(
  details: EtravFareDetail[],
  paxType: EtravPaxType,
): { baseFarePaise: number; taxesPaise: number } {
  const d = details.find((x) => x.PAX_Type === paxType);
  if (!d) return { baseFarePaise: 0, taxesPaise: 0 };
  const base = rupeesToPaise(d.Basic_Amount + d.YQ_Amount);
  // AirportTax + ServiceFee + GST flow into taxes from our pricing engine's POV.
  // TradeMarkup is supplier markup; pricing engine layers our own markup on top.
  const taxes = rupeesToPaise(
    d.AirportTax_Amount + d.Service_Fee_Amount + d.GST + d.Trade_Markup_Amount,
  );
  return { baseFarePaise: base, taxesPaise: taxes };
}

/** Convert one eTrav segment to our ResultSegment shape. */
function segmentToNormalized(s: EtravSegment): ResultSegment {
  return {
    flightNumber: `${s.Airline_Code}${s.Flight_Number}`,
    airline: { code: s.Airline_Code, name: s.Airline_Name || undefined },
    origin: {
      code: s.Origin,
      terminal: s.Origin_Terminal || undefined,
      name: s.Origin_City || undefined,
    },
    destination: {
      code: s.Destination,
      terminal: s.Destination_Terminal || undefined,
      name: s.Destination_City || undefined,
    },
    departure: parseEtravDateTime(s.Departure_DateTime),
    arrival: parseEtravDateTime(s.Arrival_DateTime),
    duration: parseDurationToMinutes(s.Duration),
    stopOver: Array.isArray(s.Stop_Over) ? s.Stop_Over.length : 0,
  };
}

/**
 * Pack the three eTrav identifiers needed for any subsequent call into a single
 * opaque token. The hold/ticket/cancel adapter methods (when their specs land)
 * will unpack this to make the next eTrav call.
 */
export function packEtravFareToken(input: {
  searchKey: string;
  flightKey: string;
  fareId: string;
}): string {
  // Compact JSON, base64url'd to stay URL-safe end-to-end.
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

export function unpackEtravFareToken(token: string): {
  searchKey: string;
  flightKey: string;
  fareId: string;
} {
  const json = Buffer.from(token, 'base64url').toString('utf8');
  return JSON.parse(json) as ReturnType<typeof unpackEtravFareToken>;
}

/**
 * Map one (flight × fare) tuple from the eTrav search response into a single
 * NormalizedFareOption. eTrav can return multiple fares per flight (Saver,
 * Flexi, Corporate); we expand each into its own option so the user can pick.
 */
export function mapFlightAndFareToOption(
  flight: EtravFlight,
  fare: EtravFare,
  ctx: MapResultContext,
): NormalizedFareOption {
  const segments = flight.Segments.map(segmentToNormalized);
  const adult = paxBreakdown(fare.FareDetails, EtravPaxType.Adult);
  const child = paxBreakdown(fare.FareDetails, EtravPaxType.Child);
  const infant = paxBreakdown(fare.FareDetails, EtravPaxType.Infant);

  // Pick a representative fare class string. Confirmed against a real response:
  // Class_Code is often null, FareBasis carries the meaningful value (e.g. "QOWINA").
  const fareClass =
    fare.FareDetails[0]?.FareClasses[0]?.Class_Code ??
    fare.FareDetails[0]?.FareClasses[0]?.FareBasis ??
    undefined;

  const baggage = formatBaggageForStorage(fare.FareDetails[0]?.Free_Baggage);

  // Source tag — IsLCC drives the source. eTrav is the supplier; under the
  // hood it's the carrier, so LCC vs FSC is what matters for our pipeline.
  const source: NormalizedFareOption['source'] = flight.IsLCC ? 'LCC' : 'FSC';

  // Travel class is per-fare-class; we read off the first segment's first
  // FareClass entry. Falls back to economy.
  const travelClass: TravelClass = 'ECONOMY';

  const seatsRemaining = (() => {
    if (typeof fare.Seats_Available === 'number') return fare.Seats_Available;
    const n = parseInt(String(fare.Seats_Available ?? ''), 10);
    return Number.isFinite(n) ? n : null;
  })();

  // FareType enum → agent-facing label. The labels match the way airlines
  // typically market these fares; "Retail" stays as-is rather than getting
  // re-labelled to "Regular" because agents already recognise eTrav's
  // RetailFare bucket.
  const fareTypeLabel = ((): string | undefined => {
    switch (fare.FareType) {
      case 0:
        return 'Retail';
      case 1:
        return 'Coupon';
      case 2:
        return 'Corporate';
      case 3:
        return 'SME';
      case 4:
        return 'RTSPL';
      case 5:
        return 'Deal';
      default:
        return undefined;
    }
  })();

  return {
    supplierFareId: fare.Fare_Id,
    inventoryId: undefined,
    segments,
    travelClass,
    fareClass,
    fareType: fareTypeLabel,
    perPax: {
      adult: { baseFarePaise: adult.baseFarePaise, taxesPaise: adult.taxesPaise },
      child: { baseFarePaise: child.baseFarePaise, taxesPaise: child.taxesPaise },
      infant: { baseFarePaise: infant.baseFarePaise, taxesPaise: infant.taxesPaise },
    },
    refundable: fare.Refundable,
    fareRuleDescription: undefined,
    baggageCheckin: baggage.checkin ?? undefined,
    baggageCabin: baggage.cabin ?? undefined,
    seatsRemaining: seatsRemaining ?? undefined,
    source,
    supplierFareToken: packEtravFareToken({
      searchKey: ctx.searchKey,
      flightKey: flight.Flight_Key,
      fareId: fare.Fare_Id,
    }),
  };
}
