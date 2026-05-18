import { z } from 'zod';

// Travel insurance Zod contracts — single source of truth for API + Web.
// These mirror the ASEGO-side constraints (passport regex, age range, date
// format) but expressed in TripBng-domain field names. The mapper translates
// to ExternalPolicy at the adapter layer.

export const INSURANCE_PAX_TYPE = ['ADULT', 'CHILD', 'INFANT'] as const;
export type InsurancePaxType = (typeof INSURANCE_PAX_TYPE)[number];

const yyyyMmDd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be yyyy-MM-dd');

const indianPassport = z
  .string()
  .regex(/^[A-Z]\d{7}$/, 'passport must be 1 letter + 7 digits (Indian)');

const pincode = z.string().regex(/^\d{6}$/, 'pincode must be 6 digits');

const mobile = z.string().regex(/^\d{10,12}$/, 'mobile must be 10–12 digits, no separators');

const gstin = z.string().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 chars');

// ────────── Traveler ──────────

export const InsuranceNomineeSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  relation: z.string().min(1).max(40),
  age: z.number().int().min(0).max(120).optional(),
});

export const InsuranceTravelerSchema = z.object({
  type: z.enum(INSURANCE_PAX_TYPE).default('ADULT'),
  /** Title is informational on our side — ASEGO doesn't accept it on the wire,
   *  so the mapper drops it. Default keeps existing callers happy. */
  title: z.enum(['MR', 'MRS', 'MS', 'MSTR', 'MISS']).default('MR'),
  firstName: z.string().min(1).max(60),
  middleName: z.string().max(60).optional(),
  lastName: z.string().min(1).max(60),
  dateOfBirth: yyyyMmDd,
  gender: z.enum(['M', 'F', 'O']).default('M'),
  /** Indian passport when international; optional for domestic. */
  passport: indianPassport.optional(),
  email: z.string().email().max(120),
  mobileNo: mobile,
  pincode,
  address: z.string().min(3).max(240),
  /** District name — ASEGO requires this even when blank. */
  district: z.string().min(1).max(60),
  /** State name (full string, not GSTIN state code). */
  state: z.string().min(1).max(60),
  /** Country name — ASEGO requires this. Default 'India' for domestic. */
  country: z.string().min(1).max(60).default('India'),
  /** Required by ASEGO. If the traveler has no separate nominee they are their
   *  own — set relation to 'Self' and use first/last name from the traveler. */
  nominee: InsuranceNomineeSchema,

  /** Auto-fill from a TripBng booking, optional for standalone purchases. */
  pnrNumber: z.string().max(20).optional(),
  flightNumber: z.string().max(10).optional(),
  departureAirportCode: z.string().length(3).optional(),
  arrivalAirportCode: z.string().length(3).optional(),
  departureTime: z.string().datetime().optional(),
  arrivalTime: z.string().datetime().optional(),

  /** B2B agencies only — leave blank for B2C. */
  gstNumber: gstin.optional(),
  gstState: z.string().max(60).optional(),
});
export type InsuranceTraveler = z.infer<typeof InsuranceTravelerSchema>;

// ────────── Plan selection ──────────

export const InsuranceRiderSchema = z.object({
  // ASEGO IDs are UUID-shaped but not hex-strict — Zod's .uuid() rejects them.
  riderId: z.string().min(1).max(64),
  riderName: z.string().min(1).max(80),
  /** rateType drives premium math: 'Loading %' = pct of agePremium, 'Rider Value' = uuid lookup */
  rateType: z.string().min(1).max(40),
  rateValue: z.number(),
});
export type InsuranceRider = z.infer<typeof InsuranceRiderSchema>;

export const InsuranceSelectedPlanSchema = z.object({
  insurerId: z.string().min(1),
  insurerName: z.string().optional(),
  planId: z.string().min(1),
  planName: z.string().optional(),
  sellingPlanId: z.string().min(1),
  /** Total premium in paise — caller computes this from the live quote response. */
  totalPremiumPaise: z.number().int().min(0),
  riders: z.array(InsuranceRiderSchema).default([]),
});
export type InsuranceSelectedPlan = z.infer<typeof InsuranceSelectedPlanSchema>;

// ────────── Quotation block ──────────

export const InsuranceQuotationSchema = z
  .object({
    startDate: yyyyMmDd,
    endDate: yyyyMmDd,
    /** category id from /api/v1/insurance/categories — UUID-shaped but not
     *  hex-strict (e.g. Asia is `296a9c2f-3071-4395-g416-...`). */
    category: z.string().min(1).max(64),
    destination: z.string().max(120).optional(),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type InsuranceQuotation = z.infer<typeof InsuranceQuotationSchema>;

// ────────── Validate / Issue ──────────

export const InsuranceValidateRequestSchema = z.object({
  quotation: InsuranceQuotationSchema,
  selectedPlan: InsuranceSelectedPlanSchema,
  travelers: z.array(InsuranceTravelerSchema).min(1).max(10),
});
export type InsuranceValidateRequest = z.infer<typeof InsuranceValidateRequestSchema>;

export const InsuranceIssueRequestSchema = z.object({
  /** TripBng booking id when available — used as ASEGO orderId for natural idempotency. */
  bookingId: z.string().optional(),
  quotation: InsuranceQuotationSchema,
  selectedPlan: InsuranceSelectedPlanSchema,
  travelers: z.array(InsuranceTravelerSchema).min(1).max(10),
  promoCode: z.string().max(20).optional(),
  remarks: z.string().max(240).optional(),
});
export type InsuranceIssueRequest = z.infer<typeof InsuranceIssueRequestSchema>;

export const InsuranceIssueResponseSchema = z.object({
  policyNumbers: z.array(z.string()).min(1),
  /** Convenience deep-link the frontend uses to download the ticket PDF. */
  downloadUrls: z.array(z.string()),
  totalPremiumPaise: z.number().int(),
  currency: z.string(),
});
export type InsuranceIssueResponse = z.infer<typeof InsuranceIssueResponseSchema>;

// ────────── Endorse / Cancel ──────────

export const InsuranceEndorseRequestSchema = z.object({
  policyNumber: z.string().min(1),
  reasonId: z.string().min(1).max(64),
  remarks: z.string().max(240).optional(),
  /** Optional patches — only set the fields you want to change. */
  newStartDate: yyyyMmDd.optional(),
  newEndDate: yyyyMmDd.optional(),
  newEmail: z.string().email().optional(),
  newMobileNo: mobile.optional(),
  newAddress: z.string().min(3).max(240).optional(),
});
export type InsuranceEndorseRequest = z.infer<typeof InsuranceEndorseRequestSchema>;

export const InsuranceCancelRequestSchema = z.object({
  policyNumber: z.string().min(1),
  reasonId: z.string().min(1).max(64),
  remarks: z.string().max(240).optional(),
});
export type InsuranceCancelRequest = z.infer<typeof InsuranceCancelRequestSchema>;
