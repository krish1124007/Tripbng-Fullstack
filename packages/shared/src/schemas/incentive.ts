import { z } from 'zod';

export const IncentiveSlabSchema = z
  .object({
    minDepositPaise: z.number().int().min(0),
    maxDepositPaise: z.number().int().min(0).nullable(),
    valueType: z.enum(['FLAT', 'PERCENT']).default('PERCENT'),
    // bp×100 for PERCENT (250 = 2.50%); paise for FLAT.
    value: z.number().int().min(0),
    tdsPercent: z.number().int().min(0).max(10000).default(0),
  })
  .refine((s) => s.maxDepositPaise == null || s.maxDepositPaise > s.minDepositPaise, {
    message: 'maxDepositPaise must exceed minDepositPaise',
    path: ['maxDepositPaise'],
  });
export type IncentiveSlab = z.infer<typeof IncentiveSlabSchema>;

export const CreateIncentiveRequestSchema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(500).optional(),
  slabs: z.array(IncentiveSlabSchema).min(1),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date(),
  target: z.enum(['ALL', 'AGENCY_GROUP', 'DISTRIBUTOR_DOWNLINE']).default('ALL'),
  agencyGroupIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  distributorIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  active: z.boolean().default(true),
});
export type CreateIncentiveRequest = z.infer<typeof CreateIncentiveRequestSchema>;

export const UpdateIncentiveRequestSchema = CreateIncentiveRequestSchema.partial();
export type UpdateIncentiveRequest = z.infer<typeof UpdateIncentiveRequestSchema>;

export const PublicIncentiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  slabs: z.array(IncentiveSlabSchema),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
  target: z.enum(['ALL', 'AGENCY_GROUP', 'DISTRIBUTOR_DOWNLINE']),
  agencyGroupIds: z.array(z.string()),
  distributorIds: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicIncentive = z.infer<typeof PublicIncentiveSchema>;
