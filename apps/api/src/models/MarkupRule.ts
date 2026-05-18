import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import {
  MARKUP_SCOPE,
  MARKUP_STATUS,
  MARKUP_VALUE_TYPE,
  PAX_TYPE,
  TRAVEL_CLASS,
  TRAVEL_TYPE,
} from '@tripbng/shared';

const MarkupRuleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },

    scope: { type: String, enum: MARKUP_SCOPE, required: true, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },

    valueType: { type: String, enum: MARKUP_VALUE_TYPE, required: true },
    value: { type: Number, required: true, min: 0 },
    maxValuePaise: { type: Number, default: null },

    priority: { type: Number, default: 100, index: true },
    status: { type: String, enum: MARKUP_STATUS, default: 'ACTIVE', index: true },

    conditions: {
      airlines: [{ type: String, uppercase: true }],
      travelType: { type: String, enum: TRAVEL_TYPE, default: null },
      travelClass: { type: String, enum: TRAVEL_CLASS, default: null },
      paxTypes: [{ type: String, enum: PAX_TYPE }],
      origins: [{ type: String, uppercase: true }],
      destinations: [{ type: String, uppercase: true }],
      fareClasses: [{ type: String }],
      agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],
      effectiveFrom: { type: Date, default: null },
      effectiveTo: { type: Date, default: null },
    },

    notes: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

MarkupRuleSchema.index({ tenantId: 1, scope: 1, status: 1, priority: 1 });
MarkupRuleSchema.index({ tenantId: 1, distributorId: 1, status: 1 });
MarkupRuleSchema.index({ tenantId: 1, agencyId: 1, status: 1 });

export type MarkupRuleDoc = HydratedDocument<InferSchemaType<typeof MarkupRuleSchema>> & {
  _id: Types.ObjectId;
};
export const MarkupRule: Model<MarkupRuleDoc> =
  (mongoose.models.MarkupRule as Model<MarkupRuleDoc> | undefined) ??
  model<MarkupRuleDoc>('MarkupRule', MarkupRuleSchema);
