import { z } from 'zod';

export const FareRuleBandSchema = z
  .object({
    // Hours before departure window: [hoursBefore, infinity) for the *upper* band, or [hoursBeforeFrom, hoursBeforeTo).
    hoursBeforeFrom: z.number().int().min(0),
    hoursBeforeTo: z.number().int().min(0).nullable(),
    feeType: z.enum(['FLAT', 'PERCENT', 'NON_REFUNDABLE']),
    // Paise for FLAT, basis points × 100 for PERCENT, ignored for NON_REFUNDABLE.
    feeValue: z.number().int().min(0).default(0),
    description: z.string().max(200).optional(),
  })
  .refine((b) => b.hoursBeforeTo == null || b.hoursBeforeTo > b.hoursBeforeFrom, {
    message: 'hoursBeforeTo must be greater than hoursBeforeFrom',
    path: ['hoursBeforeTo'],
  });
export type FareRuleBand = z.infer<typeof FareRuleBandSchema>;

export const CreateFareRuleRequestSchema = z.object({
  name: z.string().min(2).max(120),
  cancellationBands: z.array(FareRuleBandSchema).default([]),
  reschedulingBands: z.array(FareRuleBandSchema).default([]),
  noShowFeePaise: z.number().int().min(0).default(0),
  notes: z.string().max(500).optional(),
});
export type CreateFareRuleRequest = z.infer<typeof CreateFareRuleRequestSchema>;

export const UpdateFareRuleRequestSchema = CreateFareRuleRequestSchema.partial();
export type UpdateFareRuleRequest = z.infer<typeof UpdateFareRuleRequestSchema>;

export const PublicFareRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  cancellationBands: z.array(FareRuleBandSchema),
  reschedulingBands: z.array(FareRuleBandSchema),
  noShowFeePaise: z.number(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicFareRule = z.infer<typeof PublicFareRuleSchema>;
