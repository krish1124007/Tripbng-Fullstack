import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import {
  FARE_RULE_CABIN_TYPE,
  FARE_RULE_CONDITION_ACTION,
  FARE_RULE_REFUND_TYPE,
  FARE_RULE_STATUS,
  FARE_RULE_TRIP_TYPE,
} from '@tripbng/shared';

// Time-range fee band for cancellation / reschedule. Charges are layered:
// percentage of fare + flat penalty + service fee. toHours=null → open-ended.
const PolicyBandSubSchema = new Schema(
  {
    fromHours: { type: Number, required: true, min: 0, default: 0 },
    toHours: { type: Number, default: null },
    percentage: { type: Number, default: 0, min: 0, max: 100 },
    penaltyAmountPaise: { type: Number, default: 0, min: 0 },
    additionalFeePaise: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

// Condition row — narrows which fares the rule applies to. Empty field = any.
const FareConditionSubSchema = new Schema(
  {
    origin: { type: String, default: '', uppercase: true, trim: true },
    destination: { type: String, default: '', uppercase: true, trim: true },
    fareType: { type: String, default: '', trim: true },
    bookingClass: { type: String, default: '', uppercase: true, trim: true },
    fareBasis: { type: String, default: '', uppercase: true, trim: true },
    sector: { type: String, default: '', uppercase: true, trim: true },
    travelDate: { type: Date, default: null },
  },
  { _id: false },
);

const FareRuleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // General info
    name: { type: String, required: true, trim: true },
    tripType: { type: String, enum: FARE_RULE_TRIP_TYPE, default: 'ALL', index: true },
    cabinType: { type: String, enum: FARE_RULE_CABIN_TYPE, default: 'ALL' },
    refundType: { type: String, enum: FARE_RULE_REFUND_TYPE, default: 'REFUNDABLE' },
    status: { type: String, enum: FARE_RULE_STATUS, default: 'ACTIVE', index: true },

    // Relations — airline (IATA), source supplier, agency group this rule scopes to.
    airline: { type: String, default: '', uppercase: true, trim: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    agencyGroupId: { type: Schema.Types.ObjectId, ref: 'AgencyGroup', default: null, index: true },

    // Condition fields
    conditionAction: { type: String, enum: FARE_RULE_CONDITION_ACTION, default: 'INCLUDE' },
    scheduleFrom: { type: Date, default: null },
    scheduleTo: { type: Date, default: null },
    conditions: { type: [FareConditionSubSchema], default: [] },

    // Fare rule info — policies
    cancellationBands: { type: [PolicyBandSubSchema], default: [] },
    reschedulingBands: { type: [PolicyBandSubSchema], default: [] },
    noShowPenaltyPaise: { type: Number, default: 0, min: 0 },
    noShowAdditionalFeePaise: { type: Number, default: 0, min: 0 },

    // Additional info
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
