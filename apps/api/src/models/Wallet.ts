// Wallet — derived/cached read model. Spec §3.1.
//
// `WalletTransaction` is the immutable ledger source-of-truth (see that
// model). This collection is a CACHE: `balance` etc. are written by the
// ledger service via $inc on every credit/debit, and rebuilt nightly from
// the ledger to detect drift. Direct writes from anywhere except WalletService
// are forbidden.
//
// Why a separate Wallet collection (vs. Agency.walletBalance):
//   - Distributors + the platform itself need wallets too (incentive payouts,
//     refund pools). One model per owner type forces a fan-out.
//   - Wallet status (FROZEN / CLOSED), block-balance for in-flight holds, and
//     credit-line tracking belong to the wallet, not to the owning entity.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const WalletSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // Owner — exactly one of these set, enforced by pre-validate hook.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true, sparse: true },
    distributorId: {
      type: Schema.Types.ObjectId,
      ref: 'Distributor',
      default: null,
      index: true,
      sparse: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true, sparse: true },

    walletCode: { type: String, required: true, unique: true, index: true },
    currency: { type: String, default: 'INR' },

    // All money in paise. Cached — REBUILT from WalletTransaction, never written
    // directly outside `WalletService`. `version` is the optimistic-lock token.
    balance: { type: Number, default: 0, min: 0 },
    blockedBalance: { type: Number, default: 0, min: 0 },
    creditLimit: { type: Number, default: 0, min: 0 },
    creditUsed: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 0 },

    // Stats (derived; cheap to update on every txn).
    lifetimeTopupAmount: { type: Number, default: 0 },
    lifetimeBookingAmount: { type: Number, default: 0 },
    lastTopupAt: { type: Date, default: null },
    lastTransactionAt: { type: Date, default: null },

    // Operational.
    status: { type: String, enum: ['ACTIVE', 'FROZEN', 'CLOSED'], default: 'ACTIVE', index: true },
    freezeReason: { type: String, default: null },
    frozenAt: { type: Date, default: null },
    frozenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Reconciliation drift detection — nightly cron compares ledger sum to balance.
    lastReconciledAt: { type: Date, default: null },
    lastReconciledBalance: { type: Number, default: null },

    // Settings.
    autoTopupEnabled: { type: Boolean, default: false },
    autoTopupThreshold: { type: Number, default: null },
    autoTopupAmount: { type: Number, default: null },
    lowBalanceAlertEnabled: { type: Boolean, default: true },
    lowBalanceThreshold: { type: Number, default: 100_000 }, // ₹1,000
  },
  { timestamps: true },
);

WalletSchema.index({ tenantId: 1, status: 1 });
WalletSchema.pre('validate', function (next) {
  const owners = [this.agencyId, this.distributorId, this.userId].filter(Boolean);
  if (owners.length !== 1) {
    return next(new Error('Wallet must have exactly one owner (agency, distributor, or user)'));
  }
  next();
});

export type WalletDoc = HydratedDocument<InferSchemaType<typeof WalletSchema>> & {
  _id: Types.ObjectId;
};
export const Wallet: Model<WalletDoc> =
  (mongoose.models.Wallet as Model<WalletDoc> | undefined) ?? model<WalletDoc>('Wallet', WalletSchema);
