// PartnerInquiry — public submission from /apply on the marketing site.
//
// New agencies and distributors don't sign up directly — they file an
// inquiry which lands in the admin queue. Ops reviews, runs KYC, and
// then provisions an account. The inquiry record is the audit trail
// for the onboarding pipeline.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const PartnerInquirySchema = new Schema(
  {
    /** AGENCY or DISTRIBUTOR — drives which onboarding queue picks it up. */
    type: { type: String, enum: ['AGENCY', 'DISTRIBUTOR'], required: true, index: true },
    /** Legal / trading name of the firm. */
    companyName: { type: String, required: true, trim: true },
    /** Authorised signatory / point of contact. */
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    mobile: { type: String, required: true, trim: true },
    /** City + state — used by the partnerships team for regional routing. */
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    /** Optional GSTIN — speeds up KYC when present. */
    gstin: { type: String, default: '' },
    /** Self-reported scale signal (1–10 staff, 11–50, 50+). */
    sizeBand: { type: String, default: '' },
    /** Free-text — anything the applicant wants ops to see up front. */
    message: { type: String, default: '' },

    status: {
      type: String,
      enum: ['NEW', 'CONTACTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SPAM'],
      default: 'NEW',
      index: true,
    },
    /** Set when ops starts working it — useful for assignment dashboards. */
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: [
      {
        at: { type: Date, default: () => new Date() },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        note: { type: String },
      },
    ],

    /** Forensics — IP + UA captured at submission for spam filtering. */
    sourceIp: { type: String, default: null },
    sourceUserAgent: { type: String, default: null },
  },
  { timestamps: true },
);

PartnerInquirySchema.index({ status: 1, createdAt: -1 });

export type PartnerInquiryDoc = HydratedDocument<
  InferSchemaType<typeof PartnerInquirySchema>
> & { _id: Types.ObjectId };

export const PartnerInquiry: Model<PartnerInquiryDoc> =
  (mongoose.models.PartnerInquiry as Model<PartnerInquiryDoc> | undefined) ??
  model<PartnerInquiryDoc>('PartnerInquiry', PartnerInquirySchema);
