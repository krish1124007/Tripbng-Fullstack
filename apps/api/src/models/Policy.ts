import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const PolicySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },

    commissionPercent: { type: Number, default: 0, min: 0, max: 10000 },
    managementFeePaise: { type: Number, default: 0, min: 0 },
    b2bMarkupPaise: { type: Number, default: 0, min: 0 },
    gstOnMarkupOnly: { type: Boolean, default: false },
    gstRateBasisPoints: { type: Number, default: 1800, min: 0, max: 10000 },

    notes: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

PolicySchema.index({ tenantId: 1, name: 1 });

export type PolicyDoc = HydratedDocument<InferSchemaType<typeof PolicySchema>> & {
  _id: Types.ObjectId;
};
export const Policy: Model<PolicyDoc> =
  (mongoose.models.Policy as Model<PolicyDoc> | undefined) ??
  model<PolicyDoc>('Policy', PolicySchema);
