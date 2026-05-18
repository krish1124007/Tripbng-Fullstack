import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PRODUCT_TYPE, SUPPLIER_STATUS, SUPPLIER_TYPE } from '@tripbng/shared';

const SupplierSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: SUPPLIER_TYPE, required: true },
    productTypes: [{ type: String, enum: PRODUCT_TYPE }],

    capabilities: {
      search: { type: Boolean, default: true },
      book: { type: Boolean, default: true },
      hold: { type: Boolean, default: false },
      cancel: { type: Boolean, default: true },
      reschedule: { type: Boolean, default: false },
      webCheckin: { type: Boolean, default: false },
    },

    supportedAirlines: [{ type: String, uppercase: true }],

    // Credentials are sensitive — never returned in responses; serializer strips them.
    config: {
      endpoint: { type: String, required: true },
      username: { type: String, select: false },
      password: { type: String, select: false },
      apiKey: { type: String, select: false },
      agentId: { type: String, select: false },
      extra: { type: Schema.Types.Mixed, select: false },
    },

    status: { type: String, enum: SUPPLIER_STATUS, default: 'ACTIVE', index: true },
    notes: { type: String, default: null },

    lastHealthCheckAt: { type: Date, default: null },
    lastHealthCheckOk: { type: Boolean, default: null },
    lastHealthCheckError: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

SupplierSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export type SupplierDoc = HydratedDocument<InferSchemaType<typeof SupplierSchema>> & {
  _id: Types.ObjectId;
};
export const Supplier: Model<SupplierDoc> =
  (mongoose.models.Supplier as Model<SupplierDoc> | undefined) ??
  model<SupplierDoc>('Supplier', SupplierSchema);
