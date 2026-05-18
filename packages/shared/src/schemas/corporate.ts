// Corporate-account configuration — hotel travel policies, cost centres,
// GL codes, and approval workflow shapes.
//
// All amounts are paise integers for parity with the rest of the codebase.

import { z } from 'zod';

// ────────── Payment terms ──────────

export const PAYMENT_TERMS = ['PREPAID', 'NET_7', 'NET_15', 'NET_30'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

// ────────── Hotel travel policies ──────────
//
// Defaults (when an agency hasn't explicitly set the field):
//   - maxPerNightPaise = null           → no per-night cap
//   - refundableOnly = false            → both refundable + non-refundable allowed
//   - allowedStarRatings = []           → all star ratings allowed
//   - preferredChains / blockedChains = [] → no chain filter
//   - requireApprovalAbovePaise = null  → never require approval
//   - defaultApproverUserId = null      → no approver wired (booking proceeds)
//   - markupPercent = null              → use TBO_DEFAULT_MARKUP_PCT
//
// The policy guard treats every field permissively when null/empty so an
// agency that hasn't configured policies can still book.

export const HotelPoliciesSchema = z.object({
  maxPerNightPaise: z.number().int().min(0).nullable(),
  refundableOnly: z.boolean(),
  preferredChains: z.array(z.string().min(1).max(80)),
  blockedChains: z.array(z.string().min(1).max(80)),
  allowedStarRatings: z.array(z.number().int().min(0).max(5)),
  /** Total selling price above which the booking goes through approval. */
  requireApprovalAbovePaise: z.number().int().min(0).nullable(),
  /** User._id of the default approver. When null + above threshold,
   *  the agency owner is the approver. */
  defaultApproverUserId: z.string().nullable(),
  /** Override TBO_DEFAULT_MARKUP_PCT for this agency. Range 0-50%. */
  markupPercent: z.number().min(0).max(50).nullable(),
});
export type HotelPolicies = z.infer<typeof HotelPoliciesSchema>;

export const DEFAULT_HOTEL_POLICIES: HotelPolicies = {
  maxPerNightPaise: null,
  refundableOnly: false,
  preferredChains: [],
  blockedChains: [],
  allowedStarRatings: [],
  requireApprovalAbovePaise: null,
  defaultApproverUserId: null,
  markupPercent: null,
};

export const UpdateHotelPoliciesSchema = z.object({
  maxPerNightPaise: z.number().int().min(0).nullable().optional(),
  refundableOnly: z.boolean().optional(),
  preferredChains: z.array(z.string().min(1).max(80)).optional(),
  blockedChains: z.array(z.string().min(1).max(80)).optional(),
  allowedStarRatings: z.array(z.number().int().min(0).max(5)).optional(),
  requireApprovalAbovePaise: z.number().int().min(0).nullable().optional(),
  defaultApproverUserId: z.string().nullable().optional(),
  markupPercent: z.number().min(0).max(50).nullable().optional(),
});
export type UpdateHotelPolicies = z.infer<typeof UpdateHotelPoliciesSchema>;

// ────────── Cost centres + GL codes ──────────

export const CostCentreSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  isActive: z.boolean().default(true),
});
export type CostCentre = z.infer<typeof CostCentreSchema>;

export const GlCodeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  /** Optional accounting category — useful for grouping in finance reports. */
  category: z.string().max(60).optional().nullable(),
  isActive: z.boolean().default(true),
});
export type GlCode = z.infer<typeof GlCodeSchema>;

// ────────── Approval workflow ──────────

export const ApproveBookingRequestSchema = z.object({
  note: z.string().max(500).optional(),
});
export type ApproveBookingRequest = z.infer<typeof ApproveBookingRequestSchema>;

export const RejectBookingRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectBookingRequest = z.infer<typeof RejectBookingRequestSchema>;

// ────────── Per-booking corporate tagging ──────────
//
// Optional metadata captured at /book time. The frontend renders cost
// centre + GL code dropdowns sourced from the agency's configured lists.
// All optional — agencies that don't use cost centres just leave them blank.

export const HotelBookingTaggingSchema = z.object({
  costCentreCode: z.string().min(1).max(20).optional(),
  glCode: z.string().min(1).max(20).optional(),
  projectCode: z.string().min(1).max(40).optional(),
});
export type HotelBookingTagging = z.infer<typeof HotelBookingTaggingSchema>;
