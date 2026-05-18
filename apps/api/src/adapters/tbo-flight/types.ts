// TBO Flight (Air) — request + response shapes for the booking-engine API.
//
// Distinct from `adapters/tbo/types/` which covers the hotel side. Auth
// flows through the shared TBO auth service (already wired) — only the
// flight-specific endpoints (Air Search, FareRule, FareQuote, SSR, Book,
// Ticket, BookingDetails, ChangeRequest) live in this folder.
//
// TBO's Air response shapes vary mildly across docs versions; types use
// wide unions where it matters and the transforms.ts module narrows.

import type { TboErrorBlock, TboStatus } from '../tbo/types/auth.js';

// ────────── Common ──────────

/** TBO Air JourneyType. 1 = Oneway, 2 = Return, 3 = MultiCity, 4 = AdvSearch,
 *  5 = SpecialReturn. We only emit 1/2/3 for now. */
export type TboJourneyType = 1 | 2 | 3 | 4 | 5;

/** Cabin class. 1 = All, 2 = Economy, 3 = Premium Economy, 4 = Business,
 *  5 = Premium Business, 6 = First. */
export type TboCabinClass = 1 | 2 | 3 | 4 | 5 | 6;

export interface TboAirSegmentSpec {
  /** ISO airport code (origin). */
  Origin: string;
  /** ISO airport code (destination). */
  Destination: string;
  FlightCabinClass: TboCabinClass;
  /** ISO datetime — 'YYYY-MM-DDTHH:mm:ss'. */
  PreferredDepartureTime: string;
  PreferredArrivalTime?: string;
}

// ────────── Air Search ──────────

export interface TboAirSearchRequest {
  EndUserIp: string;
  TokenId: string;
  AdultCount: string; // TBO wants strings here
  ChildCount: string;
  InfantCount: string;
  /** TBO Source enum — 'SG', '6E', etc. — array of preferred sources. */
  Sources?: string[] | null;
  DirectFlight?: boolean;
  OneStopFlight?: boolean;
  JourneyType: TboJourneyType;
  /** When true, bypass internal LCC/FSC filtering. */
  PreferredAirlines?: string[] | null;
  Segments: TboAirSegmentSpec[];
}

export interface TboFareSegment {
  Baggage?: string;
  CabinBaggage?: string;
  CabinClass?: number;
  SupplierFareClass?: string | null;
  TripIndicator?: number;
  SegmentIndicator?: number;
  Airline?: {
    AirlineCode?: string;
    AirlineName?: string;
    FlightNumber?: string;
    FareClass?: string;
    OperatingCarrier?: string;
  };
  Origin?: {
    Airport?: {
      AirportCode?: string;
      AirportName?: string;
      Terminal?: string;
      CityCode?: string;
      CityName?: string;
      CountryCode?: string;
      CountryName?: string;
    };
    DepTime?: string;
  };
  Destination?: {
    Airport?: {
      AirportCode?: string;
      AirportName?: string;
      Terminal?: string;
      CityCode?: string;
      CityName?: string;
      CountryCode?: string;
      CountryName?: string;
    };
    ArrTime?: string;
  };
  Duration?: number; // minutes
  GroundTime?: number;
  Mile?: number;
  StopOver?: boolean;
  StopPoint?: string;
  Craft?: string;
  Remark?: string | null;
  IsETicketEligible?: boolean;
  FlightStatus?: string;
  Status?: string;
}

export interface TboFareItem {
  /** TBO returns rates as decimals (rupees, sometimes string). */
  BaseFare?: number | string;
  Tax?: number | string;
  YQTax?: number | string;
  AdditionalTxnFeeOfrd?: number | string;
  AdditionalTxnFeePub?: number | string;
  PGCharge?: number | string;
  OtherCharges?: number | string;
  ChargeBU?: Array<{ key?: string; value?: number | string }>;
  Discount?: number | string;
  PublishedFare?: number | string;
  CommissionEarned?: number | string;
  PLBEarned?: number | string;
  IncentiveEarned?: number | string;
  OfferedFare?: number | string;
  TdsOnCommission?: number | string;
  TdsOnPLB?: number | string;
  TdsOnIncentive?: number | string;
  ServiceFee?: number | string;
  TotalBaggageCharges?: number | string;
  TotalMealCharges?: number | string;
  TotalSeatCharges?: number | string;
  TotalSpecialServiceCharges?: number | string;
  Currency?: string;
}

export interface TboFareBreakdownPerPax {
  Currency?: string;
  /** PassengerType — 1 = Adult, 2 = Child, 3 = Infant. */
  PassengerType: 1 | 2 | 3;
  PassengerCount: number;
  BaseFare?: number | string;
  Tax?: number | string;
  YQTax?: number | string;
  AdditionalTxnFeeOfrd?: number | string;
  AdditionalTxnFeePub?: number | string;
  PGCharge?: number | string;
  SupplierReissueCharges?: number | string;
}

export interface TboFareRule {
  Origin?: string;
  Destination?: string;
  Airline?: string;
  FareBasisCode?: string;
  FareRuleDetail?: string;
  FareRestriction?: string;
  FareFamilyCode?: string;
  FareRuleIndex?: string;
}

export interface TboAirSearchResult {
  /** Stable handle TBO uses on subsequent calls — round-trip via fareToken. */
  ResultIndex: string;
  /** TBO Source code: 'GDS', '6E', 'SG', 'AK', 'G8', etc. LCC sources are
   *  signalled by IsLCC=true. */
  Source?: string;
  IsLCC?: boolean;
  IsRefundable?: boolean;
  AirlineRemark?: string | null;
  IsPanRequiredAtBook?: boolean;
  IsPanRequiredAtTicket?: boolean;
  IsPassportRequiredAtBook?: boolean;
  IsPassportRequiredAtTicket?: boolean;
  GSTAllowed?: boolean;
  IsCouponAppilcable?: boolean;
  IsGSTMandatory?: boolean;
  AirlineCode?: string;
  ValidatingAirline?: string;
  /** Flat fare totals across all pax. */
  Fare?: TboFareItem;
  /** Per-pax-type breakdown. */
  FareBreakdown?: TboFareBreakdownPerPax[];
  /** Outbound + (optional) inbound segments — array of segment groups,
   *  where group [0] = outbound, [1] = inbound for return trips. */
  Segments?: TboFareSegment[][];
  LastTicketDate?: string | null;
  TicketAdvisory?: string | null;
  FareRules?: TboFareRule[];
  PenaltyCharges?: {
    ReissueCharge?: string;
    CancellationCharge?: string;
  };
}

/** Envelope shape — TBO sometimes nests under `Response`, sometimes hoists
 *  to the top. The adapter coalesces via `res.Response ?? res` so both
 *  branches must expose the same field set. */
export interface TboAirSearchEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  Origin?: string;
  Destination?: string;
  /** Two parallel arrays: [0] = outbound options, [1] = inbound options
   *  for domestic non-combined return. For one-way / combined-return,
   *  only [0] is populated. */
  Results?: TboAirSearchResult[][];
}

export interface TboAirSearchResponse extends TboAirSearchEnvelope {
  Response?: TboAirSearchEnvelope;
}

// ────────── Air FareRule ──────────
//
// FareRule re-fetches the supplier's fare-rule blob for a previously-
// returned result. Required-by-cert before Book; the UI renders the HTML
// in a sandboxed iframe.

export interface TboAirFareRuleRequest {
  EndUserIp: string;
  TokenId: string;
  /** From the Search response. Round-trips unchanged through every
   *  subsequent call until Ticket. */
  TraceId: string;
  /** From the chosen TboAirSearchResult. */
  ResultIndex: string;
}

export interface TboAirFareRuleEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  /** TBO returns one rule per OD pair (segment leg). For multi-leg trips
   *  (return / multi-city) there's one entry per leg. */
  FareRules?: TboFareRule[];
}

export interface TboAirFareRuleResponse extends TboAirFareRuleEnvelope {
  /** Some envelope versions wrap under `Response`. */
  Response?: TboAirFareRuleEnvelope;
}

// ────────── Air FareQuote (Reprice) ──────────
//
// FareQuote re-validates a result's pricing + supplier rules just before
// Book. Required-by-cert: TBO docs explicitly mandate FareQuote between
// Search and Book. Returns:
//   - the (possibly updated) Fare + FareBreakdown
//   - IsPriceChanged flag — authoritative; we still compare totals as a
//     fallback for older sandbox builds that don't always set it
//   - Pan/Passport/GST flags driving the dynamic guest form

export interface TboAirFareQuoteRequest {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  ResultIndex: string;
}

/** Inner result block — TBO sometimes returns this as `Results` (singular,
 *  unlike Search which returns Results[][]) at the top of `Response`. */
export interface TboAirFareQuoteResult {
  ResultIndex?: string;
  Source?: string;
  IsLCC?: boolean;
  IsRefundable?: boolean;
  /** Authoritative drift signal. When true, the price moved between Search
   *  and FareQuote; the UI should re-confirm with the user. */
  IsPriceChanged?: boolean;
  /** TBO sets this to true when fare-rules shifted since search. We surface
   *  it on the route response so the UI can show "policies changed". */
  IsCancellationPolicyChanged?: boolean;
  /** Per-pax-type breakdown — same shape as TboFareBreakdownPerPax in
   *  search. Sum across rows for the new total. */
  FareBreakdown?: TboFareBreakdownPerPax[];
  Fare?: TboFareItem;
  /** Required-fields hints driving the dynamic guest form. Not all sandbox
   *  versions populate every flag — defaults are conservative (don't ask
   *  unless the supplier mandates it). */
  IsPanRequiredAtBook?: boolean;
  IsPanRequiredAtTicket?: boolean;
  IsPassportRequiredAtBook?: boolean;
  IsPassportRequiredAtTicket?: boolean;
  GSTAllowed?: boolean;
  IsGSTMandatory?: boolean;
  /** Last date/time TBO will accept the Ticket call before the fare lapses. */
  LastTicketDate?: string | null;
  TicketAdvisory?: string | null;
}

export interface TboAirFareQuoteEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  Results?: TboAirFareQuoteResult;
}

export interface TboAirFareQuoteResponse extends TboAirFareQuoteEnvelope {
  Response?: TboAirFareQuoteEnvelope;
}

// ────────── Air SSR ──────────
//
// SSR = Special Service Requests (meals, baggage, seats). Called between
// FareQuote and Book/Ticket. For LCC pathways the selected SSRs are sent
// in the Ticket request; for GDS in the Book request — the orchestrator
// reads `IsLCC` (from FareQuote) to decide.

export interface TboAirSSRRequest {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  ResultIndex: string;
}

/** Per-segment meal option. TBO returns one entry per (segment × meal). */
export interface TboMealOption {
  AirlineCode?: string;
  FlightNumber?: string;
  /** WayType: 1 = Outbound, 2 = Inbound. */
  WayType?: 1 | 2;
  Code?: string;
  Description?: string;
  AirlineDescription?: string;
  Origin?: string;
  Destination?: string;
  Currency?: string;
  Price?: number | string;
}

/** Per-segment baggage add-on. */
export interface TboBaggageOption {
  AirlineCode?: string;
  FlightNumber?: string;
  WayType?: 1 | 2;
  Code?: string;
  Description?: string;
  /** TBO returns weight as a string like "5 KG"; we parse on the way out. */
  Weight?: number | string;
  Currency?: string;
  Price?: number | string;
  Origin?: string;
  Destination?: string;
}

/** A single seat in the seat-map grid. */
export interface TboSeat {
  Code?: string;
  RowNo?: number | string;
  SeatNo?: string;
  /** 1=Window, 2=Aisle, 3=Middle (per TBO docs). */
  SeatType?: number;
  /** 1=Outbound, 2=Inbound. */
  SeatWayType?: 1 | 2;
  Compartment?: string;
  Deck?: number;
  /** 1=Available, 2=Reserved, 3=Restricted, 4=NoSeat, 5=NotAvailable. */
  AvailablityType?: number;
  Price?: number | string;
  Currency?: string;
}

export interface TboRowSeats {
  Seats?: TboSeat[];
}

export interface TboSegmentSeat {
  RowSeats?: TboRowSeats[];
}

/** One entry per segment leg. */
export interface TboSeatDynamic {
  SegmentSeat?: TboSegmentSeat[];
  Origin?: string;
  Destination?: string;
}

export interface TboAirSSREnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  Meal?: TboMealOption[];
  Baggage?: TboBaggageOption[];
  /** Outer array is per-segment; each inner SegmentSeat[] is per-pax-type
   *  in some sandbox builds, single-element in others. The mapper walks
   *  the structure defensively. */
  SeatDynamic?: TboSeatDynamic[];
  /** Some sandbox versions hoist Meal[] / Baggage[] under different keys. */
  MealDynamic?: TboMealOption[][];
  BaggageDynamic?: TboBaggageOption[][];
}

export interface TboAirSSRResponse extends TboAirSSREnvelope {
  Response?: TboAirSSREnvelope;
}

// ────────── Air Book / Ticket ──────────
//
// TBO splits the booking pathway by source:
//   • LCC sources (IndiGo, SpiceJet, etc.): single-shot Air/Ticket call.
//     SSR + passengers + payment all bundled. No Book call. The ticket is
//     issued atomically — there's no "held" state.
//   • GDS sources: Air/Book → returns a BookingId + PNR (held). Then
//     Air/Ticket(BookingId) issues the ticket against that held PNR.
//
// The orchestrator reads `IsLCC` (from FareQuote / search) to decide. The
// adapter exposes both `hold()` and `ticket()` per the SupplierAdapter
// contract; for LCC, `hold()` caches the request in Redis and returns a
// synthetic supplierBookingRef (`LCC:<uuid>`) which `ticket()` rehydrates.

/** TBO PaxType enum: 1=Adult, 2=Child, 3=Infant. */
export type TboPaxType = 1 | 2 | 3;
/** TBO Gender: 1=Male, 2=Female. (No third option in their schema.) */
export type TboGender = 1 | 2;
/** TBO Title: 1=Mr, 2=Mrs, 3=Ms, 4=Mstr (child male), 5=Miss (child female). */
export type TboTitle = 1 | 2 | 3 | 4 | 5;

/** Per-pax fare allocation. Required in the Book/Ticket request — TBO
 *  validates that sum-across-pax equals the FareQuote total exactly. The
 *  per-pax-fare-split helper in transforms.ts computes these. */
export interface TboPassengerFare {
  Currency: string;
  BaseFare: number;
  Tax: number;
  YQTax: number;
  AdditionalTxnFeeOfrd: number;
  AdditionalTxnFeePub: number;
  PGCharge: number;
  ServiceFee?: number;
  TotalBaggageCharges?: number;
  TotalMealCharges?: number;
  TotalSeatCharges?: number;
}

/** A single passenger in the Book/Ticket request. Required-field set
 *  varies by PaxType (DateOfBirth required for Child/Infant) and supplier
 *  rules (passport/PAN flags from FareQuote). The transforms map our
 *  NormalizedPassenger into this shape; null fields are omitted by the
 *  serializer. */
export interface TboBookPassenger {
  Title: string; // 'Mr' | 'Mrs' | 'Ms' | 'Mstr' | 'Miss' — TBO accepts string here
  FirstName: string;
  LastName: string;
  PaxType: TboPaxType;
  DateOfBirth?: string; // ISO date — 'YYYY-MM-DD'
  Gender?: TboGender;
  AddressLine1?: string;
  City?: string;
  CountryCode?: string;
  Nationality?: string; // ISO alpha-2
  ContactNo?: string;
  Email?: string;
  IsLeadPax: boolean;
  PassportNo?: string;
  PassportExpiry?: string; // ISO date
  PassportIssuingCountry?: string;
  /** Per-pax fare allocation. TBO requires this on every passenger. */
  Fare: TboPassengerFare;
}

export interface TboAirBookRequest {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  ResultIndex: string;
  Passengers: TboBookPassenger[];
  /** SSR selections (GDS path — TBO accepts these in Book, not Ticket).
   *  See `TboAirTicketRequestLcc` for the equivalent LCC fields. */
  Meal?: TboMealSelection[];
  Baggage?: TboBaggageSelection[];
  SeatPreference?: TboSeatSelection[];
}

/** Inner Result block from a Book response. Some fields appear only on
 *  GDS replies (BookingId, PNR); LCC source isn't expected to call Book
 *  in the first place. */
export interface TboAirBookResult {
  /** Numeric booking id. Round-trip into Ticket. */
  BookingId?: number;
  /** Airline PNR — populated on success. */
  PNR?: string;
  /** Status: 1=Successful, 2=Failed (per TBO docs). */
  Status?: number;
  IsPriceChanged?: boolean;
  /** Last datetime to call Ticket before the held fare lapses. */
  LastTicketDate?: string;
  TicketAdvisory?: string | null;
  /** When TBO needs to re-quote — caller should re-call FareQuote. */
  ResponseStatus?: TboStatus;
}

export interface TboAirBookEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  Response?: TboAirBookResult;
}

export interface TboAirBookResponse extends TboAirBookEnvelope {
  /** Some envelope versions wrap one more level deep. */
  Response_?: TboAirBookEnvelope;
}

// ── Ticket ──

/** SSR selections passed inside the Ticket request (LCC) or Book (GDS).
 *  WayType: 1=Outbound, 2=Inbound. AirlineCode + FlightNumber + Origin +
 *  Destination identify which segment the SSR applies to. */
export interface TboMealSelection {
  AirlineCode: string;
  FlightNumber: string;
  WayType: 1 | 2;
  Code: string;
  Description: string;
  Price: number;
  Origin?: string;
  Destination?: string;
  Currency?: string;
}

export interface TboBaggageSelection {
  AirlineCode: string;
  FlightNumber: string;
  WayType: 1 | 2;
  Code: string;
  Description: string;
  Weight: number;
  Price: number;
  Origin?: string;
  Destination?: string;
  Currency?: string;
}

export interface TboSeatSelection {
  AirlineCode: string;
  FlightNumber: string;
  WayType: 1 | 2;
  Code: string;
  RowNo: number;
  SeatNo: string;
  Description?: string;
  SeatType?: number;
  Price?: number;
  Origin?: string;
  Destination?: string;
  Currency?: string;
}

/** Two flavours of Ticket request:
 *   • GDS (post-Book): { BookingId, PNR } — refers to the held booking.
 *   • LCC (single-shot): { ResultIndex, Passengers, optional SSR } —
 *     creates AND issues atomically. */
export interface TboAirTicketRequestGds {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  BookingId: number;
  PNR: string;
}

export interface TboAirTicketRequestLcc {
  EndUserIp: string;
  TokenId: string;
  TraceId: string;
  ResultIndex: string;
  Passengers: TboBookPassenger[];
  /** Selected meals — flat array, repeated per pax. Optional. */
  MealDynamic?: TboMealSelection[][];
  Meal?: TboMealSelection[];
  Baggage?: TboBaggageSelection[];
  /** Seats: TBO accepts SeatPreference — flat array, one entry per (pax × seat). */
  SeatPreference?: TboSeatSelection[];
}

export interface TboAirTicketResult {
  Status?: number;
  /** TBO may return per-pax ticket-number arrays. */
  TicketNumber?: string;
  Ticket?: Array<{
    TicketId?: number;
    TicketNumber?: string;
    PaxType?: TboPaxType;
    PaxId?: number;
    ServiceFeeDisplayType?: string;
  }>;
  PNR?: string;
  AirlinePNR?: string;
  BookingId?: number;
  ResponseStatus?: TboStatus;
  InvoiceNo?: string;
  InvoiceCreatedOn?: string;
  IsPriceChanged?: boolean;
  Error?: TboErrorBlock;
}

export interface TboAirTicketEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  Response?: TboAirTicketResult;
}

export interface TboAirTicketResponse extends TboAirTicketEnvelope {
  Response_?: TboAirTicketEnvelope;
}

// ────────── Air SendChangeRequest (Cancel) ──────────
//
// TBO's Air cancel pathway is async: SendChangeRequest fires + returns a
// ChangeRequestId; status moves through Pending → InProgress → Processed
// (refund credited at supplier) or Rejected. The orchestrator commits
// the wallet refund locally based on fare-rule math; the supplier's
// status is a confirmation signal, not a money-flow trigger.
//
// RequestType for Air cancel = 1 (vs hotel cancel = 4). RequestSource
// distinguishes ONLINE_AGENT_INITIATED (1) from CALL_CENTRE (2). We use 1.

export interface TboAirSendChangeRequest {
  EndUserIp: string;
  TokenId: string;
  /** Numeric BookingId TBO assigned at Book/Ticket time. */
  BookingId: number;
  /** RequestType=1 for Air cancel. */
  RequestType: 1;
  /** Free-text reason from the agent — surfaced in TBO's ops queue. */
  CancellationRemarks: string;
  /** RequestSource=1 for ONLINE_AGENT_INITIATED. */
  RequestSource?: 1 | 2;
}

export interface TboAirSendChangeRequestEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  ChangeRequestId?: number;
  /** TBO's status enum — same as hotels. */
  ChangeRequestStatus?: 0 | 1 | 2 | 3 | 4;
}

export interface TboAirSendChangeRequestResponse extends TboAirSendChangeRequestEnvelope {
  Response?: TboAirSendChangeRequestEnvelope;
}

// ────────── Air GetChangeRequestStatus (poll) ──────────
//
// Mirrors the hotel poll. Same status enum (0=NotSet, 1=Pending, 2=InProgress,
// 3=Processed, 4=Rejected). Used by the eventual cancel-poll worker (deferred
// to next turn — for now, the orchestrator commits the refund locally and
// surfaces ChangeRequestId for ops to manually verify if needed).

export interface TboAirChangeRequestStatusRequest {
  EndUserIp: string;
  TokenId: string;
  ChangeRequestId: number;
}

export interface TboAirChangeRequestStatusEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  ChangeRequestId?: number;
  ChangeRequestStatus?: 0 | 1 | 2 | 3 | 4;
  /** Refund amount TBO will credit (decimal rupees). */
  RefundAmount?: number | string;
  CancellationCharge?: number | string;
  Remarks?: string;
}

export interface TboAirChangeRequestStatusResponse extends TboAirChangeRequestStatusEnvelope {
  Response?: TboAirChangeRequestStatusEnvelope;
}

// ────────── Air GetBookingDetails ──────────
//
// Idempotent fetch of a booking's current supplier state. Used for:
//   1. Timeout-recovery on Book/Ticket per spec §8.4
//   2. Admin "refresh from supplier" action
//   3. Reconciliation jobs comparing TBO state to ours
//
// Request: BookingId XOR PNR. We always send BookingId since that's what
// we persist on the Booking row.

export interface TboAirGetBookingDetailsRequest {
  EndUserIp: string;
  TokenId: string;
  BookingId?: number;
  PNR?: string;
  /** TBO traces calls; pass-through if known, fresh otherwise. */
  TraceId?: string;
  FirstName?: string;
  LastName?: string;
}

/** Inner FlightItinerary block. Wide shape — TBO returns the whole
 *  booking record verbatim; we only need a few fields for the canonical
 *  NormalizedBookingDetails. */
export interface TboBookingItinerary {
  BookingId?: number;
  PNR?: string;
  IsDomestic?: boolean;
  Source?: string;
  Origin?: string;
  Destination?: string;
  AirlineCode?: string;
  /** "Confirmed" | "Cancelled" | "Pending" | "Failed" — string per docs. */
  Status?: string;
  /** TBO's BookingStatus enum (numeric in some envelope versions). */
  BookingStatus?: number;
  ValidatingAirlineCode?: string;
  Passenger?: Array<{
    Title?: string;
    FirstName?: string;
    LastName?: string;
    PaxType?: TboPaxType;
    Ticket?: {
      TicketNumber?: string;
      TicketStatus?: string;
    };
  }>;
  InvoiceNo?: string;
  InvoiceCreatedOn?: string;
  LastTicketDate?: string;
}

export interface TboAirGetBookingDetailsEnvelope {
  ResponseStatus?: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  /** Some envelope versions wrap this further. */
  FlightItinerary?: TboBookingItinerary;
  Itinerary?: TboBookingItinerary;
}

export interface TboAirGetBookingDetailsResponse
  extends TboAirGetBookingDetailsEnvelope {
  Response?: TboAirGetBookingDetailsEnvelope;
}
