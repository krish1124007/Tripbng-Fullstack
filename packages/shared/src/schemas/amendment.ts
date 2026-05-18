import { z } from 'zod';

export const AMENDMENT_TYPE = ['CANCEL', 'RESCHEDULE', 'REFUND'] as const;
export type AmendmentType = (typeof AMENDMENT_TYPE)[number];

export const AMENDMENT_STATUS = [
  'REQUESTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'FAILED',
] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUS)[number];

export const RescheduleAmendmentDetailsSchema = z.object({
  // The new flight date the agent is requesting. We don't book a replacement automatically —
  // ops re-search and rebook on approval. Phase 6 just records the intent + fees.
  newTravelDate: z.coerce.date(),
  notes: z.string().max(500).optional(),
});

export const CreateAmendmentRequestSchema = z.object({
  bookingId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  type: z.enum(AMENDMENT_TYPE),
  reason: z.string().min(3).max(500),
  // Required when type is RESCHEDULE.
  reschedule: RescheduleAmendmentDetailsSchema.optional(),
});
export type CreateAmendmentRequest = z.infer<typeof CreateAmendmentRequestSchema>;

export const ApproveAmendmentRequestSchema = z.object({
  // Override fee paise — leaves null to use the auto-computed fare-rule fee.
  overrideFeePaise: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
});
export type ApproveAmendmentRequest = z.infer<typeof ApproveAmendmentRequestSchema>;

export const PublicAmendmentSchema = z.object({
  id: z.string(),
  amendmentCode: z.string(),
  bookingId: z.string(),
  bookingCode: z.string(),
  type: z.enum(AMENDMENT_TYPE),
  status: z.enum(AMENDMENT_STATUS),
  reason: z.string(),
  feePaise: z.number().int(),
  refundPaise: z.number().int(),
  reschedule: z
    .object({
      oldTravelDate: z.string().datetime(),
      newTravelDate: z.string().datetime(),
      notes: z.string().nullable(),
    })
    .nullable(),
  requestedByUserId: z.string(),
  approvedByUserId: z.string().nullable(),
  rejectedByUserId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  approvalNotes: z.string().nullable(),
  refundTxnId: z.string().nullable(),
  feeTxnId: z.string().nullable(),
  agencyId: z.string(),
  distributorId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicAmendment = z.infer<typeof PublicAmendmentSchema>;

export const AmendmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(AMENDMENT_STATUS).optional(),
  type: z.enum(AMENDMENT_TYPE).optional(),
});
