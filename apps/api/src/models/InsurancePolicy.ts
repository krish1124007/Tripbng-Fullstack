// InsurancePolicy — every issued ASEGO policy persisted in our own Mongo so
// booking history works even when ASEGO is unreachable. The full request +
// response snapshots are kept for support / audit; PII (passport, mobile,
// email) is intentionally NOT redacted here because this is the system of
// record — redaction happens at the audit log layer (InsurancePolicyEvent)
// before we hand bodies to the logger.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const InsurancePolicySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** TripBng booking id when this insurance is attached to a flight booking. Optional —
     *  insurance can also be sold standalone before a booking exists. */
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },

    /** orderId we sent to ASEGO as identity.orderId. Used for ASEGO's natural
     *  dedup (a retry with the same orderId returns 400 "Duplicate Record Found"). */
    orderId: { type: String, required: true, index: true },

    /** Policy number returned by ASEGO. Unique within our tenant. */
    policyNumber: { type: String, required: true, index: true },

    /** Path/URL ASEGO returned for the PDF. We proxy /download against this on demand. */
    policyFilePath: { type: String, default: null },

    status: {
      type: String,
      enum: ['ISSUED', 'ENDORSED', 'CANCELLED'],
      default: 'ISSUED',
      index: true,
    },

    insurerId: { type: String, required: true },
    insurerName: { type: String, default: null },
    planId: { type: String, required: true },
    planName: { type: String, default: null },
    sellingPlanId: { type: String, required: true },

    /** Snapshot of what we sent + received at issuance. Free-form so we can adapt
     *  to ASEGO contract changes without a migration. */
    travelerSnapshot: { type: Schema.Types.Mixed, required: true },
    quotationSnapshot: { type: Schema.Types.Mixed, required: true },
    selectedPlanSnapshot: { type: Schema.Types.Mixed, required: true },

    totalPremiumPaise: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    /** Endorsement / cancellation references — populated on lifecycle ops. */
    endorsedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationRefund: { type: Number, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One policy per orderId per tenant — guarantees idempotency at the DB level.
InsurancePolicySchema.index({ tenantId: 1, orderId: 1 }, { unique: true });
InsurancePolicySchema.index({ tenantId: 1, policyNumber: 1 }, { unique: true });

export type InsurancePolicyDoc = HydratedDocument<InferSchemaType<typeof InsurancePolicySchema>> & {
  _id: Types.ObjectId;
};
export const InsurancePolicy: Model<InsurancePolicyDoc> =
  (mongoose.models.InsurancePolicy as Model<InsurancePolicyDoc> | undefined) ??
  model<InsurancePolicyDoc>('InsurancePolicy', InsurancePolicySchema);
