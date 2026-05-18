// InsurancePolicyEvent — non-negotiable audit log for every transactional ASEGO
// call (validate / issue / endorse / cancel). PII is redacted from the snapshots
// before write so logs + DB stay safe to share with support. This is the only
// debugging surface when ASEGO support asks "what did you send?".

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const InsurancePolicyEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** Policy number — null for events that fail before a policy number is assigned
     *  (e.g. validate calls, or issue calls that ASEGO rejects). */
    policyNumber: { type: String, default: null, index: true },

    /** orderId we sent — present even when policyNumber is null so failures are
     *  still pinnable to a specific call. */
    orderId: { type: String, required: true, index: true },

    eventType: {
      type: String,
      enum: ['VALIDATE', 'ISSUE', 'ENDORSE', 'CANCEL'],
      required: true,
    },

    /** Redacted request payload. */
    request: { type: Schema.Types.Mixed, required: true },
    /** Full response (or null on transport failure). */
    response: { type: Schema.Types.Mixed, default: null },

    asegoStatusCode: { type: Number, default: null },
    errorCode: { type: String, default: null },
    errorMsg: { type: String, default: null },

    /** Round-trip latency ms — useful for spotting slow ASEGO regressions. */
    durationMs: { type: Number, default: null },

    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

InsurancePolicyEventSchema.index({ tenantId: 1, eventType: 1, createdAt: -1 });

export type InsurancePolicyEventDoc = HydratedDocument<
  InferSchemaType<typeof InsurancePolicyEventSchema>
> & { _id: Types.ObjectId };

export const InsurancePolicyEvent: Model<InsurancePolicyEventDoc> =
  (mongoose.models.InsurancePolicyEvent as Model<InsurancePolicyEventDoc> | undefined) ??
  model<InsurancePolicyEventDoc>('InsurancePolicyEvent', InsurancePolicyEventSchema);
