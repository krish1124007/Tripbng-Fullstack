// AirIQ AAS v1.0 wire types — narrowed to the fields the search-only flow needs
// today (Login + Availability). Booking/ticketing/track-status types will be
// added when those services land.
//
// IMPORTANT: AirIQ shipped no JSON samples with the spec — the field names below
// follow the API Reference Manual v1.0 verbatim where the doc is explicit, and
// are best-guesses where it is not. Treat anything unmarked as "confirmed" as
// candidates to harden once we capture real fixtures from the test endpoint
// (http://testairiq.mywebcheck.in/TravelAPI.svc).

// ────────── Common envelope ──────────

/** Documented in §2.3 of the integration brief. 2 = pending — only on Book / IssueTicket.
 *  Confirmed against the live test endpoint: AirIQ returns these as JSON STRINGS, not numbers.
 *  Example real response: `"ResultCode":"0"`. */
export const AirIQResultCode = {
  Success: '1',
  Failure: '0',
  Exception: '-1',
  Pending: '2',
} as const;
export type AirIQResultCode = (typeof AirIQResultCode)[keyof typeof AirIQResultCode];

export interface AirIQStatus {
  /** "1" / "0" / "-1" / "2". See AirIQResultCode. */
  ResultCode: AirIQResultCode | string;
  /** Human-readable error string. Empty on success. */
  Error: string;
  /** AirIQ-side correlation id — log on every call for support escalation. */
  SequenceID: string;
}

// ────────── Login ──────────

export interface AirIQLoginRequest {
  AppType: string; // 'API'
  ApiVersion: string; // 'V1.0'
}

export interface AirIQLoginResponse {
  Status: AirIQStatus;
  /** Bearer-style token; valid until end of day IST per §2.2. Empty string on failure. */
  Token: string;
  /** Echoed back from the request — confirmed present on the live response. */
  AgentID?: string;
  /** Per-terminal session id; AirIQ surfaces it in the Login response. */
  TerminalID?: string;
  UserName?: string;
}

// ────────── Availability (search) ──────────

/** "O" oneway, "R" roundtrip. Multi-city is not supported by AirIQ (§2.6). */
export type AirIQJourneyType = 'O' | 'R';

export interface AirIQTripInfo {
  /** 3-letter IATA. */
  From: string;
  /** 3-letter IATA. */
  To: string;
  /** yyyymmdd — see DateAdapter.toFlightDate. */
  FlightDate: string;
}

export interface AirIQAvailabilityRequest {
  AppType: string;
  ApiVersion: string;
  Token: string;
  AdultCount: number;
  ChildCount: number;
  InfantCount: number;
  JourneyType: AirIQJourneyType;
  /** "Economy" | "PremiumEconomy" | "Business" | "First". String per the doc. */
  FlightCabinClass: string;
  /** Comma-separated airline codes ("AI,6E"); null/empty = all. */
  PreferredAirlines?: string | null;
  Tripinfo: AirIQTripInfo[];
}

/** One leg in an itinerary — the doc references the field names below. */
export interface AirIQSegment {
  AirlineCode: string;
  AirlineName?: string;
  FlightNumber: string;
  /** Operating carrier — may differ on codeshare. */
  OperatingAirlineCode?: string;
  /** "DD MMM YYYY HH:MM" per §2.5. */
  DepartureDateTime: string;
  ArrivalDateTime: string;
  Origin: string;
  Destination: string;
  OriginTerminal?: string;
  DestinationTerminal?: string;
  /** Free-text or HH:MM — parser tolerates both. */
  Duration?: string;
  /** Cabin / fare class single letter (Y/W/C/F or carrier-specific). */
  CabinClass?: string;
  FareClass?: string;
  Equipment?: string;
  /** Some carriers send a numeric stop-count per segment. */
  Stops?: number;
}

/**
 * Per-pax-type fare breakdown. The doc lists Basic / Tax / TotalFare-style fields
 * but the exact key names vary by deployment — the optional keys below are the
 * supersets we've seen referenced. Pricing engine reads what's present.
 */
export interface AirIQFareDetail {
  /** "ADT" | "CHD" | "INF". */
  PaxType: 'ADT' | 'CHD' | 'INF';
  BaseFare?: number;
  Tax?: number;
  /** Some payloads itemise YQ / YR / K3 / OT — sum into taxes. */
  YQTax?: number;
  YRTax?: number;
  K3Tax?: number;
  OtherTax?: number;
  ServiceFee?: number;
  TotalFare?: number;
  /** Supplier markup — informational, not added on top of TotalFare. */
  Markup?: number;
}

export interface AirIQItineraryFare {
  /** Stable id within the itinerary for the fare bundle (Saver / Flexi / etc.). */
  FareId: string;
  /** Branded fare name surfaced to the user. */
  FareName?: string;
  /** Number of seats AirIQ has open for this fare. May come back as a string. */
  SeatsAvailable?: number | string;
  Refundable?: boolean;
  FareRuleKey?: string;
  /** Per-pax-type breakdown. */
  PaxFares: AirIQFareDetail[];
  /** Free-text baggage allowance per pax type. */
  BaggageInfo?: string;
  CabinBaggageInfo?: string;
}

export interface AirIQItinerary {
  /** Stable id within this Availability response. */
  ItineraryId: string;
  /** Onward = 1, return = 2 for round-trip; oneway always 1. */
  TripIndicator?: number;
  /** Carrier shape (LCC vs FSC) drives our `source` tag. */
  IsLCC?: boolean;
  Segments: AirIQSegment[];
  Fares: AirIQItineraryFare[];
}

export interface AirIQAvailabilityResponse {
  Status: AirIQStatus;
  /** Required input to GetFareRule, Pricing — see §2.4. */
  TrackId: string;
  Itineraries: AirIQItinerary[];
}
