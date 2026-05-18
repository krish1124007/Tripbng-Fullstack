import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import {
  BOOKING_STATUS,
  PAX_TYPE,
  PAYMENT_MODE,
  PAYMENT_STATUS,
  TRAVEL_CLASS,
} from '@tripbng/shared';

const SegmentSubSchema = new Schema(
  {
    flightNumber: { type: String, required: true },
    airline: {
      code: { type: String, required: true },
      name: { type: String },
      logo: { type: String },
    },
    origin: {
      code: { type: String, required: true },
      terminal: { type: String },
      name: { type: String },
    },
    destination: {
      code: { type: String, required: true },
      terminal: { type: String },
      name: { type: String },
    },
    departure: { type: Date, required: true },
    arrival: { type: Date, required: true },
    duration: { type: Number, required: true },
    stopOver: { type: Number, default: 0 },
  },
  { _id: false },
);

const PassengerSubSchema = new Schema(
  {
    type: { type: String, enum: PAX_TYPE, required: true },
    title: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['M', 'F'] },
    nationality: { type: String },
    passport: {
      number: { type: String, select: false },
      expiry: { type: Date },
      issuingCountry: { type: String },
    },
    seatNumber: { type: String, default: null },
    mealPreference: { type: String, default: null },
    extraBaggage: {
      weight: { type: Number, default: null },
      price: { type: Number, default: null },
    },
    fareCategory: {
      type: String,
      enum: ['REGULAR', 'STUDENT', 'SENIOR', 'ARMED_FORCES', 'MEDICAL'],
      default: 'REGULAR',
    },
    ticketNumber: { type: String, default: null },
  },
  { _id: false },
);

const PricingTraceItemSubSchema = new Schema(
  {
    step: { type: String, required: true },
    ruleId: { type: String, default: null },
    ruleName: { type: String, default: null },
    beforePaise: { type: Number, required: true },
    afterPaise: { type: Number, required: true },
    deltaPaise: { type: Number, required: true },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const BookingSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    bookingCode: { type: String, required: true, unique: true, index: true },

    channel: {
      type: String,
      enum: ['ONLINE', 'OFFLINE', 'API'],
      required: true,
      index: true,
    },
    flowSubType: {
      type: String,
      enum: ['SERIES', 'LCC', 'FSC', 'HOLD', 'TICKET'],
      required: true,
    },
    productType: {
      type: String,
      enum: ['FLIGHT', 'HOTEL', 'BUS', 'VISA'],
      default: 'FLIGHT',
    },

    // Source link — Series bookings reference the inventory.
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', default: null, index: true },
    supplierCode: { type: String, required: true },
    supplierBookingRef: { type: String, default: null },

    pnr: { type: String, default: null, index: true },
    airlinePnr: { type: String, default: null },
    ticketNumbers: [{ type: String }],

    // Buyer hierarchy snapshot at booking time — preserves history if user/agency moves.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
    agencyCode: { type: String, required: true },
    agencyName: { type: String, required: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },
    bookedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    sector: { type: String, required: true },
    travelDate: { type: Date, required: true, index: true },
    returnDate: { type: Date, default: null },
    tripType: { type: String, enum: ['ONEWAY', 'ROUNDTRIP', 'MULTICITY'], required: true },
    travelClass: { type: String, enum: TRAVEL_CLASS, required: true },

    segments: { type: [SegmentSubSchema], default: [] },
    passengers: { type: [PassengerSubSchema], default: [] },

    contact: {
      email: { type: String, default: null },
      mobile: { type: String, default: null },
      countryCode: { type: String, default: '+91' },
    },
    gst: {
      number: { type: String, default: null },
      companyName: { type: String, default: null },
      address: { type: String, default: null },
    },

    // Pricing snapshot from the Phase 2 engine — frozen at booking time.
    pricing: {
      baseFarePaise: { type: Number, default: 0 },
      taxesPaise: { type: Number, default: 0 },
      policyAdjustmentPaise: { type: Number, default: 0 },
      platformMarkupPaise: { type: Number, default: 0 },
      distributorMarkupPaise: { type: Number, default: 0 },
      agencyMarkupPaise: { type: Number, default: 0 },
      discountPaise: { type: Number, default: 0 },
      gstPaise: { type: Number, default: 0 },
      grossAmountPaise: { type: Number, default: 0 },
      netToSupplierPaise: { type: Number, default: 0 },
      agencyPayablePaise: { type: Number, default: 0 },
      distributorEarningsPaise: { type: Number, default: 0 },
      platformEarningsPaise: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
    },
    pricingTrace: { type: [PricingTraceItemSubSchema], default: [] },

    // Seats consumed against the inventory (for series). Recovered on cancel.
    seatsConsumed: { type: Number, default: 0 },

    paymentMode: { type: String, enum: PAYMENT_MODE, default: null },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUS,
      default: 'PENDING',
      index: true,
    },
    walletDebitTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    walletRefundTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    status: {
      type: String,
      enum: BOOKING_STATUS,
      default: 'INITIATED',
      index: true,
    },

    initiatedAt: { type: Date, default: null },
    heldAt: { type: Date, default: null },
    ticketedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },

    /** Supplier-side cancellation reference (e.g. TBO ChangeRequestId).
     *  Set when adapter.cancel() succeeds; null when the supplier doesn't
     *  support cancel or the call failed (look in internalNotes for the
     *  failure trace). */
    supplierCancellationRef: { type: String, default: null },
    /** Last-known supplier cancellation status. Updates as the
     *  cancel-poll worker reconciles (PENDING → IN_PROGRESS → PROCESSED
     *  or REJECTED). PROCESSED = supplier confirmed refund credited
     *  on their side; REJECTED = ops needs to manually unwind. */
    supplierCancellationStatus: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'PROCESSED', 'REJECTED', 'FAILED', null],
      default: null,
    },
    /** Last poll timestamp — keeps the worker from spinning forever. */
    supplierCancellationLastPolledAt: { type: Date, default: null },

    internalNotes: { type: String, default: null },
    customerNotes: { type: String, default: null },

    /** Brand fare name snapshotted from inventory at booking time. Per the
     *  ticket spec: NEVER read live from Inventory at render time. */
    fareName: { type: String, required: true, default: 'SkySaver' },
    fareNameDescription: { type: String, default: '' },

    /** Premium e-ticket template state (spec §2.2). The bannerSnapshot is
     *  captured at the moment of first ticket generation so re-downloads of
     *  the same booking always render the same banner — even if the admin
     *  later edits or pauses it. */
    ticketTemplate: {
      templateVersion: { type: String, default: 'v1' },
      bannerSnapshot: {
        bannerId: { type: Schema.Types.ObjectId, ref: 'Banner', default: null },
        imageUrl: { type: String, default: null },
        href: { type: String, default: null },
        title: { type: String, default: null },
      },
      generatedAt: { type: Date, default: null },
    },

    // Idempotency key — repeat hold/confirm calls dedupe to the same booking. The unique
    // index uses a partial filter so null/undefined values don't collide (sparse alone
    // doesn't help here because we explicitly set null when no key is supplied).
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: true },
);

BookingSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
BookingSchema.index({ tenantId: 1, agencyId: 1, status: 1, travelDate: -1 });
BookingSchema.index({ tenantId: 1, distributorId: 1, status: 1, createdAt: -1 });
BookingSchema.index({ tenantId: 1, pnr: 1 });

export type BookingDoc = HydratedDocument<InferSchemaType<typeof BookingSchema>> & {
  _id: Types.ObjectId;
};

// Field-level encryption for PII. The plugin encrypts on save + decrypts on
// `toObject()`/`toJSON()`. Querying encrypted fields by plaintext does NOT
// match — if we ever need passport-lookup we'll add a deterministic
// `passport_search_hash` field alongside.
import { encryptedFields } from '../utils/field-encryption.js';
BookingSchema.plugin(encryptedFields, {
  paths: ['passengers.passport.number', 'gst.number'],
});

export const Booking: Model<BookingDoc> =
  (mongoose.models.Booking as Model<BookingDoc> | undefined) ??
  model<BookingDoc>('Booking', BookingSchema);
