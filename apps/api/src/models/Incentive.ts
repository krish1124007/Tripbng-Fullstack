import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const IncentiveSlabSubSchema = new Schema(
  {
    minDepositPaise: { type: Number, required: true, min: 0 },
    maxDepositPaise: { type: Number, default: null },
    valueType: { type: String, enum: ['FLAT', 'PERCENT'], default: 'PERCENT' },
    value: { type: Number, required: true, min: 0 },
    tdsPercent: { type: Number, default: 0, min: 0, max: 10000 },
  },
  { _id: false },
);

const IncentiveSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    slabs: { type: [IncentiveSlabSubSchema], default: [] },

    validFrom: { type: Date, required: true, index: true },
    validTo: { type: Date, required: true, index: true },

    target: {
      type: String,
      enum: ['ALL', 'AGENCY_GROUP', 'DISTRIBUTOR_DOWNLINE'],
      default: 'ALL',
    },
    agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],
    distributorIds: [{ type: Schema.Types.ObjectId, ref: 'Distributor' }],

    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

IncentiveSchema.index({ tenantId: 1, active: 1, validFrom: 1, validTo: 1 });

export type IncentiveDoc = HydratedDocument<InferSchemaType<typeof IncentiveSchema>> & {
  _id: Types.ObjectId;
};
export const Incentive: Model<IncentiveDoc> =
  (mongoose.models.Incentive as Model<IncentiveDoc> | undefined) ??
  model<IncentiveDoc>('Incentive', IncentiveSchema);
