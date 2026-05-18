// GstProfile — captures one GSTIN under a tenant.
//
// Why a separate collection (vs. inlining on Tenant):
//   - One tenant can legitimately have many GSTINs (multi-state India ops).
//   - The booking flow needs to attach a chosen GST profile per booking,
//     not just the tenant default — different cost centres / branches
//     reconcile against different state GSTINs.
//   - Audit-friendly: GST profile changes are first-class entities so
//     finance can see "GSTIN X was added on date Y by user Z" without
//     diffing the tenant document.
//
// Validation: GSTIN format is enforced at the Zod schema layer
// (packages/shared/src/schemas/common.ts → GstinSchema). The model only
// enforces required + uniqueness so a malformed value never lands here.
//
// `isDefault` is the resolution fallback when a booking doesn't pick a
// specific profile. Exactly one profile per tenant should be default —
// the service layer enforces that on write (atomic flip via $set).

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const GstProfileSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** Legal registration name as it appears on the GST certificate. */
    registrationName: { type: String, required: true, trim: true },
    /** 15-char GSTIN. Format-validated by Zod before reaching the DB. */
    gstin: { type: String, required: true, uppercase: true, trim: true },

    /** Address printed on tax invoices issued to this profile. */
    address: { type: String, required: true, trim: true },
    /** State (e.g. "Karnataka") — must match the GSTIN's state code
     *  prefix. Service layer cross-checks. */
    state: { type: String, required: true, trim: true },
    /** Notification email — invoice PDFs go here. */
    email: { type: String, required: true, lowercase: true, trim: true },

    /** Default profile for this tenant. Booking service uses this when
     *  no explicit gstProfileId is supplied. Service layer maintains
     *  the "exactly one default" invariant on write. */
    isDefault: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// Per-tenant unique GSTIN — same number can't be registered twice under
// the same tenant. Different tenants can register the same GSTIN
// (parent-subsidiary arrangements) — that's allowed.
GstProfileSchema.index({ tenantId: 1, gstin: 1 }, { unique: true });

export type GstProfileDoc = HydratedDocument<InferSchemaType<typeof GstProfileSchema>> & {
  _id: Types.ObjectId;
};
export type GstProfileModel = Model<InferSchemaType<typeof GstProfileSchema>>;
// Guard against double-registration (vitest module-isolation under vi.mock).
export const GstProfile: GstProfileModel =
  (mongoose.models.GstProfile as GstProfileModel | undefined) ??
  model<InferSchemaType<typeof GstProfileSchema>>('GstProfile', GstProfileSchema);
