import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const TenantSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    domain: { type: String, lowercase: true, trim: true },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    settings: {
      defaultCurrency: { type: String, default: 'INR' },
      defaultTimezone: { type: String, default: 'Asia/Kolkata' },
    },
  },
  { timestamps: true },
);

export type TenantDoc = InferSchemaType<typeof TenantSchema>;
export const Tenant: Model<TenantDoc> =
  (mongoose.models.Tenant as Model<TenantDoc> | undefined) ?? model('Tenant', TenantSchema);
