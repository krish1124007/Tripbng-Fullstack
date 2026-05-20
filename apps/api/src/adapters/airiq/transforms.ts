// Pure transforms: NormalizedSearchRequest → AirIQ Availability request, and
// AirIQ Itinerary × Fare → NormalizedFareOption.
//
// No I/O — easy to unit-test against fixtures captured from the AirIQ test
// endpoint once we have credentials and IP whitelisting.

import type { ResultSegment, TravelClass } from '@tripbng/shared';
import type { NormalizedFareOption, NormalizedSearchRequest } from '../types.js';
import {
  type AirIQAvailabilityRequest,
  type AirIQFareDetail,
  type AirIQItinerary,
  type AirIQItineraryFare,
  type AirIQJourneyType,
  type AirIQSegment,
  type AirIQTripInfo,
} from './types.js';
import { DateAdapter, assertAirIQPax } from './utils.js';

// ────────── Cabin class mapping ──────────

const TRAVEL_CLASS_TO_AIRIQ: Record<TravelClass, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'PremiumEconomy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

const AIRIQ_TO_TRAVEL_CLASS: Record<string, TravelClass> = {
  Economy: 'ECONOMY',
  PremiumEconomy: 'PREMIUM_ECONOMY',
  Business: 'BUSINESS',
  First: 'FIRST',
};

export const toAirIQCabinClass = (tc: TravelClass): string => TRAVEL_CLASS_TO_AIRIQ[tc];
export const fromAirIQCabinClass = (s: string | undefined): TravelClass =>
  (s && AIRIQ_TO_TRAVEL_CLASS[s]) || 'ECONOMY';

// ────────── Currency ──────────

/** AirIQ returns rupees (often decimal). Pipeline standardises on integer paise. */
export function rupeesToPaise(r: number | undefined): number {
  if (typeof r !== 'number' || !Number.isFinite(r)) return 0;
  return Math.round(r * 100);
}

// ────────── Pax / journey ──────────

function toJourneyType(req: NormalizedSearchRequest): AirIQJourneyType {
  const segs = req.request.segments;
  if (segs.length === 1) return 'O';
  if (segs.length === 2 && req.request.tripType === 'ROUNDTRIP') return 'R';
  // AirIQ does not support multi-city per §2.6; reject early with a clear message.
  throw new Error(
    `AirIQ: multi-city / ${segs.length}-segment journeys are not supported by this supplier`,
  );
}

// ────────── Search request ──────────

/**
 * Build an Availability request body from our internal NormalizedSearchRequest.
 * Caller layers on the Token (it's per-session and managed by AirIQTokenManager,
 * kept out of the pure transform so this stays unit-testable).
 */
export function buildAirIQAvailabilityRequest(
  req: NormalizedSearchRequest,
  appType: string,
  apiVersion: string,
): Omit<AirIQAvailabilityRequest, 'Token'> {
  assertAirIQPax({
    adults: req.request.pax.adults,
    children: req.request.pax.children,
    infants: req.request.pax.infants,
  });

  const tripInfo: AirIQTripInfo[] = req.request.segments.map((s) => ({
    From: s.origin,
    To: s.destination,
    FlightDate: DateAdapter.toFlightDate(s.date),
  }));

  const preferred = req.request.airlines?.length ? req.request.airlines.join(',') : null;

  return {
    AppType: appType,
    ApiVersion: apiVersion,
    AdultCount: req.request.pax.adults,
    ChildCount: req.request.pax.children,
    InfantCount: req.request.pax.infants,
    JourneyType: toJourneyType(req),
    FlightCabinClass: toAirIQCabinClass(req.request.travelClass),
    PreferredAirlines: preferred,
    Tripinfo: tripInfo,
  };
}

// ────────── Response → NormalizedFareOption ──────────

interface MapResultContext {
  trackId: string;
}

/** Per-pax-type breakdown. Sums available tax fields conservatively. */
function paxBreakdown(
  details: AirIQFareDetail[] | undefined,
  paxType: AirIQFareDetail['PaxType'],
): { baseFarePaise: number; taxesPaise: number } {
  if (!details) return { baseFarePaise: 0, taxesPaise: 0 };
  const d = details.find((x) => x.PaxType === paxType);
  if (!d) return { baseFarePaise: 0, taxesPaise: 0 };
  const taxes =
    (d.Tax ?? 0) +
    (d.YQTax ?? 0) +
    (d.YRTax ?? 0) +
    (d.K3Tax ?? 0) +
    (d.OtherTax ?? 0) +
    (d.ServiceFee ?? 0);
  return {
    baseFarePaise: rupeesToPaise(d.BaseFare ?? 0),
    taxesPaise: rupeesToPaise(taxes),
  };
}

/** Tolerant duration parser — handles "HH:MM", "Hh Mm", or plain minutes string. */
function parseDurationToMinutes(input: string | undefined): number {
  if (!input) return 0;
  const colon = input.match(/^(\d{1,3}):(\d{2})$/);
  if (colon) return parseInt(colon[1]!, 10) * 60 + parseInt(colon[2]!, 10);
  const hm = input.match(/^(\d+)\s*h\s*(\d+)?\s*m?$/i);
  if (hm) return parseInt(hm[1]!, 10) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0);
  const minsOnly = input.match(/^(\d+)\s*m?$/i);
  if (minsOnly) return parseInt(minsOnly[1]!, 10);
  return 0;
}

function segmentToNormalized(s: AirIQSegment): ResultSegment {
  return {
    flightNumber: `${s.AirlineCode}${s.FlightNumber}`,
    airline: { code: s.AirlineCode, name: s.AirlineName || undefined },
    origin: {
      code: s.Origin,
      terminal: s.OriginTerminal || undefined,
    },
    destination: {
      code: s.Destination,
      terminal: s.DestinationTerminal || undefined,
    },
    departure: DateAdapter.fromDateTime(s.DepartureDateTime),
    arrival: DateAdapter.fromDateTime(s.ArrivalDateTime),
    duration: parseDurationToMinutes(s.Duration),
    stopOver: s.Stops ?? 0,
  };
}

/**
 * Pack the identifiers needed for any subsequent AirIQ call into a single opaque
 * token. When Pricing/Book lands, the adapter unpacks this to chain TrackIds.
 */
export function packAirIQFareToken(input: {
  trackId: string;
  itineraryId: string;
  fareId: string;
}): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

export function unpackAirIQFareToken(token: string): {
  trackId: string;
  itineraryId: string;
  fareId: string;
} {
  const json = Buffer.from(token, 'base64url').toString('utf8');
  return JSON.parse(json) as ReturnType<typeof unpackAirIQFareToken>;
}

/**
 * Map one (itinerary × fare) tuple from the Availability response into a single
 * NormalizedFareOption. AirIQ can return multiple fare bundles per itinerary
 * (Saver / Flexi / etc.) — each becomes its own option for the user to pick.
 */
export function mapItineraryAndFareToOption(
  itin: AirIQItinerary,
  fare: AirIQItineraryFare,
  ctx: MapResultContext,
): NormalizedFareOption {
  const segments = (itin.Segments ?? []).map(segmentToNormalized);
  const adult = paxBreakdown(fare.PaxFares, 'ADT');
  const child = paxBreakdown(fare.PaxFares, 'CHD');
  const infant = paxBreakdown(fare.PaxFares, 'INF');

  const seatsRemaining = (() => {
    if (typeof fare.SeatsAvailable === 'number') return fare.SeatsAvailable;
    if (typeof fare.SeatsAvailable === 'string') {
      const n = parseInt(fare.SeatsAvailable, 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  })();

  // AirIQ doesn't always tell us LCC vs FSC explicitly — fall back to FSC when
  // unknown (more conservative for booking semantics, e.g. seat hold).
  const source: NormalizedFareOption['source'] = itin.IsLCC ? 'LCC' : 'FSC';

  // Pick a representative fare class string from the first segment, if any.
  const fareClass = itin.Segments?.[0]?.FareClass ?? itin.Segments?.[0]?.CabinClass ?? undefined;

  return {
    supplierFareId: `${itin.ItineraryId}:${fare.FareId}`,
    inventoryId: undefined,
    segments,
    travelClass: fromAirIQCabinClass(itin.Segments?.[0]?.CabinClass),
    fareClass,
    // AirIQ exposes a marketing-style fare type as FareName — pass it
    // through directly. The whitelist of values isn't fixed (it's whatever
    // the airline's distribution config produced), so we trust the string.
    fareType: fare.FareName ?? undefined,
    perPax: {
      adult: { baseFarePaise: adult.baseFarePaise, taxesPaise: adult.taxesPaise },
      child: { baseFarePaise: child.baseFarePaise, taxesPaise: child.taxesPaise },
      infant: { baseFarePaise: infant.baseFarePaise, taxesPaise: infant.taxesPaise },
    },
    refundable: fare.Refundable ?? false,
    fareRuleDescription: undefined,
    baggageCheckin: fare.BaggageInfo || undefined,
    baggageCabin: fare.CabinBaggageInfo || undefined,
    seatsRemaining: seatsRemaining ?? undefined,
    source,
    supplierFareToken: packAirIQFareToken({
      trackId: ctx.trackId,
      itineraryId: itin.ItineraryId,
      fareId: fare.FareId,
    }),
  };
}
