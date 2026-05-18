import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { BANNER_FREQUENCY, BANNER_LOCATION, BANNER_TARGET, BANNER_TYPE } from '@tripbng/shared';

const BannerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    title: { type: String, required: true },
    imageUrl: { type: String, default: null },
    href: { type: String, default: null },
    body: { type: String, default: null },

    type: { type: String, enum: BANNER_TYPE, default: 'FIXED' },
    location: { type: String, enum: BANNER_LOCATION, default: 'AGENCY_DASHBOARD', index: true },
    target: { type: String, enum: BANNER_TARGET, default: 'ALL' },
    agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],
    distributorIds: [{ type: Schema.Types.ObjectId, ref: 'Distributor' }],

    frequency: { type: String, enum: BANNER_FREQUENCY, default: 'PER_SESSION' },
    priority: { type: Number, default: 100, index: true },

    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null, index: true },
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

BannerSchema.index({ tenantId: 1, location: 1, active: 1, priority: 1 });

export type BannerDoc = HydratedDocument<InferSchemaType<typeof BannerSchema>> & {
  _id: Types.ObjectId;
};
export const Banner: Model<BannerDoc> =
  (mongoose.models.Banner as Model<BannerDoc> | undefined) ??
  model<BannerDoc>('Banner', BannerSchema);
