// Hotel booking aggregate.
//
// Distinct from the existing `Booking` model (flights) — hotels have very
// different shapes (multi-room, rate-per-stay-not-per-segment, GST applies
// at booking-level, voucher/hold lifecycle differs). Keeping them separate
// avoids polluting either schema with optional fields the other never uses.
//
// Lifecycle states (per CLAUDE.md §7.2):
//   DRAFT             — pre-book stored, awaiting user confirm
//   AWAITING_APPROVAL — corporate policy says manager must approve
//   APPROVED          — approved internally, not yet sent to supplier
//   BOOK_FAILED
//   HELD              — Booked but VoucherStatus=false, voucher pending
//   PENDING_SUPPLIER  — TBO returned HotelBookingStatus=Pending
//   CONFIRMED         — VoucherStatus=true (one-shot voucher booking)
//   VOUCHERED         — voucher generated for held bookings
//   CANCEL_REQUESTED
//   CANCEL_PROCESSING
//   CANCELLED
//   CANCEL_REJECTED
//
// Phase 2 only writes DRAFT. Subsequent phases (Book, Voucher, Cancel)
// transition through the rest of the states.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const HOTEL_BOOKING_STATUS = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'BOOK_FAILED',
  'HELD',
  'PENDING_SUPPLIER',
  'CONFIRMED',
  'VOUCHERED',
  'CANCEL_REQUESTED',
  'CANCEL_PROCESSING',
  'CANCELLED',
  'CANCEL_REJECTED',
] as const;
export type HotelBookingStatus = (typeof HOTEL_BOOKING_STATUS)[number];

const HotelBookingSchema = new Schema(
  {
    // ───── Identity ─────
    /** TripBNG-internal sequential code (e.g. TRBNG-HTL-2026-000123).
     *  Generated lazily — DRAFT rows can have a null code. */
    bookingCode: { type: String, default: null, index: true, unique: true, sparse: true },

    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** Optional in Phase 2 — DRAFT may pre-date the booker selecting a corporate. */
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },
    bookedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Set when the booking goes through the approval workflow. */
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // ───── Supplier ─────
    supplier: {
      type: String,
      enum: ['TBO', 'AGODA', 'HOTELBEDS', 'MOCK'],
      required: true,
      index: true,
    },
    supplierRefs: {
      /** TBO BookingCode — Search → PreBook → Book identifier. */
      bookingCode: { type: String, default: null, index: true },
      bookingId: { type: Number, default: null },
      bookingRefNo: { type: String, default: null },
      confirmationNo: { type: String, default: null, index: true },
      invoiceNumber: { type: String, default: null },
      traceId: { type: String, default: null },
    },

    // ───── Hotel snapshot (denormalized) ─────
    hotel: {
      hotelCode: { type: String, default: null },
      name: { type: String, default: null },
      starRating: { type: Number, default: null },
      address: { type: String, default: null },
      cityId: { type: String, default: null },
      countryCode: { type: String, default: null },
    },

    // ───── Stay ─────
    checkIn: { type: Date, required: true, index: true },
    checkOut: { type: Date, required: true },
    nights: { type: Number, required: true, min: 1 },
    rooms: {
      type: [
        {
          name: { type: String, default: null },
          adults: { type: Number, default: 0 },
          children: { type: Number, default: 0 },
          childrenAges: { type: [Number], default: [] },
          mealPlan: { type: String, default: null },
          isRefundable: { type: Boolean, default: false },
          /** Per-room TBO BookingCode — distinct rooms can have distinct codes. */
          bookingCode: { type: String, default: null },
          inclusions: { type: String, default: null },
          totalNetPaise: { type: Number, default: 0 },
          totalSellingPaise: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    // ───── Guests ─────
    /** Empty until Book is called. DRAFT rows have no guests. */
    guests: {
      type: [
        {
          title: { type: String, enum: ['Mr', 'Mrs', 'Miss', 'Ms'] },
          firstName: { type: String },
          middleName: { type: String, default: null },
          lastName: { type: String },
          paxType: { type: String, enum: ['Adult', 'Child'] },
          age: { type: Number, default: null },
          isLeadPassenger: { type: Boolean, default: false },
          phone: { type: String, default: null },
          email: { type: String, default: null },
          /** PII — encrypted via the same field-encryption helper used for
           *  PaymentGatewayConfig. Phase 3 wires the encryption hook. */
          pan: { type: String, default: null, select: false },
          passportNo: { type: String, default: null, select: false },
          passportIssueDate: { type: Date, default: null },
          passportExpDate: { type: Date, default: null },
        },
      ],
      default: [],
    },

    // ───── Money ─────
    currency: { type: String, default: 'INR' },
    pricing: {
      /** Net to TBO. */
      totalNetPaise: { type: Number, default: 0 },
      /** What the agency pays TripBNG (markup applied). */
      totalSellingPaise: { type: Number, default: 0 },
      /** TBO floor — sellingPrice must be ≥ this. */
      recommendedSellingPaise: { type: Number, default: 0 },
      /** Per-night for display. */
      perNightPaise: { type: Number, default: 0 },
    },
    taxBreakup: {
      type: [
        {
          taxType: { type: String, enum: ['CGST', 'SGST', 'IGST', 'TCS', 'TDS', 'OTHER'] },
          taxableAmountPaise: { type: Number, default: 0 },
          taxPercentage: { type: Number, default: 0 },
          taxAmountPaise: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    // ───── Cancellation policies (snapshot at PreBook time) ─────
    cancellationPolicies: {
      type: [
        {
          fromDate: { type: Date },
          chargeType: { type: String, enum: ['Percentage', 'FixedAmount'] },
          charge: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    isRefundable: { type: Boolean, default: false },
    lastCancellationDate: { type: Date, default: null },

    // ───── GST / corporate compliance ─────
    gst: {
      gstin: { type: String, default: null },
      companyName: { type: String, default: null },
      companyAddress: { type: String, default: null },
    },

    // Corporate tagging — captured at /book time so finance reports can
    // group spend by cost centre / project / GL code. All optional —
    // agencies that don't use these leave them null.
    costCentreCode: { type: String, default: null, index: true },
    glCode: { type: String, default: null, index: true },
    projectCode: { type: String, default: null, index: true },

    // ───── Approval workflow (Phase 5) ─────
    //
    // Set when policy guard routes the booking to AWAITING_APPROVAL.
    // Cleared (left in place for audit) once approve/reject lands.
    pendingApproval: {
      isVoucherBooking: { type: Boolean, default: null },
      requestedAt: { type: Date, default: null },
      requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      approverUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      /** Reasons the booking required approval — surfaced to approver. */
      reasons: { type: [String], default: [] },
      decisionNote: { type: String, default: null },
      decidedAt: { type: Date, default: null },
      decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      decision: { type: String, enum: ['APPROVED', 'REJECTED'], default: null },
    },

    // ───── State machine ─────
    status: { type: String, enum: HOTEL_BOOKING_STATUS, default: 'DRAFT', index: true },
    statusHistory: {
      type: [
        {
          status: { type: String, enum: HOTEL_BOOKING_STATUS, required: true },
          at: { type: Date, default: () => new Date() },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          note: { type: String, default: null },
        },
      ],
      default: [],
    },

    // Edge-case flags surfaced from PreBook.
    isPriceChanged: { type: Boolean, default: false },
    isCancellationPolicyChanged: { type: Boolean, default: false },

    // Wallet ledger references — populated by Book + cancel/refund flows.
    walletDebitTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    walletRefundTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    // Pending-poll state — when TBO returns HotelBookingStatus=Pending, we
    // schedule a delayed BullMQ job and track attempt count here. Reset to
    // null once the booking transitions out of PENDING_SUPPLIER.
    pendingPoll: {
      attempts: { type: Number, default: 0 },
      lastPolledAt: { type: Date, default: null },
    },

    // Booking-time timestamps — distinct from createdAt (which marks DRAFT).
    bookedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    vouchredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    // ───── Audit ─────
    /** Source-of-truth supplier rules from PreBook — drives the dynamic
     *  guest form. Stored as Mixed because TBO's keys vary. */
    supplierRules: { type: Schema.Types.Mixed, default: null },
    /** Last raw payloads per step. Used for support-ticket attachments. */
    rawRequests: {
      preBook: { type: Schema.Types.Mixed, default: null },
      book: { type: Schema.Types.Mixed, default: null },
      voucher: { type: Schema.Types.Mixed, default: null },
    },
    rawResponses: {
      preBook: { type: Schema.Types.Mixed, default: null },
      book: { type: Schema.Types.Mixed, default: null },
      voucher: { type: Schema.Types.Mixed, default: null },
      bookingDetail: { type: Schema.Types.Mixed, default: null },
    },
  },
  { timestamps: true },
);

HotelBookingSchema.index({ tenantId: 1, agencyId: 1, status: 1, checkIn: -1 });
HotelBookingSchema.index({ 'supplierRefs.confirmationNo': 1 });

export type HotelBookingDoc = HydratedDocument<InferSchemaType<typeof HotelBookingSchema>> & {
  _id: Types.ObjectId;
};
export const HotelBooking: Model<HotelBookingDoc> =
  (mongoose.models.HotelBooking as Model<HotelBookingDoc> | undefined) ??
  model<HotelBookingDoc>('HotelBooking', HotelBookingSchema);
