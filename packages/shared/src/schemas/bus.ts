// Bus search / trip / seat-layout schemas.
//
// These are the public-facing zod shapes that the bus REST routes
// validate against. They mirror the SeatSeller types we already have in
// apps/api/src/adapters/seatseller/types.ts but are kept here in shared
// so the web app can import them for form validation.
//
// Money: prices on the wire are in INR (decimal). The booking layer
// converts to integer paise at persist time per the codebase
// convention.

import { z } from 'zod';

// ────────── City + autocomplete ──────────

export const BusCitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  state: z.string().optional(),
  countryCode: z.string().optional(),
});
export type BusCity = z.infer<typeof BusCitySchema>;

export const BusCityAutocompleteQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type BusCityAutocompleteQuery = z.infer<typeof BusCityAutocompleteQuerySchema>;

// ────────── Search ──────────

/** "yyyy-MM-dd" — the format SeatSeller expects + the format the URL
 *  uses. Validated more strictly inside the service layer (calendar
 *  date impossibilities like Feb 30 are rejected there). */
export const BusDojSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'doj must be yyyy-MM-dd');

export const BusSearchQuerySchema = z.object({
  source: z.coerce.number().int().positive(),
  destination: z.coerce.number().int().positive(),
  doj: BusDojSchema,
});
export type BusSearchQuery = z.infer<typeof BusSearchQuerySchema>;

export const BusTripSchema = z.object({
  tripId: z.string().min(1),
  inventoryId: z.string().min(1),
  operatorId: z.number().int().nonnegative(),
  operatorName: z.string(),
  busType: z.string(),
  busTypeId: z.number().int().nonnegative().optional(),
  source: z.object({ id: z.number().int().positive(), name: z.string().optional() }),
  destination: z.object({ id: z.number().int().positive(), name: z.string().optional() }),
  /** Resolved ISO timestamps. */
  departureAt: z.string().datetime(),
  arrivalAt: z.string().datetime(),
  /** Original SeatSeller minute offsets — round-tripped for the booking
   *  step which sends them back. */
  departureTime: z.number().int().nonnegative(),
  arrivalTime: z.number().int().nonnegative(),
  availableSeats: z.number().int().nonnegative(),
  fareMinINR: z.number().nonnegative(),
  fareMaxINR: z.number().nonnegative(),
  nextDay: z.boolean().optional(),
  isAc: z.boolean().optional(),
  isSleeper: z.boolean().optional(),
  bpDpSeatLayout: z.boolean().optional(),
  callFareBreakupApi: z.boolean().optional(),
  mTicketEnabled: z.boolean().optional(),
});
export type BusTrip = z.infer<typeof BusTripSchema>;

// Named with the `Trips` infix to disambiguate from the older
// placeholder `BusSearchResponseSchema` in products.ts (which models a
// different shape and will be removed once SeatSeller wiring is the
// only bus integration).
export const BusTripsSearchResponseSchema = z.object({
  source: z.object({ id: z.number().int().positive(), name: z.string().nullable() }),
  destination: z.object({ id: z.number().int().positive(), name: z.string().nullable() }),
  doj: BusDojSchema,
  fromCache: z.boolean(),
  trips: z.array(BusTripSchema),
  filteredOut: z.number().int().nonnegative(),
});
export type BusTripsSearchResponse = z.infer<typeof BusTripsSearchResponseSchema>;

// ────────── Trip details (LIVE) ──────────

export const BusSeatSchema = z.object({
  seatName: z.string().min(1),
  seatType: z.string().optional(),
  fareINR: z.number().nonnegative(),
  available: z.boolean(),
  ladiesSeat: z.boolean(),
  malesSeat: z.boolean(),
  row: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative().optional(),
  zIndex: z.union([z.literal(0), z.literal(1)]).optional(),
});
export type BusSeat = z.infer<typeof BusSeatSchema>;

export const BusStopSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  address: z.string().optional(),
  landmark: z.string().optional(),
  contact: z.string().optional(),
  /** Resolved ISO timestamp for display. */
  timeAt: z.string().datetime(),
  /** Original SeatSeller minute offset — required at block-time. */
  timeMinutes: z.number().int().nonnegative(),
});
export type BusStop = z.infer<typeof BusStopSchema>;

export const BusForcedSeatsSchema = z.object({
  female: z.array(z.string()),
  male: z.array(z.string()),
});
export type BusForcedSeatsView = z.infer<typeof BusForcedSeatsSchema>;

export const BusTripDetailsResponseSchema = z.object({
  tripId: z.string(),
  inventoryId: z.string(),
  forcedSeats: BusForcedSeatsSchema,
  cancellationPolicy: z.string(),
  cancellationCalculationTimestamp: z.string(),
  partialCancellationAllowed: z.boolean(),
  seats: z.array(BusSeatSchema),
  boardingPoints: z.array(BusStopSchema),
  droppingPoints: z.array(BusStopSchema),
  bpDpSeatLayout: z.boolean(),
  callFareBreakupApi: z.boolean(),
  mTicketEnabled: z.boolean(),
});
export type BusTripDetailsResponse = z.infer<typeof BusTripDetailsResponseSchema>;

export const BusTripQuerySchema = z.object({
  doj: BusDojSchema,
  bpId: z.coerce.number().int().nonnegative().optional(),
  dpId: z.coerce.number().int().nonnegative().optional(),
});
export type BusTripQuery = z.infer<typeof BusTripQuerySchema>;

// ────────── BPDP ──────────

export const BusBpDpResponseSchema = z.object({
  tripId: z.string(),
  boardingPoints: z.array(BusStopSchema),
  droppingPoints: z.array(BusStopSchema),
});
export type BusBpDpResponse = z.infer<typeof BusBpDpResponseSchema>;

// ────────── Booking ──────────
//
// /api/v1/bus/bookings POST. The approvalId carries the trip + seat
// snapshot; this body adds the per-pax PII the SPA collected after
// approval.

export const BusBookingPassengerSchema = z.object({
  seatName: z.string().min(1),
  title: z.enum(['Mr', 'Ms', 'Mrs', 'Miss']),
  name: z.string().min(2).max(80),
  age: z.number().int().min(0).max(120),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  mobile: z.string().min(8).max(20),
  email: z.string().email(),
  address: z.string().max(200).optional(),
  idType: z
    .enum(['AADHAR', 'PAN_CARD', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_CARD', 'RATION_CARD', 'NONE'])
    .optional(),
  idNumber: z.string().max(40).optional(),
  /** Lead pax — exactly one row should set this true. The service
   *  promotes the first pax if no one is marked. */
  primary: z.boolean(),
});
export type BusBookingPassenger = z.infer<typeof BusBookingPassengerSchema>;

export const BusBookingRequestSchema = z.object({
  approvalId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid ObjectId'),
  gstProfileId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'invalid ObjectId')
    .nullable()
    .optional(),
  passengers: z.array(BusBookingPassengerSchema).min(1).max(8),
});
export type BusBookingRequest = z.infer<typeof BusBookingRequestSchema>;

// Response — the public booking shape. Mirrors the BusBookingDoc but
// strips PII fields by default (the route maps that). We don't include
// phone/email/idNumber here; admins use a separate admin-only endpoint
// to surface those.

export const BusBookingFareBreakupSchema = z.object({
  baseFarePaise: z.number().int().nonnegative(),
  operatorServiceChargePaise: z.number().int().nonnegative(),
  serviceTaxPaise: z.number().int().nonnegative(),
  bookingFeePaise: z.number().int().nonnegative(),
  totalPaise: z.number().int().nonnegative(),
});
export type BusBookingFareBreakup = z.infer<typeof BusBookingFareBreakupSchema>;

export const BusBookingTripSnapshotSchema = z.object({
  operatorName: z.string(),
  busType: z.string(),
  sourceCityId: z.number().int().positive(),
  sourceCityName: z.string(),
  destinationCityId: z.number().int().positive(),
  destinationCityName: z.string(),
  doj: z.string(),
  departureAt: z.string(),
  arrivalAt: z.string(),
  nextDay: z.boolean(),
  boardingPoint: BusStopSchema,
  droppingPoint: BusStopSchema,
});
export type BusBookingTripSnapshot = z.infer<typeof BusBookingTripSnapshotSchema>;

export const PublicBusBookingPassengerSchema = z.object({
  seatName: z.string(),
  title: z.string(),
  name: z.string(),
  age: z.number().int(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  primary: z.boolean(),
  ladiesSeat: z.boolean(),
  farePaise: z.number().int().nonnegative(),
  ticketNumber: z.string().nullable(),
});
export type PublicBusBookingPassenger = z.infer<typeof PublicBusBookingPassengerSchema>;

export const PublicBusBookingSchema = z.object({
  id: z.string(),
  bookingRef: z.string(),
  status: z.enum([
    'BLOCKED',
    'BOOKED',
    'FAILED',
    'CANCELLED',
    'PARTIALLY_CANCELLED',
    'OPERATOR_CANCELLED',
  ]),
  approvalId: z.string(),
  employeeId: z.string(),
  agencyId: z.string(),
  gstProfileId: z.string().nullable(),
  blockKey: z.string(),
  tin: z.string().nullable(),
  pnr: z.string().nullable(),
  trip: BusBookingTripSnapshotSchema,
  passengers: z.array(PublicBusBookingPassengerSchema),
  fareBreakup: BusBookingFareBreakupSchema,
  cancellationPolicyString: z.string(),
  partialCancellationAllowed: z.boolean(),
  failureReason: z.string().nullable(),
  blockedAt: z.string().nullable(),
  bookedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicBusBooking = z.infer<typeof PublicBusBookingSchema>;

// ────────── Cancellation ──────────

export const BUS_CANCELLATION_REASONS_LIST = [
  'USER',
  'BUS_CANCELLATION',
  'BO_CANCELLATION',
  'ALTERNATE_ARRANGEMENT',
] as const;
export const BusCancellationReasonEnum = z.enum(BUS_CANCELLATION_REASONS_LIST);
export type BusCancellationReasonEnumT = z.infer<typeof BusCancellationReasonEnum>;

export const BusCancellationPreviewSchema = z.object({
  bookingId: z.string(),
  bookingRef: z.string(),
  seats: z.array(
    z.object({
      seatName: z.string(),
      baseFarePaise: z.number().int().nonnegative(),
      cancellationChargePaise: z.number().int().nonnegative(),
      refundPaise: z.number().int().nonnegative(),
    }),
  ),
  totalChargePaise: z.number().int().nonnegative(),
  totalRefundPaise: z.number().int().nonnegative(),
});
export type BusCancellationPreview = z.infer<typeof BusCancellationPreviewSchema>;

export const BusCancellationRequestSchema = z.object({
  /** Subset of seats to cancel — empty/missing = full booking. */
  seats: z.array(z.string().min(1)).max(8).optional(),
  /** Optional free-form note captured for audit. */
  note: z.string().max(500).optional(),
});
export type BusCancellationRequest = z.infer<typeof BusCancellationRequestSchema>;

export const PublicBusCancellationSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  seatsCancelled: z.array(z.string()),
  cancellationChargePaise: z.number().int().nonnegative(),
  refundAmountPaise: z.number().int().nonnegative(),
  reason: BusCancellationReasonEnum,
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  cancellationReference: z.string().nullable(),
  note: z.string(),
  refundTxnId: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicBusCancellation = z.infer<typeof PublicBusCancellationSchema>;

export const BusCancellationResultSchema = z.object({
  booking: PublicBusBookingSchema,
  cancellation: PublicBusCancellationSchema,
  refundPaise: z.number().int().nonnegative(),
  chargePaise: z.number().int().nonnegative(),
});
export type BusCancellationResult = z.infer<typeof BusCancellationResultSchema>;

// ────────── Reports ──────────

export const BUS_REPORT_TYPES_LIST = [
  'SUMMARY',
  'BY_EMPLOYEE',
  'BY_MONTH',
  'BY_OPERATOR',
] as const;
export const BusReportTypeEnum = z.enum(BUS_REPORT_TYPES_LIST);
export type BusReportTypeEnumT = z.infer<typeof BusReportTypeEnum>;

export const BusReportQuerySchema = z.object({
  type: BusReportTypeEnum,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agencyId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  status: z.string().optional(),
});
export type BusReportQuery = z.infer<typeof BusReportQuerySchema>;

export const BusReportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  format: z.enum(['number', 'paise', 'percent', 'date', 'string']),
});
export type BusReportColumn = z.infer<typeof BusReportColumnSchema>;

export const BusReportResponseSchema = z.object({
  type: BusReportTypeEnum,
  generatedAt: z.string().datetime(),
  from: z.string().datetime().nullable(),
  to: z.string().datetime().nullable(),
  columns: z.array(BusReportColumnSchema),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  totals: z.record(z.number()).nullable(),
});
export type BusReportResponse = z.infer<typeof BusReportResponseSchema>;

// ────────── Audit log viewer ──────────

export const BusAuditLogQuerySchema = z.object({
  /** Restrict to a specific resource type (booking / approval / etc.). */
  resource: z.string().optional(),
  /** Restrict to a specific resource id. */
  resourceId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  /** Restrict to actions matching this prefix (e.g. "bus.booking"). */
  actionPrefix: z.string().max(80).optional(),
  /** Acting user. */
  actorId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type BusAuditLogQuery = z.infer<typeof BusAuditLogQuerySchema>;

export const PublicAuditLogEntrySchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().nullable(),
  before: z.unknown().nullable().optional(),
  after: z.unknown().nullable().optional(),
  ip: z.string().nullable(),
  success: z.boolean(),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PublicAuditLogEntry = z.infer<typeof PublicAuditLogEntrySchema>;

export const BusAuditLogResponseSchema = z.object({
  items: z.array(PublicAuditLogEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type BusAuditLogResponse = z.infer<typeof BusAuditLogResponseSchema>;
