// Holiday booking aggregate.
//
// Distinct from Booking (flights) and HotelBooking — holidays are packaged
// multi-night, multi-city itineraries with pax-and-sharing-based pricing,
// not per-segment fares or per-night room rates. The status machine is a
// trimmed version of the hotel one (no PreBook/Voucher cycle since the
// itinerary is fully built by the time the user clicks Book).
//
// Lifecycle:
//   DRAFT      — quote captured but not committed
//   CONFIRMED  — wallet debited, holiday confirmed (mock supplier path)
//   CANCEL_REQUESTED — agent initiated cancel, refund in flight
//   CANCELLED  — terminal, refund credited
//   BOOK_FAILED — wallet debit or downstream call failed; booking shell kept for audit

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const HOLIDAY_BOOKING_STATUS = [
  'DRAFT',
  'CONFIRMED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'BOOK_FAILED',
] as const;
export type HolidayBookingStatus = (typeof HOLIDAY_BOOKING_STATUS)[number];

const HolidayBookingSchema = new Schema(
  {
    bookingCode: { type: String, default: null, index: true, unique: true, sparse: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },
    bookedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Package snapshot (denormalized so the booking is self-describing even
    // if the underlying HolidayPackageDoc is edited or unpublished later).
    packageId: { type: String, required: true, index: true },
    packageTitle: { type: String, required: true },
    destination: { type: String, default: null },
    themeLabel: { type: String, default: null },
    heroImage: { type: String, default: null },
    nights: { type: Number, required: true, min: 1 },

    // Trip dates
    departureDate: { type: Date, required: true, index: true },
    /** Computed = departureDate + nights. Stored for the bookings-list "Travel" column. */
    returnDate: { type: Date, required: true },
    departureCity: { type: String, default: null },

    // Pax + sharing
    sharingType: {
      type: String,
      enum: ['single', 'double', 'triple'],
      default: 'double',
    },
    adults: { type: Number, default: 2, min: 0 },
    childrenWithBed: { type: Number, default: 0, min: 0 },
    childrenWithoutBed: { type: Number, default: 0, min: 0 },

    // Travellers (lead first, isLead flag set on it)
    travellers: {
      type: [
        {
          title: { type: String, enum: ['Mr', 'Mrs', 'Miss', 'Ms'] },
          firstName: { type: String },
          lastName: { type: String },
          paxType: { type: String, enum: ['Adult', 'Child'], default: 'Adult' },
          isLeadPassenger: { type: Boolean, default: false },
          email: { type: String, default: null },
          phone: { type: String, default: null },
        },
      ],
      default: [],
    },

    // Money — all paise.
    currency: { type: String, default: 'INR' },
    pricing: {
      perAdultPaise: { type: Number, default: 0 },
      perChildBedPaise: { type: Number, default: 0 },
      perChildNoBedPaise: { type: Number, default: 0 },
      subtotalPaise: { type: Number, default: 0 },
      gstPaise: { type: Number, default: 0 },
      totalPaise: { type: Number, default: 0 },
    },

    // Optional GST profile.
    gst: {
      gstin: { type: String, default: null },
      companyName: { type: String, default: null },
      companyAddress: { type: String, default: null },
    },

    // Supplier — mock for now; real OTA / consolidator wiring lands later.
    supplier: { type: String, enum: ['MOCK', 'TBO', 'CUSTOM'], default: 'MOCK' },
    supplierRefs: {
      bookingCode: { type: String, default: null },
      confirmationNo: { type: String, default: null, index: true },
    },

    // State machine
    status: {
      type: String,
      enum: HOLIDAY_BOOKING_STATUS,
      default: 'DRAFT',
      index: true,
    },
    statusHistory: {
      type: [
        {
          status: { type: String, enum: HOLIDAY_BOOKING_STATUS, required: true },
          at: { type: Date, default: () => new Date() },
          by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          note: { type: String, default: null },
        },
      ],
      default: [],
    },

    confirmedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

HolidayBookingSchema.index({ tenantId: 1, agencyId: 1, status: 1, departureDate: -1 });

export type HolidayBookingDoc = HydratedDocument<InferSchemaType<typeof HolidayBookingSchema>> & {
  _id: Types.ObjectId;
};

export const HolidayBooking: Model<HolidayBookingDoc> =
  (mongoose.models.HolidayBooking as Model<HolidayBookingDoc> | undefined) ??
  model<HolidayBookingDoc>('HolidayBooking', HolidayBookingSchema);
