import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PAYMENT_MODE, TOPUP_STATUS } from '@tripbng/shared';

const TopupRequestSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    amountPaise: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    paymentMode: { type: String, enum: PAYMENT_MODE, required: true },

    status: { type: String, enum: TOPUP_STATUS, default: 'PENDING', index: true },

    // Wallet that will be credited on approval — exactly one set.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },
    notes: { type: String, default: null },

    // Manual mode bookkeeping.
    referenceNumber: { type: String, default: null },
    proofUrl: { type: String, default: null },

    // Set on approval — link to the ledger entry we just posted.
    walletTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    // Set when the topup reaches a terminal state (APPROVED / REJECTED).
    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

TopupRequestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export type TopupRequestDoc = HydratedDocument<InferSchemaType<typeof TopupRequestSchema>> & {
  _id: Types.ObjectId;
};
export const TopupRequest: Model<TopupRequestDoc> =
  (mongoose.models.TopupRequest as Model<TopupRequestDoc> | undefined) ??
  model<TopupRequestDoc>('TopupRequest', TopupRequestSchema);
