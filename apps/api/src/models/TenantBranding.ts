// Per-tenant branding doc. One row per (tenantId, subjectKind,
// subjectId) — i.e. one row per Agency or Distributor in a given
// platform tenant. Looked up on every portal load + every document
// render, so the hot path is heavily cached upstream (60s Redis).

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { BRANDING_SUBJECT_KIND } from '@tripbng/shared';

const TenantBrandingSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** Which subject this branding belongs to — Agency or Distributor. */
    subjectKind: { type: String, enum: BRANDING_SUBJECT_KIND, required: true },
    /** Agency._id or Distributor._id. */
    subjectId: { type: Schema.Types.ObjectId, required: true, index: true },

    companyName: { type: String, required: true, trim: true, maxlength: 80 },

    /** Absolute filesystem path under STORAGE_ROOT. Never exposed to
     *  the wire — only used internally for cleanup + reads. */
    logoPath: { type: String, default: null },
    /** Absolute or absolute-from-root URL serving the logo via /static. */
    logoPublicUrl: { type: String, default: null },

    primaryColor: { type: String, required: true, lowercase: true },
    secondaryColor: { type: String, required: true, lowercase: true },
    primaryHoverColor: { type: String, required: true, lowercase: true },
    primaryForegroundColor: { type: String, required: true, lowercase: true },

    /** Soft visibility — when false, the resolver falls back to TripBng
     *  defaults without losing the saved customisation. */
    isActive: { type: Boolean, default: true, index: true },

    /** Last write — useful for cache-bust + audit context. */
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastResetBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastResetAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One branding doc per subject — guarantees idempotency on every PUT.
TenantBrandingSchema.index(
  { tenantId: 1, subjectKind: 1, subjectId: 1 },
  { unique: true },
);

export type TenantBrandingDoc = HydratedDocument<
  InferSchemaType<typeof TenantBrandingSchema>
> & { _id: Types.ObjectId };

export const TenantBranding: Model<TenantBrandingDoc> =
  (mongoose.models.TenantBranding as Model<TenantBrandingDoc> | undefined) ??
  model<TenantBrandingDoc>('TenantBranding', TenantBrandingSchema);
