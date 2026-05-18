// Admin-authored holiday-package schemas.
//
// The legacy `HolidayPackage` type in ./products.ts is the *summary* shape used
// by the search-results card. This file extends that into a rich, admin-authored
// detail shape (`HolidayPackageDetail`) covering the 11-tab editor wireframe:
// cities, hotels-per-city, sightseeing-per-city, day-by-day plan, flights,
// inclusions, exclusions, special notes, cancellation policy, and a pricing
// matrix.
//
// Stored in Mongo under apps/api/src/models/HolidayPackageDoc.ts; admin CRUD
// routes land in Phase B; the editor in Phase C; the customer detail page in
// Phase D.

import { z } from 'zod';

// ────────── Enums ──────────

export const HOLIDAY_MEAL_PLANS = ['EP', 'CP', 'MAP', 'AP'] as const;
export type HolidayMealPlan = (typeof HOLIDAY_MEAL_PLANS)[number];

export const HOLIDAY_DAY_INCLUSION_TAGS = [
  'hotel',
  'transfer',
  'sightseeing',
  'activity',
  'meal',
  'flight',
] as const;
export type HolidayDayInclusionTag = (typeof HOLIDAY_DAY_INCLUSION_TAGS)[number];

export const HOLIDAY_PRICE_TYPES = ['Normal', 'Promo', 'Peak', 'Festive'] as const;
export type HolidayPriceType = (typeof HOLIDAY_PRICE_TYPES)[number];

export const HOLIDAY_ROOM_SHARING_TYPES = ['single', 'double', 'triple'] as const;
export type HolidayRoomSharingType = (typeof HOLIDAY_ROOM_SHARING_TYPES)[number];

// ────────── Nested rows ──────────

export const HolidayCityStopSchema = z.object({
  order: z.number().int().min(1),
  city: z.string().min(1).max(80),
  /** Slug used as the cityKey lookup in hotelsPerCity / sightseeingPerCity. */
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'city key must be lowercase letters, digits, hyphens'),
  nights: z.number().int().min(0).max(60),
  days: z.number().int().min(1).max(60),
});
export type HolidayCityStop = z.infer<typeof HolidayCityStopSchema>;

export const HolidayHotelSchema = z.object({
  /** Stable id within the package. Service layer auto-generates if missing/empty. */
  id: z.string().max(80).optional(),
  cityKey: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  nights: z.number().int().min(0).max(60),
  starRating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  mealPlan: z.enum(HOLIDAY_MEAL_PLANS),
  roomCategory: z.string().min(1).max(120),
  descriptionHtml: z.string().max(8000).optional(),
  imageUrl: z.string().url().max(1024).optional(),
});
export type HolidayHotel = z.infer<typeof HolidayHotelSchema>;

export const HolidaySightseeingSchema = z.object({
  id: z.string().max(80).optional(),
  cityKey: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  descriptionHtml: z.string().max(8000).optional(),
  imageUrl: z.string().url().max(1024).optional(),
});
export type HolidaySightseeing = z.infer<typeof HolidaySightseeingSchema>;

export const HolidayFlightEntrySchema = z.object({
  id: z.string().max(80).optional(),
  /** "BOM-DXB-BOM" or any sector string the operator wants to surface. */
  sector: z.string().min(1).max(80),
  descriptionHtml: z.string().max(8000).optional(),
});
export type HolidayFlightEntry = z.infer<typeof HolidayFlightEntrySchema>;

export const HolidayDayPlanSchema = z.object({
  day: z.number().int().min(1).max(60),
  title: z.string().min(1).max(200),
  description: z.string().max(20000),
  inclusions: z.array(z.enum(HOLIDAY_DAY_INCLUSION_TAGS)).default([]),
});
export type HolidayDayPlan = z.infer<typeof HolidayDayPlanSchema>;

export const HolidayPriceRowSchema = z
  .object({
    id: z.string().max(80).optional(),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date(),
    priceType: z.enum(HOLIDAY_PRICE_TYPES).default('Normal'),
    fromPax: z.number().int().min(1).max(40),
    toPax: z.number().int().min(1).max(40),
    /** Free-text bucket label shown next to the row, e.g. "20–35 pax bulk". */
    rateVolume: z.string().max(40).optional(),
    /** Per-adult INR (rupees, not paise). Service layer × 100 → paise. */
    singleSharingInr: z.number().int().min(0),
    doubleSharingInr: z.number().int().min(0),
    tripleSharingInr: z.number().int().min(0),
    childWithBedInr: z.number().int().min(0).default(0),
    childWithoutBedInr: z.number().int().min(0).default(0),
  })
  .refine((r) => r.fromDate.getTime() <= r.toDate.getTime(), {
    message: 'fromDate must be on or before toDate',
    path: ['toDate'],
  })
  .refine((r) => r.fromPax <= r.toPax, {
    message: 'fromPax must be ≤ toPax',
    path: ['toPax'],
  });
export type HolidayPriceRow = z.infer<typeof HolidayPriceRowSchema>;

export const HolidayCancellationSlabSchema = z
  .object({
    hoursBeforeDeparture: z
      .number()
      .int()
      .min(0)
      .max(24 * 365),
    chargePercent: z.number().min(0).max(100),
  })
  .strict();
export type HolidayCancellationSlab = z.infer<typeof HolidayCancellationSlabSchema>;

export const HolidayRatingSchema = z.object({
  score: z.number().min(0).max(5),
  count: z.number().int().min(0),
});
export type HolidayRating = z.infer<typeof HolidayRatingSchema>;

// ────────── Full admin shape ──────────

/**
 * Full admin-authored holiday package — what the 11-tab editor produces and
 * what the customer detail page renders. The summary fields (title, nights,
 * cities[], inclusions[], themeLabel, perPaxRupees) keep their meaning from
 * the legacy `HolidayPackage` type so the search-card UI doesn't change.
 */
export const AdminHolidayPackageSchema = z
  .object({
    /** URL slug + Mongo `_id`. Service layer derives if omitted on create. */
    id: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9-]+$/, 'id must be lowercase letters, digits, hyphens')
      .optional(),

    title: z.string().min(1).max(200),
    destination: z.string().min(1).max(120),
    /** ISO-2 list — flagged on the detail page. */
    visaCountriesHinted: z.array(z.string().length(2)).default([]),
    /** IATA codes the package departs from. */
    departureCities: z.array(z.string().length(3)).default([]),
    /** "honeymoon" | "family" | "beach" | "adventure" | "luxury" | … free-form on purpose. */
    themes: z.array(z.string().min(1).max(40)).default([]),
    themeLabel: z.string().min(1).max(80),
    /** First image is the cover; the rest power the hero carousel. */
    heroImages: z.array(z.string().url().max(1024)).default([]),
    rating: HolidayRatingSchema.optional(),

    nights: z.number().int().min(1).max(60),
    /** Convenience cache of cities[].city — kept in sync by the service layer. */
    cities: z.array(HolidayCityStopSchema).default([]),
    /** Keyed by HolidayCityStop.key — empty record allowed. */
    hotelsPerCity: z.record(z.string(), z.array(HolidayHotelSchema)).default({}),
    sightseeingPerCity: z.record(z.string(), z.array(HolidaySightseeingSchema)).default({}),

    inclusions: z.array(z.string().max(8000)).default([]),
    exclusions: z.array(z.string().max(8000)).default([]),
    dayWise: z.array(HolidayDayPlanSchema).default([]),
    flights: z.array(HolidayFlightEntrySchema).default([]),
    specialNotes: z.array(z.string().max(8000)).default([]),
    cancellationPolicyText: z.array(z.string().max(8000)).default([]),
    cancellationSchedule: z.array(HolidayCancellationSlabSchema).default([]),
    priceMatrix: z.array(HolidayPriceRowSchema).default([]),

    fixDeparture: z.boolean().default(false),
    insuranceBundled: z.boolean().default(false),

    flightIncluded: z.boolean().default(false),
    bestSeller: z.boolean().default(false),
    published: z.boolean().default(false),

    /** BigInt-safe — the service layer recomputes from the cheapest priceMatrix row on save. */
    fromPerAdultPaise: z.string().regex(/^\d+$/, 'integer paise as string').default('0'),
  })
  .superRefine((pkg, ctx) => {
    // City keys must be unique.
    const seenCityKeys = new Set<string>();
    pkg.cities.forEach((c, i) => {
      if (seenCityKeys.has(c.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate city key "${c.key}"`,
          path: ['cities', i, 'key'],
        });
      }
      seenCityKeys.add(c.key);
    });
    // Day numbers must be a strictly ascending 1..n run with no gaps.
    pkg.dayWise.forEach((d, i) => {
      if (d.day !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Day numbers must be sequential 1..N — entry ${i} has day=${d.day}`,
          path: ['dayWise', i, 'day'],
        });
      }
    });
    // Cancellation schedule must be sorted by hoursBeforeDeparture descending
    // (largest window first) — small enough rule to enforce here, simplifies
    // the customer-page table render.
    for (let i = 1; i < pkg.cancellationSchedule.length; i++) {
      const prev = pkg.cancellationSchedule[i - 1]!;
      const cur = pkg.cancellationSchedule[i]!;
      if (cur.hoursBeforeDeparture > prev.hoursBeforeDeparture) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Cancellation schedule must be sorted by hoursBeforeDeparture descending',
          path: ['cancellationSchedule', i, 'hoursBeforeDeparture'],
        });
      }
    }
    // Price matrix: each row's hotel/per-pax fields must reference cities that exist.
    // (Soft check: only enforce when cities are present — drafts can be partial.)
    if (pkg.cities.length > 0) {
      const cityKeys = new Set(pkg.cities.map((c) => c.key));
      Object.keys(pkg.hotelsPerCity).forEach((key) => {
        if (!cityKeys.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `hotelsPerCity references unknown city key "${key}"`,
            path: ['hotelsPerCity', key],
          });
        }
      });
      Object.keys(pkg.sightseeingPerCity).forEach((key) => {
        if (!cityKeys.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `sightseeingPerCity references unknown city key "${key}"`,
            path: ['sightseeingPerCity', key],
          });
        }
      });
    }
  });

export type AdminHolidayPackage = z.infer<typeof AdminHolidayPackageSchema>;

// ────────── List query + summary ──────────

export const AdminHolidayPackageListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  destinationId: z.string().max(120).optional(),
  publishedOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminHolidayPackageListQuery = z.infer<typeof AdminHolidayPackageListQuerySchema>;

/**
 * The slim shape returned by the admin-list endpoint and by the customer-side
 * `/holidays` search results once Mongo-authored packages flow through.
 *
 * Keeps the same fields as the legacy `HolidayPackage` summary so the existing
 * PackageCard component renders without changes when the API unions Mongo +
 * legacy fixtures.
 */
export const AdminHolidayPackageSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  destination: z.string(),
  nights: z.number().int(),
  cities: z.array(z.string()),
  inclusions: z.array(z.string()),
  themeLabel: z.string(),
  themes: z.array(z.string()),
  fromPerAdultPaise: z.string(),
  /** Convenience field for the existing PackageCard — derived from fromPerAdultPaise. */
  perPaxRupees: z.number().int().min(0),
  flightIncluded: z.boolean(),
  bestSeller: z.boolean(),
  imageUrl: z.string().url().optional(),
  imageGradient: z.string().optional(),
  published: z.boolean(),
  updatedAt: z.string().optional(),
});
export type AdminHolidayPackageSummary = z.infer<typeof AdminHolidayPackageSummarySchema>;
