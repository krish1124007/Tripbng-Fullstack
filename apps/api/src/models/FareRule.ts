import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const FareRuleBandSubSchema = new Schema(
  {
    hoursBeforeFrom: { type: Number, required: true, min: 0 },
    hoursBeforeTo: { type: Number, default: null },
    feeType: { type: String, enum: ['FLAT', 'PERCENT', 'NON_REFUNDABLE'], required: true },
    feeValue: { type: Number, default: 0, min: 0 },
    description: { type: String, default: null },
  },
  { _id: false },
);

const FareRuleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },

    cancellationBands: { type: [FareRuleBandSubSchema], default: [] },
    reschedulingBands: { type: [FareRuleBandSubSchema], default: [] },

    noShowFeePaise: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

FareRuleSchema.index({ tenantId: 1, name: 1 });

export type FareRuleDoc = HydratedDocument<InferSchemaType<typeof FareRuleSchema>> & {
  _id: Types.ObjectId;
};
export const FareRule: Model<FareRuleDoc> =
  (mongoose.models.FareRule as Model<FareRuleDoc> | undefined) ??
  model<FareRuleDoc>('FareRule', FareRuleSchema);
