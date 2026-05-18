import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { AGENCY_STATUS } from '@tripbng/shared';

const DistributorSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    distributorCode: { type: String, required: true, unique: true, index: true },

    // Public-facing referral code shared with prospective agents at sign-up
    // time. Short + memorable (e.g. "DST-9F3K"). Distinct from
    // `distributorCode` which is the internal full-address style identifier
    // used in admin (e.g. "DT-BLR-0011"). Distributors generate / rotate
    // this from their cockpit; the registration form's "Distributor code"
    // field is validated against this column.
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, index: true },

    companyName: { type: String, required: true },
    legalName: { type: String, default: null },
    logo: { type: String, default: null },

    country: { type: String, default: 'IN' },
    state: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
    address: { type: String, required: true },

    walletBalance: { type: Number, default: 0 },
    creditLimit: { type: Number, default: 0 },

    overrideCommissionPercent: { type: Number, default: 0, min: 0, max: 100 },

    status: { type: String, enum: AGENCY_STATUS, default: 'PENDING', index: true },
    blockedReason: { type: String, default: null },

    pan: {
      number: { type: String, select: false },
      name: { type: String },
      imageUrl: { type: String },
    },
    gst: {
      number: { type: String },
      imageUrl: { type: String },
    },

    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Denormalized counter — incremented when agencies are created under this distributor.
    agencyCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export type DistributorDoc = HydratedDocument<InferSchemaType<typeof DistributorSchema>> & {
  _id: Types.ObjectId;
};
export const Distributor: Model<DistributorDoc> =
  (mongoose.models.Distributor as Model<DistributorDoc> | undefined) ??
  model<DistributorDoc>('Distributor', DistributorSchema);
