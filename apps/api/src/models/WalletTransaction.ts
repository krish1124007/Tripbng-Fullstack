import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { WALLET_TXN_BUCKET, WALLET_TXN_TYPE } from '@tripbng/shared';

const WalletTransactionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    txnId: { type: String, required: true, unique: true, index: true },

    // Who initiated.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Which wallet was affected — exactly one of these is set.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    type: { type: String, enum: WALLET_TXN_TYPE, required: true, index: true },
    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    // Spec §3.1: wallet and credit are NEVER co-mingled in a single ledger
    // entry. Each row touches exactly one bucket. Default 'WALLET' so legacy
    // rows backfill consistently — the only bucket the old code wrote to.
    bucket: { type: String, enum: WALLET_TXN_BUCKET, default: 'WALLET', index: true },

    // Balance snapshot pre/post-this-txn — written by the ledger service from
    // atomic $inc result. Pre is added in Phase-1 step 5 (additive), so legacy
    // rows will have `balanceBefore === null`; the integrity-check cron (step 8)
    // tolerates this.
    balanceBefore: { type: Number, default: null },
    balanceAfter: { type: Number, required: true },

    // References.
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    topupRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'TopupRequest',
      default: null,
      index: true,
    },
    amendmentId: { type: Schema.Types.ObjectId, ref: 'Amendment', default: null },
    relatedTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    // Payment-gateway reference for idempotent webhook handling. Sparse-unique
    // index below — only DEPOSIT-shaped txns set this, and the same `pgRef`
    // can never produce two ledger rows (spec §10 idempotency).
    pgReferenceId: { type: String, default: null },

    description: { type: String, default: null },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ipAddress: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

WalletTransactionSchema.index({ tenantId: 1, agencyId: 1, createdAt: -1 });
WalletTransactionSchema.index({ tenantId: 1, distributorId: 1, createdAt: -1 });
WalletTransactionSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
// Webhook-idempotency dedupe — same gateway txn id cannot post two ledger
// rows IN THE SAME BUCKET. The unique index is compound on (pgReferenceId,
// bucket) because the waterfall (spec §3.1) intentionally splits one
// deposit into two rows when CREDIT settles a portion and the surplus tops
// up the wallet — one CREDIT-bucket row + one WALLET-bucket row, both
// sharing the gateway reference. The compound key still prevents
// double-application of either leg.
//
// We use a `partialFilterExpression` (not `sparse: true`) because the
// field defaults to `null` for non-deposit rows, and sparse indexes only
// skip MISSING fields — they still index explicit `null` values, which
// causes E11000 duplicates on the second null row. The partial expression
// only indexes documents where pgReferenceId is actually a string.
WalletTransactionSchema.index(
  { pgReferenceId: 1, bucket: 1 },
  { unique: true, partialFilterExpression: { pgReferenceId: { $type: 'string' } } },
);
// Bucket-aware ledger scans — credit-exposure report and waterfall reverse-search.
WalletTransactionSchema.index({ tenantId: 1, agencyId: 1, bucket: 1, createdAt: -1 });

// Spec §5.2.5 — wallet transactions are immutable. Saving an already-persisted record is an error.
WalletTransactionSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Wallet transactions are immutable'));
  next();
});
// Block any update/findOneAndUpdate paths defensively too.
['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((op) => {
  WalletTransactionSchema.pre(op as 'findOneAndUpdate', function (next) {
    next(new Error('Wallet transactions are immutable'));
  });
});

export type WalletTransactionDoc = HydratedDocument<
  InferSchemaType<typeof WalletTransactionSchema>
> & {
  _id: Types.ObjectId;
};
export const WalletTransaction: Model<WalletTransactionDoc> =
  (mongoose.models.WalletTransaction as Model<WalletTransactionDoc> | undefined) ??
  model<WalletTransactionDoc>('WalletTransaction', WalletTransactionSchema);
