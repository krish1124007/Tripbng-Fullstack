import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { AGENCY_STATUS } from '@tripbng/shared';

const AgencySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agencyCode: { type: String, required: true, unique: true, index: true },

    companyName: { type: String, required: true, trim: true },
    legalName: { type: String, default: null, trim: true },
    logo: { type: String, default: null },

    country: { type: String, default: 'IN' },
    state: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
    address: { type: String, required: true },

    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },
    agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],

    // Wallet balance is the projection of walletTransactions (paise units).
    // Never written directly except by the wallet service after a ledger insert.
    walletBalance: { type: Number, default: 0 },
    creditLimit: { type: Number, default: 0 },
    outstandingAmount: { type: Number, default: 0 },
    creditBalance: { type: Number, default: 0 },

    paymentMethods: {
      wallet: { type: Boolean, default: true },
      credit: { type: Boolean, default: false },
      deposit: { type: Boolean, default: false },
    },

    managementFee: { type: Number, default: 0 },
    manageMarkup: { type: Number, default: 0 },

    status: { type: String, enum: AGENCY_STATUS, default: 'PENDING', index: true },
    blockedReason: { type: String, default: null },

    pan: {
      number: { type: String, select: false },
      name: { type: String },
      imageUrl: { type: String },
    },
    gst: {
      number: { type: String },
      imageUrl: { type: String },
    },

    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // ───────── Corporate-account configuration (Phase 5) ─────────
    //
    // Hotel travel policies — drive the search-result filter + the book-time
    // approval gate. See packages/shared/src/schemas/corporate.ts for the
    // contract. Defaults (null/empty) are permissive: an agency that hasn't
    // configured policies has no restrictions.
    hotelPolicies: {
      maxPerNightPaise: { type: Number, default: null },
      refundableOnly: { type: Boolean, default: false },
      preferredChains: { type: [String], default: [] },
      blockedChains: { type: [String], default: [] },
      allowedStarRatings: { type: [Number], default: [] },
      requireApprovalAbovePaise: { type: Number, default: null },
      defaultApproverUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      markupPercent: { type: Number, default: null },
    },

    // Cost centres + GL codes — finance dropdowns surfaced at booking time.
    // Stored as embedded subdocs because they're small (typically <50 of each
    // per agency) and always read alongside the agency.
    costCentres: {
      type: [
        {
          code: { type: String, required: true },
          name: { type: String, required: true },
          isActive: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
    glCodes: {
      type: [
        {
          code: { type: String, required: true },
          name: { type: String, required: true },
          category: { type: String, default: null },
          isActive: { type: Boolean, default: true },
        },
      ],
      default: [],
    },

    paymentTerms: {
      type: String,
      enum: ['PREPAID', 'NET_7', 'NET_15', 'NET_30'],
      default: 'PREPAID',
    },

    // Per-agency alert routing — see packages/shared/src/schemas/notification.ts
    // for the contract. Embedded subdoc (not a separate collection) because
    // the data is tiny, always read alongside the agency, and mutates rarely.
    notificationPrefs: {
      channels: {
        email: { type: Boolean, default: true },
        whatsapp: { type: Boolean, default: true },
        inapp: { type: Boolean, default: true },
      },
      // Stored as Mixed because the keys are dynamic (one entry per
      // configurable AlertEvent). Validation lives at the Zod layer.
      events: { type: Schema.Types.Mixed, default: () => ({}) },
      lowBalanceThresholdPaise: { type: Number, default: null },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

AgencySchema.index({ tenantId: 1, distributorId: 1 });
AgencySchema.index({ tenantId: 1, status: 1 });

export type AgencyDoc = HydratedDocument<InferSchemaType<typeof AgencySchema>> & {
  _id: Types.ObjectId;
};
export const Agency: Model<AgencyDoc> =
  (mongoose.models.Agency as Model<AgencyDoc> | undefined) ??
  model<AgencyDoc>('Agency', AgencySchema);
