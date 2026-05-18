import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { WALLET_TXN_TYPE } from '@tripbng/shared';

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

    // Balance snapshot post-this-txn — written by the ledger service from atomic $inc result.
    // Allows reconciliation by replaying transactions in createdAt order.
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
