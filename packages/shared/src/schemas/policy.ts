import { z } from 'zod';

// Policy lives upstream of every markup rule — defaults applied to a supplier's fares
// before any platform/distributor/agency markup runs.
export const CreatePolicyRequestSchema = z.object({
  name: z.string().min(2).max(120),
  // Commission % the supplier owes us (basis points × 100). Subtracted from supplier fare.
  commissionPercent: z.number().int().min(0).max(10000).default(0),
  // Flat management fee (paise) added on top of supplier fare.
  managementFeePaise: z.number().int().min(0).default(0),
  // Default platform B2B markup applied to all fares this policy covers (paise).
  b2bMarkupPaise: z.number().int().min(0).default(0),
  // Whether GST applies on the markup portion only (true) or the whole fare (false).
  gstOnMarkupOnly: z.boolean().default(false),
  // GST rate in basis points × 100 — e.g. 1800 = 18.00%.
  gstRateBasisPoints: z.number().int().min(0).max(10000).default(1800),
  notes: z.string().max(500).optional(),
});
export type CreatePolicyRequest = z.infer<typeof CreatePolicyRequestSchema>;

export const UpdatePolicyRequestSchema = CreatePolicyRequestSchema.partial();
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequestSchema>;

export const PublicPolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  commissionPercent: z.number(),
  managementFeePaise: z.number(),
  b2bMarkupPaise: z.number(),
  gstOnMarkupOnly: z.boolean(),
  gstRateBasisPoints: z.number(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicPolicy = z.infer<typeof PublicPolicySchema>;
