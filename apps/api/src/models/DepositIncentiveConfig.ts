// DepositIncentiveConfig — per-agency DI module configuration (spec §2.5 +
// §6.2). One ACTIVE row per agency at a time; an `agencyId: null` row acts
// as the tenant-wide fallback used when no per-agency override exists.
//
// Why this is separate from the existing `Incentive` model:
//   The repo's `Incentive` collection is a tenant-wide *campaign* with
//   slabs (FLAT/PERCENT, validFrom/To, target=ALL/AGENCY_GROUP/...). The
//   spec's DI config is a *per-agency* policy that runs synchronously per
//   deposit and emits two ledger entries (INCENTIVE_CREDIT + TDS_DEDUCT).
//   They co-exist — campaigns can still drive promo-style payouts; this
//   model drives the DI module's primary economics.
//
// Basis points (bp) over percent strings:
//   `incentiveBasisPoints` and `tdsBasisPoints` are integer bp (1 bp =
//   0.01%, 100 bp = 1%, 200 bp = 2%). Matches the existing repo convention
//   (see formatPercentBasisPoints + Money.percentBasisPoints) and avoids
//   float-rounding traps in the storage layer.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const DepositIncentiveConfigSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // Per-agency policy. Null = tenant-wide fallback used when no per-agency
    // row matches. The resolution helper prefers agency-specific rows.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },

    isActive: { type: Boolean, default: true, index: true },

    // PERCENT: incentive = deposit * incentiveBasisPoints / 10_000.
    // ABSOLUTE: incentive = incentiveAbsolutePaise, ignoring deposit size
    //           (still subject to minDepositForIncentivePaise gate).
    incentiveMode: {
      type: String,
      enum: ['PERCENT', 'ABSOLUTE'],
      required: true,
      default: 'PERCENT',
    },
    incentiveBasisPoints: { type: Number, default: null, min: 0, max: 1_000_000 },
    incentiveAbsolutePaise: { type: Number, default: null, min: 0 },

    // Floor: deposits below this don't qualify for incentive. Null = no floor.
    minDepositForIncentivePaise: { type: Number, default: null, min: 0 },
    // Ceiling: cap incentive per deposit. Null = no cap.
    maxIncentivePerTxnPaise: { type: Number, default: null, min: 0 },

    // TDS withholding. When `tdsApplicable=true` the worker posts an extra
    // TDS_DEDUCT ledger row (bucket=WALLET, direction=DEBIT) immediately
    // after INCENTIVE_CREDIT, both inside the same Mongo transaction.
    tdsApplicable: { type: Boolean, default: true },
    tdsBasisPoints: { type: Number, default: 200, min: 0, max: 10_000 },

    // Validity window — config takes effect on validFrom and stops applying
    // after validTo (inclusive of both ends). `validTo: null` = open-ended.
    validFrom: { type: Date, default: () => new Date(), required: true },
    validTo: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Resolution scan: find active config for a tenant + agency in one query.
// Partial-unique on (tenantId, agencyId) for ACTIVE rows prevents two live
// configs for the same agency.
DepositIncentiveConfigSchema.index(
  { tenantId: 1, agencyId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

// Resolution prefers the per-agency row over the global default. Both
// candidates land in this index; the service picks by `agencyId != null`.
DepositIncentiveConfigSchema.index({ tenantId: 1, isActive: 1, validFrom: 1, validTo: 1 });

export type DepositIncentiveConfigDoc = HydratedDocument<
  InferSchemaType<typeof DepositIncentiveConfigSchema>
> & { _id: Types.ObjectId };

export const DepositIncentiveConfig: Model<DepositIncentiveConfigDoc> =
  (mongoose.models.DepositIncentiveConfig as Model<DepositIncentiveConfigDoc> | undefined) ??
  model<DepositIncentiveConfigDoc>('DepositIncentiveConfig', DepositIncentiveConfigSchema);
