// TBO country reference data — synced via CountryList.
//
// Tiny collection (~250 rows). Synced nightly. We don't bother with TTL or
// soft-delete: countries don't appear/disappear in the real world, and
// syncedAt is enough for "is this stale?" queries.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const TboCountrySchema = new Schema(
  {
    /** ISO 3166-1 alpha-2 (per TBO docs). */
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    syncedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Autocomplete by name — country picker on the frontend.
TboCountrySchema.index({ name: 'text' });

export type TboCountryDoc = HydratedDocument<InferSchemaType<typeof TboCountrySchema>> & {
  _id: Types.ObjectId;
};
export const TboCountry: Model<TboCountryDoc> =
  (mongoose.models.TboCountry as Model<TboCountryDoc> | undefined) ??
  model<TboCountryDoc>('TboCountry', TboCountrySchema);
