// VisaProductDoc — admin-authored visa product, the rich shape behind
// /v1/admin/visa/products and /v1/visa/products/:id reads.
//
// _id is the URL slug (e.g. "thailand-tourist-30d") so the customer URL and
// the Mongo key match exactly. tenantId scopes products to a single TripBng
// tenant. The shape mirrors AdminVisaProductSchema in @tripbng/shared — Zod
// validates at the route layer; this schema stores after validation.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from 'mongoose';
import {
  VISA_APPLICANT_TYPES,
  VISA_APPLICATION_STATES,
  VISA_DOC_FORMATS,
  VISA_ENTRY_TYPES,
  VISA_PRICE_TYPES,
  VISA_PROCESSING_MODES,
  VISA_PURPOSES,
} from '@tripbng/shared';

// ────────── Subschemas ──────────

const PhotoSpecSchema = new Schema(
  {
    widthPx: { type: Number, default: null },
    heightPx: { type: Number, default: null },
    background: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const DocumentEntrySchema = new Schema(
  {
    id: { type: String, required: true },
    code: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: null },
    perApplicant: { type: Boolean, default: true },
    formats: [{ type: String, enum: VISA_DOC_FORMATS }],
    maxSizeBytes: { type: Number, default: 5 * 1024 * 1024 },
    photoSpec: { type: PhotoSpecSchema, default: null },
    required: { type: Boolean, default: true },
    applicantTypes: [{ type: String, enum: VISA_APPLICANT_TYPES }],
  },
  { _id: false },
);

const ProcessStepSchema = new Schema(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true, min: 1 },
    title: { type: String, required: true },
    descriptionHtml: { type: String, default: null },
    estimatedDays: { type: Number, default: null },
  },
  { _id: false },
);

const FaqSchema = new Schema(
  {
    id: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
  },
  { _id: false },
);

const PriceRowSchema = new Schema(
  {
    id: { type: String, required: true },
    priceType: { type: String, enum: VISA_PRICE_TYPES, default: 'Normal' },
    fromPax: { type: Number, required: true, min: 1 },
    toPax: { type: Number, required: true, min: 1 },
    consulateFeeInr: { type: Number, required: true, min: 0 },
    serviceFeeInr: { type: Number, required: true, min: 0 },
    urgentSurchargeInr: { type: Number, default: null },
  },
  { _id: false },
);

const CancellationSlabSchema = new Schema(
  {
    stage: { type: String, enum: VISA_APPLICATION_STATES, required: true },
    chargePercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const EligibilitySchema = new Schema(
  {
    eligibleNationalities: [{ type: String, length: 2 }],
    minAgeYears: { type: Number, default: null },
    maxAgeYears: { type: Number, default: null },
    requiresPriorVisa: { type: Boolean, default: false },
    successNote: { type: String, default: null },
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

// ────────── Top-level product schema ──────────

const VisaProductDocSchema = new Schema(
  {
    /**
     * URL slug + Mongo `_id`. Service layer derives from `name + countryIso2`
     * if omitted on create. Customer URL: /visa/products/[id]
     */
    _id: { type: String, required: true },

    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    countryId: { type: String, required: true, index: true },
    countryName: { type: String, required: true },
    countryIso2: { type: String, required: true, length: 2 },
    region: { type: String, required: true },

    name: { type: String, required: true },
    purpose: { type: String, enum: VISA_PURPOSES, required: true },
    processingMode: { type: String, enum: VISA_PROCESSING_MODES, required: true },
    entryType: { type: String, enum: VISA_ENTRY_TYPES, required: true },

    biometricRequired: { type: Boolean, default: false },
    currency: { type: String, default: 'INR', length: 3 },

    summary: { type: String, default: '' },
    bannerImage: { type: String, default: null },
    gallery: [{ type: String }],

    processingDays: { type: Number, required: true, min: 0 },
    validityDays: { type: Number, required: true, min: 1 },
    stayDays: { type: Number, required: true, min: 1 },

    urgentAvailable: { type: Boolean, default: false },
    urgentProcessingDays: { type: Number, default: null },
    urgentSurchargeInr: { type: Number, default: null },

    eligibility: { type: EligibilitySchema, default: () => ({}) },

    documents: { type: [DocumentEntrySchema], default: [] },
    processSteps: { type: [ProcessStepSchema], default: [] },

    consulateFeeInr: { type: Number, default: 0, min: 0 },
    serviceFeeInr: { type: Number, default: 0, min: 0 },
    priceMatrix: { type: [PriceRowSchema], default: [] },

    inclusions: [{ type: String }],
    exclusions: [{ type: String }],
    faqs: { type: [FaqSchema], default: [] },
    specialNotes: [{ type: String }],
    cancellationPolicyText: [{ type: String }],
    cancellationSchedule: { type: [CancellationSlabSchema], default: [] },

    rating: { type: RatingSchema, default: null },
    published: { type: Boolean, default: false, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    _id: false, // we provide the slug as _id
    timestamps: true,
    collection: 'visa_products',
    minimize: false,
  },
);

// Index compositions per the prompt:
//   - (countryId, published) — for /v1/visa/countries/:countryId list
//   - (published, updatedAt) — for the public listing
// Plus tenantId-prefixed for multi-tenant isolation.
VisaProductDocSchema.index({ tenantId: 1, countryId: 1, published: 1 });
VisaProductDocSchema.index({ tenantId: 1, published: 1, updatedAt: -1 });
VisaProductDocSchema.index({ tenantId: 1, purpose: 1, published: 1 });

export type VisaProductDocData = InferSchemaType<typeof VisaProductDocSchema>;
export type VisaProductDoc = HydratedDocument<VisaProductDocData> & {
  _id: string;
};

export const VisaProductDocModel: Model<VisaProductDoc> =
  (mongoose.models.VisaProductDoc as Model<VisaProductDoc> | undefined) ??
  model<VisaProductDoc>('VisaProductDoc', VisaProductDocSchema);
