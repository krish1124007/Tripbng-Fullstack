import { z } from 'zod';
import { PAX_TYPE, TRAVEL_CLASS, TRAVEL_TYPE } from '../enums.js';

export const MARKUP_SCOPE = ['PLATFORM', 'DISTRIBUTOR', 'AGENCY'] as const;
export type MarkupScope = (typeof MARKUP_SCOPE)[number];

export const MARKUP_VALUE_TYPE = ['FLAT', 'PERCENT'] as const;
export type MarkupValueType = (typeof MARKUP_VALUE_TYPE)[number];

export const MARKUP_STATUS = ['ACTIVE', 'PAUSED'] as const;
export type MarkupStatus = (typeof MARKUP_STATUS)[number];

export const MarkupConditionsSchema = z.object({
  airlines: z
    .array(
      z
        .string()
        .length(2)
        .regex(/^[A-Z0-9]+$/),
    )
    .optional(),
  travelType: z.enum(TRAVEL_TYPE).optional(),
  travelClass: z.enum(TRAVEL_CLASS).optional(),
  paxTypes: z.array(z.enum(PAX_TYPE)).optional(),
  origins: z.array(z.string().length(3)).optional(),
  destinations: z.array(z.string().length(3)).optional(),
  fareClasses: z.array(z.string()).optional(),
  agencyGroupIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
});
export type MarkupConditions = z.infer<typeof MarkupConditionsSchema>;

export const CreateMarkupRuleRequestSchema = z
  .object({
    name: z.string().min(2).max(120),
    scope: z.enum(MARKUP_SCOPE),
    distributorId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    agencyId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    valueType: z.enum(MARKUP_VALUE_TYPE),
    // Stored as paise (when FLAT) or basis points × 100 (when PERCENT — i.e. 250 = 2.50%).
    value: z.number().int().min(0),
    // Optional cap on percent markups, paise.
    maxValuePaise: z.number().int().min(0).optional(),
    priority: z.number().int().min(0).default(100),
    status: z.enum(MARKUP_STATUS).default('ACTIVE'),
    conditions: MarkupConditionsSchema.default({}),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => d.scope !== 'DISTRIBUTOR' || !!d.distributorId, {
    message: 'distributorId required for DISTRIBUTOR scope',
    path: ['distributorId'],
  })
  .refine((d) => d.scope !== 'AGENCY' || !!d.agencyId, {
    message: 'agencyId required for AGENCY scope',
    path: ['agencyId'],
  });
export type CreateMarkupRuleRequest = z.infer<typeof CreateMarkupRuleRequestSchema>;

export const UpdateMarkupRuleRequestSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  valueType: z.enum(MARKUP_VALUE_TYPE).optional(),
  value: z.number().int().min(0).optional(),
  maxValuePaise: z.number().int().min(0).optional(),
  priority: z.number().int().min(0).optional(),
  status: z.enum(MARKUP_STATUS).optional(),
  conditions: MarkupConditionsSchema.optional(),
  notes: z.string().max(500).optional(),
});
export type UpdateMarkupRuleRequest = z.infer<typeof UpdateMarkupRuleRequestSchema>;

export const PublicMarkupRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(MARKUP_SCOPE),
  distributorId: z.string().nullable(),
  agencyId: z.string().nullable(),
  valueType: z.enum(MARKUP_VALUE_TYPE),
  value: z.number(),
  maxValuePaise: z.number().nullable(),
  priority: z.number(),
  status: z.enum(MARKUP_STATUS),
  conditions: MarkupConditionsSchema,
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicMarkupRule = z.infer<typeof PublicMarkupRuleSchema>;
