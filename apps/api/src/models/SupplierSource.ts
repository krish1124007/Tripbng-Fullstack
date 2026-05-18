import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import { PRODUCT_TYPE } from '@tripbng/shared';

const SupplierSourceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },

    productType: { type: String, enum: PRODUCT_TYPE, required: true, index: true },
    travelType: {
      type: String,
      enum: ['DOMESTIC', 'INTERNATIONAL', 'BOTH'],
      default: 'BOTH',
      index: true,
    },

    airlineCodes: [{ type: String, uppercase: true }],

    priority: { type: Number, default: 100, index: true },
    enabled: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

SupplierSourceSchema.index({ tenantId: 1, productType: 1, enabled: 1, priority: 1 });

export type SupplierSourceDoc = InferSchemaType<typeof SupplierSourceSchema>;
export const SupplierSource: Model<SupplierSourceDoc> =
  (mongoose.models.SupplierSource as Model<SupplierSourceDoc> | undefined) ??
  model('SupplierSource', SupplierSourceSchema);
