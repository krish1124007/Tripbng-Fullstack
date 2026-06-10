import type { ResultSegment, SearchRequest, TravelClass } from '@tripbng/shared';

// SupplierAdapter — every integration implements this so the search/book pipeline doesn't
// know whether it's talking to our own Inventory model or a third-party API. Spec §7.1.
export interface SupplierAdapter {
  readonly code: string;
  readonly name: string;
  readonly capabilities: readonly Capability[];

  search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse>;
  hold(req: NormalizedHoldRequest): Promise<NormalizedHoldResponse>;
  ticket(req: NormalizedTicketRequest): Promise<NormalizedTicketResponse>;
  cancel(req: NormalizedCancelRequest): Promise<NormalizedCancelResponse>;
  retrieveBooking(supplierBookingRef: string): Promise<NormalizedBookingDetails>;

  healthCheck(): Promise<HealthStatus>;
}

export type Capability =
  | 'SEARCH'
  | 'HOLD'
  | 'BOOK'
  | 'CANCEL'
  | 'RESCHEDULE'
  | 'WEBCHECKIN'
  | 'RETRIEVE';

export interface HealthStatus {
  ok: boolean;
  message?: string;
  latencyMs?: number;
}

// Normalized inputs/outputs — the universal lingua franca of the adapter contract.
export interface NormalizedSearchRequest {
  searchId: string;
  request: SearchRequest;
  // Optional: supplier-specific context (cabin codes, branded fare filters).
  meta?: Record<string, unknown>;
}

// A normalized fare option from a supplier — pre-pricing.
export interface NormalizedFareOption {
  // Stable identifier *within this supplier* — used as part of fareToken.
  supplierFareId: string;

  // Optional link back to our own Inventory (only for the Series adapter).
  inventoryId?: string;

  segments: ResultSegment[];
  travelClass: TravelClass;
  /** Supplier's booking-class code (e.g. "YA", "K"). Surfaced separately from
   *  the agent-facing fare type so masking/filtering at search time can target
   *  either dimension. */
  fareClass?: string;
  /** Agent-facing fare type (e.g. "Regular", "SME", "Promo"). Distinct from
   *  fareClass — fareClass is the supplier's booking code, fareType is what
   *  the airline marketed the fare as. Populated by adapters whose APIs
   *  carry it (eTrav, Kafila, AirIQ); undefined for adapters that don't.
   *  Map Source masking + Map Policy criteria.fareTypes consult this first
   *  and fall back to fareClass when undefined. */
  fareType?: string;

  // Per-pax base + tax in paise. Pricing engine handles markup/GST on top.
  perPax: {
    adult: { baseFarePaise: number; taxesPaise: number };
    child: { baseFarePaise: number; taxesPaise: number };
    infant: { baseFarePaise: number; taxesPaise: number };
  };

  refundable: boolean;
  fareRuleDescription?: string;

  baggageCheckin?: string;
  baggageCabin?: string;

  seatsRemaining?: number;

  // Hint to mark this fare as a series, LCC, FSC, or generic API result.
  source: 'SERIES' | 'LCC' | 'FSC' | 'API';

  // Short-lived token the supplier uses to look the fare back up during hold.
  // For our Series adapter this is just inventoryId. External adapters opaque it.
  supplierFareToken: string;

  // Policy + fare rule references (Series adapter populates from Inventory metadata).
  policyId?: string;
  fareRuleId?: string;
}

export interface NormalizedSearchResponse {
  options: NormalizedFareOption[];
}

/** A single passenger as the hold call needs them. Subset of the public
 *  PassengerInput — adapters only get what they need to file the booking. */
export interface NormalizedPassenger {
  type: 'ADULT' | 'CHILD' | 'INFANT';
  title: string; // 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS'
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  gender?: 'M' | 'F';
  nationality?: string; // ISO-2
  passport?: {
    number: string;
    issuingCountry: string;
    expiry: Date;
  };
}

export interface NormalizedHoldRequest {
  supplierFareToken: string;
  passengerCount: { adults: number; children: number; infants: number };
  /** Full passenger list — required for live suppliers (eTrav). Series + Mock
   *  ignore it but keep accepting it so the contract stays uniform. */
  passengers: NormalizedPassenger[];
  /** Booking contact — surfaced as Passenger_Email + Passenger_Mobile to eTrav. */
  contact: {
    email: string;
    mobile: string;
    countryCode?: string;
  };
  /** Optional SSR selections — meals, baggage add-ons, seats — captured by
   *  the UI from the /flights/ssr endpoint. Adapters that support SSR
   *  forward these into their booking call (TBO: in Book for GDS, in Ticket
   *  for LCC). Adapters that don't ignore the field. */
  ssrSelections?: NormalizedSsrSelections;
}

/**
 * Per-segment SSR selections. Each pick carries `segmentId` (the
 * "${origin}-${destination}" key the SSR endpoint groups by) plus enough
 * supplier-routing context (airlineCode, flightNumber, wayType) for the
 * adapter to build its native booking-request fields without re-fetching
 * the SSR catalog.
 */
export interface NormalizedSsrSelections {
  meals?: NormalizedSsrMealPick[];
  baggage?: NormalizedSsrBaggagePick[];
  seats?: NormalizedSsrSeatPick[];
}

export interface NormalizedSsrPickBase {
  segmentId: string;
  /** Supplier routing — required for TBO; safe-to-ignore for suppliers
   *  that don't care. UI forwards these verbatim from /flights/ssr. */
  airlineCode?: string;
  flightNumber?: string;
  /** 1=Outbound, 2=Inbound. */
  wayType?: 1 | 2;
  origin?: string;
  destination?: string;
}

export interface NormalizedSsrMealPick extends NormalizedSsrPickBase {
  code: string;
  description: string;
  pricePaise: number;
  currency: string;
}

export interface NormalizedSsrBaggagePick extends NormalizedSsrPickBase {
  code: string;
  description: string;
  weightKg: number;
  pricePaise: number;
  currency: string;
}

export interface NormalizedSsrSeatPick extends NormalizedSsrPickBase {
  code: string;
  rowNo: number;
  seatNo: string;
  /** Seat-type label from the SSR catalog ("Window" / "Aisle" / "Middle"). */
  seatType?: string;
  pricePaise: number;
  currency: string;
  /** Which passenger gets this seat (0-based index into `passengers`).
   *  Required when `seats` is non-empty — TBO sends one SeatPreference
   *  entry per (pax × seat) tuple. */
  paxIndex: number;
}

export interface NormalizedHoldResponse {
  supplierBookingRef: string;
  expiresAt: Date;
  pnr?: string;
}

export interface NormalizedTicketRequest {
  supplierBookingRef: string;
}

export interface NormalizedTicketResponse {
  pnr: string;
  airlinePnr?: string;
  ticketNumbers?: string[];
}

export interface NormalizedCancelRequest {
  supplierBookingRef: string;
  reason?: string;
}

export interface NormalizedCancelResponse {
  ok: boolean;
  refundAmountPaise?: number;
  cancellationReference?: string;
}

export interface NormalizedBookingDetails {
  supplierBookingRef: string;
  pnr?: string;
  status: string;
}

export class SupplierAdapterError extends Error {
  constructor(
    public code:
      | 'TIMEOUT'
      | 'CIRCUIT_OPEN'
      | 'NOT_FOUND'
      | 'EXHAUSTED'
      | 'AUTH'
      | 'BAD_REQUEST'
      | 'UPSTREAM',
    message: string,
    public supplierCode?: string,
  ) {
    super(message);
    this.name = 'SupplierAdapterError';
  }
}
