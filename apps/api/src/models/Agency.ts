import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import {
  AGENCY_BLOCK_REASON,
  AGENCY_MODULE,
  AGENCY_STATUS,
  DEDUCTEE_CATEGORY,
} from '@tripbng/shared';

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

    // ───────── Agency-wallet module config (Phase-1 step 4) ─────────
    //
    // `module` is the mutually-exclusive billing/pricing tier per spec §0.
    // Default 'CASH' so existing rows are behaviourally unchanged — only
    // explicit admin assignment switches an agency into CREDIT/DI/etc.
    // The `paymentMethods` flags above are kept for back-compat with current
    // booking-flow code; once `module` is fully wired, they'll be derived
    // from it (see gap-analysis Conflict — paymentMethods consolidation).
    module: { type: String, enum: AGENCY_MODULE, default: 'CASH', index: true },

    // Sub-agent → distributor parent. Null for everything except module=SUB_AGENT.
    // We do NOT migrate the existing `distributorId` reference here — both
    // co-exist during the transition (gap-analysis Conflict 2 deferred).
    parentAgencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },

    // Denormalised booking-gate flags. Recomputed by the hourly cron + on every
    // ledger write so the booking flow can check a single boolean without
    // re-evaluating credit limits / expiries / due dates inline.
    bookingBlocked: { type: Boolean, default: false, index: true },
    blockReason: { type: String, enum: AGENCY_BLOCK_REASON, default: null },

    // Credit-module fields (only meaningful when module='CREDIT'). Null on
    // any non-credit agency. Spec §6.1 + §3.6.
    creditExpiryDate: { type: Date, default: null },
    creditDueDate: { type: Date, default: null, index: true },
    blockOnDueDateCross: { type: Boolean, default: false },

    managementFee: { type: Number, default: 0 },
    manageMarkup: { type: Number, default: 0 },

    status: { type: String, enum: AGENCY_STATUS, default: 'PENDING', index: true },
    // Legacy free-text — superseded by `blockReason` enum above. Kept so we
    // don't break existing UI strings; new code should write `blockReason`.
    blockedReason: { type: String, default: null },

    pan: {
      number: { type: String, select: false },
      // Legal name exactly as it appears on the PAN card. Different from
      // `companyName` (the trading/display name). Form 16A + Form 26Q both
      // require the on-PAN name verbatim — mismatches with the IT-dept
      // master cause the deductee row to be rejected at FVU validation.
      name: { type: String },
      imageUrl: { type: String },
      // Deductee classification for Form 26Q + 16A. Drives the NSDL
      // `deductee_code` field (1=Individual, 3=Company, 4=Firm/LLP, …).
      // Required before any TDS-bearing payout (incentive credit) can post
      // — the DI-incentive worker should refuse to deduct TDS if missing.
      deducteeCategory: {
        type: String,
        enum: DEDUCTEE_CATEGORY,
        default: null,
      },
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
// Sub-agent fan-out: distributor portal "my sub-agents" list. Sparse because
// only SUB_AGENT rows have it set.
AgencySchema.index({ tenantId: 1, parentAgencyId: 1 }, { sparse: true });
// Hourly recompute cron query: "all CREDIT agencies whose due date crossed
// today" — the compound index supports both filters with a single scan.
AgencySchema.index({ module: 1, creditDueDate: 1 }, { sparse: true });

export type AgencyDoc = HydratedDocument<InferSchemaType<typeof AgencySchema>> & {
  _id: Types.ObjectId;
};
export const Agency: Model<AgencyDoc> =
  (mongoose.models.Agency as Model<AgencyDoc> | undefined) ??
  model<AgencyDoc>('Agency', AgencySchema);
