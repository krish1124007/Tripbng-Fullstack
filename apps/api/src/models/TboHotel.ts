// TBO hotel reference data — synced via HotelCodeList (lightweight) +
// HotelDetails (heavy, on-demand).
//
// Two-stage population strategy:
//   1. HotelCodeList → upserts a minimal row per code (just hotelCode, cityId,
//      countryCode). Fast. Done nightly for tracked cities.
//   2. HotelDetails → enriches with name, address, geo, amenities, images,
//      hotelPolicy, etc. Slow, batched, lazy: only fetched the first time a
//      hotel is viewed in the UI, or via admin trigger.
//
// `detailsSyncedAt` is null when only the lightweight stage has run; presence
// is the signal that the row is "ready for surfacing in search results".
//
// `rawDetails` keeps the full HotelDetails response Mixed-typed for fallback
// — TBO's amenity vocabulary changes, and we'd rather have everything than
// realize next quarter we're missing a field.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const TboHotelSchema = new Schema(
  {
    /** TBO's hotel code — the identifier passed to Search/PreBook. */
    hotelCode: { type: String, required: true, unique: true, index: true },
    cityId: { type: String, required: true, index: true },
    countryCode: { type: String, required: true, index: true },

    // Populated by stage 1 (HotelCodeList) when TBO returns a name; otherwise
    // filled in by stage 2 (HotelDetails).
    name: { type: String, default: null },
    starRating: { type: Number, default: null },

    // Populated only by stage 2 (HotelDetails).
    address: { type: String, default: null },
    pinCode: { type: String, default: null },
    geo: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    description: { type: String, default: null },
    amenities: { type: [String], default: [] },
    images: {
      type: [
        {
          url: { type: String },
          caption: { type: String },
        },
      ],
      default: [],
    },
    hotelPolicy: { type: String, default: null },
    checkInTime: { type: String, default: null },
    checkOutTime: { type: String, default: null },

    /** Full HotelDetails response (Mixed). Used as a fallback when the
     *  curated fields don't have a particular attribute we need. */
    rawDetails: { type: Schema.Types.Mixed, default: null },
    /** Set by HotelCodeList sweep. */
    syncedAt: { type: Date, required: true },
    /** Set by HotelDetails enrichment. Null = stage 2 hasn't run yet. */
    detailsSyncedAt: { type: Date, default: null },
    /** Soft-delete: TBO occasionally removes hotels from inventory. */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

TboHotelSchema.index({ name: 'text', address: 'text' }); // autocomplete
TboHotelSchema.index({ cityId: 1, starRating: -1, isActive: 1 }); // city search ordering

export type TboHotelDoc = HydratedDocument<InferSchemaType<typeof TboHotelSchema>> & {
  _id: Types.ObjectId;
};
export const TboHotel: Model<TboHotelDoc> =
  (mongoose.models.TboHotel as Model<TboHotelDoc> | undefined) ??
  model<TboHotelDoc>('TboHotel', TboHotelSchema);
