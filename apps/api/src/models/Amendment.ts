import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { AMENDMENT_STATUS, AMENDMENT_TYPE } from '@tripbng/shared';

const AmendmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    amendmentCode: { type: String, required: true, unique: true, index: true },

    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    bookingCode: { type: String, required: true },

    type: { type: String, enum: AMENDMENT_TYPE, required: true, index: true },
    status: { type: String, enum: AMENDMENT_STATUS, default: 'REQUESTED', index: true },

    reason: { type: String, required: true },

    // Auto-computed at request time from the booking's fare rule. Approver may override.
    feePaise: { type: Number, default: 0 },
    refundPaise: { type: Number, default: 0 },

    reschedule: {
      oldTravelDate: { type: Date, default: null },
      newTravelDate: { type: Date, default: null },
      notes: { type: String, default: null },
    },

    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },
    approvalNotes: { type: String, default: null },

    refundTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    feeTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AmendmentSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
AmendmentSchema.index({ tenantId: 1, bookingId: 1 });

export type AmendmentDoc = HydratedDocument<InferSchemaType<typeof AmendmentSchema>> & {
  _id: Types.ObjectId;
};
export const Amendment: Model<AmendmentDoc> =
  (mongoose.models.Amendment as Model<AmendmentDoc> | undefined) ??
  model<AmendmentDoc>('Amendment', AmendmentSchema);
