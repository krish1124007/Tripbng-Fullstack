// TBO city reference data — synced via CityList(countryCode).
//
// Indian + key SE Asia cities only in phase 1 (~3K rows). Phase 2 expands.
// We persist cityId as the primary identifier (TBO's own code, used in
// HotelCodeList queries) and index on countryCode for filtered lookups.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const TboCitySchema = new Schema(
  {
    /** TBO's city code — the value passed to HotelCodeList. */
    cityId: { type: String, required: true, unique: true, index: true },
    countryCode: { type: String, required: true, index: true },
    name: { type: String, required: true },
    /** State/province — when TBO returns it. Optional. */
    state: { type: String, default: null },
    geo: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    /** Cached count of hotels TBO advertises for this city — useful for
     *  "is this a real metro or just a tag?" filtering on autocomplete. */
    hotelCount: { type: Number, default: null },
    syncedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

TboCitySchema.index({ name: 'text' }); // autocomplete
TboCitySchema.index({ countryCode: 1, name: 1 }); // listing screens

export type TboCityDoc = HydratedDocument<InferSchemaType<typeof TboCitySchema>> & {
  _id: Types.ObjectId;
};
export const TboCity: Model<TboCityDoc> =
  (mongoose.models.TboCity as Model<TboCityDoc> | undefined) ??
  model<TboCityDoc>('TboCity', TboCitySchema);
