// SeatSeller (RedBus partner API) request/response types.
//
// Shape mirrors the SeatSeller v3 PDFs verbatim where possible. Unknown /
// rarely-used fields are typed as optional `unknown` so the mock and
// real clients can pass them through without locking us into a contract
// that hasn't stabilised. Money fields are typed as `number` on the
// wire — the booking service converts to Decimal128 at the persistence
// boundary.
//
// Naming convention: SeatSellerXxx where Xxx matches the endpoint
// terminology. Tripngb-internal canonical types live alongside the
// existing SupplierAdapter contract.

// ────────── Cities & aliases ──────────

export interface SeatSellerCity {
  /** SeatSeller numeric city ID — primary key for source/destination. */
  id: number;
  name: string;
  state?: string;
  /** Some endpoints alias as "stateId"; we don't rely on it. */
  countryCode?: string;
}

export interface SeatSellerCityAlias {
  cityId: number;
  alias: string;
}

// ────────── Available trips (search) ──────────

export interface SeatSellerAvailableTripsRequest {
  source: number;
  destination: number;
  /** "yyyy-MM-dd" in IST. */
  doj: string;
}

export interface SeatSellerAvailableTrip {
  /** Stable identifier for tripDetails / blockTicket. */
  tripId: string;
  /** SeatSeller's "inventory" handle — required for tripDetailsV2. */
  inventoryId: string;

  operatorId: number;
  operatorName: string;
  busType: string;
  /** SeatSeller numeric busType — used by policy filters. */
  busTypeId?: number;

  /** Source / destination as IDs the request used. SeatSeller doesn't
   *  always echo names — we round-trip from the client. */
  source: { id: number; name?: string };
  destination: { id: number; name?: string };

  /** Minutes from doj-midnight IST. Use ssMinutesToDate to convert. */
  departureTime: number;
  arrivalTime: number;

  /** Total number of seats available on this trip. */
  availableSeats: number;
  /** Min/max fare visible at search time — confirm via tripDetails. */
  fareMinINR: number;
  fareMaxINR: number;

  /** Whether this trip crosses midnight (arrivalTime is on doj+1). */
  nextDay?: boolean;
  /** AC / non-AC hint — operator-supplied; not always reliable. */
  isAc?: boolean;
  isSleeper?: boolean;

  /** Boarding-point/dropping-point seat layout (BP-DP model). When
   *  true, layouts are per-BP-DP combination; use tripDetailsV2. */
  bpDpSeatLayout?: boolean;
  /** RTC operators want a separate fare-breakup call before booking. */
  callFareBreakupApi?: boolean;
  /** Operator emits an mTicket QR — not all do. */
  mTicketEnabled?: boolean;

  /** Pass-through of raw payload for debug / fixture replay. */
  raw?: unknown;
}

// ────────── Trip details (LIVE — never cached) ──────────

export interface SeatSellerSeat {
  seatName: string;
  /** Sleeper / semi-sleeper / seater hint (operator-defined). */
  seatType?: string;
  /** Fare for this seat in INR. Pass byte-for-byte to blockTicket. */
  fareINR: number;
  available: boolean;
  /** Reserved for ladies (parsed from forcedSeats too). */
  ladiesSeat: boolean;
  malesSeat: boolean;
  /** Seat row/column for layout rendering. SeatSeller varies; both
   *  may be undefined for very old operators. */
  row?: number;
  col?: number;
  /** Lower / upper berth indicator on sleeper buses. */
  zIndex?: 0 | 1;
}

export interface SeatSellerTripDetails {
  tripId: string;
  inventoryId: string;
  /** Concatenated forcedSeats string per CLAUDE.md §13. Use parseForcedSeats. */
  forcedSeats: string;
  /** Cancellation policy string per CLAUDE.md §12. Use parsePolicy. */
  cancellationPolicy: string;
  /** Server timestamp from SeatSeller — anchor for cancellation slab math. */
  cancellationCalculationTimestamp: string;
  partialCancellationAllowed: boolean;

  seats: SeatSellerSeat[];
  /** Boarding / dropping pickup points. Keyed by id; can be huge for hubs. */
  boardingPoints: SeatSellerStop[];
  droppingPoints: SeatSellerStop[];

  bpDpSeatLayout: boolean;
  callFareBreakupApi: boolean;
  mTicketEnabled: boolean;

  raw?: unknown;
}

export interface SeatSellerStop {
  id: number;
  name: string;
  address?: string;
  landmark?: string;
  /** Minutes from doj-midnight IST. */
  time: number;
  /** Operator contact phone — surfaced on the e-ticket. */
  contact?: string;
}

// ────────── BP-DP (boarding-point / dropping-point) details ──────────

export interface SeatSellerBpDpDetailsRequest {
  tripId: string;
  /** Optional — required for some operators that index BP/DP under a parent. */
  bpId?: number;
}

export interface SeatSellerBpDpDetails {
  tripId: string;
  boardingPoints: SeatSellerStop[];
  droppingPoints: SeatSellerStop[];
}

// ────────── tripDetailsV2 (BP-DP model) ──────────

export interface SeatSellerTripDetailsV2Request {
  inventoryId: string;
  bpId: number;
  dpId: number;
}

// V2 response shape == TripDetails. Same canonical model.

// ────────── Block ticket ──────────

export interface SeatSellerBlockPassenger {
  /** SeatSeller field is `seatName`. We mirror exactly. */
  seatName: string;
  /** "Mr" / "Ms" / "Mrs" / "Miss" — verbatim casing. */
  title: 'Mr' | 'Ms' | 'Mrs' | 'Miss';
  name: string;
  age: number;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  mobile: string;
  email: string;
  address?: string;
  /** Government ID — accepted types per SeatSeller. */
  idType?: 'AADHAR' | 'PAN_CARD' | 'PASSPORT' | 'DRIVING_LICENCE' | 'VOTER_CARD' | 'RATION_CARD' | 'NONE';
  idNumber?: string;
  /** Lead pax — receives the ticket / SMS. */
  primary: boolean;
  /** Was this seat reserved for ladies (for cross-validation)? */
  ladiesSeat: boolean;
  /** Per-seat fare — must match what tripDetails returned. */
  fareINR: number;
}

export interface SeatSellerBlockRequest {
  tripId: string;
  inventoryId: string;
  /** SeatSeller numeric BP/DP IDs — must come from BpDpDetails or
   *  tripDetails.boardingPoints. */
  boardingPointId: number;
  droppingPointId: number;
  passengers: SeatSellerBlockPassenger[];
  /** Optional GST capture — needed for corporate ITC claims. */
  passengerGSTDetails?: SeatSellerGstDetails;
  /** Optional caller IP for fraud heuristics. */
  customerIp?: string;
}

export interface SeatSellerGstDetails {
  registrationName: string;
  gstin: string;
  address: string;
  email: string;
  state: string;
}

export interface SeatSellerBlockResponse {
  blockKey: string;
  /** Some operators echo a pseudo-tin even on block. Do NOT treat this
   *  as the booking confirmation — only bookTicket's tin counts. */
  preliminaryTin?: string;
}

// ────────── Get updated fare (RTC operators) ──────────

export interface SeatSellerUpdatedFareItem {
  /** Field name as RTC returns it — varies per operator. */
  field: string;
  /** Customer-visible label. */
  label?: string;
  amountINR: number;
}

export interface SeatSellerUpdatedFare {
  blockKey: string;
  /** Itemised breakup. The TOTAL_FARE row is computed on top — exclude
   *  it when summing for wallet adjustment (CLAUDE.md §8.2 step 9). */
  customerPriceBreakUp: SeatSellerUpdatedFareItem[];
  totalFareINR: number;
}

// ────────── Book ticket ──────────

export interface SeatSellerBookResponse {
  /** SeatSeller "ticket identification number" — primary booking reference. */
  tin: string;
  /** Operator PNR (varies by operator; can be empty on RTC). */
  pnr?: string;
}

// ────────── Get ticket / check booked ticket ──────────

export interface SeatSellerTicket {
  tin: string;
  pnr?: string;
  blockKey: string;
  /** SeatSeller's status string — "BOOKED" / "CANCELLED" / etc. */
  status: string;
  /** When SeatSeller cancelled the ticket on the operator's behalf. */
  cancellationReason?: string;
  cancellationMessage?: string;
  refundAmountINR?: number;

  trip: SeatSellerAvailableTrip;
  passengers: SeatSellerBlockPassenger[];
  fareBreakup: SeatSellerFareBreakup;

  bookedAt: string;
  cancelledAt?: string;
  raw?: unknown;
}

export interface SeatSellerFareBreakup {
  baseFareINR: number;
  /** Operator service charge — non-refundable on user cancel. */
  operatorServiceChargeINR: number;
  serviceTaxINR: number;
  bookingFeeINR: number;
  totalINR: number;
  /** Populated by RTC operators only. */
  rtcCustomerPriceBreakUp?: SeatSellerUpdatedFareItem[] | null;
}

// ────────── Cancellation ──────────

export interface SeatSellerCancellationData {
  tin: string;
  /** Per-seat preview — SeatSeller calculates charges live, even if
   *  the cancellation policy looks static. Do NOT compute locally and
   *  display this; always fetch live for the user-facing preview. */
  seats: SeatSellerCancellationSeatPreview[];
  totalChargeINR: number;
  totalRefundINR: number;
}

export interface SeatSellerCancellationSeatPreview {
  seatName: string;
  baseFareINR: number;
  cancellationChargeINR: number;
  refundINR: number;
}

export interface SeatSellerCancelRequest {
  tin: string;
  /** Subset of seats to cancel — empty/omitted = full cancel. */
  seatsToCancel?: string[];
}

export interface SeatSellerCancelResponse {
  tin: string;
  cancelledSeats: string[];
  cancellationChargeINR: number;
  refundAmountINR: number;
  /** Operator-side reference for the cancellation. */
  cancellationReference?: string;
}

// ────────── Operator-side cancellation poller ──────────

export interface SeatSellerBusCancellationInfoRequest {
  /** "yyyy-MM-dd" — both inclusive. */
  from: string;
  to: string;
}

export interface SeatSellerCancelledTinRef {
  tin: string;
  /** Operator's cancellation reason flag — see CLAUDE.md §8.4. */
  reasonCode?: 'BUS_CANCELLATION' | 'BO_CANCELLATION' | 'ALTERNATE_ARRANGEMENT' | string;
}

// ────────── OAuth ──────────

export interface SeatSellerOauthToken {
  accessToken: string;
  /** Seconds until expiry, as returned by SeatSeller. We cache for
   *  expiresIn - 300 to leave headroom. */
  expiresIn: number;
  tokenType: string;
}
