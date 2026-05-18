// ApprovalRequest API schemas — request bodies + response shapes for
// the /api/v1/bus/approvals surface.
//
// Money in PAISE everywhere — matches the rest of TripBNG. The web
// form converts to/from rupees at the field boundary.

import { z } from 'zod';

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'booked',
] as const;
export const ApprovalStatusEnum = z.enum(APPROVAL_STATUSES);
export type ApprovalStatusEnumT = z.infer<typeof ApprovalStatusEnum>;

// ────────── Submit ──────────

export const BusApprovalSubmitSchema = z.object({
  /** Employee on whose behalf this request is created. The actor may be
   *  the employee themselves or a travel-desk admin. */
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid ObjectId'),

  sourceCityId: z.number().int().positive(),
  destinationCityId: z.number().int().positive(),
  doj: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'doj must be yyyy-MM-dd'),

  tripId: z.string().min(1),
  inventoryId: z.string().min(1),
  seatNumbers: z.array(z.string().min(1)).min(1).max(8),
  boardingPointId: z.number().int().nonnegative(),
  droppingPointId: z.number().int().nonnegative(),

  estimatedFarePaise: z.number().int().positive(),
  operatorName: z.string().max(80).optional(),
  operatorId: z.number().int().nonnegative(),
  busType: z.string().max(120).optional(),
  busTypeId: z.number().int().nonnegative().optional(),
  isAc: z.boolean().optional(),
  isSleeper: z.boolean().optional(),

  /** ISO timestamps from the search-result decoration. */
  departureAt: z.string().datetime(),
  arrivalAt: z.string().datetime(),
});
export type BusApprovalSubmit = z.infer<typeof BusApprovalSubmitSchema>;

// ────────── Decide (approve / reject) ──────────

export const ApprovalApproveSchema = z.object({
  /** Optional manager note. */
  note: z.string().max(500).optional(),
});
export type ApprovalApprove = z.infer<typeof ApprovalApproveSchema>;

export const ApprovalRejectSchema = z.object({
  /** Required + ≥10 chars per CLAUDE.md §9. */
  note: z.string().min(10, 'rejection note must be ≥10 characters').max(500),
});
export type ApprovalReject = z.infer<typeof ApprovalRejectSchema>;

// ────────── List query ──────────

export const ApprovalListQuerySchema = z.object({
  status: ApprovalStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;

// ────────── Public response ──────────

export const PublicBusApprovalPayloadSchema = z.object({
  sourceCityId: z.number().int().positive(),
  destinationCityId: z.number().int().positive(),
  doj: z.string(),
  tripId: z.string(),
  inventoryId: z.string(),
  seatNumbers: z.array(z.string()),
  boardingPointId: z.number().int().nonnegative(),
  droppingPointId: z.number().int().nonnegative(),
  estimatedFarePaise: z.number().int().nonnegative(),
  estimatedTotalPaise: z.number().int().nonnegative(),
  operatorName: z.string(),
  busType: z.string(),
  departureAt: z.string(),
  arrivalAt: z.string(),
});
export type PublicBusApprovalPayload = z.infer<typeof PublicBusApprovalPayloadSchema>;

export const PublicApprovalSchema = z.object({
  id: z.string(),
  type: z.literal('bus'),
  status: ApprovalStatusEnum,
  employeeId: z.string(),
  managerId: z.string().nullable(),
  travelPolicyId: z.string().nullable(),
  payload: PublicBusApprovalPayloadSchema,
  policyViolations: z.array(z.string()),
  approverNote: z.string().nullable(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedByUserId: z.string().nullable(),
  bookingId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicApproval = z.infer<typeof PublicApprovalSchema>;

export const ApprovalListResponseSchema = z.object({
  items: z.array(PublicApprovalSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>;

// ────────── Submit response ──────────
// The submit response also surfaces the policy-eval result so the SPA
// can show "auto-approved" inline + a violation list when applicable.

export const PolicyEvalResultSchema = z.object({
  ok: z.boolean(),
  violations: z.array(z.string()),
  requiresApproval: z.boolean(),
  autoApproveEligible: z.boolean(),
});
export type PolicyEvalResultPublic = z.infer<typeof PolicyEvalResultSchema>;

export const BusApprovalSubmitResponseSchema = z.object({
  approval: PublicApprovalSchema,
  policy: PolicyEvalResultSchema,
});
export type BusApprovalSubmitResponse = z.infer<typeof BusApprovalSubmitResponseSchema>;
