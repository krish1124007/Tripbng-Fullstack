// eTrav Flight API — TypeScript DTOs.
//
// Sourced from the integration analysis prepared for TripBNG (Postman docs export
// of eTrav AIR Aggregator API). The shapes here mirror the wire format exactly,
// including the snake_case conventions and the `Applicablility` typo that exists
// in the upstream API. Do NOT "fix" naming here — defensive coding requires we
// match what eTrav actually sends.

// ────────── Auth ──────────

export interface EtravAuthHeader {
  UserId: string;
  Password: string;
  IP_Address: string;
  Request_Id: string; // UUID v4 per request — echoed back in response for tracing
  IMEI_Number: string;
}

// ────────── Common response envelope ──────────

export interface EtravResponseHeader {
  Error_Code: string; // "0000" === success; non-zero is an application error (HTTP may still be 200)
  Error_Desc: string;
  Error_InnerException: string; // .NET stack trace if upstream errored — never surface this to end users
  Request_Id: string;
  Status_Id: string;
}

// ────────── Enums (numeric on the wire) ──────────

export const EtravTravelType = {
  Domestic: 0,
  International: 1,
} as const;
export type EtravTravelType = (typeof EtravTravelType)[keyof typeof EtravTravelType];

export const EtravBookingType = {
  OneWay: 0,
  RoundTrip: 1,
  SpecialRoundTrip: 2,
  MultiCity: 3,
} as const;
export type EtravBookingType = (typeof EtravBookingType)[keyof typeof EtravBookingType];

export const EtravCabinClass = {
  Economy: 0,
  Business: 1,
  First: 2,
  PremiumEconomy: 3,
} as const;
export type EtravCabinClass = (typeof EtravCabinClass)[keyof typeof EtravCabinClass];

export const EtravInventoryType = {
  RetailFare: 0,
} as const;
export type EtravInventoryType = (typeof EtravInventoryType)[keyof typeof EtravInventoryType];

export const EtravPaxType = {
  Adult: 0,
  Child: 1,
  Infant: 2,
} as const;
export type EtravPaxType = (typeof EtravPaxType)[keyof typeof EtravPaxType];

export const EtravFareType = {
  RetailFare: 0,
  CouponFare: 1,
  CorporateFare: 2,
  SMEFare: 3,
  RTSPLFare: 4,
  DealFare: 5,
} as const;
export type EtravFareType = (typeof EtravFareType)[keyof typeof EtravFareType];

// ────────── Air_Search ──────────

export interface EtravTripInfo {
  Origin: string; // IATA, e.g. "BLR"
  Destination: string;
  TravelDate: string; // MM/DD/YYYY  ← critical: NOT ISO 8601
  Trip_Id: 0 | 1; // 0 = onward, 1 = return (semantics ambiguous — see analysis §4.1)
}

export interface EtravAirSearchRequest {
  Auth_Header: EtravAuthHeader;
  Travel_Type: EtravTravelType;
  Booking_Type: EtravBookingType;
  TripInfo: EtravTripInfo[];
  Adult_Count: number;
  Child_Count?: number;
  Infant_Count?: number;
  Class_Of_Travel: EtravCabinClass;
  InventoryType: EtravInventoryType;
  Filtered_Airline?: { Airline_Code: string }[] | null;
}

// Field names confirmed against a real Air_Search response (AMD→DXB, 30-Jun-2026).
// eTrav uses Underscore_PascalCase on the wire — do NOT camel-case.
export interface EtravSegment {
  Segment_Id: number;
  Leg_Index: number;
  Origin: string;
  Origin_Terminal: string;
  Origin_City: string;
  Destination: string;
  Destination_Terminal: string;
  Destination_City: string;
  Airline_Code: string;
  Airline_Name: string | null;
  Flight_Number: string;
  Aircraft_Type: string;
  /** "MM/DD/YYYY HH:mm" server-local — parsed by parseEtravDateTime. */
  Departure_DateTime: string;
  Arrival_DateTime: string;
  Stop_Over: string[] | null;
  Return_Flight: boolean;
  Duration: string; // "HH:mm"
  OperatedBy?: string | null;
}

export interface EtravAirportTax {
  Tax_Code: string;
  Tax_Desc: string;
  Tax_Amount: number;
}

export interface EtravFareClass {
  /** Numeric in real responses (matches EtravSegment.Segment_Id). */
  Segment_Id: number;
  /** Cabin classification ("ECONOMY", "BUSINESS"…). */
  CabinClass?: string;
  Class_Code: string | null;
  Class_Desc: string | null;
  FareBasis: string | null;
  Privileges: string[] | null;
}

export interface EtravFreeBaggage {
  // Concatenated string format — e.g. "OB-30 KgRT-30 Kg" or "7 Kg7 Kg|"
  Check_In_Baggage: string;
  Hand_Baggage: string;
}

export interface EtravChargeRule {
  // typo preserved: 0 = Per Segment, 1 = Per Passenger
  Applicablility: 0 | 1;
  DurationFrom: string;
  DurationTo: string;
  DurationTypeFrom: 0 | 1; // 0 = Hour, 1 = Day
  DurationTypeTo: 0 | 1;
  OfflineServiceFee: number;
  OnlineServiceFee: number;
  PassengerType: EtravPaxType;
  Remarks: string;
  Return_Flight: boolean;
  Value: string; // numeric string
  ValueType: 0 | 1; // 0 = Amount (₹), 1 = Percentage
}

// Field names confirmed against a real Air_Search response. Note the underscore
// inside Service_Fee_Amount and Trade_Markup_Amount — earlier camel-cased
// guesses (ServiceFee_Amount / TradeMarkup_Amount) were wrong.
export interface EtravFareDetail {
  PAX_Type: EtravPaxType;
  Basic_Amount: number;
  YQ_Amount: number;
  AirportTax_Amount: number;
  Service_Fee_Amount: number;
  Trade_Markup_Amount: number;
  Promo_Discount: number;
  GST: number;
  TDS: number;
  Gross_Commission: number;
  Net_Commission: number;
  Currency_Code: string; // typically "INR"
  Total_Amount: number; // per pax of this type — NOT the whole fare
  AirportTaxes: EtravAirportTax[];
  FareClasses: EtravFareClass[];
  Free_Baggage: EtravFreeBaggage;
  CancellationCharges: EtravChargeRule[];
  RescheduleCharges: EtravChargeRule[];
}

// Field names confirmed against a real Air_Search response.
export interface EtravFare {
  Fare_Id: string;
  Fare_Key: string;
  Refundable: boolean;
  Food_onboard: 'P' | 'F' | string; // P = Paid, F = Free
  Seats_Available: string | number; // sometimes "9", sometimes 9 — tolerate both
  LastFewSeats: string | number;
  Warning: string;
  PromptMessage: string;
  GSTMandatory: string; // "True" / "False" — yes, as a string
  ProductClass?: string;
  FareType: EtravFareType;
  FareDetails: EtravFareDetail[]; // one per pax type present in the search
}

export interface EtravFlight {
  Flight_Id: string;
  Flight_Key: string; // multi-segment: "FK...$FK...$FK..." — pass back as-is, do not split
  Origin: string;
  Destination: string;
  TravelDate: string;
  Airline_Code: string;
  IsLCC: boolean;
  Cached: boolean; // true = served from eTrav DB cache, may be stale
  Block_Ticket_Allowed: boolean; // hint for whether TempBooking can hold without ticketing
  GST_Entry_Allowed: boolean;
  Repriced: boolean; // false in Search response, true after a successful Air_Reprice
  HasMoreClass: boolean;
  InventoryType: EtravInventoryType;
  PromoCode: string;
  Segments: EtravSegment[];
  Fares: EtravFare[];
}

export interface EtravTripDetail {
  Trip_Id: string;
  Flights: EtravFlight[];
}

export interface EtravAirSearchResponse {
  Response_Header: EtravResponseHeader;
  Search_Key: string; // forward to FareRule, Reprice, GetSSR, GetSeatMap, TempBooking
  TripDetails: EtravTripDetail[];
}

// ────────── Air_FareRule ──────────

export interface EtravAirFareRuleRequest {
  Auth_Header: EtravAuthHeader;
  Search_Key: string;
  Flight_Key: string;
  Fare_Id: string;
}

export interface EtravFareRule {
  Segment_Id: string;
  FareRuleName: string;
  FareRuleDesc: string; // FULL HTML document with embedded CSS — render in sandboxed iframe
}

export interface EtravAirFareRuleResponse {
  Response_Header: EtravResponseHeader;
  FareRules: EtravFareRule[];
}

// ────────── Air_Reprice ──────────

export interface EtravAirRepriceRequestEntry {
  Flight_Key: string;
  Fare_Id: string;
}

export interface EtravAirRepriceRequest {
  Auth_Header: EtravAuthHeader;
  Search_Key: string;
  AirRepriceRequests: EtravAirRepriceRequestEntry[];
  Customer_Mobile: string; // mandatory; fall back to agency mobile if no customer one
  GST_Input?: boolean | string;
  SinglePricing?: boolean; // not in formal schema but seen in examples
}

export interface EtravRequiredPaxDetails {
  Pax_type: EtravPaxType;
  Title: boolean;
  First_Name: boolean;
  Last_Name: boolean;
  Gender: boolean;
  Age: boolean;
  DOB: boolean;
  Nationality: boolean;
  Passport_Number: boolean;
  Passport_Issuing_Country: boolean;
  Passport_Expiry: boolean;
  DefenceServiceId: boolean;
  DefenceIssueDate: boolean;
  DefenceExpiryDate: boolean;
  Student_Id: boolean;
  Mandatory_SSRs: string[] | null;
}

export interface EtravAirRepriceResponseEntry {
  Flight: EtravFlight; // re-priced — Repriced: true, possibly with updated fares
  Required_PAX_Details: EtravRequiredPaxDetails[];
}

export interface EtravAirRepriceResponse {
  Response_Header: EtravResponseHeader;
  FrequentFlyerAccepted: boolean;
  AirRepriceResponses: EtravAirRepriceResponseEntry[];
}

// ────────── Air_TempBooking ──────────
//
// Discovered live (May-2026) by probing the staging endpoint — eTrav's docs
// for this call were not provided. Field shape verified against Booking_RefNo
// "F-A03MAY26X89JE" successfully created on staging. See contract notes in
// EMAIL_DRAFT.md (Path 3) — only AddPayment specs are still missing from eTrav.

/** One row in BookingFlightDetails — note Search_Key lives INSIDE each entry,
 *  not at the top level (probe finding). For one-way bookings there's exactly
 *  one entry; multi-city would presumably have one per leg. */
export interface EtravBookingFlightDetail {
  Search_Key: string;
  Flight_Key: string;
  Fare_Id: string;
}

/** Per-passenger object inside top-level PAX_Details. Field names use the
 *  Pax_type (lowercase t) convention — matches Reprice's Required_PAX_Details. */
export interface EtravBookingPaxDetail {
  Title: string; // "MR" | "MRS" | "MS" | "MSTR" | "MISS"
  First_Name: string;
  Last_Name: string;
  Pax_type: EtravPaxType; // 0 ADT | 1 CHD | 2 INF
  /** "DD/MM/YYYY" — required for ADT per Required_PAX_Details. */
  DOB: string;
  Gender?: 'M' | 'F';
  Age?: number;
  Nationality?: string;
  Passport_Number?: string;
  Passport_Issuing_Country?: string;
  /** "DD/MM/YYYY" */
  Passport_Expiry?: string;
}

export interface EtravAirTempBookingRequest {
  Auth_Header: EtravAuthHeader;
  BookingFlightDetails: EtravBookingFlightDetail[];
  Passenger_Email: string;
  Passenger_Mobile: string;
  PAX_Details: EtravBookingPaxDetail[];
}

export interface EtravAirTempBookingResponse {
  Response_Header: EtravResponseHeader;
  /** eTrav-side booking reference, format `F-...` (e.g. "F-A03MAY26X89JE").
   *  Required as input to AddPayment + Air_Ticketing. */
  Booking_RefNo: string;
}

// ────────── Air_Ticketing ──────────

/** Ticketing modes discovered via staging probe:
 *   0 — "Hold attempt" (no payment required; for GDS holds before issuance)
 *   1 — "Issue ticket" (requires AddPayment first)
 *   2 — "Issue ticket" alternate flow (also payment-gated)
 */
export const EtravTicketingType = {
  HoldAttempt: 0,
  Issue: 1,
  IssueAlt: 2,
} as const;
export type EtravTicketingType = (typeof EtravTicketingType)[keyof typeof EtravTicketingType];

export interface EtravAirTicketingRequest {
  Auth_Header: EtravAuthHeader;
  Booking_RefNo: string;
  Ticketing_Type: EtravTicketingType;
}

/** Success response shape for HoldAttempt (the only mode we've exercised end-to-end
 *  during discovery). Issue (1/2) responses likely include PNR + ticket numbers
 *  in a richer envelope — to be filled in once AddPayment specs land + we
 *  successfully issue a ticket. */
export interface EtravAirTicketingResponse {
  Response_Header: EtravResponseHeader;
  PNR?: string;
  Airline_PNR?: string;
  Ticket_Numbers?: string[];
}
