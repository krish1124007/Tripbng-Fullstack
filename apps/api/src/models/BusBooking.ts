// BusBooking — master record for a bus reservation through SeatSeller.
//
// Distinct from the existing flight `Booking` model and the
// `HotelBooking` model — bus has its own SeatSeller-specific state
// machine + payload shape. Following the same separate-model pattern
// hotels use rather than overloading a unified Booking schema.
//
// Money convention: integer PAISE everywhere. Spec §5.7 lists Decimal128
// — we override to match the rest of TripBNG.
//
// State machine:
//
//   BLOCKED  ─book─►  BOOKED  ─cancel(user)─►  PARTIALLY_CANCELLED
//      │                  │                        │
//      │                  ├─cancel(operator)──►  OPERATOR_CANCELLED
//      │                  │
//      │                  └─cancel(user, all)──►  CANCELLED
//      │
//      └─block-failure──►  FAILED
//
// Failures during the booking flow are intentionally explicit:
//   - blockTicket fails              → never persists a row (caller refunds wallet)
//   - bookTicket fails AND
//       checkBookedTicket null       → persist FAILED, refund wallet
//   - bookTicket fails AND
//       checkBookedTicket recovers   → persist BOOKED (tin from check call)

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const BUS_BOOKING_STATUS = [
  'BLOCKED',
  'BOOKED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_CANCELLED',
  'OPERATOR_CANCELLED',
] as const;
export type BusBookingStatus = (typeof BUS_BOOKING_STATUS)[number];

// ────────── Sub-schemas ──────────

const TripStopSubSchema = new Schema(
  {
    id: { type: Number, required: true },
    name: { type: String, required: true },
    address: { type: String, default: '' },
    landmark: { type: String, default: '' },
    contact: { type: String, default: '' },
    /** ISO timestamp resolved at search time. */
    timeAt: { type: String, required: true },
    /** Original SeatSeller minute-offset, kept for cancellation flows. */
    timeMinutes: { type: Number, required: true },
  },
  { _id: false },
);

const TripSnapshotSubSchema = new Schema(
  {
    operatorId: { type: Number, required: true },
    operatorName: { type: String, default: '' },
    busType: { type: String, default: '' },
    busTypeId: { type: Number, default: null },

    sourceCityId: { type: Number, required: true },
    sourceCityName: { type: String, default: '' },
    destinationCityId: { type: Number, required: true },
    destinationCityName: { type: String, default: '' },

    /** "yyyy-MM-dd" IST. */
    doj: { type: String, required: true },
    departureAt: { type: String, required: true },
    arrivalAt: { type: String, required: true },
    nextDay: { type: Boolean, default: false },

    boardingPoint: { type: TripStopSubSchema, required: true },
    droppingPoint: { type: TripStopSubSchema, required: true },

    isAc: { type: Boolean, default: false },
    isSleeper: { type: Boolean, default: false },
    bpDpSeatLayout: { type: Boolean, default: false },
    callFareBreakupApi: { type: Boolean, default: false },
    mTicketEnabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const PassengerSubSchema = new Schema(
  {
    seatName: { type: String, required: true },
    title: { type: String, enum: ['Mr', 'Ms', 'Mrs', 'Miss'], required: true },
    name: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'], required: true },
    /** PII — kept out of default queries; encrypted at rest in a later pass. */
    mobile: { type: String, required: true, select: false },
    email: { type: String, required: true, select: false },
    address: { type: String, default: '', select: false },
    idType: {
      type: String,
      enum: ['AADHAR', 'PAN_CARD', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_CARD', 'RATION_CARD', 'NONE'],
      default: 'NONE',
    },
    idNumber: { type: String, default: '', select: false },

    /** Lead pax — receives the ticket / SMS. Exactly one in the array. */
    primary: { type: Boolean, default: false },
    /** Snapshot: the seat was operator-reserved for ladies. */
    ladiesSeat: { type: Boolean, default: false },
    /** Per-pax fare in PAISE — must equal what tripDetails returned. */
    farePaise: { type: Number, required: true, min: 0 },

    /** Filled after bookTicket if SeatSeller returns per-pax tickets. */
    ticketNumber: { type: String, default: null },
    ticketStatus: { type: String, default: null },
  },
  { _id: false },
);

const FareBreakupSubSchema = new Schema(
  {
    baseFarePaise: { type: Number, default: 0, min: 0 },
    operatorServiceChargePaise: { type: Number, default: 0, min: 0 },
    serviceTaxPaise: { type: Number, default: 0, min: 0 },
    bookingFeePaise: { type: Number, default: 0, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    /** Free-form RTC operator breakdown. Populated only when
     *  trip.callFareBreakupApi was true at block time. */
    rtcCustomerPriceBreakUp: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

// ────────── Main schema ──────────

const BusBookingSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** Human-readable code: "TBNG-BUS-2026-000123". Issued by Counter. */
    bookingRef: { type: String, required: true, unique: true, index: true },

    /** The approval that authorised this booking. */
    approvalId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest', required: true, index: true },

    /** Who the booking is for + who placed it. */
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
    bookedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    gstProfileId: { type: Schema.Types.ObjectId, ref: 'GstProfile', default: null },

    // ── SeatSeller correlation ──
    blockKey: { type: String, required: true, unique: true, index: true },
    /** SeatSeller TIN — primary booking reference. Null until book-success. */
    tin: { type: String, default: null, index: true, sparse: true },
    /** Operator PNR — varies per operator, can be empty even on success. */
    pnr: { type: String, default: null },
    inventoryId: { type: String, required: true },

    // ── Snapshots (immutable) ──
    trip: { type: TripSnapshotSubSchema, required: true },
    passengers: { type: [PassengerSubSchema], required: true, validate: (v: unknown[]) => v.length >= 1 },
    fareBreakup: { type: FareBreakupSubSchema, required: true },

    // ── Cancellation context (snapshotted from tripDetails) ──
    cancellationPolicyString: { type: String, default: '' },
    cancellationCalculationTimestamp: { type: Date, default: null },
    partialCancellationAllowed: { type: Boolean, default: false },

    // ── State ──
    status: {
      type: String,
      enum: BUS_BOOKING_STATUS,
      required: true,
      default: 'BLOCKED',
      index: true,
    },
    failureReason: { type: String, default: null },

    // ── Wallet linkage ──
    walletDebitTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    walletRefundTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    // ── Timestamps for the lifecycle ──
    blockedAt: { type: Date, default: null },
    bookedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    operatorCancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Composite indexes for common queries.
BusBookingSchema.index({ tenantId: 1, agencyId: 1, status: 1, 'trip.doj': 1 });
BusBookingSchema.index({ tenantId: 1, employeeId: 1, createdAt: -1 });

export type BusBookingDoc = HydratedDocument<InferSchemaType<typeof BusBookingSchema>> & {
  _id: Types.ObjectId;
};
export type BusBookingModel = Model<InferSchemaType<typeof BusBookingSchema>>;
// Guard against double-registration (vitest module-isolation under vi.mock).
export const BusBooking: BusBookingModel =
  (mongoose.models.BusBooking as BusBookingModel | undefined) ??
  model<InferSchemaType<typeof BusBookingSchema>>('BusBooking', BusBookingSchema);
