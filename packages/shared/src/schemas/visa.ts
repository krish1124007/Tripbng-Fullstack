// Admin-authored visa-product schemas.
//
// The legacy `VisaQuote` / `VisaQuoteRequest` types in ./products.ts are the
// quote-engine shapes used by the existing /visa/quote mock endpoint. This
// file adds the rich admin-authored product shape (`AdminVisaProduct`) for
// the 11-tab editor wireframe: documents, process steps, eligibility, pricing
// matrix, FAQs, cancellation slabs, etc.
//
// Stored in Mongo under apps/api/src/models/VisaProductDoc.ts; admin CRUD
// routes land in Phase B; the editor in Phase C; the customer detail page in
// Phase D.

import { z } from 'zod';

// ────────── Enums ──────────

export const VISA_PURPOSES = [
  'tourist',
  'business',
  'transit',
  'student',
  'work',
  'dependent',
] as const;
export type VisaPurpose = (typeof VISA_PURPOSES)[number];

export const VISA_PROCESSING_MODES = ['embassy', 'e-visa', 'on-arrival', 'vfs'] as const;
export type VisaProcessingMode = (typeof VISA_PROCESSING_MODES)[number];

export const VISA_ENTRY_TYPES = ['single', 'multiple'] as const;
export type VisaEntryType = (typeof VISA_ENTRY_TYPES)[number];

export const VISA_APPLICANT_TYPES = ['ADT', 'CHD', 'INF'] as const;
export type VisaApplicantType = (typeof VISA_APPLICANT_TYPES)[number];

export const VISA_PRICE_TYPES = ['Normal', 'Promo', 'Peak'] as const;
export type VisaPriceType = (typeof VISA_PRICE_TYPES)[number];

/** Lifecycle states a visa application can be in. The cancellation slab table
 *  uses this to gate refund% per stage. */
export const VISA_APPLICATION_STATES = [
  'created',
  'documents_pending',
  'documents_submitted',
  'lodged',
  'granted',
  'rejected',
] as const;
export type VisaApplicationState = (typeof VISA_APPLICATION_STATES)[number];

export const VISA_DOC_FORMATS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'] as const;
export type VisaDocFormat = (typeof VISA_DOC_FORMATS)[number];

// ────────── Nested rows ──────────

export const VisaPhotoSpecSchema = z
  .object({
    widthPx: z.number().int().min(100).max(2000).optional(),
    heightPx: z.number().int().min(100).max(2000).optional(),
    background: z.string().max(40).optional(), // "white" | "off-white" | …
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type VisaPhotoSpec = z.infer<typeof VisaPhotoSpecSchema>;

export const VisaProductDocumentSchema = z.object({
  id: z.string().max(80).optional(),
  /** Short machine code: "passport_bio" | "photo" | "flight_itinerary" | … */
  code: z.string().min(1).max(80),
  /** Display label surfaced in the customer checklist. */
  label: z.string().min(1).max(160),
  description: z.string().max(8000).optional(),
  /** True = each applicant must upload their own. False = one shared per booking. */
  perApplicant: z.boolean().default(true),
  formats: z.array(z.enum(VISA_DOC_FORMATS)).min(1).default(['pdf', 'jpg']),
  maxSizeBytes: z
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  photoSpec: VisaPhotoSpecSchema.optional(),
  required: z.boolean().default(true),
  applicantTypes: z.array(z.enum(VISA_APPLICANT_TYPES)).min(1).default(['ADT', 'CHD', 'INF']),
});
export type VisaProductDocument = z.infer<typeof VisaProductDocumentSchema>;

export const VisaProcessStepSchema = z.object({
  id: z.string().max(80).optional(),
  order: z.number().int().min(1).max(100),
  title: z.string().min(1).max(200),
  descriptionHtml: z.string().max(8000).optional(),
  estimatedDays: z.number().int().min(0).max(365).optional(),
});
export type VisaProcessStep = z.infer<typeof VisaProcessStepSchema>;

export const VisaFaqSchema = z.object({
  id: z.string().max(80).optional(),
  question: z.string().min(1).max(400),
  answer: z.string().min(1).max(8000),
});
export type VisaFaq = z.infer<typeof VisaFaqSchema>;

export const VisaPriceRowSchema = z
  .object({
    id: z.string().max(80).optional(),
    priceType: z.enum(VISA_PRICE_TYPES).default('Normal'),
    fromPax: z.number().int().min(1).max(40),
    toPax: z.number().int().min(1).max(40),
    consulateFeeInr: z.number().int().min(0),
    serviceFeeInr: z.number().int().min(0),
    urgentSurchargeInr: z.number().int().min(0).optional(),
  })
  .refine((r) => r.fromPax <= r.toPax, {
    message: 'fromPax must be ≤ toPax',
    path: ['toPax'],
  });
export type VisaPriceRow = z.infer<typeof VisaPriceRowSchema>;

export const VisaCancellationSlabSchema = z
  .object({
    stage: z.enum(VISA_APPLICATION_STATES),
    chargePercent: z.number().min(0).max(100),
  })
  .strict();
export type VisaCancellationSlab = z.infer<typeof VisaCancellationSlabSchema>;

export const VisaEligibilitySchema = z.object({
  /** ISO-2 codes. Empty array = "all nationalities". */
  eligibleNationalities: z.array(z.string().length(2)).default([]),
  minAgeYears: z.number().int().min(0).max(120).optional(),
  maxAgeYears: z.number().int().min(0).max(120).optional(),
  requiresPriorVisa: z.boolean().default(false),
  /** Free-form editorial note ("Schengen / US visa improves issuance odds…"). */
  successNote: z.string().max(8000).optional(),
});
export type VisaEligibility = z.infer<typeof VisaEligibilitySchema>;

export const VisaRatingSchema = z.object({
  score: z.number().min(0).max(5),
  count: z.number().int().min(0),
});
export type VisaRating = z.infer<typeof VisaRatingSchema>;

// ────────── Full admin shape ──────────

export const AdminVisaProductSchema = z
  .object({
    /** URL slug + Mongo `_id`. Service layer derives if omitted on create. */
    id: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, 'id must be lowercase letters, digits, hyphens')
      .optional(),

    /** Country slug — distinct from `id` so multiple visa products per country are possible. */
    countryId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, 'countryId must be lowercase letters, digits, hyphens'),
    countryName: z.string().min(1).max(80),
    countryIso2: z.string().length(2),
    region: z.string().min(1).max(80),

    name: z.string().min(1).max(200),
    purpose: z.enum(VISA_PURPOSES),
    processingMode: z.enum(VISA_PROCESSING_MODES),
    entryType: z.enum(VISA_ENTRY_TYPES),

    biometricRequired: z.boolean().default(false),
    currency: z.string().length(3).default('INR'),

    summary: z.string().max(20000).default(''),
    bannerImage: z.string().url().max(1024).optional(),
    gallery: z.array(z.string().url().max(1024)).default([]),

    processingDays: z.number().int().min(0).max(365),
    validityDays: z.number().int().min(1).max(3650),
    stayDays: z.number().int().min(1).max(3650),

    urgentAvailable: z.boolean().default(false),
    urgentProcessingDays: z.number().int().min(0).max(60).optional(),
    urgentSurchargeInr: z.number().int().min(0).optional(),

    eligibility: VisaEligibilitySchema.default({
      eligibleNationalities: [],
      requiresPriorVisa: false,
    }),

    documents: z.array(VisaProductDocumentSchema).default([]),
    processSteps: z.array(VisaProcessStepSchema).default([]),

    consulateFeeInr: z.number().int().min(0).default(0),
    serviceFeeInr: z.number().int().min(0).default(0),
    priceMatrix: z.array(VisaPriceRowSchema).default([]),

    inclusions: z.array(z.string().max(8000)).default([]),
    exclusions: z.array(z.string().max(8000)).default([]),
    faqs: z.array(VisaFaqSchema).default([]),
    specialNotes: z.array(z.string().max(8000)).default([]),
    cancellationPolicyText: z.array(z.string().max(8000)).default([]),
    cancellationSchedule: z.array(VisaCancellationSlabSchema).default([]),

    rating: VisaRatingSchema.optional(),
    published: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    // Process-step orders must be a strict 1..N sequence.
    p.processSteps
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((s, i) => {
        if (s.order !== i + 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `processSteps.order must be 1..N — got ${s.order} at sorted position ${i}`,
            path: ['processSteps', i, 'order'],
          });
        }
      });
    // Document codes must be unique within a product.
    const seenCodes = new Set<string>();
    p.documents.forEach((d, i) => {
      if (seenCodes.has(d.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate document code "${d.code}"`,
          path: ['documents', i, 'code'],
        });
      }
      seenCodes.add(d.code);
    });
    // Cancellation slabs must have unique stages.
    const seenStages = new Set<string>();
    p.cancellationSchedule.forEach((s, i) => {
      if (seenStages.has(s.stage)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate stage "${s.stage}"`,
          path: ['cancellationSchedule', i, 'stage'],
        });
      }
      seenStages.add(s.stage);
    });
    // If urgentAvailable, urgent-processing-days + surcharge should be set.
    if (p.urgentAvailable) {
      if (p.urgentProcessingDays == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'urgentProcessingDays is required when urgentAvailable is true',
          path: ['urgentProcessingDays'],
        });
      }
      if (p.urgentSurchargeInr == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'urgentSurchargeInr is required when urgentAvailable is true',
          path: ['urgentSurchargeInr'],
        });
      }
    }
    if (
      p.eligibility.minAgeYears != null &&
      p.eligibility.maxAgeYears != null &&
      p.eligibility.minAgeYears > p.eligibility.maxAgeYears
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'eligibility.minAgeYears must be ≤ maxAgeYears',
        path: ['eligibility', 'maxAgeYears'],
      });
    }
  });

export type AdminVisaProduct = z.infer<typeof AdminVisaProductSchema>;

// ────────── List query + summary ──────────

export const AdminVisaProductListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  countryId: z.string().max(120).optional(),
  publishedOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminVisaProductListQuery = z.infer<typeof AdminVisaProductListQuerySchema>;

/**
 * Summary shape returned by admin/list and customer-list endpoints. Slim by
 * design — full detail fetched when the customer lands on the per-product page.
 */
export const AdminVisaProductSummarySchema = z.object({
  id: z.string(),
  countryId: z.string(),
  countryName: z.string(),
  countryIso2: z.string(),
  region: z.string(),
  name: z.string(),
  purpose: z.enum(VISA_PURPOSES),
  processingMode: z.enum(VISA_PROCESSING_MODES),
  entryType: z.enum(VISA_ENTRY_TYPES),
  processingDays: z.number().int(),
  consulateFeeInr: z.number().int().min(0),
  serviceFeeInr: z.number().int().min(0),
  urgentAvailable: z.boolean(),
  bannerImage: z.string().url().optional(),
  rating: VisaRatingSchema.optional(),
  published: z.boolean(),
  updatedAt: z.string().optional(),
});
export type AdminVisaProductSummary = z.infer<typeof AdminVisaProductSummarySchema>;
