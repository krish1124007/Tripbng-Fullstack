// Visa booking aggregate.
//
// Distinct from Booking (flights), HotelBooking, and HolidayBooking.
// Visa applications are per-applicant with a document-upload workflow and a
// state machine that maps closely to embassy lifecycle (created → docs
// submitted → lodged → granted/rejected). We collapse the lifecycle into a
// simpler booking-level enum for the unified bookings UI — the per-applicant
// document state lives on applicants[] when we ship the upload portal.
//
// Lifecycle:
//   DRAFT       — quote captured, not yet committed
//   CONFIRMED   — wallet debited, application accepted, docs collection in flight
//   IN_PROCESS  — docs submitted to embassy / e-Visa portal
//   GRANTED     — terminal success (visa issued)
//   REJECTED    — embassy refused
//   CANCEL_REQUESTED — agent initiated cancel
//   CANCELLED   — refund credited
//   BOOK_FAILED — wallet debit or downstream call failed

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const VISA_BOOKING_STATUS = [
  'DRAFT',
  'CONFIRMED',
  'IN_PROCESS',
  'GRANTED',
  'REJECTED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'BOOK_FAILED',
] as const;
export type VisaBookingStatus = (typeof VISA_BOOKING_STATUS)[number];

const VisaBookingSchema = new Schema(
  {
    bookingCode: { type: String, default: null, index: true, unique: true, sparse: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },
    bookedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Product snapshot (denormalized so the booking is self-describing even
    // if the source VisaProductDoc is edited/unpublished later).
    productId: { type: String, required: true, index: true },
    productName: { type: String, required: true },
    countryId: { type: String, default: null },
    countryName: { type: String, default: null },
    countryIso2: { type: String, default: null },
    region: { type: String, default: null },
    purpose: { type: String, default: 'tourist' },
    processingMode: { type: String, default: 'e-visa' },
    entryType: { type: String, default: 'single' },
    validityDays: { type: Number, default: 30 },
    stayDays: { type: Number, default: 30 },
    processingDays: { type: Number, default: 7 },
    bannerImage: { type: String, default: null },

    // When the user expects to travel — used as the "Travel" column on the
    // unified bookings list. Optional; falls back to createdAt+processingDays.
    expectedTravelDate: { type: Date, default: null, index: true },

    urgent: { type: Boolean, default: false },

    // Applicants (lead first, isLead flag set on it).
    applicants: {
      type: [
        {
          title: { type: String, enum: ['Mr', 'Mrs', 'Miss', 'Ms', 'Mstr'] },
          firstName: { type: String },
          lastName: { type: String },
          paxType: { type: String, enum: ['ADT', 'CHD', 'INF'], default: 'ADT' },
          isLeadPassenger: { type: Boolean, default: false },
          email: { type: String, default: null },
          phone: { type: String, default: null },
          nationality: { type: String, default: 'IN' },
          passportNumber: { type: String, default: null, select: false },
          passportExpiry: { type: Date, default: null },
        },
      ],
      default: [],
    },

    // Money — all paise.
    currency: { type: String, default: 'INR' },
    pricing: {
      consulateFeePaise: { type: Number, default: 0 },
      serviceFeePaise: { type: Number, default: 0 },
      urgentSurchargePaise: { type: Number, default: 0 },
      perApplicantPaise: { type: Number, default: 0 },
      applicants: { type: Number, default: 1 },
      subtotalPaise: { type: Number, default: 0 },
      gstPaise: { type: Number, default: 0 },
      totalPaise: { type: Number, default: 0 },
    },

    gst: {
      gstin: { type: String, default: null },
      companyName: { type: String, default: null },
      companyAddress: { type: String, default: null },
    },

    supplier: { type: String, enum: ['MOCK', 'VFS', 'EMBASSY', 'CUSTOM'], default: 'MOCK' },
    supplierRefs: {
      applicationNo: { type: String, default: null, index: true },
      portalRef: { type: String, default: null },
    },

    status: { type: String, enum: VISA_BOOKING_STATUS, default: 'DRAFT', index: true },
    statusHistory: {
      type: [
        {
          status: { type: String, enum: VISA_BOOKING_STATUS, required: true },
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

VisaBookingSchema.index({ tenantId: 1, agencyId: 1, status: 1, createdAt: -1 });

export type VisaBookingDoc = HydratedDocument<InferSchemaType<typeof VisaBookingSchema>> & {
  _id: Types.ObjectId;
};

export const VisaBooking: Model<VisaBookingDoc> =
  (mongoose.models.VisaBooking as Model<VisaBookingDoc> | undefined) ??
  model<VisaBookingDoc>('VisaBooking', VisaBookingSchema);
