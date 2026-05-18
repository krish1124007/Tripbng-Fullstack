// HolidayPackageDoc — admin-authored holiday package, the rich shape behind
// /v1/admin/holidays/packages and /v1/holidays/packages/:id reads.
//
// _id is the URL slug (e.g. "vietnam-cultural-7n") so the customer URL and the
// Mongo key match exactly. tenantId scopes packages to a single TripBng tenant.
// The shape mirrors AdminHolidayPackageSchema in @tripbng/shared — Zod validates
// at the route layer; this schema stores after validation.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from 'mongoose';
import {
  HOLIDAY_DAY_INCLUSION_TAGS,
  HOLIDAY_MEAL_PLANS,
  HOLIDAY_PRICE_TYPES,
} from '@tripbng/shared';

// ────────── Subschemas (one per nested row type) ──────────

const CityStopSchema = new Schema(
  {
    order: { type: Number, required: true },
    city: { type: String, required: true },
    key: { type: String, required: true },
    nights: { type: Number, required: true },
    days: { type: Number, required: true },
  },
  { _id: false },
);

const HotelEntrySchema = new Schema(
  {
    id: { type: String, required: true },
    cityKey: { type: String, required: true },
    name: { type: String, required: true },
    nights: { type: Number, required: true },
    starRating: { type: Number, required: true, min: 1, max: 5 },
    mealPlan: { type: String, enum: HOLIDAY_MEAL_PLANS, required: true },
    roomCategory: { type: String, required: true },
    descriptionHtml: { type: String, default: null },
    imageUrl: { type: String, default: null },
  },
  { _id: false },
);

const SightseeingEntrySchema = new Schema(
  {
    id: { type: String, required: true },
    cityKey: { type: String, required: true },
    name: { type: String, required: true },
    descriptionHtml: { type: String, default: null },
    imageUrl: { type: String, default: null },
  },
  { _id: false },
);

const FlightEntrySchema = new Schema(
  {
    id: { type: String, required: true },
    sector: { type: String, required: true },
    descriptionHtml: { type: String, default: null },
  },
  { _id: false },
);

const DayPlanSchema = new Schema(
  {
    day: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    inclusions: [{ type: String, enum: HOLIDAY_DAY_INCLUSION_TAGS }],
  },
  { _id: false },
);

const PriceRowSchema = new Schema(
  {
    id: { type: String, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    priceType: { type: String, enum: HOLIDAY_PRICE_TYPES, default: 'Normal' },
    fromPax: { type: Number, required: true, min: 1, max: 40 },
    toPax: { type: Number, required: true, min: 1, max: 40 },
    rateVolume: { type: String, default: null },
    singleSharingInr: { type: Number, required: true, min: 0 },
    doubleSharingInr: { type: Number, required: true, min: 0 },
    tripleSharingInr: { type: Number, required: true, min: 0 },
    childWithBedInr: { type: Number, default: 0, min: 0 },
    childWithoutBedInr: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const CancellationSlabSchema = new Schema(
  {
    hoursBeforeDeparture: { type: Number, required: true, min: 0 },
    chargePercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const RatingSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 5 },
    count: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

// ────────── Top-level package schema ──────────

const HolidayPackageDocSchema = new Schema(
  {
    /**
     * URL slug + Mongo `_id`. Service layer derives from `title` if omitted on
     * create. This is what `/holidays/packages/[id]` reads from the URL.
     */
    _id: { type: String, required: true },

    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    title: { type: String, required: true },
    destination: { type: String, required: true },

    visaCountriesHinted: [{ type: String, length: 2 }],
    departureCities: [{ type: String, length: 3 }],
    themes: [{ type: String }],
    themeLabel: { type: String, required: true },

    /** First image is the cover; the rest power the hero carousel. */
    heroImages: [{ type: String }],
    rating: { type: RatingSchema, default: null },

    nights: { type: Number, required: true, min: 1, max: 60 },
    cities: { type: [CityStopSchema], default: [] },

    // hotelsPerCity / sightseeingPerCity are dynamic-keyed objects (cityKey →
    // entries). Mongoose's Mixed lets us preserve the shape exactly without
    // declaring every cityKey upfront. Zod validates the inner shape at the
    // route layer.
    hotelsPerCity: { type: Schema.Types.Mixed, default: () => ({}) },
    sightseeingPerCity: { type: Schema.Types.Mixed, default: () => ({}) },

    inclusions: [{ type: String }],
    exclusions: [{ type: String }],
    dayWise: { type: [DayPlanSchema], default: [] },
    flights: { type: [FlightEntrySchema], default: [] },
    specialNotes: [{ type: String }],
    cancellationPolicyText: [{ type: String }],
    cancellationSchedule: { type: [CancellationSlabSchema], default: [] },
    priceMatrix: { type: [PriceRowSchema], default: [] },

    fixDeparture: { type: Boolean, default: false },
    insuranceBundled: { type: Boolean, default: false },

    flightIncluded: { type: Boolean, default: false },
    bestSeller: { type: Boolean, default: false },
    published: { type: Boolean, default: false, index: true },

    /** BigInt-safe — re-derived by service layer from cheapest priceMatrix row on save. */
    fromPerAdultPaise: { type: String, default: '0' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    // _id is a string slug, so disable Mongoose's ObjectId default.
    _id: false,
    timestamps: true,
    collection: 'holiday_packages',
    /** Keep the Mixed sub-trees from being collapsed by Mongoose. */
    minimize: false,
  },
);

// Index compositions used by the prompt's read paths:
//   list/search:      tenantId + (destination + themes) + published
//   public listing:   tenantId + published + updatedAt (latest-first)
HolidayPackageDocSchema.index({ tenantId: 1, destination: 1, themes: 1 });
HolidayPackageDocSchema.index({ tenantId: 1, published: 1, updatedAt: -1 });

export type HolidayPackageDocData = InferSchemaType<typeof HolidayPackageDocSchema>;
export type HolidayPackageDoc = HydratedDocument<HolidayPackageDocData> & {
  _id: string;
};

export const HolidayPackageDocModel: Model<HolidayPackageDoc> =
  (mongoose.models.HolidayPackageDoc as Model<HolidayPackageDoc> | undefined) ??
  model<HolidayPackageDoc>('HolidayPackageDoc', HolidayPackageDocSchema);
