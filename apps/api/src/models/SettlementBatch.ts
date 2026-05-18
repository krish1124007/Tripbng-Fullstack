// SettlementBatch — daily reconciliation envelope. Spec §3.5 + §8.
//
// Each row is one (provider, batchDate) tuple. Created when admin uploads the
// gateway's settlement CSV (or a future API pulls it). Reconciliation runs
// against this batch — match each gateway row to a PaymentTransaction by
// gatewayTxnId, flag mismatches.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PAYMENT_PROVIDER } from './PaymentTransaction.js';

const SettlementBatchSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    providerCode: { type: String, enum: PAYMENT_PROVIDER, required: true, index: true },
    batchDate: { type: Date, required: true, index: true },

    // Totals (paise).
    totalGrossAmount: { type: Number, default: 0 },
    totalMdrAmount: { type: Number, default: 0 },
    totalGstAmount: { type: Number, default: 0 },
    totalNetAmount: { type: Number, default: 0 },

    expectedTransactionCount: { type: Number, default: 0 },
    actualTransactionCount: { type: Number, default: 0 },
    reconciledCount: { type: Number, default: 0 },
    discrepancyCount: { type: Number, default: 0 },

    // Bank confirmation — admin enters during recon.
    bankUtr: { type: String, default: null },
    bankCreditedAt: { type: Date, default: null },
    bankCreditedAmount: { type: Number, default: null },

    status: {
      type: String,
      enum: ['EXPECTED', 'RECEIVED', 'RECONCILED', 'DISCREPANT'],
      default: 'EXPECTED',
      index: true,
    },

    csvUrl: { type: String, default: null },
    reconciledByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reconciledAt: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true },
);

SettlementBatchSchema.index({ tenantId: 1, providerCode: 1, batchDate: 1 }, { unique: true });

export type SettlementBatchDoc = HydratedDocument<InferSchemaType<typeof SettlementBatchSchema>> & {
  _id: Types.ObjectId;
};
export const SettlementBatch: Model<SettlementBatchDoc> =
  (mongoose.models.SettlementBatch as Model<SettlementBatchDoc> | undefined) ??
  model<SettlementBatchDoc>('SettlementBatch', SettlementBatchSchema);
