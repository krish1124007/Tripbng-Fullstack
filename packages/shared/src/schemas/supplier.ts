import { z } from 'zod';

export const SUPPLIER_TYPE = ['OTA', 'CONSOLIDATOR', 'DIRECT', 'GDS', 'IN_HOUSE'] as const;
export type SupplierType = (typeof SUPPLIER_TYPE)[number];

export const SUPPLIER_STATUS = ['ACTIVE', 'PAUSED', 'DISABLED'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUS)[number];

export const PRODUCT_TYPE = ['FLIGHT', 'HOTEL', 'BUS', 'VISA'] as const;
export type ProductType = (typeof PRODUCT_TYPE)[number];

export const SupplierCapabilitiesSchema = z.object({
  search: z.boolean().default(true),
  book: z.boolean().default(true),
  hold: z.boolean().default(false),
  cancel: z.boolean().default(true),
  reschedule: z.boolean().default(false),
  webCheckin: z.boolean().default(false),
});

export const SupplierConfigSchema = z.object({
  endpoint: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  apiKey: z.string().optional(),
  agentId: z.string().optional(),
  extra: z.record(z.unknown()).optional(),
});

export const CreateSupplierRequestSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, 'Use uppercase letters, digits, hyphens, underscores'),
  name: z.string().min(2).max(120),
  type: z.enum(SUPPLIER_TYPE),
  productTypes: z.array(z.enum(PRODUCT_TYPE)).min(1),
  config: SupplierConfigSchema,
  capabilities: SupplierCapabilitiesSchema.optional(),
  supportedAirlines: z.array(z.string()).optional(),
  status: z.enum(SUPPLIER_STATUS).default('ACTIVE'),
  notes: z.string().max(500).optional(),
});
export type CreateSupplierRequest = z.infer<typeof CreateSupplierRequestSchema>;

export const UpdateSupplierRequestSchema = CreateSupplierRequestSchema.partial();
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequestSchema>;

export const PublicSupplierSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.enum(SUPPLIER_TYPE),
  productTypes: z.array(z.enum(PRODUCT_TYPE)),
  capabilities: SupplierCapabilitiesSchema,
  supportedAirlines: z.array(z.string()),
  status: z.enum(SUPPLIER_STATUS),
  configEndpoint: z.string(),
  notes: z.string().nullable(),
  lastHealthCheckAt: z.string().datetime().nullable(),
  lastHealthCheckOk: z.boolean().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicSupplier = z.infer<typeof PublicSupplierSchema>;

export const SupplierSourceTravelType = ['DOMESTIC', 'INTERNATIONAL', 'BOTH'] as const;
export type SupplierSourceTravelTypeT = (typeof SupplierSourceTravelType)[number];

export const SUPPLIER_SOURCE_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type SupplierSourceStatus = (typeof SUPPLIER_SOURCE_STATUS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Map Source — the "Manage Supplier → Map Source" admin record.
//
// The schema mirrors the form in screenshot 2 of the spec PDF (one section
// per accordion in the form). Most fields are optional so the admin can land
// a minimal row first and refine later.
// ─────────────────────────────────────────────────────────────────────────────

/** Original supplier code → masked code the agent sees. */
export const CodeMaskSchema = z.object({
  original: z.string().min(1).max(40),
  masked: z.string().min(1).max(40),
});
export type CodeMask = z.infer<typeof CodeMaskSchema>;

export const RestrictTravelSchema = z.object({
  dateFrom: z.string().datetime().nullable().optional(),
  dateTo: z.string().datetime().nullable().optional(),
  /** Minutes-since-midnight IST. 0–1439. */
  timeStartMinutes: z.number().int().min(0).max(1439).nullable().optional(),
  timeEndMinutes: z.number().int().min(0).max(1439).nullable().optional(),
});
export type RestrictTravel = z.infer<typeof RestrictTravelSchema>;

export const ManualIssuanceSchema = z
  .object({
    /** Master switch for the entire manual-issuance branch. */
    pendingBooking: z.boolean().default(false),
    maximumPax: z.number().int().min(1).nullable().optional(),
    minAmountPaisePerPax: z.number().int().min(0).nullable().optional(),
    maxAmountPaisePerPax: z.number().int().min(0).nullable().optional(),
    tripType: z.enum(['ONEWAY', 'ROUND_TRIP', 'MULTI_CITY']).nullable().optional(),
    /** Comma-separated booking classes — e.g. "K,T,YJ". Form validation
     *  stays loose here so admins can paste from supplier docs. */
    bookingClass: z.string().max(200).nullable().optional(),
    /** Comma-separated fare-basis codes. */
    fareBasis: z.string().max(400).nullable().optional(),
    fromDate: z.string().datetime().nullable().optional(),
    toDate: z.string().datetime().nullable().optional(),
    bookingDateFrom: z.string().datetime().nullable().optional(),
    bookingDateTo: z.string().datetime().nullable().optional(),
    applyForNonStopFlight: z.boolean().default(false),
    applyForStopFlight: z.boolean().default(false),
    /** Comma-separated sectors — e.g. "DEL-BOM,DEL-DXB". */
    sector: z.string().max(400).nullable().optional(),
  })
  // Cross-field sanity — min <= max when both set.
  .refine(
    (v) =>
      v.minAmountPaisePerPax == null ||
      v.maxAmountPaisePerPax == null ||
      v.minAmountPaisePerPax <= v.maxAmountPaisePerPax,
    { message: 'minAmountPaisePerPax must be ≤ maxAmountPaisePerPax', path: ['minAmountPaisePerPax'] },
  )
  .refine(
    (v) => !v.fromDate || !v.toDate || new Date(v.fromDate) <= new Date(v.toDate),
    { message: 'fromDate must be ≤ toDate', path: ['fromDate'] },
  )
  .refine(
    (v) =>
      !v.bookingDateFrom ||
      !v.bookingDateTo ||
      new Date(v.bookingDateFrom) <= new Date(v.bookingDateTo),
    { message: 'bookingDateFrom must be ≤ bookingDateTo', path: ['bookingDateFrom'] },
  );
export type ManualIssuance = z.infer<typeof ManualIssuanceSchema>;

/** Free-form travel criteria — UI section still being shaped; keep
 *  permissive until the spec pins down. */
export const TravelCriteriaSchema = z.object({
  raw: z.unknown().nullable().optional(),
});
export type TravelCriteria = z.infer<typeof TravelCriteriaSchema>;

export const CreateSupplierSourceSchema = z.object({
  /** Display name surfaced in the list view. Optional on the legacy path
   *  for back-compat; the new admin UI requires it. */
  name: z.string().min(1).max(120).optional(),
  /** Free-form admin grouping ("tripbng group1"). */
  supplierGroup: z.string().max(60).nullable().optional(),
  supplierId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  productType: z.enum(PRODUCT_TYPE),
  travelType: z.enum(SupplierSourceTravelType),
  /** IATA airline codes that pass through. Empty = "no airlines pass" (a
   *  legitimate kill-switch the admin may want). */
  airlineCodes: z.array(z.string().min(1).max(8)).default([]),
  /** Agency-group ObjectIds. Empty = applies to ALL agency groups. */
  agencyGroupIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  maskBookingClassCodes: z.array(CodeMaskSchema).default([]),
  maskFareTypes: z.array(CodeMaskSchema).default([]),
  hideFareTypes: z.array(z.string().min(1).max(80)).default([]),
  restrictTravel: RestrictTravelSchema.optional(),
  manualIssuance: ManualIssuanceSchema.optional(),
  travelCriteria: TravelCriteriaSchema.optional(),
  priority: z.number().int().min(0).default(100),
  status: z.enum(SUPPLIER_SOURCE_STATUS).default('ACTIVE'),
  /** Legacy bool — accepted on the way in for back-compat, mirrored to
   *  `status` server-side via the model's pre-save hook. */
  enabled: z.boolean().optional(),
});
export type CreateSupplierSource = z.infer<typeof CreateSupplierSourceSchema>;

export const UpdateSupplierSourceSchema = CreateSupplierSourceSchema.partial();
export type UpdateSupplierSource = z.infer<typeof UpdateSupplierSourceSchema>;

/** Shape the admin UI consumes. Includes derived display fields the
 *  server hydrates (supplier name + agency-group names) so the list
 *  page doesn't need to round-trip per row. */
export const PublicSupplierSourceSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  supplierGroup: z.string().nullable(),
  supplierId: z.string(),
  supplierCode: z.string().optional(),
  supplierName: z.string().optional(),
  productType: z.enum(PRODUCT_TYPE),
  travelType: z.enum(SupplierSourceTravelType),
  airlineCodes: z.array(z.string()),
  agencyGroupIds: z.array(z.string()),
  agencyGroupNames: z.array(z.string()).optional(),
  maskBookingClassCodes: z.array(CodeMaskSchema),
  maskFareTypes: z.array(CodeMaskSchema),
  hideFareTypes: z.array(z.string()),
  restrictTravel: RestrictTravelSchema,
  manualIssuance: ManualIssuanceSchema,
  travelCriteria: TravelCriteriaSchema,
  priority: z.number(),
  status: z.enum(SUPPLIER_SOURCE_STATUS),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicSupplierSource = z.infer<typeof PublicSupplierSourceSchema>;
