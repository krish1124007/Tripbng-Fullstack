// PendingAdjustment — staging row for two-person approval on manual wallet
// adjustments (spec §7). One row per pending request; on APPROVED status,
// the second admin's approval triggers the actual ledger entry via
// `adjustWallet`. REJECTED + CANCELLED are terminal no-op states.
//
// Threshold gating
//   `services/wallet/adjust-approval.service.ts` decides whether an
//   inbound adjustment goes through this staging path or executes
//   directly. Above `WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_PAISE` lands
//   here; below executes inline. Snapshotted on the row so a later
//   threshold change doesn't reinterpret pending rows.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const PendingAdjustmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // Wallet owner — exactly one of agencyId / distributorId is set
    // (matches the existing adjustWallet API). Pre-validate hook enforces it.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: {
      type: Schema.Types.ObjectId,
      ref: 'Distributor',
      default: null,
      index: true,
    },

    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, minlength: 3, maxlength: 1000 },

    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
      required: true,
      default: 'PENDING_APPROVAL',
      index: true,
    },

    proposedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    proposedAt: { type: Date, default: () => new Date() },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },

    /** Set when status=APPROVED — the WalletTransaction _id that the
     *  ledger service produced. Lets the admin UI link directly to the
     *  resulting ledger row. */
    ledgerTxnId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },

    /** Snapshotted at create time so a config change doesn't reinterpret
     *  pending rows. Audit + filtering convenience. */
    thresholdAtTime: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Pending queue scan — admin dashboard hits this constantly.
PendingAdjustmentSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

PendingAdjustmentSchema.pre('validate', function (next) {
  const ownerCount = [this.agencyId, this.distributorId].filter(Boolean).length;
  if (ownerCount !== 1) {
    return next(new Error('PendingAdjustment must have exactly one owner (agencyId XOR distributorId)'));
  }
  next();
});

export type PendingAdjustmentDoc = HydratedDocument<
  InferSchemaType<typeof PendingAdjustmentSchema>
> & { _id: Types.ObjectId };

export const PendingAdjustment: Model<PendingAdjustmentDoc> =
  (mongoose.models.PendingAdjustment as Model<PendingAdjustmentDoc> | undefined) ??
  model<PendingAdjustmentDoc>('PendingAdjustment', PendingAdjustmentSchema);
