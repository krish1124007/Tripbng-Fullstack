import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import {
  INVENTORY_STATUS,
  TRAVEL_CLASS,
  TRAVEL_TYPE,
  FARE_CLASS_DESCRIPTION,
} from '@tripbng/shared';

const SegmentSubSchema = new Schema(
  {
    flightNumber: { type: String, required: true },
    airline: {
      code: { type: String, required: true, uppercase: true },
      name: { type: String },
      logo: { type: String },
    },
    origin: {
      code: { type: String, required: true, uppercase: true },
      terminal: { type: String },
    },
    destination: {
      code: { type: String, required: true, uppercase: true },
      terminal: { type: String },
    },
    departureTime: { type: String, required: true },
    arrivalTime: { type: String, required: true },
    nextDayArrival: { type: Boolean, default: false },
    duration: { type: Number, required: true },
    stopOver: { type: Number, default: 0 },
    dayChange: { type: Boolean, default: false },
  },
  { _id: false },
);

const InventorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    inventoryCode: { type: String, required: true, unique: true, index: true },

    inventoryName: { type: String, required: true, trim: true },
    status: { type: String, enum: INVENTORY_STATUS, default: 'DRAFT', index: true },

    /** Brand-style fare name printed prominently on the ticket. Snapshotted
     *  onto the Booking at booking time — never read live from inventory at
     *  ticket-render time. Defaults to "SkySaver" so legacy rows keep working. */
    fareName: { type: String, required: true, default: 'SkySaver', trim: true, maxlength: 30 },
    /** Optional one-line summary printed under the fare name on the ticket. */
    fareNameDescription: { type: String, default: '', trim: true, maxlength: 80 },

    travelType: { type: String, enum: TRAVEL_TYPE, required: true, index: true },
    travelClass: { type: String, enum: TRAVEL_CLASS, default: 'ECONOMY' },

    origin: {
      code: { type: String, required: true, uppercase: true, index: true },
      name: { type: String, default: null },
      country: { type: String, default: null },
    },
    destination: {
      code: { type: String, required: true, uppercase: true, index: true },
      name: { type: String, default: null },
      country: { type: String, default: null },
    },

    seriesStartDate: { type: Date, required: true, index: true },
    seriesEndDate: { type: Date, required: true, index: true },
    scheduleFrom: { type: Date, default: null },
    scheduleTo: { type: Date, default: null },

    daysOfOperation: [{ type: Number, min: 0, max: 6 }],

    totalSeats: { type: Number, required: true, min: 0 },
    seatsPerDay: { type: Number, required: true, min: 0 },
    // Atomically decremented by booking flow — never set directly outside that path.
    seatsRemaining: { type: Number, required: true, min: 0 },

    closeBeforeDays: { type: Number, default: 0 },
    classCode: { type: String, default: null },

    isRealTimeBooking: { type: Boolean, default: false },
    airlinePnr: { type: String, default: null },
    classDescription: { type: String, enum: FARE_CLASS_DESCRIPTION, default: null },

    segments: { type: [SegmentSubSchema], default: [] },

    fare: {
      adultFare: { type: Number, required: true, min: 0 },
      childFare: { type: Number, required: true, min: 0 },
      infantFare: { type: Number, default: 0, min: 0 },
      discount: { type: Number, default: 0, min: 0 },
      b2bMarkup: { type: Number, default: 0, min: 0 },
      gstOnMarkup: { type: Boolean, default: false },
      refundable: { type: Boolean, default: false },
      fareRuleDescription: { type: String, default: null },
    },

    baggage: {
      checkin: {
        weight: { type: Number, default: null },
        unit: { type: String, enum: ['KG', 'PC'], default: 'KG' },
      },
      handBaggage: {
        weight: { type: Number, default: null },
        unit: { type: String, enum: ['KG', 'PC'], default: 'KG' },
      },
    },

    bucketPricing: [
      {
        _id: false,
        fromSeat: { type: Number, required: true },
        toSeat: { type: Number, required: true },
        value: { type: Number, required: true },
        type: { type: String, enum: ['ABSOLUTE', 'PERCENT'], default: 'ABSOLUTE' },
        totalAmount: { type: Number, default: null },
        gstOnDynamicFare: { type: Boolean, default: false },
      },
    ],

    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    policyId: { type: Schema.Types.ObjectId, ref: 'Policy', default: null },
    fareRuleId: { type: Schema.Types.ObjectId, ref: 'FareRule', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

InventorySchema.index({
  tenantId: 1,
  'origin.code': 1,
  'destination.code': 1,
  seriesStartDate: 1,
});
InventorySchema.index({ tenantId: 1, status: 1, seriesEndDate: 1 });

export type InventoryDoc = HydratedDocument<InferSchemaType<typeof InventorySchema>> & {
  _id: Types.ObjectId;
};
export const Inventory: Model<InventoryDoc> =
  (mongoose.models.Inventory as Model<InventoryDoc> | undefined) ??
  model<InventoryDoc>('Inventory', InventorySchema);
