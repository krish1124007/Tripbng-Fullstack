import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const AgencyGroupSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    agencyIds: [{ type: Schema.Types.ObjectId, ref: 'Agency' }],
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

AgencyGroupSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type AgencyGroupDoc = HydratedDocument<InferSchemaType<typeof AgencyGroupSchema>> & {
  _id: Types.ObjectId;
};
export const AgencyGroup: Model<AgencyGroupDoc> =
  (mongoose.models.AgencyGroup as Model<AgencyGroupDoc> | undefined) ??
  model<AgencyGroupDoc>('AgencyGroup', AgencyGroupSchema);
