import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { POLICY_PRODUCT_TYPE, POLICY_STATUS, POLICY_VALUE_TYPE } from '@tripbng/shared';

const PayoutRowSubSchema = new Schema(
  {
    label: { type: String, default: '' },
    valueType: { type: String, enum: POLICY_VALUE_TYPE, default: 'PERCENT' },
    value: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const ComponentSubSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
    valueType: { type: String, enum: POLICY_VALUE_TYPE, default: 'PERCENT' },
    value: { type: Number, default: 0, min: 0 },
    morePayout: { type: Boolean, default: false },
    extraPayouts: { type: [PayoutRowSubSchema], default: [] },
  },
  { _id: false },
);

const ManagementFeeSubSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
    valueType: { type: String, enum: POLICY_VALUE_TYPE, default: 'FLAT' },
    value: { type: Number, default: 0, min: 0 },
    morePayout: { type: Boolean, default: false },
    extraPayouts: { type: [PayoutRowSubSchema], default: [] },
    hideManagementFee: { type: Boolean, default: false },
  },
  { _id: false },
);

const PolicySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // General info
    productType: { type: String, enum: POLICY_PRODUCT_TYPE, default: 'AIR', index: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: POLICY_STATUS, default: 'ACTIVE', index: true },

    // Components
    commission: { type: ComponentSubSchema, default: () => ({}) },
    plb: { type: ComponentSubSchema, default: () => ({}) },
    b2bMarkup: { type: ComponentSubSchema, default: () => ({ valueType: 'FLAT' }) },
    managementFee: { type: ManagementFeeSubSchema, default: () => ({ valueType: 'FLAT' }) },

    notes: { type: String, default: null },

    // Derived legacy pricing fields — consumed by the pricing engine. Written on
    // every save from the component config above (see policy.routes deriveLegacyPricing).
    commissionPercent: { type: Number, default: 0, min: 0, max: 10000 },
    managementFeePaise: { type: Number, default: 0, min: 0 },
    b2bMarkupPaise: { type: Number, default: 0, min: 0 },
    gstOnMarkupOnly: { type: Boolean, default: false },
    gstRateBasisPoints: { type: Number, default: 1800, min: 0, max: 10000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

PolicySchema.index({ tenantId: 1, productType: 1, status: 1 });
PolicySchema.index({ tenantId: 1, name: 1 });

export type PolicyDoc = HydratedDocument<InferSchemaType<typeof PolicySchema>> & {
  _id: Types.ObjectId;
};
export const Policy: Model<PolicyDoc> =
  (mongoose.models.Policy as Model<PolicyDoc> | undefined) ??
  model<PolicyDoc>('Policy', PolicySchema);
