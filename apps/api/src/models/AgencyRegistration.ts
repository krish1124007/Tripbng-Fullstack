// AgencyRegistration — full multi-step sign-up document.
//
// Why this exists (vs the simpler PartnerInquiry): the marketing /apply
// form just collects an expression-of-interest. /register is the full
// KYC flow — Aadhar, PAN, GST, mobile + email OTP — and lands in admin
// for approval. Approval provisions an Agency + a User account; the
// applicant gets an email with their temp password.
//
// Verification is opportunistic: each field has its own `Verified`
// boolean + `VerifiedAt` timestamp. We stamp them as the third-party
// provider returns success (or as soon as we accept manual verification
// for the dev stubs). The admin queue surfaces unverified fields so the
// reviewer can flag them.
//
// Status workflow:
//   DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED   (→ Agency + User created)
//                                    ↘ REJECTED  (with reason)
//                                    ↘ NEEDS_INFO (back to applicant)
//   CANCELLED (applicant withdrew)

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const REGISTRATION_STATUS = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_INFO',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

const AgencyRegistrationSchema = new Schema(
  {
    // ─── Lifecycle ───
    status: {
      type: String,
      enum: REGISTRATION_STATUS,
      default: 'DRAFT',
      index: true,
    },
    /** Human-readable application code, e.g. "REG-A8K3X9". Generated at
     *  create time. Surfaces in admin + email confirmations. */
    applicationCode: { type: String, unique: true, sparse: true, uppercase: true, index: true },

    // ─── Agent type / org ───
    agentType: { type: String, enum: ['RETAILER', 'CORPORATE', 'TMC', 'OTHER'], default: 'RETAILER' },
    companyName: { type: String, required: true, trim: true },
    companyType: { type: String, enum: ['PROPRIETOR', 'PARTNER', 'COMPANY_LLP'], default: 'PROPRIETOR' },

    // ─── Company contacts (each verifiable independently) ───
    mobileCountryCode: { type: String, default: '+91' },
    mobile: { type: String, required: true, trim: true },
    mobileVerified: { type: Boolean, default: false, index: true },
    mobileVerifiedAt: { type: Date, default: null },

    whatsappCountryCode: { type: String, default: '+91' },
    whatsapp: { type: String, default: '', trim: true },
    whatsappVerified: { type: Boolean, default: false },
    whatsappVerifiedAt: { type: Date, default: null },
    whatsappSameAsMobile: { type: Boolean, default: false },

    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerifiedAt: { type: Date, default: null },

    // ─── Owner / authorised signatory ───
    ownerTitle: { type: String, enum: ['MR', 'MRS', 'MS', 'DR'], default: 'MR' },
    ownerFirstName: { type: String, default: '', trim: true },
    ownerLastName: { type: String, default: '', trim: true },
    ownerDob: { type: Date, default: null },

    // ─── PAN ───
    panNumber: { type: String, default: '', uppercase: true, trim: true },
    panVerified: { type: Boolean, default: false, index: true },
    panVerifiedAt: { type: Date, default: null },
    /** Vendor response payload for the PAN verification call — kept for
     *  audit / dispute. Free-form because Cashfree / Surepass / Karza
     *  shapes differ; we don't need uniform indexing here. */
    panVerificationProvider: { type: String, default: null },
    panVerificationRef: { type: String, default: null },
    panNameOnRecord: { type: String, default: '' },
    /** Inline image upload (data: URL) — same pattern as banners. */
    panDocUrl: { type: String, default: '' },

    // ─── Address ───
    addressLine1: { type: String, default: '' },
    addressLine2: { type: String, default: '' },
    addressLine3: { type: String, default: '' },
    country: { type: String, default: 'India' },
    state: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: { type: String, default: '' },

    // ─── Aadhar ───
    aadharNumber: { type: String, default: '', trim: true },
    aadharVerified: { type: Boolean, default: false, index: true },
    aadharVerifiedAt: { type: Date, default: null },
    aadharVerificationProvider: { type: String, default: null },
    aadharVerificationRef: { type: String, default: null },
    aadharNameOnRecord: { type: String, default: '' },

    // ─── GST (optional) ───
    gstNumber: { type: String, default: '', uppercase: true, trim: true },
    gstVerified: { type: Boolean, default: false },
    gstVerifiedAt: { type: Date, default: null },
    gstVerificationProvider: { type: String, default: null },
    gstLegalName: { type: String, default: '' },

    // ─── Referral / link ───
    /** Public referral code (matches Distributor.referralCode). If set
     *  and validated, the approved agency is auto-linked to that
     *  distributor's downline at provision time. */
    distributorCode: { type: String, default: '', uppercase: true, trim: true, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null },
    distributorVerifiedAt: { type: Date, default: null },
    /** Optional channel attribution. */
    salesRepCode: { type: String, default: '' },
    relationshipManagerCode: { type: String, default: '' },

    // ─── Consent + forensics ───
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date, default: null },
    submitIp: { type: String, default: null },
    submitUserAgent: { type: String, default: null },

    // ─── Submission + review ───
    submittedAt: { type: Date, default: null, index: true },
    reviewerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    /** Internal notes captured during review. Not visible to the applicant. */
    reviewNotes: [
      {
        at: { type: Date, default: () => new Date() },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        note: { type: String },
      },
    ],
    /** Applicant-visible reason on rejection / needs-info. */
    rejectionReason: { type: String, default: '' },
    /** On APPROVED: the Agency + User we provisioned. */
    provisionedAgencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null },
    provisionedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Indexes the admin queue queries against most often.
AgencyRegistrationSchema.index({ status: 1, submittedAt: -1 });
AgencyRegistrationSchema.index({ distributorId: 1, status: 1 });

export type AgencyRegistrationDoc = HydratedDocument<
  InferSchemaType<typeof AgencyRegistrationSchema>
> & { _id: Types.ObjectId };

export const AgencyRegistration: Model<AgencyRegistrationDoc> =
  (mongoose.models.AgencyRegistration as Model<AgencyRegistrationDoc> | undefined) ??
  model<AgencyRegistrationDoc>('AgencyRegistration', AgencyRegistrationSchema);
